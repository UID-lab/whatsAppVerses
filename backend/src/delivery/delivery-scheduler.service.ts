import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AppConfigService } from '../config/app-config.service';
import { LeaseService } from '../coordination/lease.service';
import { localDate, localMinutesNow, minutesOfDay, toIsoDate } from '../common/time/time.util';
import { DeliveryRepository } from './delivery.repository';
import { SettingsService } from '../settings/settings.service';

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
  /** Jobs currently running on this replica (each job is guarded separately). */
  private readonly running = new Set<string>();

  constructor(
    private readonly repo: DeliveryRepository,
    private readonly lease: LeaseService,
    private readonly config: AppConfigService,
    private readonly settings: SettingsService,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.lease.release(SCHEDULER_LEASE);
  }

  private get tz(): string {
    return this.config.get('APP_TIMEZONE');
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'daily-enqueue' })
  async enqueueTick(): Promise<void> {
    await this.exclusive('daily-enqueue', async () => {
      const { dailySendTime } = await this.settings.schedule();
      if (localMinutesNow(this.tz) < minutesOfDay(dailySendTime)) return;
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
    await this.exclusive('reap-stale', async () => {
      const { requeued, unknown } = await this.repo.reapStale();
      if (requeued || unknown) this.logger.warn(`Reaper: ${requeued} requeued, ${unknown} marked UNKNOWN`);
    });
  }

  /** Failed messages are re-run automatically until they're delivered (see FAILED_REQUEUE_LIMIT). */
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'requeue-failed' })
  async requeueTick(): Promise<void> {
    await this.exclusive('requeue-failed', async () => {
      const n = await this.repo.requeueFailed({
        date: localDate(this.tz),
        maxRequeues: this.config.get('FAILED_REQUEUE_LIMIT'),
      });
      if (n) this.logger.warn(`Re-queued ${n} failed deliveries for another round of attempts`);
    });
  }

  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'expire-old' })
  async expireTick(): Promise<void> {
    await this.exclusive('expire-old', async () => {
      const n = await this.repo.expireBefore(localDate(this.tz));
      if (n) this.logger.warn(`Expired ${n} deliveries from previous days (capacity or downtime)`);
    });
  }

  @Cron('17 3 * * *', { name: 'purge-old' })
  async purgeTick(): Promise<void> {
    await this.exclusive('purge-old', async () => {
      const cutoff = new Date(localDate(this.tz).getTime() - this.config.get('DELIVERY_RETENTION_DAYS') * 86_400_000);
      const n = await this.repo.purgeBefore(cutoff);
      if (n) this.logger.log(`Purged ${n} deliveries older than ${toIsoDate(cutoff)}`);
    });
  }

  /**
   * Run on one replica at a time (DB lease), and never overlap with a previous tick of the SAME
   * job on this replica. Different jobs may run at the same moment (several fire every minute).
   */
  private async exclusive(job: string, fn: () => Promise<void>): Promise<void> {
    if (!this.config.runsScheduler || this.running.has(job)) return;
    this.running.add(job);
    try {
      if (!(await this.lease.tryAcquire(SCHEDULER_LEASE, 120))) return;
      await fn();
    } catch (err) {
      this.logger.error(`Scheduled job failed: ${(err as Error).message}`, (err as Error).stack);
    } finally {
      this.running.delete(job);
    }
  }
}
