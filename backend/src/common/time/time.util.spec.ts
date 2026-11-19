import { firstVerseTiming, formatClockTime, isWithinWindow, localDate, toIsoDate } from './time.util';

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

describe('first verse timing', () => {
  const ist = (hhmm: string) => new Date(`2026-11-18T${hhmm}:00+05:30`);

  it('formats clock times', () => {
    expect(formatClockTime('21:30')).toBe('9:30 PM');
    expect(formatClockTime('07:05')).toBe('7:05 AM');
    expect(formatClockTime('00:00')).toBe('12:00 AM');
    expect(formatClockTime('12:15')).toBe('12:15 PM');
  });

  it('decides when the first verse goes out', () => {
    const t = (hhmm: string) => firstVerseTiming('Asia/Kolkata', '21:30', '07:00', '23:00', ist(hhmm));
    expect(t('09:00')).toBe('today'); // before send time: tonight's run includes them
    expect(t('21:45')).toBe('now'); // after send time, window still open: right away
    expect(t('23:30')).toBe('tomorrow'); // window closed
  });
});
