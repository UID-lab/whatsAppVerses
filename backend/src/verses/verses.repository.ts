import { Injectable } from '@nestjs/common';
import { Verse, VerseType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type TierRange = { tier: number; start: number; size: number };

@Injectable()
export class VersesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Each rotation tier is a contiguous rotationIndex range [start, start + size). */
  async tierRanges(type: VerseType): Promise<TierRange[]> {
    const rows = await this.prisma.$queryRaw<{ tier: number; start: number; size: bigint }[]>`
      SELECT rotationTier AS tier, MIN(rotationIndex) AS start, COUNT(*) AS size
      FROM verses
      WHERE type = ${type} AND rotationTier IS NOT NULL
      GROUP BY rotationTier
      ORDER BY rotationTier`;
    return rows.map((r) => ({ tier: Number(r.tier), start: Number(r.start), size: Number(r.size) }));
  }

  /**
   * First verse in [from, to) of the rotation that this subscriber has never been given.
   * Range scan on UNIQUE(type, rotationIndex) + primary-key probe on subscriber_verses.
   */
  async findFirstUnassigned(type: VerseType, subscriberId: number, from: number, to: number): Promise<Verse | null> {
    if (from >= to) return null;
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT v.id FROM verses v
      WHERE v.type = ${type} AND v.rotationIndex >= ${from} AND v.rotationIndex < ${to}
        AND NOT EXISTS (
          SELECT 1 FROM subscriber_verses sv WHERE sv.subscriberId = ${subscriberId} AND sv.verseId = v.id
        )
      ORDER BY v.rotationIndex
      LIMIT 1`;
    return rows[0] ? this.prisma.verse.findUnique({ where: { id: rows[0].id } }) : null;
  }

  /**
   * Atomically claims `verseId` for this subscriber. Returns false if they already had it — the
   * primary key on subscriber_verses makes a repeat impossible even under concurrency.
   */
  async reserve(subscriberId: number, verseId: number): Promise<boolean> {
    const n = await this.prisma.$executeRaw`
      INSERT IGNORE INTO subscriber_verses (subscriberId, verseId, assignedAt) VALUES (${subscriberId}, ${verseId}, NOW(3))`;
    return n === 1;
  }

  /** Gives a verse back (it was never delivered, e.g. the number isn't on WhatsApp). */
  async release(subscriberId: number, verseId: number): Promise<void> {
    await this.prisma.subscriberVerse.deleteMany({ where: { subscriberId, verseId } });
  }

  /** Forgets every verse of one type for a subscriber (used only with ON_VERSES_EXHAUSTED=restart). */
  async clearHistory(subscriberId: number, type: VerseType): Promise<number> {
    return this.prisma.$executeRaw`
      DELETE sv FROM subscriber_verses sv JOIN verses v ON v.id = sv.verseId
      WHERE sv.subscriberId = ${subscriberId} AND v.type = ${type}`;
  }

  /**
   * Audit: how many times any subscriber has been *sent* the same verse more than once.
   * Should always be 0. Covers deliveries still within the retention window.
   */
  async countRepeatedDeliveries(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM (
        SELECT subscriberId, verseId FROM deliveries
        WHERE verseId IS NOT NULL AND status IN ('SENT', 'SENDING', 'UNKNOWN')
        GROUP BY subscriberId, verseId HAVING COUNT(*) > 1
      ) dup`;
    return Number(rows[0]?.n ?? 0);
  }

  countAssigned(subscriberId: number, type: VerseType): Promise<number> {
    return this.prisma.subscriberVerse.count({ where: { subscriberId, verse: { type } } });
  }
}
