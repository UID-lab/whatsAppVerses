/**
 * Seeds the `verses` table from the bundled, public-domain datasets in prisma/data/.
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
type GitaRow = { c: number; v: number; sa: string; tr: string; en: string | null };

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
function loadDailyRefs(): string[] {
  return readFileSync(join(DATA_DIR, 'bible-daily-refs.txt'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

type Row = Omit<Prisma.VerseCreateManyInput, 'rotationIndex'>;

/** Inserts missing verses, then makes rotationIndex match the desired order. */
async function seedType(type: VerseType, rows: Row[], eligible: number[], seed: number) {
  const order = shuffledIndexes(eligible.length, seed);
  const desired = new Map<string, number>(); // "book|chapter|verse" -> rotationIndex
  order.forEach((pos, rotationIndex) => {
    const r = rows[eligible[pos]];
    desired.set(`${r.book}|${r.chapter}|${r.verse}`, rotationIndex);
  });
  const keyOf = (r: { book: string; chapter: number; verse: number }) => `${r.book}|${r.chapter}|${r.verse}`;

  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK).map((r) => ({ ...r, rotationIndex: desired.get(keyOf(r)) ?? null }));
    inserted += (await prisma.verse.createMany({ data: chunk, skipDuplicates: true })).count;
  }

  // Existing databases: fix the rotation only if it differs (e.g. bible-daily-refs.txt was edited).
  const current = await prisma.verse.findMany({
    where: { type },
    select: { id: true, book: true, chapter: true, verse: true, rotationIndex: true },
  });
  const changes = current.filter((v) => (desired.get(keyOf(v)) ?? null) !== v.rotationIndex);
  if (changes.length > 0) {
    await prisma.$transaction(
      async (tx) => {
        await tx.verse.updateMany({ where: { type }, data: { rotationIndex: null } });
        const targets = current.filter((v) => desired.has(keyOf(v)));
        for (let i = 0; i < targets.length; i += 500) {
          const batch = targets.slice(i, i + 500);
          const cases = Prisma.join(
            batch.map((v) => Prisma.sql`WHEN ${v.id} THEN ${desired.get(keyOf(v))}`),
            ' ',
          );
          await tx.$executeRaw`UPDATE verses SET rotationIndex = CASE id ${cases} END WHERE id IN (${Prisma.join(batch.map((v) => v.id))})`;
        }
      },
      { timeout: 300_000 },
    );
  }
  return { inserted, rotation: desired.size, rotationChanged: changes.length };
}

async function seedBible() {
  const data = load<BibleRow>('bible-kjv.json.gz');
  const indexByRef = new Map(data.map((r, i) => [`${r.b} ${r.c}:${r.v}`, i]));
  const refs = [...new Set(loadDailyRefs())];
  const missing = refs.filter((ref) => !indexByRef.has(ref));
  if (missing.length) console.warn(`Unknown references in bible-daily-refs.txt (skipped): ${missing.join(', ')}`);
  const eligible = refs.filter((ref) => indexByRef.has(ref)).map((ref) => indexByRef.get(ref) as number);

  const rows: Row[] = data.map((r) => ({
    type: VerseType.BIBLE,
    reference: `${r.b} ${r.c}:${r.v}`,
    book: r.b,
    chapter: r.c,
    verse: r.v,
    text: r.t,
    translation: 'KJV',
  }));
  const res = await seedType(VerseType.BIBLE, rows, eligible, ROTATION_SEED);
  console.log(`Bible (KJV): ${rows.length} verses (${res.inserted} new), ${res.rotation} in daily rotation (${res.rotationChanged} rotation updates)`);
}

async function seedGita() {
  const data = load<GitaRow>('gita.json.gz').filter((r) => r.en);
  // Chapter 1 is mostly the roll-call of both armies, so the rotation pool starts at chapter 2.
  const eligible = data.map((r, i) => (r.c >= 2 ? i : -1)).filter((i) => i >= 0);
  const rows: Row[] = data.map((r) => ({
    type: VerseType.GITA,
    reference: `Bhagavad Gita ${r.c}.${r.v}`,
    book: 'Bhagavad Gita',
    chapter: r.c,
    verse: r.v,
    text: r.en as string,
    originalText: r.sa,
    transliteration: r.tr,
    translation: 'Shri Purohit Swami',
  }));
  const res = await seedType(VerseType.GITA, rows, eligible, ROTATION_SEED + 1);
  console.log(`Bhagavad Gita: ${rows.length} verses (${res.inserted} new), ${res.rotation} in daily rotation (${res.rotationChanged} rotation updates)`);
}

async function main() {
  await seedBible();
  await seedGita();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
