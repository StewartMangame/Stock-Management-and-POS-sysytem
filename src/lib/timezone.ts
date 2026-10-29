/**
 * Timezone utilities for Ace Holdings POS.
 *
 * All local business dates and reports must use COMPANY_TIMEZONE ('Africa/Blantyre', UTC+2).
 * Vercel and servers run in UTC, so a local sale at 00:30 local time would otherwise
 * receive yesterday's UTC date.
 */

export const COMPANY_TIMEZONE = 'Africa/Blantyre';

let customClock: (() => Date) | null = null;

/**
 * Returns the current instant in time.
 * In production, returns new Date().
 * In tests, can be mocked via setClock().
 */
export function getNow(): Date {
  return customClock ? customClock() : new Date();
}

/**
 * Set a custom clock for testing (e.g. simulating midnight in Blantyre).
 */
export function setClock(fn: () => Date): void {
  customClock = fn;
}

/**
 * Reset test clock back to system clock.
 */
export function resetClock(): void {
  customClock = null;
}

/**
 * Returns today's date in Africa/Blantyre as a 'YYYY-MM-DD' string.
 * Uses the testable getNow() clock by default.
 */
export function todayInCompanyTz(date: Date = getNow()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: COMPANY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/**
 * Returns the start of the day (00:00:00.000 local) in Africa/Blantyre
 * as an absolute UTC Date instant.
 *
 * @param dateStr Date formatted as 'YYYY-MM-DD'
 */
export function startOfDayInCompanyTz(dateStr: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid date format '${dateStr}', expected 'YYYY-MM-DD'`);
  }
  // Africa/Blantyre is permanently UTC+2 (no DST)
  return new Date(`${dateStr}T00:00:00+02:00`);
}

/**
 * Returns the end of the day (23:59:59.999 local) in Africa/Blantyre
 * as an absolute UTC Date instant.
 *
 * @param dateStr Date formatted as 'YYYY-MM-DD'
 */
export function endOfDayInCompanyTz(dateStr: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid date format '${dateStr}', expected 'YYYY-MM-DD'`);
  }
  // Africa/Blantyre is permanently UTC+2 (no DST)
  return new Date(`${dateStr}T23:59:59.999+02:00`);
}
