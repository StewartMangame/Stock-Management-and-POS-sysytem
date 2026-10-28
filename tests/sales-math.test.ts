import { describe, it, expect } from 'vitest';
import {
  calculateSalesLine,
  calculateDocumentTotals,
  validateLineCredit,
  validateReturnQuantity,
} from '@/lib/sales-math';

describe('Shared Sales Math (Rule 2 & 9)', () => {
  it('calculates line net, tax, and line total using exact roundHalfUp arithmetic in tambala', () => {
    // 1 item @ MWK 150.00 (15,000 tambala), 17.5% VAT (1750 bp)
    // net = 15,000
    // tax = 15,000 * 1750 / 10000 = 2625 tambala (MWK 26.25)
    // total = 17,625 tambala (MWK 176.25)
    const line = calculateSalesLine({
      quantity: 1,
      unitPriceMinor: 15000,
      discountMinor: 0,
      taxRateBasisPoints: 1750,
    });

    expect(line.netMinor).toBe(15000);
    expect(line.taxMinor).toBe(2625);
    expect(line.lineTotalMinor).toBe(17625);
  });

  it('correctly rounds tax with roundHalfUp on odd tambala figures', () => {
    // 3 items @ MWK 33.33 (3333 tambala), 17.5% VAT (1750 bp)
    // gross = 3 * 3333 = 9999 tambala
    // tax = 9999 * 1750 / 10000 = 1749.825 -> roundHalfUp -> 1750 tambala
    // total = 9999 + 1750 = 11749 tambala
    const line = calculateSalesLine({
      quantity: 3,
      unitPriceMinor: 3333,
      discountMinor: 0,
      taxRateBasisPoints: 1750,
    });

    expect(line.netMinor).toBe(9999);
    expect(line.taxMinor).toBe(1750);
    expect(line.lineTotalMinor).toBe(11749);
  });

  it('subtracts per-line discount before calculating tax', () => {
    // 2 items @ 10,000 tambala, discount 2,000 tambala
    // net = 20,000 - 2,000 = 18,000 tambala
    // tax = 18,000 * 1750 / 10000 = 3150 tambala
    // total = 18,000 + 3150 = 21,150 tambala
    const line = calculateSalesLine({
      quantity: 2,
      unitPriceMinor: 10000,
      discountMinor: 2000,
      taxRateBasisPoints: 1750,
    });

    expect(line.netMinor).toBe(18000);
    expect(line.taxMinor).toBe(3150);
    expect(line.lineTotalMinor).toBe(21150);
  });

  it('aggregates document totals accurately across multiple lines', () => {
    const totals = calculateDocumentTotals([
      {
        quantity: 2,
        unitPriceMinor: 10000,
        discountMinor: 2000,
        taxRateBasisPoints: 1750,
      },
      {
        quantity: 1,
        unitPriceMinor: 5000,
        discountMinor: 0,
        taxRateBasisPoints: 0, // exempt / zero rated
      },
    ]);

    expect(totals.subtotalMinor).toBe(25000);
    expect(totals.discountMinor).toBe(2000);
    expect(totals.netMinor).toBe(23000);
    expect(totals.taxMinor).toBe(3150);
    expect(totals.totalMinor).toBe(26150);
    expect(totals.lines).toHaveLength(2);
  });

  it('validates remaining creditable amount on credit notes', () => {
    // Line total was 20,000 tambala, 5,000 already credited
    const check1 = validateLineCredit(20000, 5000, 15000);
    expect(check1.valid).toBe(true);
    expect(check1.remainingMinor).toBe(15000);

    const check2 = validateLineCredit(20000, 5000, 15001);
    expect(check2.valid).toBe(false);
  });

  it('validates physical return quantity against delivered minus already returned', () => {
    // Delivered 10 units, already returned 3 units
    const check1 = validateReturnQuantity(10, 3, 7);
    expect(check1.valid).toBe(true);
    expect(check1.maxReturnableQty).toBe('7.000');

    const check2 = validateReturnQuantity(10, 3, 7.5);
    expect(check2.valid).toBe(false);
  });
});
