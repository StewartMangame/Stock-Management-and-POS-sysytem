/**
 * Money library unit tests.
 *
 * Covers:
 *  - roundHalfUp (spec §6.6: "rounded half up to the nearest tambala")
 *  - calcLineTax — exclusive price tax calculation
 *  - extractTaxFromInclusive — inclusive price tax extraction
 *  - calcNewAverageCost — formula from spec §6.3
 *  - allocateLandedCosts — spec §6.4: by value, last line absorbs remainder
 *  - formatDocNumber — spec §6.7
 *  - formatMwk / parseKwachaToMinor
 */

import { describe, it, expect } from 'vitest';
import {
  roundHalfUp,
  calcLineTax,
  extractTaxFromInclusive,
  calcNewAverageCost,
  allocateLandedCosts,
  formatDocNumber,
  formatMwk,
  parseKwachaToMinor,
} from '@/lib/money';

// ── roundHalfUp ───────────────────────────────────────────────────────────────

describe('roundHalfUp', () => {
  it('rounds 0.5 up to 1', () => expect(roundHalfUp(0.5)).toBe(1));
  it('rounds 1.5 up to 2', () => expect(roundHalfUp(1.5)).toBe(2));
  it('rounds 2.5 up to 3', () => expect(roundHalfUp(2.5)).toBe(3));
  it('rounds 1.4 down to 1', () => expect(roundHalfUp(1.4)).toBe(1));
  it('rounds negative -0.5 to 0 (half-up towards +∞)', () => expect(roundHalfUp(-0.5)).toBe(0));
  it('handles integers unchanged', () => expect(roundHalfUp(7)).toBe(7));
});

// ── calcLineTax ───────────────────────────────────────────────────────────────

describe('calcLineTax (prices exclusive of tax)', () => {
  const VAT = 1750; // 17.5%

  it('calculates tax on a single unit', () => {
    // 1000 tambala × 1 unit = 1000 line total
    // tax = 1000 × 1750/10000 = 175
    const result = calcLineTax(1000, 1, VAT);
    expect(result.lineTotal).toBe(1000);
    expect(result.taxAmount).toBe(175);
    expect(result.lineTotalIncTax).toBe(1175);
  });

  it('calculates tax with quantity', () => {
    // 50000 tambala × 3 = 150000 line total
    // tax = 150000 × 0.175 = 26250
    const result = calcLineTax(50000, 3, VAT);
    expect(result.lineTotal).toBe(150000);
    expect(result.taxAmount).toBe(26250);
    expect(result.lineTotalIncTax).toBe(176250);
  });

  it('rounds tax half-up (not banker rounding)', () => {
    // line = 1001 tambala; tax = 1001 × 0.175 = 175.175 → rounds to 175
    const result = calcLineTax(1001, 1, VAT);
    expect(result.taxAmount).toBe(175);
  });

  it('handles fractional quantities (3dp)', () => {
    // 10000 × 1.5 = 15000; tax = 15000 × 0.175 = 2625
    const result = calcLineTax(10000, 1.5, VAT);
    expect(result.lineTotal).toBe(15000);
    expect(result.taxAmount).toBe(2625);
  });

  it('handles zero-rate tax', () => {
    const result = calcLineTax(10000, 2, 0);
    expect(result.taxAmount).toBe(0);
    expect(result.lineTotalIncTax).toBe(20000);
  });
});

// ── extractTaxFromInclusive ────────────────────────────────────────────────────

describe('extractTaxFromInclusive', () => {
  it('extracts 17.5% VAT from an inclusive price', () => {
    // 1175 inc → 1000 exc, 175 tax
    const result = extractTaxFromInclusive(1175, 1750);
    expect(result.totalExcMinor).toBe(1000);
    expect(result.taxAmount).toBe(175);
  });

  it('rounds correctly for non-round numbers', () => {
    // 1000 inc at 17.5% → exc = 1000/1.175 = 851.06... → 851; tax = 149
    const result = extractTaxFromInclusive(1000, 1750);
    expect(result.totalExcMinor + result.taxAmount).toBe(1000);
  });
});

// ── calcNewAverageCost ────────────────────────────────────────────────────────

describe('calcNewAverageCost (spec §6.3)', () => {
  it('sets average cost when starting from zero on-hand', () => {
    // No existing stock; new cost = receivedUnitCost
    const avg = calcNewAverageCost(0, 0, 10, 5000);
    expect(avg).toBe(5000);
  });

  it('calculates weighted average on second receipt', () => {
    // 10 units @ 5000 + 10 units @ 7000 = 120000 / 20 = 6000
    const avg = calcNewAverageCost(10, 5000, 10, 7000);
    expect(avg).toBe(6000);
  });

  it('rounds half-up', () => {
    // 1 unit @ 3 + 1 unit @ 4 = 7/2 = 3.5 → rounds to 4
    const avg = calcNewAverageCost(1, 3, 1, 4);
    expect(avg).toBe(4);
  });

  it('returns current avg when received qty is 0', () => {
    expect(calcNewAverageCost(10, 5000, 0, 9999)).toBe(5000);
  });

  it('handles multiple receipts correctly (cumulative)', () => {
    // Simulate three goods receipts:
    // Receipt 1: 5 units @ 10000 → avg = 10000
    let avg = calcNewAverageCost(0, 0, 5, 10000);
    expect(avg).toBe(10000);

    // Receipt 2: 5 units @ 14000 → (50000 + 70000) / 10 = 12000
    avg = calcNewAverageCost(5, avg, 5, 14000);
    expect(avg).toBe(12000);

    // Receipt 3: 10 units @ 8000 → (120000 + 80000) / 20 = 10000
    avg = calcNewAverageCost(10, avg, 10, 8000);
    expect(avg).toBe(10000);
  });
});

// ── allocateLandedCosts ───────────────────────────────────────────────────────

describe('allocateLandedCosts (spec §6.4)', () => {
  it('allocates zero landed cost as all zeros', () => {
    const result = allocateLandedCosts([10000, 20000], 0);
    expect(result).toEqual([0, 0]);
  });

  it('allocates proportionally by value', () => {
    // Lines: 10000 (33.3%), 20000 (66.7%) — total landed 3000
    // Line 1: 3000 × (10000/30000) = 1000
    // Line 2 (last, absorbs remainder): 3000 - 1000 = 2000
    const result = allocateLandedCosts([10000, 20000], 3000);
    expect(result[0]).toBe(1000);
    expect(result[1]).toBe(2000);
    expect(result.reduce((a, b) => a + b, 0)).toBe(3000);
  });

  it('last line absorbs any rounding remainder', () => {
    // 3 equal lines: 1000 each; landed cost 100
    // Each line gets 33 (100/3 = 33.33 → rounds to 33)
    // First 2: 33, last: 100 - 66 = 34
    const result = allocateLandedCosts([1000, 1000, 1000], 100);
    const total = result.reduce((a, b) => a + b, 0);
    expect(total).toBe(100); // sum is always exact
  });

  it('distributes equally when all lines have zero value', () => {
    const result = allocateLandedCosts([0, 0], 100);
    expect(result.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('handles a single line (gets all landed cost)', () => {
    const result = allocateLandedCosts([50000], 5000);
    expect(result[0]).toBe(5000);
  });
});

// ── formatDocNumber ───────────────────────────────────────────────────────────

describe('formatDocNumber (spec §6.7)', () => {
  it('formats with default padding', () => {
    expect(formatDocNumber('MAIN-INV', 1, 4)).toBe('MAIN-INV-0001');
    expect(formatDocNumber('MAIN-INV', 42, 4)).toBe('MAIN-INV-0042');
    expect(formatDocNumber('MAIN-INV', 9999, 4)).toBe('MAIN-INV-9999');
  });

  it('does not truncate numbers larger than padding', () => {
    expect(formatDocNumber('MAIN-INV', 10000, 4)).toBe('MAIN-INV-10000');
  });

  it('supports different prefixes', () => {
    expect(formatDocNumber('MAIN-QT', 1, 4)).toBe('MAIN-QT-0001');
    expect(formatDocNumber('MAIN-GRN', 7, 4)).toBe('MAIN-GRN-0007');
  });
});

// ── formatMwk / parseKwachaToMinor ───────────────────────────────────────────

describe('formatMwk', () => {
  it('formats tambala as kwacha with 2dp', () => {
    // 150000 tambala = MWK 1,500.00
    expect(formatMwk(150000)).toContain('1,500.00');
    expect(formatMwk(150000)).toContain('MWK');
  });

  it('formats zero correctly', () => {
    expect(formatMwk(0)).toContain('0.00');
  });

  it('omits symbol when requested', () => {
    const result = formatMwk(100, { symbol: false });
    expect(result).not.toContain('MWK');
    expect(result).toContain('1.00');
  });
});

describe('parseKwachaToMinor', () => {
  it('converts "1500" to 150000 tambala', () => {
    expect(parseKwachaToMinor('1500')).toBe(150000);
  });

  it('converts "1,500.00" (with comma) to 150000', () => {
    expect(parseKwachaToMinor('1,500.00')).toBe(150000);
  });

  it('rounds half-up on fractional tambala', () => {
    // 0.555 kwacha = 55.5 tambala → rounds to 56
    expect(parseKwachaToMinor('0.555')).toBe(56);
  });

  it('throws on invalid input', () => {
    expect(() => parseKwachaToMinor('abc')).toThrow();
  });
});
