import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';
import { jitter, localDate, sleep } from '../common/time/time.util';
import { MESSAGING_PROVIDER, MessagingProvider, Recipient, SendResult, TransientSendError } from './messaging.types';

export class DailyCapReachedError extends TransientSendError {}

/**
 * The only path to the provider. Every outgoing message — daily verses and keyword replies —
 * goes through here, so pacing and the daily cap apply to all of them:
 *
 *  - Pacing: messages are serialized and spaced ~60/MESSAGES_PER_MINUTE seconds apart with
 *    ±30% random jitter (fixed-interval bursts are an easy bot signal).
 *  - Daily cap: a per-day counter in MySQL (`send_counters`) survives restarts and failover.
 *
 * Runs only on the single sender process, so in-memory pacing state is authoritative.
 */
@Injectable()
export class OutboundService {
  private readonly logger = new Logger(OutboundService.name);
  private chain: Promise<unknown> = Promise.resolve();
  private nextSlotAt = 0;

  constructor(
    @Inject(MESSAGING_PROVIDER) private readonly provider: MessagingProvider,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  isReady(): boolean {
    return this.provider.isReady();
  }

  async sentToday(): Promise<number> {
    const row = await this.prisma.sendCounter.findUnique({ where: { day: this.today() } });
    return row?.sent ?? 0;
  }

  async remainingToday(): Promise<number> {
    return Math.max(0, this.config.get('DAILY_SEND_CAP') - (await this.sentToday()));
  }

  /** Paced, capped send. Resolves after the provider accepted the message. */
  send(to: Recipient, text: string): Promise<SendResult> {
    const run = async () => {
      await this.waitForSlot();
      if ((await this.remainingToday()) <= 0) throw new DailyCapReachedError('Daily send cap reached');
      const result = await this.provider.sendText(to, text, { simulateTyping: this.config.get('SIMULATE_TYPING') });
      await this.incrementCounter().catch((err) => this.logger.warn(`Counter update failed: ${err.message}`));
      return result;
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async waitForSlot(): Promise<void> {
    const wait = this.nextSlotAt - Date.now();
    if (wait > 0) await sleep(wait);
    const interval = 60_000 / this.config.get('MESSAGES_PER_MINUTE');
    this.nextSlotAt = Date.now() + jitter(interval, 0.3);
  }

  private async incrementCounter(): Promise<void> {
    const day = this.today();
    await this.prisma.$executeRaw`
      INSERT INTO send_counters (day, sent) VALUES (${day}, 1)
      ON DUPLICATE KEY UPDATE sent = sent + 1`;
  }

  private today(): Date {
    return localDate(this.config.get('APP_TIMEZONE'));
  }
}
