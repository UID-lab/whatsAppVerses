import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AppConfigService } from '../config/app-config.service';
import { LeaseService } from '../coordination/lease.service';
import { localDate, localMinutesNow, minutesOfDay, toIsoDate } from '../common/time/time.util';
import { DeliveryRepository } from './delivery.repository';

const SCHEDULER_LEASE = 'scheduler';
const DAILY_JOB = 'daily-enqueue';

/**
 * Cron jobs. They only *enqueue* and tidy up — sending happens in the worker.
 *
 * The daily enqueue is checked every minute rather than fired once at an exact time: if the
 * process was asleep/restarting at 07:00, the next tick catches up, and the job_runs marker plus
 * the UNIQUE(subscriberId, deliveryDate) key make repeated runs harmless. With several replicas,
 * a DB lease ensures only one of them does the work.
 */
@Injectable()
export class DeliverySchedulerService implements OnApplicationShutdown {
  private readonly logger = new Logger(DeliverySchedulerService.name);
  private busy = false;

  constructor(
    private readonly repo: DeliveryRepository,
    private readonly lease: LeaseService,
    private readonly config: AppConfigService,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.lease.release(SCHEDULER_LEASE);
  }

  private get tz(): string {
    return this.config.get('APP_TIMEZONE');
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'daily-enqueue' })
  async enqueueTick(): Promise<void> {
    await this.exclusive(async () => {
      if (localMinutesNow(this.tz) < minutesOfDay(this.config.get('DAILY_SEND_TIME'))) return;
      const today = localDate(this.tz);
      if (await this.repo.hasJobRun(DAILY_JOB, today)) return;
      await this.enqueueFor(today);
    });
  }

  /** Also used by the admin "run now" endpoint. Idempotent. */
  async enqueueFor(date: Date): Promise<number> {
    const started = Date.now();
    const count = await this.repo.enqueueDaily(date, this.config.get('ENQUEUE_BATCH_SIZE'));
    await this.repo.recordJobRun(DAILY_JOB, date, count);
    this.logger.log(`Enqueued ${count} daily deliveries for ${toIsoDate(date)} in ${Date.now() - started}ms`);
    return count;
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'reap-stale' })
  async reapTick(): Promise<void> {
    await this.exclusive(async () => {
      const { requeued, unknown } = await this.repo.reapStale();
      if (requeued || unknown) this.logger.warn(`Reaper: ${requeued} requeued, ${unknown} marked UNKNOWN`);
    });
  }

  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'expire-old' })
  async expireTick(): Promise<void> {
    await this.exclusive(async () => {
      const n = await this.repo.expireBefore(localDate(this.tz));
      if (n) this.logger.warn(`Expired ${n} deliveries from previous days (capacity or downtime)`);
    });
  }

  @Cron('17 3 * * *', { name: 'purge-old' })
  async purgeTick(): Promise<void> {
    await this.exclusive(async () => {
      const cutoff = new Date(localDate(this.tz).getTime() - this.config.get('DELIVERY_RETENTION_DAYS') * 86_400_000);
      const n = await this.repo.purgeBefore(cutoff);
      if (n) this.logger.log(`Purged ${n} deliveries older than ${toIsoDate(cutoff)}`);
    });
  }

  /** Run on one replica at a time, and never overlap with a previous tick on this replica. */
  private async exclusive(fn: () => Promise<void>): Promise<void> {
    if (!this.config.runsScheduler || this.busy) return;
    this.busy = true;
    try {
      if (!(await this.lease.tryAcquire(SCHEDULER_LEASE, 120))) return;
      await fn();
    } catch (err) {
      this.logger.error(`Scheduled job failed: ${(err as Error).message}`, (err as Error).stack);
    } finally {
      this.busy = false;
    }
  }
}
