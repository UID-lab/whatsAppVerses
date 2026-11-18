import { Injectable } from '@nestjs/common';
import { DeliveryKind, DeliveryStatus, Prisma, SubscriberStatus } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

const SPREAD_SECONDS = 600;
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
   * Queue the welcome greeting for today. It takes today's slot, so the first verse arrives
   * tomorrow morning. If a daily delivery already exists for today and hasn't gone out, it is
   * converted into the welcome message (still one message per day).
   * Returns false when something was already sent today.
   */
  async scheduleWelcome(subscriberId: number, date: Date): Promise<boolean> {
    const existing = await this.prisma.delivery.findUnique({
      where: { subscriberId_deliveryDate: { subscriberId, deliveryDate: date } },
    });
    const welcome = {
      kind: DeliveryKind.WELCOME,
      status: DeliveryStatus.PENDING,
      attempts: 0,
      verseId: null,
      nextAttemptAt: new Date(),
      lastError: null,
    };
    if (!existing) {
      try {
        await this.prisma.delivery.create({ data: { subscriberId, deliveryDate: date, ...welcome } });
        return true;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
        throw err;
      }
    }
    const resettable: DeliveryStatus[] = ['PENDING', 'SKIPPED', 'EXPIRED', 'FAILED'];
    if (!resettable.includes(existing.status)) return false;
    const res = await this.prisma.delivery.updateMany({
      where: { id: existing.id, status: existing.status },
      data: welcome,
    });
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

  /** Point of no return: after this, a crash means UNKNOWN (never retried), not a duplicate. */
  async markSending(id: bigint, owner: string): Promise<boolean> {
    const res = await this.prisma.delivery.updateMany({
      where: { id, status: DeliveryStatus.PROCESSING, lockedBy: owner },
      data: { status: DeliveryStatus.SENDING, lockedUntil: new Date(Date.now() + 5 * 60_000) },
    });
    return res.count === 1;
  }

  /** `advanceProgress` is false for the welcome greeting, which carries no verse. */
  async markSent(
    id: bigint,
    subscriberId: number,
    providerMessageId: string | null,
    resolvedAddress: string | null | undefined,
    advanceProgress: boolean,
  ) {
    const step = advanceProgress ? 1 : 0;
    await this.prisma.$transaction([
      this.prisma.delivery.update({
        where: { id },
        data: {
          status: DeliveryStatus.SENT,
          sentAt: new Date(),
          providerMessageId,
          lockedBy: null,
          lockedUntil: null,
          lastError: null,
        },
      }),
      this.prisma.$executeRaw`
        UPDATE subscribers
        SET progress = progress + ${step}, lastDeliveredAt = NOW(3), consecutiveFailures = 0,
            channelAddress = COALESCE(channelAddress, ${resolvedAddress ?? null}), updatedAt = NOW(3)
        WHERE id = ${subscriberId}`,
    ]);
  }

  async markRetry(id: bigint, error: string, delayMs: number, refundAttempt = false): Promise<void> {
    await this.prisma.delivery.update({
      where: { id },
      data: {
        status: DeliveryStatus.PENDING,
        nextAttemptAt: new Date(Date.now() + delayMs),
        lastError: error.slice(0, 500),
        lockedBy: null,
        lockedUntil: null,
        ...(refundAttempt ? { attempts: { decrement: 1 } } : {}),
      },
    });
  }

  async markFailed(id: bigint, subscriberId: number, error: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.delivery.update({
        where: { id },
        data: { status: DeliveryStatus.FAILED, lastError: error.slice(0, 500), lockedBy: null, lockedUntil: null },
      }),
      this.prisma.subscriber.update({ where: { id: subscriberId }, data: { consecutiveFailures: { increment: 1 } } }),
    ]);
  }

  async markSkipped(id: bigint, reason: string): Promise<void> {
    await this.prisma.delivery.update({
      where: { id },
      data: { status: DeliveryStatus.SKIPPED, lastError: reason, lockedBy: null, lockedUntil: null },
    });
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
