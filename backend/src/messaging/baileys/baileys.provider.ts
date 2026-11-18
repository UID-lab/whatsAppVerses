import { Logger } from '@nestjs/common';
import pino from 'pino';
import type { ConnectionState as BaileysConnectionState, WAMessage, WASocket } from '@whiskeysockets/baileys';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { jitter, sleep } from '../../common/time/time.util';
import { SenderStateRepository } from '../sender-state.repository';
import {
  ConnectionState,
  InboundHandler,
  MessagingProvider,
  PermanentSendError,
  ProviderStatus,
  Recipient,
  SendResult,
  TransientSendError,
} from '../messaging.types';
import { usePrismaAuthState } from './prisma-auth-state';

type BaileysRuntime = typeof import('@whiskeysockets/baileys');

const SEND_TIMEOUT_MS = 30_000;
const MAX_RECONNECT_DELAY_MS = 120_000;

/**
 * WhatsApp via Baileys: an unofficial WhatsApp Web (multi-device) client over a WebSocket.
 * The server becomes a "linked device" of your own WhatsApp account, like WhatsApp Web,
 * so messages are sent from your number at no per-message cost and without a browser.
 *
 * Baileys is ESM-only; it is loaded lazily with require() (supported for ESM since Node 22.12),
 * so processes that never send (PROCESS_ROLE=api, or the console provider) never load it.
 */
export class BaileysMessagingProvider implements MessagingProvider {
  readonly name = 'baileys';
  private readonly logger = new Logger('BaileysProvider');
  private readonly waLogger = pino({ level: process.env.BAILEYS_LOG_LEVEL ?? 'warn' });

  private baileys?: BaileysRuntime;
  private sock?: WASocket;
  private clearAuth?: () => Promise<void>;
  private handlers: InboundHandler[] = [];
  private wantRunning = false;
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private restrictedUntil: Date | null = null;
  private current: ProviderStatus = { provider: 'baileys', connection: 'stopped' };

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly stateRepo: SenderStateRepository,
  ) {}

  // ---- lifecycle ------------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.wantRunning) return;
    this.wantRunning = true;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    this.baileys ??= require('@whiskeysockets/baileys') as BaileysRuntime;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.wantRunning = false;
    clearTimeout(this.reconnectTimer);
    this.sock?.end(undefined);
    this.sock = undefined;
    await this.setStatus({ connection: 'stopped', qr: null });
  }

  isReady(): boolean {
    if (this.restrictedUntil && this.restrictedUntil > new Date()) return false;
    return this.current.connection === 'open' && !!this.sock;
  }

  status(): ProviderStatus {
    return { ...this.current };
  }

  onInbound(handler: InboundHandler): void {
    this.handlers.push(handler);
  }

  private async connect(): Promise<void> {
    const b = this.baileys!;
    await this.setStatus({ connection: 'connecting', lastError: null });

    const auth = await usePrismaAuthState(this.prisma, this.config.get('WA_SESSION_ID'), b);
    this.clearAuth = auth.clear;

    let version: [number, number, number] | undefined;
    try {
      version = (await b.fetchLatestBaileysVersion()).version;
    } catch {
      version = undefined; // fall back to the version bundled with the library
    }

    const sock = b.makeWASocket({
      ...(version ? { version } : {}),
      auth: { creds: auth.state.creds, keys: b.makeCacheableSignalKeyStore(auth.state.keys, this.waLogger) },
      logger: this.waLogger,
      browser: b.Browsers.ubuntu('Chrome'),
      // Don't appear "online" all the time: your phone keeps getting notifications.
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldIgnoreJid: (jid) => b.isJidGroup(jid) || b.isJidBroadcast(jid) || b.isJidNewsletter(jid),
      getMessage: async () => undefined,
    });
    this.sock = sock;

    sock.ev.on('creds.update', () => void auth.saveCreds());
    sock.ev.on('connection.update', (u) => void this.onConnectionUpdate(sock, u));
    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const m of messages) void this.onMessage(sock, m);
    });
    sock.ev.on('message-capping.update', (cap) =>
      this.logger.warn(`WhatsApp new-chat message cap: used ${cap.used_quota}/${cap.total_quota} (${cap.capping_status})`),
    );
  }

  private async onConnectionUpdate(sock: WASocket, u: Partial<BaileysConnectionState>): Promise<void> {
    if (sock !== this.sock) return; // event from a socket we've already replaced
    const b = this.baileys!;

    if (u.reachoutTimeLock?.isActive) {
      this.restrictedUntil = u.reachoutTimeLock.timeEnforcementEnds ?? new Date(Date.now() + 24 * 3600_000);
      this.logger.error(
        `WhatsApp has temporarily restricted this account from messaging (until ${this.restrictedUntil.toISOString()}). Sending is paused.`,
      );
      await this.setStatus({ lastError: `Account restricted by WhatsApp until ${this.restrictedUntil.toISOString()}` });
    }

    if (u.qr) {
      this.logger.warn('WhatsApp is not linked yet. Open the admin page (/admin) and scan the QR code.');
      await this.setStatus({ connection: 'awaiting_link', qr: u.qr });
    }

    if (u.connection === 'open') {
      this.reconnectAttempts = 0;
      const account = b.jidDecode(sock.user?.id ?? '')?.user ?? null;
      const expected = this.config.get('WA_PHONE_NUMBER');
      if (account && account !== expected) {
        this.logger.error(`Linked account ${account} does not match WA_PHONE_NUMBER=${expected}. Refusing to send.`);
        await this.setStatus({ connection: 'error', account, qr: null, lastError: 'Linked to the wrong WhatsApp number' });
        return;
      }
      this.logger.log(`WhatsApp connected as ${account}`);
      await this.setStatus({ connection: 'open', account, qr: null, lastError: null });
      sock
        .fetchNewChatMessageCap()
        .then((cap) => cap && this.logger.log(`New-chat message quota: ${cap.used_quota ?? '?'}/${cap.total_quota ?? '?'}`))
        .catch(() => undefined);
    }

    if (u.connection === 'close') {
      const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      const reason = u.lastDisconnect?.error?.message ?? 'unknown';
      this.sock = undefined;

      if (code === b.DisconnectReason.loggedOut) {
        this.logger.error('WhatsApp session was logged out (device unlinked). A new QR code will be generated.');
        await this.clearAuth?.();
        await this.setStatus({ connection: 'logged_out', account: null, lastError: 'Logged out — relink required' });
        if (this.wantRunning) this.scheduleReconnect(2_000);
        return;
      }
      if (code === b.DisconnectReason.connectionReplaced) {
        // Another process opened the same session. Don't fight over it (that looks abusive).
        this.logger.error('WhatsApp connection replaced by another client. Stopping this sender.');
        await this.setStatus({ connection: 'error', lastError: 'Connection replaced by another client' });
        this.wantRunning = false;
        return;
      }
      await this.setStatus({ connection: 'connecting', lastError: `Disconnected (${code ?? '?'}: ${reason})` });
      if (this.wantRunning) {
        const delay = code === b.DisconnectReason.restartRequired ? 0 : this.backoffDelay();
        this.scheduleReconnect(delay);
      }
    }
  }

  private backoffDelay(): number {
    this.reconnectAttempts++;
    return Math.min(MAX_RECONNECT_DELAY_MS, jitter(2_000 * 2 ** Math.min(this.reconnectAttempts, 6), 0.2));
  }

  private scheduleReconnect(delayMs: number): void {
    clearTimeout(this.reconnectTimer);
    this.logger.log(`Reconnecting to WhatsApp in ${Math.round(delayMs / 1000)}s`);
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        this.logger.error(`Reconnect failed: ${(err as Error).message}`);
        if (this.wantRunning) this.scheduleReconnect(this.backoffDelay());
      });
    }, delayMs);
  }

  // ---- inbound --------------------------------------------------------------------------------

  private async onMessage(sock: WASocket, m: WAMessage): Promise<void> {
    const b = this.baileys!;
    const jid = m.key.remoteJid;
    if (!jid || m.key.fromMe) return;
    if (!(b.isPnUser(jid) || b.isLidUser(jid))) return; // 1:1 chats only

    const text = (m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? '').trim();
    if (!text) return;

    try {
      const phoneE164 = await this.resolvePhone(sock, jid, m.key.remoteJidAlt);
      for (const handler of this.handlers) {
        await handler({
          channelAddress: jid,
          phoneE164,
          text,
          providerMessageId: m.key.id ?? '',
          receivedAt: new Date(Number(m.messageTimestamp ?? 0) * 1000 || Date.now()),
        });
      }
    } catch (err) {
      this.logger.error(`Inbound handler failed: ${(err as Error).message}`);
    }
  }

  /** WhatsApp may address users by a privacy "LID" instead of their phone number; map it back. */
  private async resolvePhone(sock: WASocket, jid: string, alt?: string | null): Promise<string | null> {
    const b = this.baileys!;
    let pnJid: string | null = null;
    if (b.isPnUser(jid)) pnJid = jid;
    else if (alt && b.isPnUser(alt)) pnJid = alt;
    else {
      try {
        pnJid = await sock.signalRepository.lidMapping.getPNForLID(jid);
      } catch {
        pnJid = null;
      }
    }
    const user = pnJid ? b.jidDecode(pnJid)?.user : null;
    return user ? `+${user}` : null;
  }

  // ---- outbound -------------------------------------------------------------------------------

  async sendText(to: Recipient, text: string, opts?: { simulateTyping?: boolean }): Promise<SendResult> {
    const sock = this.sock;
    if (!sock || !this.isReady()) throw new TransientSendError('WhatsApp is not connected');

    let jid = to.channelAddress ?? null;
    if (!jid) {
      const digits = to.phoneE164.replace(/^\+/, '');
      const [result] = (await sock.onWhatsApp(digits)) ?? [];
      if (!result?.exists) throw new PermanentSendError('Number is not registered on WhatsApp');
      jid = result.jid;
    }

    try {
      if (opts?.simulateTyping) {
        await sock.sendPresenceUpdate('composing', jid).catch(() => undefined);
        await sleep(jitter(Math.min(4_000, 600 + text.length * 8), 0.3));
        await sock.sendPresenceUpdate('paused', jid).catch(() => undefined);
      }
      const sent = await Promise.race([
        sock.sendMessage(jid, { text }),
        sleep(SEND_TIMEOUT_MS).then(() => {
          throw new TransientSendError('Timed out waiting for WhatsApp to accept the message');
        }),
      ]);
      return { providerMessageId: sent?.key?.id ?? null, resolvedAddress: jid };
    } catch (err) {
      if (err instanceof TransientSendError || err instanceof PermanentSendError) throw err;
      throw new TransientSendError((err as Error).message);
    }
  }

  // ---- linking --------------------------------------------------------------------------------

  async requestPairingCode(phoneDigits: string): Promise<string> {
    if (!this.sock) throw new Error('WhatsApp socket is not running on this instance');
    if (this.sock.authState.creds.registered) throw new Error('This session is already linked');
    return this.sock.requestPairingCode(phoneDigits);
  }

  async logout(): Promise<void> {
    if (this.sock) await this.sock.logout().catch(() => undefined);
    await this.clearAuth?.();
  }

  private async setStatus(patch: Partial<ProviderStatus> & { connection?: ConnectionState }): Promise<void> {
    this.current = { ...this.current, ...patch, provider: this.name };
    await this.stateRepo.save(this.current);
  }
}
