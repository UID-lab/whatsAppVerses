jest.mock('@nestjs/common', () => ({
  Logger: class {
    debug() {}
  },
}));

import { Prisma } from '@prisma/client';
import { isRetryableDbError, withDbRetry } from './db-retry';

const known = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('db error', { code, clientVersion: 'test', meta });

const deadlock = known('P2010', { code: '1213', message: 'Deadlock found when trying to get lock' });
const noSleep = { sleep: async () => undefined };

describe('isRetryableDbError', () => {
  it('recognises deadlocks and lock wait timeouts', () => {
    expect(isRetryableDbError(deadlock)).toBe(true);
    expect(isRetryableDbError(known('P2010', { code: '1205' }))).toBe(true);
    expect(isRetryableDbError(known('P2034'))).toBe(true);
    expect(isRetryableDbError(new Error('Raw query failed. Code: `1213`. Message: `Deadlock found …`'))).toBe(true);
  });

  it('does not retry other errors', () => {
    expect(isRetryableDbError(known('P2002'))).toBe(false); // unique constraint
    expect(isRetryableDbError(known('P2010', { code: '1062' }))).toBe(false);
    expect(isRetryableDbError(new Error("Can't reach database server"))).toBe(false);
  });
});

describe('withDbRetry', () => {
  it('re-runs after a deadlock and returns the result', async () => {
    let calls = 0;
    const fn = jest.fn(async () => {
      calls++;
      if (calls < 3) throw deadlock;
      return 'ok';
    });
    await expect(withDbRetry(fn, noSleep)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('gives up after the last attempt', async () => {
    const fn = jest.fn(async () => {
      throw deadlock;
    });
    await expect(withDbRetry(fn, { ...noSleep, attempts: 3 })).rejects.toBe(deadlock);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-transient errors', async () => {
    const err = known('P2002');
    const fn = jest.fn(async () => {
      throw err;
    });
    await expect(withDbRetry(fn, noSleep)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('backs off with growing delays', async () => {
    const delays: number[] = [];
    let calls = 0;
    await withDbRetry(
      async () => {
        if (++calls < 4) throw deadlock;
      },
      { sleep: async (ms) => void delays.push(ms), random: () => 0.5, baseDelayMs: 50 },
    );
    expect(delays).toEqual([50, 100, 200]);
  });
});
