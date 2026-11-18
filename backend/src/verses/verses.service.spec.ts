import { Verse, VerseType } from '@prisma/client';
import { TierRange, VersesRepository } from './verses.repository';
import { VersesService } from './verses.service';

/** In-memory stand-in for the repository, mirroring the SQL semantics. */
function fakeRepo(tiers: TierRange[]) {
  const pool: Verse[] = [];
  for (const t of tiers) {
    for (let i = 0; i < t.size; i++) {
      const idx = t.start + i;
      pool.push({ id: 1000 + idx, rotationIndex: idx, rotationTier: t.tier, type: 'GITA' } as Verse);
    }
  }
  const assigned = new Set<string>();
  const repo = {
    tierRanges: jest.fn(async () => tiers),
    findFirstUnassigned: jest.fn(async (_t: VerseType, sub: number, from: number, to: number) =>
      pool.find((v) => v.rotationIndex! >= from && v.rotationIndex! < to && !assigned.has(`${sub}:${v.id}`)) ?? null,
    ),
    reserve: jest.fn(async (sub: number, verseId: number) => {
      const key = `${sub}:${verseId}`;
      if (assigned.has(key)) return false;
      assigned.add(key);
      return true;
    }),
    release: jest.fn(async (sub: number, verseId: number) => void assigned.delete(`${sub}:${verseId}`)),
  };
  return { repo: repo as unknown as VersesRepository, pool };
}

const sub = (progress: number, rotationOffset = 3) => ({ id: 1, verseType: 'GITA' as VerseType, rotationOffset, progress });

describe('VersesService.nextVerse', () => {
  it('walks every verse exactly once, tier 1 before tier 2, then returns null', async () => {
    const { repo, pool } = fakeRepo([
      { tier: 1, start: 0, size: 5 },
      { tier: 2, start: 5, size: 3 },
    ]);
    const service = new VersesService(repo);
    const got: Verse[] = [];
    for (let day = 0; day < 20; day++) {
      const v = await service.nextVerse(sub(day));
      if (!v) break;
      got.push(v);
    }
    expect(got).toHaveLength(pool.length);
    expect(new Set(got.map((v) => v.id)).size).toBe(pool.length);
    expect(got.map((v) => v.rotationTier)).toEqual([1, 1, 1, 1, 1, 2, 2, 2]);
    // starts at the subscriber's random offset (3) inside tier 1
    expect(got[0].rotationIndex).toBe(3);
    expect(await service.nextVerse(sub(got.length))).toBeNull();
  });

  it('never repeats even when progress is wrong (e.g. after a crash)', async () => {
    const { repo } = fakeRepo([{ tier: 1, start: 0, size: 4 }]);
    const service = new VersesService(repo);
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push((await service.nextVerse(sub(0)))!.id); // progress stuck at 0
    expect(new Set(ids).size).toBe(4);
    expect(await service.nextVerse(sub(0))).toBeNull();
  });

  it('makes a released verse available again', async () => {
    const { repo } = fakeRepo([{ tier: 1, start: 0, size: 2 }]);
    const service = new VersesService(repo);
    const first = (await service.nextVerse(sub(0, 0)))!;
    await service.release(1, first.id);
    expect((await service.nextVerse(sub(0, 0)))!.id).toBe(first.id);
  });
});
