import { VerseType } from '@prisma/client';

/**
 * Verse types offered at sign-up, in display order. GITA is not here: it was replaced by
 * RAMAYANA / MAHABHARATA and only remains in the database for the history of earlier deliveries.
 */
export const OFFERED_VERSE_TYPES = [VerseType.BIBLE, VerseType.RAMAYANA, VerseType.MAHABHARATA, VerseType.QURAN] as const;
export type OfferedVerseType = (typeof OFFERED_VERSE_TYPES)[number];

/**
 * Types read as a story, in order: every subscriber starts at part 1 and gets the next part each
 * day (rotationOffset 0, rotation not shuffled). All other types start at a random point.
 */
export const IN_ORDER_VERSE_TYPES: readonly VerseType[] = [VerseType.RAMAYANA];
export const isInOrder = (type: VerseType): boolean => IN_ORDER_VERSE_TYPES.includes(type);

export interface VerseTypeOption {
  id: OfferedVerseType;
  label: string;
  description: string;
  /** Options with the same group are shown together as one block on the sign-up page. */
  group?: string;
}

export const VERSE_TYPE_OPTIONS: VerseTypeOption[] = [
  { id: VerseType.BIBLE, label: 'Bible verses', description: 'King James Version' },
  { id: VerseType.RAMAYANA, label: 'Ramayana', description: 'The full story, a part a day', group: 'Indian epics' },
  { id: VerseType.MAHABHARATA, label: 'Mahabharata', description: 'Daily teachings of wisdom', group: 'Indian epics' },
  { id: VerseType.QURAN, label: 'Quran verses', description: 'Arabic with English translation (Pickthall)' },
];

/** Each offered type mapped to 0, for per-type counts (a legacy GITA row still adds its own key). */
export const zeroByVerseType = (): Record<VerseType, number> =>
  Object.fromEntries(OFFERED_VERSE_TYPES.map((t) => [t, 0])) as Record<VerseType, number>;
