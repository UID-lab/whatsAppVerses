/**
 * The sending abstraction. Business logic (subscribers, delivery queue) only depends on this
 * interface; swapping Baileys for the official WhatsApp Cloud API, Twilio, Telegram, etc. means
 * writing one new class and changing MESSAGING_PROVIDER — nothing else.
 */
export const MESSAGING_PROVIDER = Symbol('MESSAGING_PROVIDER');

export type ConnectionState = 'stopped' | 'connecting' | 'awaiting_link' | 'open' | 'logged_out' | 'error';

export interface ProviderStatus {
  provider: string;
  connection: ConnectionState;
  /** Raw QR payload while waiting to be linked (render it as a QR code). */
  qr?: string | null;
  /** The account this provider is logged in as (e.g. "918971775506"). */
  account?: string | null;
  lastError?: string | null;
}

export interface Recipient {
  /** E.164 number, always present. */
  phoneE164: string;
  /** Provider-specific address learned from an inbound message (preferred when present). */
  channelAddress?: string | null;
}

export interface SendResult {
  providerMessageId: string | null;
  /** Address the provider actually delivered to; stored so later sends skip the lookup. */
  resolvedAddress?: string | null;
}

export interface InboundMessage {
  /** Address to reply to (WhatsApp JID for Baileys). */
  channelAddress: string;
  /** Sender's number in E.164, when the provider can resolve it. */
  phoneE164: string | null;
  text: string;
  providerMessageId: string;
  receivedAt: Date;
}

export type InboundHandler = (message: InboundMessage) => Promise<void>;

/** Thrown for failures that will never succeed on retry (e.g. number not on WhatsApp). */
export class PermanentSendError extends Error {
  readonly permanent = true;
}

/** Thrown when the provider can't send right now (disconnected, timeout, rate limited). */
export class TransientSendError extends Error {
  readonly permanent = false;
}

export interface MessagingProvider {
  readonly name: string;
  /** Connect (may require linking). Called only on the process that holds the sender lease. */
  start(): Promise<void>;
  stop(): Promise<void>;
  isReady(): boolean;
  status(): ProviderStatus;
  sendText(to: Recipient, text: string, opts?: { simulateTyping?: boolean }): Promise<SendResult>;
  onInbound(handler: InboundHandler): void;
  /** Optional: link without scanning a QR code. Returns the 8-character pairing code. */
  requestPairingCode?(phoneDigits: string): Promise<string>;
  /** Optional: unlink the device and wipe the stored session. */
  logout?(): Promise<void>;
}
