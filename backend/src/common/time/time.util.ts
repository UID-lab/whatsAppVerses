/** Date/time helpers that work in an IANA time zone without extra dependencies. */

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function localParts(timeZone: string, at: Date = new Date()): LocalParts {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(at).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** The local calendar day in `timeZone`, as a UTC-midnight Date (what Prisma uses for @db.Date). */
export function localDate(timeZone: string, at: Date = new Date()): Date {
  const p = localParts(timeZone, at);
  return new Date(Date.UTC(p.year, p.month - 1, p.day));
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function localMinutesNow(timeZone: string, at: Date = new Date()): number {
  const p = localParts(timeZone, at);
  return p.hour * 60 + p.minute;
}

/** True when the local time is within [start, end). Supports windows that wrap midnight. */
export function isWithinWindow(timeZone: string, start: string, end: string, at: Date = new Date()): boolean {
  const now = localMinutesNow(timeZone, at);
  const s = minutesOfDay(start);
  const e = minutesOfDay(end);
  return s <= e ? now >= s && now < e : now >= s || now < e;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Uniform random value in [base*(1-spread), base*(1+spread)]. */
export function jitter(base: number, spread = 0.3): number {
  return Math.round(base * (1 - spread + Math.random() * 2 * spread));
}

/** "21:30" -> "9:30 PM", "07:05" -> "7:05 AM". */
export function formatClockTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export type FirstVerseTiming = 'today' | 'now' | 'tomorrow';

/**
 * When someone who subscribes at `at` gets their first daily verse:
 *  - today    — before today's send time: they're included in today's scheduled run;
 *  - now      — after the send time but inside the send window: sent right after the welcome;
 *  - tomorrow — after the send window has closed for the day.
 */
export function firstVerseTiming(
  timeZone: string,
  sendTime: string,
  windowStart: string,
  windowEnd: string,
  at: Date = new Date(),
): FirstVerseTiming {
  if (localMinutesNow(timeZone, at) < minutesOfDay(sendTime)) return 'today';
  return isWithinWindow(timeZone, windowStart, windowEnd, at) ? 'now' : 'tomorrow';
}
