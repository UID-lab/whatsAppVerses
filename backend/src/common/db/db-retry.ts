import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** MySQL errors that mean "nothing was applied, just run it again". */
const RETRYABLE_MYSQL_CODES = new Set(['1213', '1205']); // deadlock, lock wait timeout
const RETRYABLE_PRISMA_CODES = new Set(['P2034']); // Prisma: write conflict or deadlock in a transaction

const logger = new Logger('DbRetry');

/**
 * True for transient lock conflicts. InnoDB rolls the whole transaction back on a deadlock, so
 * re-running the same statement or transaction is safe.
 */
export function isRetryableDbError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (RETRYABLE_PRISMA_CODES.has(err.code)) return true;
    const mysqlCode = String((err.meta as { code?: unknown } | undefined)?.code ?? '');
    if (RETRYABLE_MYSQL_CODES.has(mysqlCode)) return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /Deadlock found|Lock wait timeout exceeded/i.test(message);
}

export interface DbRetryOptions {
  /** Total tries, including the first one. */
  attempts?: number;
  /** First back-off; doubles each try, with jitter. */
  baseDelayMs?: number;
  /** Shown in the log when a retry happens. */
  label?: string;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/**
 * Runs `fn`, re-running it after a short random pause when the database reports a deadlock or a
 * lock wait timeout. `fn` must be safe to repeat: a single statement, or a whole transaction.
 * Any other error, or the last failed try, is thrown as is.
 */
export async function withDbRetry<T>(fn: () => Promise<T>, opts: DbRetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const base = opts.baseDelayMs ?? 50;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !isRetryableDbError(err)) throw err;
      const delay = Math.round(base * 2 ** (attempt - 1) * (0.5 + random()));
      logger.debug(`${opts.label ?? 'query'}: lock conflict, retry ${attempt}/${attempts - 1} in ${delay}ms`);
      await sleep(delay);
    }
  }
}
