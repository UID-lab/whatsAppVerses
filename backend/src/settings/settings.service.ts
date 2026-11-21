import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';
import { formatClockTime, minutesOfDay } from '../common/time/time.util';

export interface Schedule {
  /** When the daily verses go out, local time (APP_TIMEZONE), "HH:MM". */
  dailySendTime: string;
  /** Daily verses are only sent inside [sendWindowStart, sendWindowEnd). */
  sendWindowStart: string;
  sendWindowEnd: string;
  timezone: string;
  /** "database" when an admin changed it at runtime, "env" when it comes from backend/.env. */
  source: 'database' | 'env';
}

const KEYS = ['DAILY_SEND_TIME', 'SEND_WINDOW_START', 'SEND_WINDOW_END'] as const;
type Key = (typeof KEYS)[number];
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const CACHE_MS = 5_000;

/**
 * The single source of truth for the send schedule. The scheduler, the worker, the welcome
 * message and the sign-up page all read it from here, so they can never disagree.
 *
 * Values saved by an admin (PUT /api/admin/settings/schedule) live in the app_settings table and
 * take effect within a few seconds on every replica, without a restart. Without saved values,
 * the DAILY_SEND_TIME / SEND_WINDOW_* environment variables are used.
 */
@Injectable()
export class SettingsService {
  private cache?: { value: Schedule; at: number };

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async schedule(): Promise<Schedule> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const rows = await this.prisma.appSetting.findMany({ where: { key: { in: [...KEYS] } } });
    const saved = new Map(rows.map((r) => [r.key as Key, r.value]));
    const pick = (k: Key) => (saved.get(k) && HH_MM.test(saved.get(k)!) ? saved.get(k)! : this.config.get(k));
    const value: Schedule = {
      dailySendTime: pick('DAILY_SEND_TIME'),
      sendWindowStart: pick('SEND_WINDOW_START'),
      sendWindowEnd: pick('SEND_WINDOW_END'),
      timezone: this.config.get('APP_TIMEZONE'),
      source: saved.size > 0 ? 'database' : 'env',
    };
    this.cache = { value, at: Date.now() };
    return value;
  }

  async updateSchedule(patch: Partial<Pick<Schedule, 'dailySendTime' | 'sendWindowStart' | 'sendWindowEnd'>>): Promise<Schedule> {
    const current = await this.schedule();
    const next = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    for (const [name, v] of Object.entries({
      dailySendTime: next.dailySendTime,
      sendWindowStart: next.sendWindowStart,
      sendWindowEnd: next.sendWindowEnd,
    })) {
      if (!HH_MM.test(v)) throw new BadRequestException(`${name} must be HH:MM (24-hour), e.g. 21:30`);
    }
    const send = minutesOfDay(next.dailySendTime);
    if (!(minutesOfDay(next.sendWindowStart) <= send && send < minutesOfDay(next.sendWindowEnd))) {
      throw new BadRequestException(
        `The send time (${formatClockTime(next.dailySendTime)}) must be inside the send window ` +
          `(${formatClockTime(next.sendWindowStart)}–${formatClockTime(next.sendWindowEnd)}).`,
      );
    }
    const values: Record<Key, string> = {
      DAILY_SEND_TIME: next.dailySendTime,
      SEND_WINDOW_START: next.sendWindowStart,
      SEND_WINDOW_END: next.sendWindowEnd,
    };
    await this.prisma.$transaction(
      KEYS.map((key) =>
        this.prisma.appSetting.upsert({ where: { key }, create: { key, value: values[key] }, update: { value: values[key] } }),
      ),
    );
    this.cache = undefined;
    return this.schedule();
  }

  /** Forget runtime values and go back to the environment variables. */
  async resetSchedule(): Promise<Schedule> {
    await this.prisma.appSetting.deleteMany({ where: { key: { in: [...KEYS] } } });
    this.cache = undefined;
    return this.schedule();
  }
}
