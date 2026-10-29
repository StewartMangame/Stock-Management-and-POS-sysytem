import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  COMPANY_TIMEZONE,
  todayInCompanyTz,
  startOfDayInCompanyTz,
  endOfDayInCompanyTz,
  setClock,
  resetClock,
  getNow,
} from '@/lib/timezone';

describe('Timezone helpers (Africa/Blantyre)', () => {
  afterEach(() => {
    resetClock();
  });

  it('COMPANY_TIMEZONE is Africa/Blantyre', () => {
    expect(COMPANY_TIMEZONE).toBe('Africa/Blantyre');
  });

  it('formats Blantyre date correctly across UTC midnight', () => {
    // 22:30 UTC on Oct 29 is 00:30 on Oct 30 in Blantyre (UTC+2)
    setClock(() => new Date('2026-10-29T22:30:00.000Z'));
    expect(todayInCompanyTz()).toBe('2026-10-30');

    // 21:59 UTC on Oct 29 is 23:59 on Oct 29 in Blantyre
    setClock(() => new Date('2026-10-29T21:59:59.000Z'));
    expect(todayInCompanyTz()).toBe('2026-10-29');
  });

  it('computes startOfDay and endOfDay in company timezone', () => {
    const start = startOfDayInCompanyTz('2026-10-30');
    const end = endOfDayInCompanyTz('2026-10-30');

    // 2026-10-30 00:00:00+02:00 = 2026-10-29 22:00:00Z
    expect(start.toISOString()).toBe('2026-10-29T22:00:00.000Z');
    // 2026-10-30 23:59:59.999+02:00 = 2026-10-30 21:59:59.999Z
    expect(end.toISOString()).toBe('2026-10-30T21:59:59.999Z');
  });

  it('throws on invalid date strings for startOfDay and endOfDay', () => {
    expect(() => startOfDayInCompanyTz('2026/10/30')).toThrow();
    expect(() => endOfDayInCompanyTz('invalid')).toThrow();
  });
});
