/**
 * Shared sales calculation module for quotations, invoices, and credit notes.
 *
 * Implements exact integer arithmetic in MWK tambala (1/100 MWK) using Decimal.js
 * with ROUND_HALF_UP rounding.
 *
 * Rule: VAT rate is never hard-coded; it is passed as basis points (e.g. 1750 = 17.5%)
 * obtained from the tax_rates table.
 */

import Decimal from 'decimal.js';

// Configure Decimal for financial precision
const D = Decimal.clone({
  precision: 28,
  rounding: Decimal.ROUND_HALF_UP,
});

export interface SalesLineInput {
  quantity: number | string;
  unitPriceMinor: number | string;
  discountMinor?: number | string;
  taxRateBasisPoints: number;
}

export interface CalculatedSalesLine {
  quantity: string;
  unitPriceMinor: number;
  discountMinor: number;
  netMinor: number;
  taxRateBasisPoints: number;
  taxMinor: number;
  lineTotalMinor: number;
}

export interface CalculatedDocumentTotals {
  subtotalMinor: number;
  discountMinor: number;
  netMinor: number;
  taxMinor: number;
  totalMinor: number;
  lines: CalculatedSalesLine[];
}

/**
 * Calculates a single sales line's net, tax, and line total in minor units (tambala).
 *
 * Formula:
 *   gross = quantity * unitPriceMinor
 *   net = gross - discountMinor
 *   tax = roundHalfUp((net * taxRateBasisPoints) / 10000)
 *   lineTotal = net + tax
 */
export function calculateSalesLine(input: SalesLineInput): CalculatedSalesLine {
  const qty = new D(input.quantity);
  if (qty.isNegative()) {
    throw new Error('Quantity cannot be negative');
  }

  const unitPrice = new D(input.unitPriceMinor);
  if (unitPrice.isNegative()) {
    throw new Error('Unit price cannot be negative');
  }

  const discount = new D(input.discountMinor ?? 0);
  if (discount.isNegative()) {
    throw new Error('Discount cannot be negative');
  }

  const gross = qty.times(unitPrice);
  if (discount.greaterThan(gross)) {
    throw new Error('Discount cannot exceed gross line amount');
  }

  const net = gross.minus(discount);

  // Rate in basis points: 1750 bp = 17.5% -> net * 1750 / 10000
  const bp = new D(input.taxRateBasisPoints);
  const tax = net.times(bp).dividedBy(10000).toDecimalPlaces(0, D.ROUND_HALF_UP);
  const lineTotal = net.plus(tax);

  return {
    quantity: qty.toFixed(3),
    unitPriceMinor: unitPrice.toNumber(),
    discountMinor: discount.toNumber(),
    netMinor: net.toNumber(),
    taxRateBasisPoints: input.taxRateBasisPoints,
    taxMinor: tax.toNumber(),
    lineTotalMinor: lineTotal.toNumber(),
  };
}

/**
 * Calculates totals for a document by computing each line and summing.
 */
export function calculateDocumentTotals(lines: SalesLineInput[]): CalculatedDocumentTotals {
  let subtotal = new D(0);
  let totalDiscount = new D(0);
  let totalNet = new D(0);
  let totalTax = new D(0);
  let grandTotal = new D(0);

  const calculatedLines: CalculatedSalesLine[] = [];

  for (const line of lines) {
    const calc = calculateSalesLine(line);
    calculatedLines.push(calc);

    const gross = new D(calc.quantity).times(calc.unitPriceMinor);
    subtotal = subtotal.plus(gross);
    totalDiscount = totalDiscount.plus(calc.discountMinor);
    totalNet = totalNet.plus(calc.netMinor);
    totalTax = totalTax.plus(calc.taxMinor);
    grandTotal = grandTotal.plus(calc.lineTotalMinor);
  }

  return {
    subtotalMinor: subtotal.toDecimalPlaces(0, D.ROUND_HALF_UP).toNumber(),
    discountMinor: totalDiscount.toNumber(),
    netMinor: totalNet.toNumber(),
    taxMinor: totalTax.toNumber(),
    totalMinor: grandTotal.toNumber(),
    lines: calculatedLines,
  };
}

/**
 * Validates whether a line credit request exceeds the invoice line's remaining creditable amount.
 */
export function validateLineCredit(
  lineTotalMinor: number,
  alreadyCreditedMinor: number,
  requestCreditMinor: number,
): { valid: boolean; remainingMinor: number } {
  const remaining = Math.max(0, lineTotalMinor - alreadyCreditedMinor);
  return {
    valid: requestCreditMinor <= remaining,
    remainingMinor: remaining,
  };
}

/**
 * Validates whether returned physical quantity exceeds deliverable minus already returned.
 */
export function validateReturnQuantity(
  deliveredQty: number | string,
  alreadyReturnedQty: number | string,
  returnQty: number | string,
): { valid: boolean; maxReturnableQty: string } {
  const delivered = new D(deliveredQty);
  const alreadyReturned = new D(alreadyReturnedQty);
  const requested = new D(returnQty);

  const maxReturnable = D.max(0, delivered.minus(alreadyReturned));
  return {
    valid: requested.lessThanOrEqualTo(maxReturnable),
    maxReturnableQty: maxReturnable.toFixed(3),
  };
}
