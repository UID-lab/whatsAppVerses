/**
 * Seeds the MySQL `verses` table from the bundled, openly licensed datasets in prisma/data/.
 * After seeding, verses live only in the database — the app never reads the data files.
 * No network access is needed at seed time or at runtime.
 *
 *   npx prisma db seed        (or: npm run prisma:seed)
 *
 * Idempotent: re-running skips verses that already exist. The rotation order is derived
 * from a fixed PRNG seed, so every environment gets exactly the same order.
 */
import { Prisma, PrismaClient, VerseType } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

type BibleRow = { b: string; c: number; v: number; t: string };
type RamayanaRow = { k: number; kn: string; c: number; ct: string; p: number; t: string };
type MahabharataRow = { b: number; bn: string; s: number; p: number; t: string; tier: number };
type QuranRow = { s: number; n: string; v: number; ar: string; en: string };

const DATA_DIR = join(__dirname, 'data');
const ROTATION_SEED = 0x5eed_2026;
const INSERT_CHUNK = 2000;

const prisma = new PrismaClient();

const load = <T>(file: string): T[] => JSON.parse(gunzipSync(readFileSync(join(DATA_DIR, file))).toString('utf8'));

/** mulberry32 — tiny deterministic PRNG so the rotation is reproducible. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledIndexes(n: number, seed: number): number[] {
  const rand = prng(seed);
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

/**
 * Reading the Bible verse-by-verse at random mostly yields genealogies and mid-sentence
 * fragments, so the daily rotation uses a curated list of well-known devotional verses
 * (prisma/data/bible-daily-refs.txt). All 31,102 verses are still stored.
 */
function loadDailyRefs(file = 'bible-daily-refs.txt'): string[] {
  return readFileSync(join(DATA_DIR, file), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

type Row = Omit<Prisma.VerseCreateManyInput, 'rotationIndex' | 'rotationTier'>;
type Slot = { index: number; tier: number };

interface SeedOptions {
  /** Keep each tier in the given order instead of shuffling it (the Ramayana is read in order). */
  ordered?: boolean;
  /** Also update text/reference/title of rows that already exist (dataset was re-cut). */
  syncContent?: boolean;
}

/**
 * Inserts missing verses, then makes rotationIndex/rotationTier match the desired order.
 * `tiers` are lists of row indexes; tier 1 gets rotationIndex 0..n1-1, tier 2 continues after it,
 * each tier in its own seeded shuffle (or in the given order). Subscribers exhaust tier 1 before
 * reaching tier 2.
 */
async function seedType(type: VerseType, rows: Row[], tiers: number[][], seed: number, opts: SeedOptions = {}) {
  const keyOf = (r: { book: string; chapter: number; verse: number }) => `${r.book}|${r.chapter}|${r.verse}`;
  const desired = new Map<string, Slot>();
  let next = 0;
  tiers.forEach((eligible, t) => {
    const order = opts.ordered ? eligible.map((_, i) => i) : shuffledIndexes(eligible.length, seed + t * 7919);
    order.forEach((pos) => {
      desired.set(keyOf(rows[eligible[pos]]), { index: next++, tier: t + 1 });
    });
  });

  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK).map((r) => {
      const slot = desired.get(keyOf(r));
      return { ...r, rotationIndex: slot?.index ?? null, rotationTier: slot?.tier ?? null };
    });
    inserted += (await prisma.verse.createMany({ data: chunk, skipDuplicates: true })).count;
  }

  let contentUpdated = 0;
  if (opts.syncContent) {
    const byKey = new Map(rows.map((r) => [keyOf(r), r]));
    const existing = await prisma.verse.findMany({
      where: { type },
      select: { id: true, book: true, chapter: true, verse: true, text: true, reference: true, chapterTitle: true },
    });
    for (const v of existing) {
      const r = byKey.get(keyOf(v));
      if (r && (r.text !== v.text || r.reference !== v.reference || (r.chapterTitle ?? null) !== v.chapterTitle)) {
        await prisma.verse.update({
          where: { id: v.id },
          data: { text: r.text, reference: r.reference, chapterTitle: r.chapterTitle ?? null },
        });
        contentUpdated++;
      }
    }
  }

  // Existing databases: rewrite the rotation only if it differs (e.g. bible-daily-refs.txt edited).
  const current = await prisma.verse.findMany({
    where: { type },
    select: { id: true, book: true, chapter: true, verse: true, rotationIndex: true, rotationTier: true },
  });
  const changes = current.filter((v) => {
    const slot = desired.get(keyOf(v));
    return (slot?.index ?? null) !== v.rotationIndex || (slot?.tier ?? null) !== v.rotationTier;
  });
  if (changes.length > 0) {
    await prisma.$transaction(
      async (tx) => {
        await tx.verse.updateMany({ where: { type }, data: { rotationIndex: null, rotationTier: null } });
        const targets = current.filter((v) => desired.has(keyOf(v)));
        for (let i = 0; i < targets.length; i += 500) {
          const batch = targets.slice(i, i + 500);
          const ids = Prisma.join(batch.map((v) => v.id));
          const idx = Prisma.join(batch.map((v) => Prisma.sql`WHEN ${v.id} THEN ${desired.get(keyOf(v))!.index}`), ' ');
          const tier = Prisma.join(batch.map((v) => Prisma.sql`WHEN ${v.id} THEN ${desired.get(keyOf(v))!.tier}`), ' ');
          await tx.$executeRaw`UPDATE verses SET rotationIndex = CASE id ${idx} END, rotationTier = CASE id ${tier} END WHERE id IN (${ids})`;
        }
      },
      { timeout: 600_000 },
    );
  }
  return { inserted, tierSizes: tiers.map((t) => t.length), rotationChanged: changes.length, contentUpdated };
}

/**
 * Extended Bible pool (tier 2): verses that read well on their own, chosen by a heuristic —
 * a full sentence of reasonable length, not a genealogy/census list, not a mid-story fragment.
 */
const LIST_HEAVY_BOOKS = new Set(['Numbers', '1 Chronicles', 'Leviticus']);
function isStandAloneBibleVerse(r: BibleRow): boolean {
  const len = r.t.length;
  if (len < 60 || len > 320) return false;
  if (LIST_HEAVY_BOOKS.has(r.b)) return false;
  if (/^(And|But|Then|Now|So|Or|Nor|Because|That|Which|Who|Whom|Unto)\b/.test(r.t)) return false;
  if (/(begat|son of|sons of)\b/i.test(r.t)) return false;
  return /[.!?]["')’]?$/.test(r.t);
}

async function seedBible() {
  const data = load<BibleRow>('bible-kjv.json.gz');
  const indexByRef = new Map(data.map((r, i) => [`${r.b} ${r.c}:${r.v}`, i]));
  const refs = [...new Set(loadDailyRefs())];
  const missing = refs.filter((ref) => !indexByRef.has(ref));
  if (missing.length) console.warn(`Unknown references in bible-daily-refs.txt (skipped): ${missing.join(', ')}`);
  const curated = refs.filter((ref) => indexByRef.has(ref)).map((ref) => indexByRef.get(ref) as number);
  const curatedSet = new Set(curated);
  const extended = data.map((r, i) => (!curatedSet.has(i) && isStandAloneBibleVerse(r) ? i : -1)).filter((i) => i >= 0);

  const rows: Row[] = data.map((r) => ({
    type: VerseType.BIBLE,
    reference: `${r.b} ${r.c}:${r.v}`,
    book: r.b,
    chapter: r.c,
    verse: r.v,
    text: r.t,
    translation: 'KJV',
  }));
  const res = await seedType(VerseType.BIBLE, rows, [curated, extended], ROTATION_SEED);
  console.log(
    `Bible (KJV): ${rows.length} verses (${res.inserted} new), rotation: ${res.tierSizes[0]} curated + ${res.tierSizes[1]} extended (${res.rotationChanged} rotation updates)`,
  );
}

/**
 * Ramayana (Griffith's English verse), read as a story: every daily part of the whole text, in
 * reading order. Subscribers start at part 1 (rotationOffset 0, see IN_ORDER_VERSE_TYPES).
 */
async function seedRamayana() {
  const data = load<RamayanaRow>('ramayana.json.gz');
  const rows: Row[] = data.map((r) => ({
    type: VerseType.RAMAYANA,
    reference: `Ramayana ${r.k}.${r.c}.${r.p}`,
    book: r.kn,
    chapter: r.c,
    verse: r.p,
    chapterTitle: r.ct,
    text: r.t,
    translation: 'Ralph T. H. Griffith',
  }));
  const res = await seedType(VerseType.RAMAYANA, rows, [data.map((_, i) => i)], ROTATION_SEED + 3, {
    ordered: true,
    syncContent: true,
  });
  console.log(
    `Ramayana: ${rows.length} daily parts in reading order (${res.inserted} new, ${res.contentUpdated} updated, ${res.rotationChanged} rotation updates)`,
  );
}

/** Mahabharata (Ganguli's English prose): short teaching passages scored by the builder. */
async function seedMahabharata() {
  const data = load<MahabharataRow>('mahabharata.json.gz');
  const tier = (t: number) => data.map((r, i) => (r.tier === t ? i : -1)).filter((i) => i >= 0);
  const rows: Row[] = data.map((r) => ({
    type: VerseType.MAHABHARATA,
    reference: `Mahabharata · ${r.bn}, Section ${r.s}`,
    book: r.bn,
    chapter: r.s,
    verse: r.p,
    text: r.t,
    translation: 'Kisari Mohan Ganguli',
  }));
  const res = await seedType(VerseType.MAHABHARATA, rows, [tier(1), tier(2)], ROTATION_SEED + 4);
  console.log(
    `Mahabharata: ${rows.length} passages (${res.inserted} new), rotation: ${res.tierSizes[0]} + ${res.tierSizes[1]} (${res.rotationChanged} rotation updates)`,
  );
}

/**
 * Extended Quran pool (tier 2): ayahs that read as a complete thought on their own AND are about
 * universal devotional themes. Ayahs about punishment, warfare, legal rulings or specific
 * communities are left out: out of context, as a lone daily message, they can easily mislead.
 */
const QURAN_GOOD_THEMES =
  /\b(merc|forgiv|patien|steadfast|grateful|thank|prayer|worship|remembrance|remember|guidance|guide|light|peace|kind|good|righteous|charity|alms|trust|hope|knowledge|wisdom|heart|soul|believ|praise|glorif|reward|paradise|garden|love|just|truth|repent|bounty|blessing|provision)/i;
const QURAN_EXCLUDED_THEMES =
  /\b(disbeliev|unbeliev|hell|doom|fire|torment|chastise|punish|wrath|curse|slay|fight|kill|war|hypocrit|idolat|pharaoh|wives|divorce|usury|sword|captive|booty|spoils|polythe|jew|christian|evil-doer|wrong-doer|transgress|plague|destroy|drown|stone|blood|swine|carrion|menstru|marr|inherit|bequest|debt|witness|ruin|lawful|forbid)/i;
function isStandAloneAyah(r: QuranRow): boolean {
  const len = r.en.length;
  if (len < 60 || len > 360) return false;
  if (/^(And|But|Then|So|Or|Nay|Until|When|If|Save|Except|Whereby|Wherein|Who|Which|That)\b/.test(r.en)) return false;
  if (!/[.!?]["')’]?$/.test(r.en)) return false;
  return QURAN_GOOD_THEMES.test(r.en) && !QURAN_EXCLUDED_THEMES.test(r.en);
}

async function seedQuran() {
  const data = load<QuranRow>('quran.json.gz');
  const indexByRef = new Map(data.map((r, i) => [`${r.s}:${r.v}`, i]));
  const refs = [...new Set(loadDailyRefs('quran-daily-refs.txt'))];
  const missing = refs.filter((ref) => !indexByRef.has(ref));
  if (missing.length) console.warn(`Unknown references in quran-daily-refs.txt (skipped): ${missing.join(', ')}`);
  const curated = refs.filter((ref) => indexByRef.has(ref)).map((ref) => indexByRef.get(ref) as number);
  const curatedSet = new Set(curated);
  const extended = data.map((r, i) => (!curatedSet.has(i) && isStandAloneAyah(r) ? i : -1)).filter((i) => i >= 0);

  const rows: Row[] = data.map((r) => ({
    type: VerseType.QURAN,
    reference: `Quran ${r.s}:${r.v}`,
    book: r.n,
    chapter: r.s,
    verse: r.v,
    text: r.en,
    originalText: r.ar,
    translation: 'Pickthall',
  }));
  const res = await seedType(VerseType.QURAN, rows, [curated, extended], ROTATION_SEED + 2);
  console.log(
    `Quran: ${rows.length} ayahs (${res.inserted} new), rotation: ${res.tierSizes[0]} curated + ${res.tierSizes[1]} extended (${res.rotationChanged} rotation updates)`,
  );
}

async function main() {
  await seedBible();
  await seedRamayana();
  await seedMahabharata();
  await seedQuran();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
