/**
 * Proves the no-repeat guarantee against your real database.
 *
 *   npm run verify:no-repeats              # both types (Bible takes ~1 minute)
 *   npm run verify:no-repeats -- QURAN     # one type (BIBLE | GITA | QURAN)
 *
 * For each verse type it creates a temporary test subscriber (status UNSUBSCRIBED, so nothing
 * is ever sent to it), then draws verses one "day" at a time with the exact selection code the
 * worker uses, until the pool is empty. It checks that:
 *   1. no verse is ever drawn twice,
 *   2. every verse in the pool is eventually drawn,
 *   3. the primary tier is used up before the extended tier,
 *   4. once the pool is empty, nothing more is handed out,
 *   5. 25 draws in parallel still never produce a duplicate.
 * The test subscribers and their history are deleted afterwards.
 */
import { SubscriberStatus, VerseType } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { VersesRepository } from '../src/verses/verses.repository';
import { VersesService } from '../src/verses/verses.service';

// Load backend/.env (DATABASE_URL) the same way the app does.
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file: rely on the real environment */
}

const prisma = new PrismaService();
const verses = new VersesService(new VersesRepository(prisma));
const createdIds: number[] = [];

async function testSubscriber(type: VerseType) {
  const sub = await prisma.subscriber.create({
    data: {
      name: 'No-repeat test',
      phoneE164: `+000${randomBytes(6).toString('hex').replace(/\D/g, '').padEnd(10, '7').slice(0, 10)}`,
      verseType: type,
      status: SubscriberStatus.UNSUBSCRIBED,
      manageToken: randomBytes(16).toString('hex'),
      rotationOffset: await verses.randomOffset(type),
    },
  });
  createdIds.push(sub.id);
  return sub;
}

function check(ok: boolean, message: string) {
  console.log(`  ${ok ? '✅' : '❌'} ${message}`);
  if (!ok) process.exitCode = 1;
}

async function verifyType(type: VerseType) {
  const tiers = await verses.tierRanges(type);
  const pool = tiers.reduce((n, t) => n + t.size, 0);
  console.log(`\n${type}: pool of ${pool} verses (${tiers.map((t) => `tier ${t.tier}: ${t.size}`).join(', ')})`);
  if (pool === 0) return check(false, 'pool is empty — run `npm run prisma:seed` first');

  const sub = await testSubscriber(type);
  const seen = new Set<number>();
  const tierOf: number[] = [];
  let duplicates = 0;
  const started = Date.now();
  for (let day = 0; ; day++) {
    const verse = await verses.nextVerse({ ...sub, progress: day });
    if (!verse) break;
    if (seen.has(verse.id)) duplicates++;
    seen.add(verse.id);
    tierOf.push(verse.rotationTier ?? 0);
    if ((day + 1) % 2000 === 0) console.log(`  … ${day + 1} days simulated`);
    if (day > pool + 10) break; // safety net: would mean verses are being repeated
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`  Simulated ${tierOf.length} days in ${seconds}s (≈ ${(tierOf.length / 365).toFixed(1)} years of daily verses)`);

  check(duplicates === 0, `no verse repeated (${duplicates} duplicates)`);
  check(seen.size === pool, `every verse used exactly once (${seen.size}/${pool})`);
  const firstTier2 = tierOf.indexOf(2);
  const tier1AfterTier2 = firstTier2 >= 0 && tierOf.slice(firstTier2).includes(1);
  check(!tier1AfterTier2, 'primary tier fully used before the extended tier');
  check((await verses.nextVerse({ ...sub, progress: tierOf.length })) === null, 'nothing handed out once the pool is used up');

  // Concurrency: many workers asking for the same subscriber's next verse at the same moment.
  const racer = await testSubscriber(type);
  const results = await Promise.all(Array.from({ length: 25 }, () => verses.nextVerse({ ...racer, progress: 0 })));
  const ids = results.filter(Boolean).map((v) => v!.id);
  check(new Set(ids).size === ids.length, `25 parallel draws gave ${ids.length} distinct verses`);
}

async function main() {
  const arg = process.argv[2]?.toUpperCase();
  const types =
    arg === 'BIBLE' || arg === 'GITA' || arg === 'QURAN'
      ? [arg as VerseType]
      : [VerseType.GITA, VerseType.QURAN, VerseType.BIBLE];
  try {
    for (const type of types) await verifyType(type);
  } finally {
    if (createdIds.length) await prisma.subscriber.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.$disconnect();
  }
  console.log(process.exitCode ? '\n❌ No-repeat check FAILED' : '\n✅ No-repeat guarantee verified');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
