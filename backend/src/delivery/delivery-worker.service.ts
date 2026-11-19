import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DeliveryKind, SubscriberStatus } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { firstVerseTiming, formatClockTime, isWithinWindow, sleep } from '../common/time/time.util';
import { PermanentSendError } from '../messaging/messaging.types';
import { DailyCapReachedError, OutboundService } from '../messaging/outbound.service';
import { SenderLeadershipService } from '../messaging/sender-leadership.service';
import { VersesService } from '../verses/verses.service';
import { formatVerseMessage, formatWelcomeMessage } from '../verses/verse-formatter';
import { retryDelayMs } from './backoff';
import { ClaimedDelivery, DeliveryRepository } from './delivery.repository';

const IDLE_POLL_MS = 10_000;
const NOT_READY_POLL_MS = 15_000;
const CAP_REACHED_POLL_MS = 5 * 60_000;
const CLAIM_LOCK_SECONDS = 600;

/**
 * Drains the delivery queue. Runs only on the process holding the sender lease.
 * Throughput is set by OutboundService pacing (MESSAGES_PER_MINUTE), not by this loop.
 */
@Injectable()
export class DeliveryWorkerService implements OnModuleInit {
  private readonly logger = new Logger(DeliveryWorkerService.name);
  private running = false;
  private loop?: Promise<void>;
  private wakeUp?: () => void;

  constructor(
    private readonly repo: DeliveryRepository,
    private readonly verses: VersesService,
    private readonly outbound: OutboundService,
    private readonly leadership: SenderLeadershipService,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    this.leadership.onLeadershipChange((isLeader) => (isLeader ? this.start() : this.stop()));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
    this.logger.log('Delivery worker started');
  }

  /** Stops after the message currently being sent (never abandons a send halfway). */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.wakeUp?.();
    await this.loop;
    const released = await this.repo.releaseClaims(this.config.instanceId).catch(() => 0);
    this.logger.log(`Delivery worker stopped${released ? ` (${released} claimed deliveries returned to the queue)` : ''}`);
  }

  /** Skip the idle wait (e.g. right after a welcome message was queued). */
  wake(): void {
    this.wakeUp?.();
  }

  private async pause(ms: number): Promise<void> {
    await Promise.race([sleep(ms), new Promise<void>((resolve) => (this.wakeUp = resolve))]);
    this.wakeUp = undefined;
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        if (!this.outbound.isReady()) {
          await this.pause(NOT_READY_POLL_MS);
          continue;
        }
        const remaining = await this.outbound.remainingToday();
        if (remaining <= 0) {
          this.logger.warn('Daily send cap reached; pausing until tomorrow');
          await this.pause(CAP_REACHED_POLL_MS);
          continue;
        }
        const inWindow = isWithinWindow(
          this.config.get('APP_TIMEZONE'),
          this.config.get('SEND_WINDOW_START'),
          this.config.get('SEND_WINDOW_END'),
        );
        const batch = await this.repo.claim(
          this.config.instanceId,
          Math.min(this.config.get('CLAIM_BATCH_SIZE'), remaining),
          CLAIM_LOCK_SECONDS,
          !inWindow, // outside the window only welcome replies go out
        );
        if (batch.length === 0) {
          await this.pause(IDLE_POLL_MS);
          continue;
        }
        for (const delivery of batch) {
          // Once stopped, unprocessed claims are simply returned to the queue by the reaper.
          if (!this.running) break;
          await this.process(delivery);
        }
      } catch (err) {
        this.logger.error(`Worker loop error: ${(err as Error).message}`, (err as Error).stack);
        await this.pause(IDLE_POLL_MS);
      }
    }
  }

  /** Wording for the welcome message, matching what SubscribersService scheduled. */
  private firstVerseText(): string {
    const at = formatClockTime(this.config.get('DAILY_SEND_TIME'));
    switch (
      firstVerseTiming(
        this.config.get('APP_TIMEZONE'),
        this.config.get('DAILY_SEND_TIME'),
        this.config.get('SEND_WINDOW_START'),
        this.config.get('SEND_WINDOW_END'),
      )
    ) {
      case 'today':
        return `today at ${at}`;
      case 'now':
        return 'in a few minutes';
      default:
        return `tomorrow at ${at}`;
    }
  }

  private async process(d: ClaimedDelivery): Promise<void> {
    const sub = d.subscriber;
    if (sub.status !== SubscriberStatus.ACTIVE) {
      await this.repo.markSkipped(d.id, `Subscriber is ${sub.status}`);
      return;
    }

    let text: string;
    let verseId: number | null = null;
    const isWelcome = d.kind === DeliveryKind.WELCOME;
    if (isWelcome) {
      // Greeting only; the first verse goes out with tomorrow's daily run.
      text = formatWelcomeMessage(sub.name, this.config.get('BRAND_NAME'), this.firstVerseText());
    } else {
      // A retried delivery keeps the verse it was given the first time.
      let verse = d.verse;
      if (!verse) {
        verse = await this.verses.nextVerse(sub);
        if (!verse && this.config.get('ON_VERSES_EXHAUSTED') === 'restart' && (await this.verses.poolSize(sub.verseType)) > 0) {
          const cleared = await this.verses.clearHistory(sub.id, sub.verseType);
          this.logger.log(`Subscriber ${sub.id} received all ${cleared} ${sub.verseType} verses; starting a new cycle`);
          verse = await this.verses.nextVerse(sub);
        }
        if (!verse) {
          const pool = await this.verses.poolSize(sub.verseType);
          if (pool === 0) {
            await this.repo.markRetry(d.id, 'No verses available (seed not run?)', 30 * 60_000, true);
          } else {
            this.logger.log(`Subscriber ${sub.id} has received all ${pool} ${sub.verseType} verses; nothing left to send`);
            await this.repo.markSkipped(d.id, `All ${pool} ${sub.verseType} verses already delivered`);
          }
          return;
        }
        await this.repo.assignVerse(d.id, verse.id);
      }
      verseId = verse.id;
      text = formatVerseMessage(verse);
    }

    if (!(await this.repo.markSending(d.id, this.config.instanceId))) return; // lock lost

    try {
      const result = await this.outbound.send({ phoneE164: sub.phoneE164, channelAddress: sub.channelAddress }, text);
      await this.repo.markSent(d.id, sub.id, result.providerMessageId, result.resolvedAddress, !isWelcome);
    } catch (err) {
      const message = (err as Error).message;
      if (err instanceof DailyCapReachedError) {
        await this.repo.markRetry(d.id, message, 60 * 60_000, true);
      } else if (err instanceof PermanentSendError || d.attempts >= this.config.get('MAX_DELIVERY_ATTEMPTS')) {
        this.logger.warn(`Delivery ${d.id} failed permanently: ${message}`);
        await this.repo.markFailed(d.id, sub.id, message);
        // Never delivered, so the verse stays available for this subscriber on a later day.
        if (verseId !== null) await this.verses.release(sub.id, verseId);
      } else {
        await this.repo.markRetry(d.id, message, retryDelayMs(d.attempts));
      }
    }
  }
}
