import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SubscriberStatus } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { maskPhone } from '../common/phone/phone.util';
import { InboundMessage, MESSAGING_PROVIDER, MessagingProvider } from '../messaging/messaging.types';
import { OutboundService } from '../messaging/outbound.service';
import { SubscribersRepository } from './subscribers.repository';
import { SubscribersService } from './subscribers.service';

const JOIN = /^(?:JOIN|START|SUBSCRIBE)\s+([A-Z0-9]{6})$/;
const STOP = /^(?:STOP|STOP ALL|UNSUBSCRIBE|CANCEL|END|QUIT|OPT OUT|OPTOUT)$/;
const RESUME = /^(?:START|RESUME|UNSTOP)$/;

/**
 * Handles keywords sent to our WhatsApp number:
 *   JOIN <code>  → confirms a web sign-up (proves the person owns the number)
 *   STOP …       → opt out
 *   START        → opt back in
 *
 * Everything else is ignored on purpose: this is a personal number, and normal conversations
 * must never get automated replies.
 */
@Injectable()
export class InboundCommandsService implements OnModuleInit {
  private readonly logger = new Logger(InboundCommandsService.name);

  constructor(
    @Inject(MESSAGING_PROVIDER) private readonly provider: MessagingProvider,
    private readonly outbound: OutboundService,
    private readonly subscribers: SubscribersService,
    private readonly repo: SubscribersRepository,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    this.provider.onInbound((m) => this.handle(m));
  }

  async handle(m: InboundMessage): Promise<void> {
    const text = m.text.trim().toUpperCase().replace(/\s+/g, ' ');
    const join = JOIN.exec(text);
    if (join) return this.confirm(join[1], m);
    if (STOP.test(text)) return this.stop(m);
    if (RESUME.test(text)) return this.resume(m);
  }

  private async confirm(code: string, m: InboundMessage): Promise<void> {
    const sub = await this.repo.findByConfirmCode(code);
    const signupUrl = this.config.get('PUBLIC_WEB_URL');
    if (!sub || sub.status !== SubscriberStatus.PENDING || !sub.confirmCodeExpiresAt || sub.confirmCodeExpiresAt < new Date()) {
      return this.reply(m, `That code is invalid or has expired. Please sign up again at ${signupUrl}`);
    }
    // If WhatsApp tells us the sender's number, it must be the number that signed up.
    if (m.phoneE164 && m.phoneE164 !== sub.phoneE164) {
      this.logger.warn(`Confirm code used from ${maskPhone(m.phoneE164)} for ${maskPhone(sub.phoneE164)}; rejected`);
      return this.reply(m, `This code belongs to a different number. Please sign up at ${signupUrl} with the number you are messaging from.`);
    }
    const { welcomeQueued } = await this.subscribers.activate(sub, m.channelAddress);
    this.logger.log(`Subscriber ${maskPhone(sub.phoneE164)} confirmed via WhatsApp`);
    if (!welcomeQueued) {
      await this.reply(m, "✅ You're subscribed! Your daily verse starts tomorrow. Reply STOP anytime to unsubscribe.");
    }
  }

  private async stop(m: InboundMessage): Promise<void> {
    const sub = await this.repo.findByChannel(m.channelAddress, m.phoneE164, [SubscriberStatus.ACTIVE, SubscriberStatus.PENDING]);
    if (!sub) return; // not a subscriber — leave personal chats alone
    await this.subscribers.optOut(sub);
    await this.reply(m, "You've been unsubscribed and won't receive more verses. Reply START to subscribe again.");
  }

  private async resume(m: InboundMessage): Promise<void> {
    const sub = await this.repo.findByChannel(m.channelAddress, m.phoneE164, [SubscriberStatus.UNSUBSCRIBED]);
    if (!sub) return;
    await this.subscribers.resume(sub, m.channelAddress);
    await this.reply(m, "🙏 Welcome back! Your daily verse resumes tomorrow. Reply STOP anytime to unsubscribe.");
  }

  private async reply(m: InboundMessage, text: string): Promise<void> {
    try {
      await this.outbound.send({ phoneE164: m.phoneE164 ?? '', channelAddress: m.channelAddress }, text);
    } catch (err) {
      this.logger.warn(`Could not send reply: ${(err as Error).message}`);
    }
  }
}
