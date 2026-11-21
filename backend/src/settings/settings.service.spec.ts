import { BadRequestException } from '@nestjs/common';
import type { AppConfigService } from '../config/app-config.service';
import type { PrismaService } from '../prisma/prisma.service';

// The real modules pull in ESM-only packages Jest can't load; the test passes its own fakes anyway.
jest.mock('../config/app-config.service', () => ({ AppConfigService: class {} }));
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

import { SettingsService } from './settings.service';

function setup(saved: Record<string, string> = {}) {
  const store = new Map(Object.entries(saved));
  const prisma = {
    appSetting: {
      findMany: jest.fn(async () => [...store].map(([key, value]) => ({ key, value }))),
      upsert: jest.fn(({ where, update }) => {
        store.set(where.key, update.value);
        return Promise.resolve();
      }),
      deleteMany: jest.fn(async () => store.clear()),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const env: Record<string, string> = {
    DAILY_SEND_TIME: '21:30',
    SEND_WINDOW_START: '07:00',
    SEND_WINDOW_END: '23:00',
    APP_TIMEZONE: 'Asia/Kolkata',
  };
  const config = { get: (k: string) => env[k] } as unknown as AppConfigService;
  return new SettingsService(prisma as unknown as PrismaService, config);
}

describe('SettingsService', () => {
  it('uses .env until a time is saved', async () => {
    const s = await setup().schedule();
    expect(s).toMatchObject({ dailySendTime: '21:30', source: 'env' });
  });

  it('a saved time overrides .env everywhere', async () => {
    const svc = setup();
    const s = await svc.updateSchedule({ dailySendTime: '16:40' });
    expect(s).toMatchObject({ dailySendTime: '16:40', sendWindowStart: '07:00', source: 'database' });
    expect((await svc.schedule()).dailySendTime).toBe('16:40');
  });

  it('rejects a send time outside the send window', async () => {
    await expect(setup().updateSchedule({ dailySendTime: '23:30' })).rejects.toThrow(BadRequestException);
    await expect(setup().updateSchedule({ dailySendTime: '06:00' })).rejects.toThrow(/inside the send window/);
  });

  it('accepts moving the window together with the time', async () => {
    const s = await setup().updateSchedule({ dailySendTime: '06:30', sendWindowStart: '06:00' });
    expect(s).toMatchObject({ dailySendTime: '06:30', sendWindowStart: '06:00' });
  });

  it('reset goes back to .env', async () => {
    const svc = setup({ DAILY_SEND_TIME: '16:40' });
    expect((await svc.schedule()).dailySendTime).toBe('16:40');
    expect((await svc.resetSchedule()).dailySendTime).toBe('21:30');
  });
});
