/**
 * High-precision mathematical functions for Stock Management & Landed Cost Allocation.
 *
 * Implements strict business rules:
 *   1. No JavaScript floats for financial or quantity calculations — uses Decimal from decimal.js.
 *   2. Company-wide weighted average cost calculation (round half-up).
 *   3. Largest Remainder Method (Hare-Niemeyer) for landed cost allocation.
 *   4. Multi-currency conversion to MWK tambala (1/100 MWK).
 */

import Decimal from 'decimal.js';

// Configure Decimal for exact standard commercial rounding (ROUND_HALF_UP)
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

/**
 * Standard round half-up to integer.
 */
export function roundHalfUp(n: Decimal | number | string): number {
  return new Decimal(n).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Parse quantity string or number into Decimal with max 3 decimal places.
 */
export function toDecimalQty(qty: string | number | Decimal): Decimal {
  return new Decimal(qty).toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
}

/**
 * Compute new company-wide weighted average cost after receiving goods.
 *
 * Formula:
 *   new_avg = roundHalfUp((current_total_value + received_value) / (current_total_qty + received_qty))
 *
 * Invariants:
 *   - If totalCurrentOnHandQty <= 0, new average cost = receivedLandedUnitCostMinor.
 *   - If receivedQty <= 0, return currentAvgMinor unchanged.
 *   - All monetary outputs are integer tambala (MWK minor).
 */
export function calcNewCompanyAverageCost(
  totalCurrentOnHandQty: string | number | Decimal,
  currentAvgMinor: number | bigint,
  receivedQty: string | number | Decimal,
  receivedLandedUnitCostMinor: number | bigint,
): number {
  const rQty = toDecimalQty(receivedQty);
  if (rQty.lte(0)) return Number(currentAvgMinor);

  const cQty = toDecimalQty(totalCurrentOnHandQty);
  const rUnitCost = new Decimal(receivedLandedUnitCostMinor.toString());
  const cUnitCost = new Decimal(currentAvgMinor.toString());

  // If company-wide stock was 0 or negative (rare edge-case), average cost becomes the new landed cost
  if (cQty.lte(0)) {
    return roundHalfUp(rUnitCost);
  }

  const currentValue = cQty.times(cUnitCost);
  const receivedValue = rQty.times(rUnitCost);
  const totalQty = cQty.plus(rQty);

  const newAvg = currentValue.plus(receivedValue).dividedBy(totalQty);
  return roundHalfUp(newAvg);
}

/**
 * Distribute landed costs across receipt lines using the Largest Remainder Method (Hare-Niemeyer).
 *
 * Invariant:
 *   The sum of allocated shares across all lines MUST EQUAL totalLandedMwkMinor exactly,
 *   with no rounding distortion or off-by-one errors.
 *
 * @param lineValuesMwkMinor  Line values in MWK tambala (before landed cost)
 * @param totalLandedMwkMinor Total landed cost in MWK tambala to distribute
 * @returns                   Array of landed cost shares in tambala (same order and length)
 */
export function allocateLandedCostsLargestRemainder(
  lineValuesMwkMinor: number[],
  totalLandedMwkMinor: number,
): number[] {
  const n = lineValuesMwkMinor.length;
  if (n === 0 || totalLandedMwkMinor <= 0) {
    return lineValuesMwkMinor.map(() => 0);
  }

  const totalValue = lineValuesMwkMinor.reduce((acc, v) => acc.plus(new Decimal(v)), new Decimal(0));
  const totalLanded = new Decimal(totalLandedMwkMinor);

  // If all lines have 0 value, distribute equally with remainder distributed to the first lines
  if (totalValue.lte(0)) {
    const baseShare = totalLanded.dividedToIntegerBy(n).toNumber();
    const remainder = totalLanded.mod(n).toNumber();
    return lineValuesMwkMinor.map((_, i) => baseShare + (i < remainder ? 1 : 0));
  }

  // Step 1: Compute quotas, integer floors, and decimal remainders
  const floors: number[] = [];
  const remainders: { index: number; remainder: Decimal }[] = [];
  let sumFloors = 0;

  for (let i = 0; i < n; i++) {
    const lineVal = new Decimal(lineValuesMwkMinor[i]!);
    // Quota = (lineVal / totalValue) * totalLanded
    const quota = lineVal.times(totalLanded).dividedBy(totalValue);
    const floor = quota.floor();
    const floorNum = floor.toNumber();
    const remainder = quota.minus(floor);

    floors.push(floorNum);
    sumFloors += floorNum;
    remainders.push({ index: i, remainder });
  }

  // Step 2: Determine unallocated remainder
  let unallocated = totalLandedMwkMinor - sumFloors;

  // Step 3: Sort lines by largest remainder descending (tie-breaker: line index ascending)
  remainders.sort((a, b) => {
    const diff = b.remainder.minus(a.remainder);
    if (!diff.isZero()) return diff.isPositive() ? 1 : -1;
    return a.index - b.index;
  });

  // Step 4: Add +1 to the top 'unallocated' lines
  const result = [...floors];
  for (let i = 0; i < unallocated && i < remainders.length; i++) {
    const idx = remainders[i]!.index;
    result[idx] = (result[idx] ?? 0) + 1;
  }

  return result;
}

/**
 * Convert a supplier currency amount into MWK tambala (integer minor units).
 *
 * e.g. amount = 100.50 USD, exchangeRate = 1750.25 MWK/USD
 *      → 100.50 * 1750.25 * 100 = 17590012.5 tambala → rounds to 17590013
 */
export function convertSupplierToMwkMinor(
  amountSupplier: string | number | Decimal,
  exchangeRate: string | number | Decimal,
): number {
  const amt = new Decimal(amountSupplier);
  const rate = new Decimal(exchangeRate);
  const mwkTambala = amt.times(rate).times(100);
  return roundHalfUp(mwkTambala);
}
