import { isWithinWindow, localDate, toIsoDate } from './time.util';

describe('time utils', () => {
  it('computes the local calendar day in Asia/Kolkata', () => {
    // 2026-11-18 20:00 UTC = 2026-11-19 01:30 IST
    expect(toIsoDate(localDate('Asia/Kolkata', new Date('2026-11-18T20:00:00Z')))).toBe('2026-11-19');
    expect(toIsoDate(localDate('UTC', new Date('2026-11-18T20:00:00Z')))).toBe('2026-11-18');
  });

  it('checks send windows, including ones that wrap midnight', () => {
    const at = new Date('2026-11-18T03:00:00Z'); // 08:30 IST
    expect(isWithinWindow('Asia/Kolkata', '07:00', '21:30', at)).toBe(true);
    expect(isWithinWindow('Asia/Kolkata', '09:00', '21:30', at)).toBe(false);
    expect(isWithinWindow('Asia/Kolkata', '22:00', '09:00', at)).toBe(true);
  });
});
