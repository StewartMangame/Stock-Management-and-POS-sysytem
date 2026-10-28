/**
 * Money library — all monetary arithmetic for Ace Holdings POS.
 *
 * Rules (from spec §6.6):
 *   - All money is stored as integers in the smallest unit: tambala (1/100 MWK).
 *   - Columns end in _minor.
 *   - Never use floats for money.
 *   - Rates are stored as basis points (17.5% = 1750).
 *   - Tax is calculated per line and rounded HALF-UP to the nearest tambala, then summed.
 *   - Quantities use NUMERIC(14,3) — represented as number in JS.
 */

// ── Rounding ──────────────────────────────────────────────────────────────────

/**
 * Round half-up (standard commercial rounding).
 * JavaScript's Math.round uses "round half to even" (banker's rounding) for .5,
 * so we implement our own.
 */
export function roundHalfUp(n: number): number {
  return Math.floor(n + 0.5);
}

// ── Formatting ────────────────────────────────────────────────────────────────

/**
 * Format a minor-unit amount (tambala) as a MWK string.
 * e.g. 150000 → "MWK 1,500.00"
 */
export function formatMwk(minor: bigint | number, { symbol = true } = {}): string {
  const n = typeof minor === 'bigint' ? Number(minor) : minor;
  const kwacha = n / 100;
  const formatted = new Intl.NumberFormat('en-MW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(kwacha);
  return symbol ? `MWK ${formatted}` : formatted;
}

/**
 * Alias for formatMwk — formats a tambala (minor-unit) amount as MWK string.
 * e.g. 150000 → "MWK 1,500.00"
 */
export const formatTambala = formatMwk;

/**
 * Parse a user-entered kwacha amount (e.g. "1,500.00") into minor units (tambala).
 * Strips commas and multiplies by 100, rounding half-up.
 */
export function parseKwachaToMinor(input: string): number {
  const cleaned = input.replace(/,/g, '').trim();
  const float = parseFloat(cleaned);
  if (isNaN(float)) throw new Error(`Invalid amount: "${input}"`);
  return roundHalfUp(float * 100);
}

// ── Tax calculation ───────────────────────────────────────────────────────────

/**
 * Calculate VAT on a line given the price-exclusive-of-tax unit price.
 *
 * @param unitPriceMinor  Price ex-VAT per unit, in tambala
 * @param quantity        Quantity (up to 3 decimal places)
 * @param rateBasisPoints VAT rate in basis points (17.5% = 1750)
 * @returns               { lineTotal, taxAmount, lineTotalIncTax }  — all in tambala
 */
export function calcLineTax(
  unitPriceMinor: number,
  quantity: number,
  rateBasisPoints: number,
): { lineTotal: number; taxAmount: number; lineTotalIncTax: number } {
  const lineTotal = roundHalfUp(unitPriceMinor * quantity);
  const taxAmount = roundHalfUp((lineTotal * rateBasisPoints) / 10_000);
  return {
    lineTotal,
    taxAmount,
    lineTotalIncTax: lineTotal + taxAmount,
  };
}

/**
 * Calculate tax when the price INCLUDES tax.
 * Used only when prices_include_tax setting is true.
 *
 * Extract tax from an inclusive price:
 *   tax = total_inc - total_exc
 *   total_exc = total_inc / (1 + rate)
 */
export function extractTaxFromInclusive(
  totalIncMinor: number,
  rateBasisPoints: number,
): { taxAmount: number; totalExcMinor: number } {
  const rate = rateBasisPoints / 10_000;
  const totalExcMinor = roundHalfUp(totalIncMinor / (1 + rate));
  const taxAmount = totalIncMinor - totalExcMinor;
  return { taxAmount, totalExcMinor };
}

// ── Average cost ──────────────────────────────────────────────────────────────

/**
 * Compute new weighted average cost after receiving goods.
 *
 * Formula (spec §6.3):
 *   new_avg = (current_on_hand_value + received_value) / (current_on_hand_qty + received_qty)
 *
 * Returns tambala per unit, rounded half-up.
 * Returns currentAvgMinor unchanged if received_qty is 0.
 */
export function calcNewAverageCost(
  currentOnHand: number,
  currentAvgMinor: number,
  receivedQty: number,
  receivedUnitCostMinor: number,
): number {
  if (receivedQty <= 0) return currentAvgMinor;
  const totalQty = currentOnHand + receivedQty;
  if (totalQty <= 0) return receivedUnitCostMinor;

  const currentValue = currentOnHand * currentAvgMinor;
  const receivedValue = receivedQty * receivedUnitCostMinor;
  return roundHalfUp((currentValue + receivedValue) / totalQty);
}

// ── Landed cost allocation ────────────────────────────────────────────────────

/**
 * Distribute landed costs (freight, duty, clearing) across receipt lines by line value.
 *
 * @param lineValues   Array of line values in MWK minor units (before landed costs)
 * @param totalLanded  Total landed cost to distribute (MWK minor)
 * @returns            Array of per-line landed cost additions (same length as lineValues)
 *
 * The last line absorbs any rounding remainder to keep the sum exact.
 */
export function allocateLandedCosts(lineValues: number[], totalLanded: number): number[] {
  if (lineValues.length === 0 || totalLanded === 0) return lineValues.map(() => 0);

  const grandTotal = lineValues.reduce((a, b) => a + b, 0);
  if (grandTotal === 0) {
    // Equal distribution when all lines have zero value
    const perLine = Math.floor(totalLanded / lineValues.length);
    const result = lineValues.map(() => perLine);
    if (result[result.length - 1] !== undefined) {
      result[result.length - 1]! += totalLanded - perLine * lineValues.length;
    }
    return result;
  }

  let allocated = 0;
  const result = lineValues.map((v, i) => {
    if (i === lineValues.length - 1) {
      // Last line: absorb remainder
      return totalLanded - allocated;
    }
    const share = roundHalfUp((v / grandTotal) * totalLanded);
    allocated += share;
    return share;
  });

  return result;
}

// ── Document numbering ────────────────────────────────────────────────────────

/**
 * Format a document number from prefix, sequence number and padding.
 * e.g. ('MAIN-INV', 42, 4) → 'MAIN-INV-0042'
 */
export function formatDocNumber(prefix: string, number: number, padding: number): string {
  return `${prefix}-${String(number).padStart(padding, '0')}`;
}
