import { Injectable, Logger } from '@nestjs/common';
import { Verse, VerseType } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { VersesRepository } from './verses.repository';

const POOL_CACHE_MS = 10 * 60_000;

/**
 * Verse selection — "sequential progression through a shuffled rotation, per subscriber":
 *
 *  - The seed assigns every eligible verse a rotationIndex 0..N-1 in a fixed, pre-shuffled order.
 *  - Each subscriber gets a random rotationOffset at sign-up and a progress counter that only
 *    increases when a verse is actually delivered.
 *  - Today's verse = rotation[(rotationOffset + progress) mod N].
 *
 * So nobody sees a repeat until they've received all N verses (420 Bible / 654 Gita ≈ 1-2 years),
 * a failed or skipped day never skips a verse, and different subscribers receive different text
 * on the same day (thousands of byte-identical messages are a classic spam signal).
 */
@Injectable()
export class VersesService {
  private readonly logger = new Logger(VersesService.name);
  private readonly poolSizes = new Map<VerseType, { size: number; at: number }>();

  constructor(private readonly repo: VersesRepository) {}

  async poolSize(type: VerseType): Promise<number> {
    const cached = this.poolSizes.get(type);
    if (cached && Date.now() - cached.at < POOL_CACHE_MS) return cached.size;
    const size = await this.repo.countRotation(type);
    this.poolSizes.set(type, { size, at: Date.now() });
    if (size === 0) this.logger.error(`No ${type} verses in rotation — did you run the seed?`);
    return size;
  }

  async randomOffset(type: VerseType): Promise<number> {
    const size = await this.poolSize(type);
    return size > 0 ? randomInt(size) : 0;
  }

  async verseFor(sub: { verseType: VerseType; rotationOffset: number; progress: number }): Promise<Verse | null> {
    const size = await this.poolSize(sub.verseType);
    if (size === 0) return null;
    const index = (((sub.rotationOffset + sub.progress) % size) + size) % size;
    return this.repo.findByRotationIndex(sub.verseType, index);
  }
}
