import { Injectable } from '@nestjs/common';
import { AttemptOutcome, DeliveryKind, DeliveryStatus, Prisma, SubscriberStatus } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Daily deliveries get a random due time within this many seconds of the send time. Only the
 * order matters (fair when the daily cap can't reach everyone); pacing is MESSAGES_PER_MINUTE.
 */
const SPREAD_SECONDS = 60;
const MAINTENANCE_CHUNK = 5000;

export type ClaimedDelivery = Prisma.DeliveryGetPayload<{ include: { subscriber: true; verse: true } }>;

/**
 * MySQL-backed job queue. No Redis needed:
 *
 *  - Enqueue: INSERT IGNORE on UNIQUE(subscriberId, deliveryDate) — re-running the cron, or
 *    running it on several replicas, can never create a second message for the same day.
 *  - Claim: SELECT … FOR UPDATE SKIP LOCKED, so concurrent workers never grab the same row and
 *    never block each other.
 *  - Leases: claimed rows carry lockedBy/lockedUntil; a reaper returns abandoned rows.
 */
@Injectable()
export class DeliveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---- enqueue ------------------------------------------------------------------------------

  /** Enqueue one DAILY delivery per ACTIVE subscriber for `date`, in keyset-paginated batches. */
  async enqueueDaily(date: Date, batchSize: number): Promise<number> {
    let lastId = 0;
    let inserted = 0;
    for (;;) {
      const batch = await this.prisma.subscriber.findMany({
        where: { status: SubscriberStatus.ACTIVE, id: { gt: lastId } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: batchSize,
      });
      if (batch.length === 0) break;
      const now = Date.now();
      const res = await this.prisma.delivery.createMany({
        data: batch.map((s) => ({
          subscriberId: s.id,
          deliveryDate: date,
          kind: DeliveryKind.DAILY,
          // Random spread = random send order, so if capacity runs out it isn't always the same people.
          nextAttemptAt: new Date(now + randomInt(SPREAD_SECONDS) * 1000),
        })),
        skipDuplicates: true,
      });
      inserted += res.count;
      lastId = batch[batch.length - 1].id;
      if (batch.length < batchSize) break;
    }
    return inserted;
  }

  /**
   * Queue the welcome greeting for today. It is independent of the daily verse, so a subscriber
   * can get both on the day they sign up. Returns false if a welcome was already sent today.
   */
  async scheduleWelcome(subscriberId: number, date: Date): Promise<boolean> {
    return this.scheduleNow(subscriberId, date, DeliveryKind.WELCOME, 0);
  }

  /**
   * Queue today's daily verse right away (for someone who subscribes after today's scheduled run).
   * `delayMs` lets the welcome go out first. No-op if today's verse already exists or went out.
   */
  async scheduleDailyNow(subscriberId: number, date: Date, delayMs: number): Promise<boolean> {
    return this.scheduleNow(subscriberId, date, DeliveryKind.DAILY, delayMs);
  }

  private async scheduleNow(subscriberId: number, date: Date, kind: DeliveryKind, delayMs: number): Promise<boolean> {
    const existing = await this.prisma.delivery.findUnique({
      where: { subscriberId_deliveryDate_kind: { subscriberId, deliveryDate: date, kind } },
    });
    const fresh = {
      status: DeliveryStatus.PENDING,
      attempts: 0,
      nextAttemptAt: new Date(Date.now() + delayMs),
      lastError: null,
    };
    if (!existing) {
      try {
        await this.prisma.delivery.create({ data: { subscriberId, deliveryDate: date, kind, ...fresh } });
        return true;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
        throw err;
      }
    }
    // Re-queue only if nothing went out (e.g. skipped because they had unsubscribed earlier today).
    // A verse already assigned stays assigned, so the no-repeat guarantee is untouched.
    const resettable: DeliveryStatus[] = ['SKIPPED', 'EXPIRED', 'FAILED'];
    if (!resettable.includes(existing.status)) return existing.status === DeliveryStatus.PENDING;
    const res = await this.prisma.delivery.updateMany({ where: { id: existing.id, status: existing.status }, data: fresh });
    return res.count === 1;
  }

  // ---- claim & state transitions --------------------------------------------------------------

  async claim(owner: string, limit: number, lockSeconds: number, welcomeOnly: boolean): Promise<ClaimedDelivery[]> {
    const ids = await this.prisma.$transaction(async (tx) => {
      const kindFilter = welcomeOnly ? Prisma.sql`AND kind = 'WELCOME'` : Prisma.empty;
      const rows = await tx.$queryRaw<{ id: bigint }[]>`
        SELECT id FROM deliveries
        WHERE status = 'PENDING' AND nextAttemptAt <= NOW(3) ${kindFilter}
        ORDER BY nextAttemptAt, id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED`;
      if (rows.length === 0) return [];
      const claimed = rows.map((r) => r.id);
      await tx.$executeRaw`
        UPDATE deliveries
        SET status = 'PROCESSING', lockedBy = ${owner}, lockedUntil = NOW(3) + INTERVAL ${lockSeconds} SECOND,
            attempts = attempts + 1, updatedAt = NOW(3)
        WHERE id IN (${Prisma.join(claimed)})`;
      return claimed;
    });
    if (ids.length === 0) return [];
    return this.prisma.delivery.findMany({
      where: { id: { in: ids } },
      include: { subscriber: true, verse: true },
      orderBy: { nextAttemptAt: 'asc' },
    });
  }

  async assignVerse(id: bigint, verseId: number): Promise<void> {
    await this.prisma.delivery.update({ where: { id }, data: { verseId } });
  }

  /**
   * Point of no return: after this, a crash means UNKNOWN (never retried), not a duplicate.
   * Also opens a row in delivery_attempts (started now), numbered across all retry rounds
   * (1, 2, 3 …). Returns that attempt's id, or null if this worker lost its claim.
   */
  async markSending(id: bigint, owner: string): Promise<bigint | null> {
    return this.prisma.$transaction(async (tx) => {
      const res = await tx.delivery.updateMany({
        where: { id, status: DeliveryStatus.PROCESSING, lockedBy: owner },
        data: { status: DeliveryStatus.SENDING, lockedUntil: new Date(Date.now() + 5 * 60_000) },
      });
      if (res.count !== 1) return null;
      const previous = await tx.deliveryAttempt.count({ where: { deliveryId: id } });
      const attempt = await tx.deliveryAttempt.create({ data: { deliveryId: id, attemptNo: previous + 1 } });
      return attempt.id;
    });
  }

  /** `advanceProgress` is false for the welcome greeting, which carries no verse. */
  async markSent(
    id: bigint,
    subscriberId: number,
    providerMessageId: string | null,
    resolvedAddress: string | null | undefined,
    advanceProgress: boolean,
    attemptId: bigint,
  ) {
    const step = advanceProgress ? 1 : 0;
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.delivery.update({
        where: { id },
        data: {
          status: DeliveryStatus.SENT,
          sentAt: now,
          providerMessageId,
          lockedBy: null,
          lockedUntil: null,
          lastError: null,
          failurePermanent: false,
        },
      }),
      this.prisma.deliveryAttempt.update({
        where: { id: attemptId },
        data: { outcome: AttemptOutcome.SUCCEEDED, finishedAt: now },
      }),
      this.prisma.$executeRaw`
        UPDATE subscribers
        SET progress = progress + ${step}, lastDeliveredAt = NOW(3), consecutiveFailures = 0,
            channelAddress = COALESCE(channelAddress, ${resolvedAddress ?? null}), updatedAt = NOW(3)
        WHERE id = ${subscriberId}`,
    ]);
  }

  /** A failed attempt that will be retried automatically after `delayMs`. */
  async markRetry(id: bigint, error: string, delayMs: number, attemptId: bigint): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.deliveryAttempt.update({
        where: { id: attemptId },
        data: { outcome: AttemptOutcome.FAILED, error: error.slice(0, 500), finishedAt: now },
      }),
      this.prisma.$executeRaw`
        UPDATE deliveries
        SET status = 'PENDING', nextAttemptAt = ${new Date(now.getTime() + delayMs)}, lastError = ${error.slice(0, 500)},
            lockedBy = NULL, lockedUntil = NULL, firstFailedAt = COALESCE(firstFailedAt, ${now}),
            lastFailedAt = ${now}, updatedAt = NOW(3)
        WHERE id = ${id}`,
    ]);
  }

  /**
   * Put a delivery back in the queue without counting a failure (daily cap reached, no verses
   * loaded yet …). If an attempt row was opened for it, it is removed: nothing was sent.
   */
  async defer(id: bigint, reason: string, delayMs: number, attemptId?: bigint | null): Promise<void> {
    await this.prisma.$transaction([
      ...(attemptId ? [this.prisma.deliveryAttempt.delete({ where: { id: attemptId } })] : []),
      this.prisma.delivery.update({
        where: { id },
        data: {
          status: DeliveryStatus.PENDING,
          nextAttemptAt: new Date(Date.now() + delayMs),
          lastError: reason.slice(0, 500),
          lockedBy: null,
          lockedUntil: null,
          attempts: { decrement: 1 },
        },
      }),
    ]);
  }

  /**
   * Gives up on a delivery for now. `permanent` = retrying can't help (e.g. not on WhatsApp);
   * otherwise the automatic re-queue sweep will try it again later today.
   * The verse is detached so a later retry picks a fresh one (the old one was released).
   */
  async markFailed(id: bigint, subscriberId: number, error: string, permanent: boolean, attemptId: bigint): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.deliveryAttempt.update({
        where: { id: attemptId },
        data: { outcome: AttemptOutcome.FAILED, error: error.slice(0, 500), finishedAt: now },
      }),
      this.prisma.$executeRaw`
        UPDATE deliveries
        SET status = 'FAILED', lastError = ${error.slice(0, 500)}, lockedBy = NULL, lockedUntil = NULL,
            failurePermanent = ${permanent}, verseId = NULL,
            firstFailedAt = COALESCE(firstFailedAt, ${now}), lastFailedAt = ${now}, updatedAt = NOW(3)
        WHERE id = ${id}`,
      this.prisma.subscriber.update({ where: { id: subscriberId }, data: { consecutiveFailures: { increment: 1 } } }),
    ]);
  }

  /**
   * Re-queues FAILED deliveries so they are sent again (fresh attempt budget). Without `ids` it
   * re-queues every retryable FAILED delivery of `date` that hasn't hit `maxRequeues`.
   * `includePermanent` also re-queues permanent failures (manual admin action).
   */
  async requeueFailed(opts: {
    date?: Date;
    ids?: bigint[];
    maxRequeues?: number;
    includePermanent?: boolean;
  }): Promise<number> {
    const where: Prisma.DeliveryWhereInput = {
      status: { in: [DeliveryStatus.FAILED, DeliveryStatus.EXPIRED] },
      ...(opts.ids ? { id: { in: opts.ids } } : {}),
      ...(opts.date ? { deliveryDate: opts.date } : {}),
      ...(opts.includePermanent ? {} : { failurePermanent: false }),
      ...(opts.maxRequeues !== undefined ? { requeueCount: { lt: opts.maxRequeues } } : {}),
    };
    if (!opts.ids) where.status = DeliveryStatus.FAILED; // the sweep never revives EXPIRED days
    const res = await this.prisma.delivery.updateMany({
      where,
      data: {
        status: DeliveryStatus.PENDING,
        attempts: 0,
        nextAttemptAt: new Date(),
        failurePermanent: false,
        lockedBy: null,
        lockedUntil: null,
        requeueCount: { increment: 1 },
      },
    });
    return res.count;
  }

  async markSkipped(id: bigint, reason: string): Promise<void> {
    await this.prisma.delivery.update({
      where: { id },
      data: { status: DeliveryStatus.SKIPPED, lastError: reason, lockedBy: null, lockedUntil: null },
    });
  }

  /**
   * True while this subscriber's welcome for `date` may still go out: waiting, being sent, or
   * FAILED but still due for an automatic re-run (not permanent, re-runs left).
   */
  async welcomePending(subscriberId: number, date: Date, maxRequeues: number): Promise<boolean> {
    const n = await this.prisma.delivery.count({
      where: {
        subscriberId,
        deliveryDate: date,
        kind: DeliveryKind.WELCOME,
        OR: [
          { status: { in: [DeliveryStatus.PENDING, DeliveryStatus.PROCESSING, DeliveryStatus.SENDING] } },
          { status: DeliveryStatus.FAILED, failurePermanent: false, requeueCount: { lt: maxRequeues } },
        ],
      },
    });
    return n > 0;
  }

  /** On graceful shutdown: give back rows we claimed but never started sending. */
  async releaseClaims(owner: string): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE deliveries SET status = 'PENDING', lockedBy = NULL, lockedUntil = NULL,
             attempts = GREATEST(attempts - 1, 0), updatedAt = NOW(3)
      WHERE status = 'PROCESSING' AND lockedBy = ${owner}`;
  }

  // ---- maintenance ----------------------------------------------------------------------------

  /** Return abandoned claims to the queue; mark interrupted sends UNKNOWN (no duplicate risk). */
  async reapStale(): Promise<{ requeued: number; unknown: number }> {
    const requeued = await this.prisma.$executeRaw`
      UPDATE deliveries SET status = 'PENDING', lockedBy = NULL, lockedUntil = NULL, updatedAt = NOW(3)
      WHERE status = 'PROCESSING' AND lockedUntil < NOW(3)`;
    const unknown = await this.prisma.$executeRaw`
      UPDATE deliveries
      SET status = 'UNKNOWN', lockedBy = NULL, lockedUntil = NULL, updatedAt = NOW(3),
          lastError = 'Sender stopped mid-send; not retried to avoid a duplicate'
      WHERE status = 'SENDING' AND lockedUntil < NOW(3)`;
    if (unknown > 0) {
      await this.prisma.$executeRaw`
        UPDATE delivery_attempts a JOIN deliveries d ON d.id = a.deliveryId
        SET a.outcome = 'UNKNOWN', a.finishedAt = NOW(3), a.error = 'Sender stopped mid-send'
        WHERE d.status = 'UNKNOWN' AND a.finishedAt IS NULL`;
    }
    return { requeued, unknown };
  }

  /** Deliveries still pending from previous days are dropped (tomorrow brings the next verse). */
  async expireBefore(date: Date): Promise<number> {
    let total = 0;
    for (;;) {
      const n = await this.prisma.$executeRaw`
        UPDATE deliveries SET status = 'EXPIRED', lockedBy = NULL, lockedUntil = NULL, updatedAt = NOW(3)
        WHERE deliveryDate < ${date} AND status = 'PENDING'
        LIMIT ${MAINTENANCE_CHUNK}`;
      total += n;
      if (n < MAINTENANCE_CHUNK) return total;
    }
  }

  /** Keeps the table small enough for a free-tier database. */
  async purgeBefore(date: Date): Promise<number> {
    let total = 0;
    for (;;) {
      const n = await this.prisma.$executeRaw`
        DELETE FROM deliveries WHERE deliveryDate < ${date} LIMIT ${MAINTENANCE_CHUNK}`;
      total += n;
      if (n < MAINTENANCE_CHUNK) return total;
    }
  }

  async hasJobRun(job: string, date: Date): Promise<boolean> {
    return (await this.prisma.jobRun.findUnique({ where: { job_runDate: { job, runDate: date } } })) !== null;
  }

  async recordJobRun(job: string, date: Date, enqueued: number): Promise<void> {
    await this.prisma.jobRun.upsert({
      where: { job_runDate: { job, runDate: date } },
      create: { job, runDate: date, enqueued },
      update: { enqueued, completedAt: new Date() },
    });
  }

  async statusCounts(date: Date): Promise<Record<string, number>> {
    const rows = await this.prisma.delivery.groupBy({
      by: ['status'],
      where: { deliveryDate: date },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }
}
