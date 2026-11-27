import { Injectable, Logger } from '@nestjs/common';
import { Verse, VerseType } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { TierRange, VersesRepository } from './verses.repository';
import { isInOrder } from './verse-types';

const TIER_CACHE_MS = 10 * 60_000;
// A failed reservation means a concurrent call for the same subscriber just won that verse, so
// failures are bounded by the number of simultaneous calls (in practice: one sender, one per day).
const MAX_RESERVE_ATTEMPTS = 100;

type SubscriberRef = { id: number; verseType: VerseType; rotationOffset: number; progress: number };

/**
 * Verse selection with a hard no-repeat guarantee.
 *
 *  - The seed orders verses into tiers: tier 1 (curated verses / best-scoring passages), then
 *    tier 2 (more stand-alone verses / passages), each a fixed shuffle.
 *  - Each subscriber starts at a random point (rotationOffset) inside each tier and walks forward,
 *    so different people get different verses on the same day.
 *  - Every verse handed out is recorded in subscriber_verses (PRIMARY KEY subscriberId+verseId).
 *    Selection skips recorded verses and the insert is atomic, so MySQL itself refuses a repeat.
 *  - When every verse of the type has been given, nextVerse() returns null: by default the
 *    subscriber simply stops receiving verses (ON_VERSES_EXHAUSTED=stop) rather than seeing a repeat.
 */
@Injectable()
export class VersesService {
  private readonly logger = new Logger(VersesService.name);
  private readonly tiers = new Map<VerseType, { ranges: TierRange[]; at: number }>();

  constructor(private readonly repo: VersesRepository) {}

  async tierRanges(type: VerseType): Promise<TierRange[]> {
    const cached = this.tiers.get(type);
    if (cached && Date.now() - cached.at < TIER_CACHE_MS) return cached.ranges;
    const ranges = await this.repo.tierRanges(type);
    this.tiers.set(type, { ranges, at: Date.now() });
    if (ranges.length === 0) this.logger.error(`No ${type} verses in rotation — did you run the seed?`);
    return ranges;
  }

  async poolSize(type: VerseType): Promise<number> {
    return (await this.tierRanges(type)).reduce((sum, t) => sum + t.size, 0);
  }

  /**
   * Start position for a new subscriber (applied modulo each tier's size): random, so people get
   * different verses on the same day; 0 for types read in order (the Ramayana starts at part 1).
   */
  async randomOffset(type: VerseType): Promise<number> {
    if (isInOrder(type)) return 0;
    const first = (await this.tierRanges(type))[0];
    return first && first.size > 0 ? randomInt(first.size) : 0;
  }

  /**
   * Picks and reserves the next verse this subscriber has never received.
   * Returns null when they have received every verse of their type.
   */
  async nextVerse(sub: SubscriberRef): Promise<Verse | null> {
    for (let attempt = 0; attempt < MAX_RESERVE_ATTEMPTS; attempt++) {
      const candidate = await this.findNextUnassigned(sub);
      if (!candidate) return null;
      if (await this.repo.reserve(sub.id, candidate.id)) return candidate;
    }
    throw new Error(`Could not reserve a verse for subscriber ${sub.id}`);
  }

  release(subscriberId: number, verseId: number): Promise<void> {
    return this.repo.release(subscriberId, verseId);
  }

  clearHistory(subscriberId: number, type: VerseType): Promise<number> {
    return this.repo.clearHistory(subscriberId, type);
  }

  countRepeatedDeliveries(): Promise<number> {
    return this.repo.countRepeatedDeliveries();
  }

  private async findNextUnassigned(sub: SubscriberRef): Promise<Verse | null> {
    for (const t of await this.tierRanges(sub.verseType)) {
      if (t.size === 0) continue;
      // Start the scan where the next unsent verse most likely is (offset + progress). This is
      // only a speed hint: correctness comes from the NOT EXISTS check, so the wrap-around
      // second query still finds any verse that was skipped.
      const hint = t.start + ((((sub.rotationOffset + sub.progress) % t.size) + t.size) % t.size);
      const end = t.start + t.size;
      const verse =
        (await this.repo.findFirstUnassigned(sub.verseType, sub.id, hint, end)) ??
        (await this.repo.findFirstUnassigned(sub.verseType, sub.id, t.start, hint));
      if (verse) return verse;
    }
    return null;
  }
}
