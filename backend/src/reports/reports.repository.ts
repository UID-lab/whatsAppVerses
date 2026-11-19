import { Injectable } from '@nestjs/common';
import { DeliveryStatus, Prisma, SubscriberStatus, VerseType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Read-only queries for the admin reports. Everything comes straight from MySQL. */
@Injectable()
export class ReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async activeCountsByType(): Promise<Record<VerseType, number>> {
    const rows = await this.prisma.subscriber.groupBy({
      by: ['verseType'],
      where: { status: SubscriberStatus.ACTIVE },
      _count: { _all: true },
    });
    const out = { BIBLE: 0, GITA: 0, QURAN: 0 } as Record<VerseType, number>;
    for (const r of rows) out[r.verseType] = r._count._all;
    return out;
  }

  activeSubscribers(today: Date, limit: number, offset: number, verseType?: VerseType) {
    const typeFilter = verseType ? Prisma.sql`AND s.verseType = ${verseType}` : Prisma.empty;
    return this.prisma.$queryRaw<
      {
        id: number;
        name: string;
        phoneE164: string;
        verseType: VerseType;
        status: SubscriberStatus;
        optedInAt: Date | null;
        lastDeliveredAt: Date | null;
        progress: number;
        assignedOfType: bigint;
        todaysVerseStatus: DeliveryStatus | null;
      }[]
    >`
      SELECT s.id, s.name, s.phoneE164, s.verseType, s.status, s.optedInAt, s.lastDeliveredAt, s.progress,
             (SELECT COUNT(*) FROM subscriber_verses sv JOIN verses v ON v.id = sv.verseId
               WHERE sv.subscriberId = s.id AND v.type = s.verseType) AS assignedOfType,
             (SELECT d.status FROM deliveries d
               WHERE d.subscriberId = s.id AND d.deliveryDate = ${today} AND d.kind = 'DAILY') AS todaysVerseStatus
      FROM subscribers s
      WHERE s.status = 'ACTIVE' ${typeFilter}
      ORDER BY s.id
      LIMIT ${limit} OFFSET ${offset}`;
  }

  async deliveryCounts(date: Date) {
    const [byKindStatus, permanent, recovered, attempts, dailyByType] = await Promise.all([
      this.prisma.delivery.groupBy({ by: ['kind', 'status'], where: { deliveryDate: date }, _count: { _all: true } }),
      this.prisma.delivery.count({ where: { deliveryDate: date, status: 'FAILED', failurePermanent: true } }),
      this.prisma.delivery.count({ where: { deliveryDate: date, status: 'SENT', firstFailedAt: { not: null } } }),
      this.prisma.$queryRaw<{ outcome: string | null; n: bigint }[]>`
        SELECT a.outcome, COUNT(*) AS n FROM delivery_attempts a JOIN deliveries d ON d.id = a.deliveryId
        WHERE d.deliveryDate = ${date} GROUP BY a.outcome`,
      this.prisma.$queryRaw<{ type: VerseType; n: bigint }[]>`
        SELECT v.type, COUNT(*) AS n FROM deliveries d JOIN verses v ON v.id = d.verseId
        WHERE d.deliveryDate = ${date} AND d.kind = 'DAILY' AND d.status = 'SENT' GROUP BY v.type`,
    ]);
    return { byKindStatus, permanent, recovered, attempts, dailyByType };
  }

  async repeatedPairs(limit: number) {
    return this.prisma.$queryRaw<{ subscriberId: number; name: string; reference: string; timesSent: bigint }[]>`
      SELECT d.subscriberId, s.name, v.reference, COUNT(*) AS timesSent
      FROM deliveries d JOIN subscribers s ON s.id = d.subscriberId JOIN verses v ON v.id = d.verseId
      WHERE d.status IN ('SENT', 'SENDING', 'UNKNOWN')
      GROUP BY d.subscriberId, s.name, v.reference
      HAVING COUNT(*) > 1
      ORDER BY timesSent DESC
      LIMIT ${limit}`;
  }

  countVerseDeliveries(): Promise<number> {
    return this.prisma.delivery.count({ where: { verseId: { not: null }, status: { in: ['SENT', 'SENDING', 'UNKNOWN'] } } });
  }

  countHistory(): Promise<number> {
    return this.prisma.subscriberVerse.count();
  }

  async versesInDatabase() {
    const rows = await this.prisma.$queryRaw<{ type: VerseType; stored: bigint; inRotation: bigint; translation: string }[]>`
      SELECT type, COUNT(*) AS stored, COUNT(rotationIndex) AS inRotation, MIN(translation) AS translation
      FROM verses GROUP BY type`;
    return rows;
  }

  listDeliveries(where: Prisma.DeliveryWhereInput, limit: number, offset: number) {
    return this.prisma.$transaction([
      this.prisma.delivery.count({ where }),
      this.prisma.delivery.findMany({
        where,
        include: { subscriber: true, verse: true, attemptLog: { orderBy: { startedAt: 'asc' } } },
        orderBy: [{ deliveryDate: 'desc' }, { id: 'asc' }],
        take: limit,
        skip: offset,
      }),
    ]);
  }
}
