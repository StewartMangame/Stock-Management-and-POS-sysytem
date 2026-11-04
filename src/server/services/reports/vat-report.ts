/**
 * VAT Summary Report Service (Phase 6).
 *
 * OUTPUT VAT ONLY — purchase/input VAT is not tracked in this system.
 *
 * Rules:
 *   - Rates read dynamically from tax_rates table AND from each sales_document_line.tax_rate.
 *   - No hard-coded tax percentages.
 *   - Invoice basis: issue_date in period, document_type IN ('invoice','credit_note').
 *   - Voids excluded: status != 'void'.
 *   - Credit notes reduce output tax.
 *   - Separate lines for each distinct rate (Standard, Zero-Rated, Exempt, etc.).
 *   - EIS status counts use exact enum: not_required, pending, processing, accepted, rejected, failed.
 *   - Counter POS walk-in sales included.
 *
 * Date boundaries: issue_date >= startOfDay(from) AND issue_date < startOfDay(to+1).
 */

import { db } from '@/server/db';
import { sql } from 'drizzle-orm';
import { startOfDayInCompanyTz } from '@/lib/timezone';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VatByRateRow {
  taxRateId: string | null;
  rateName: string;
  ratePercent: number; // from tax_rates.rate stored as numeric
  taxableSalesMinor: number;    // net_amount on invoices for this rate
  outputVatMinor: number;       // tax_amount on invoices for this rate
  taxableCreditMinor: number;   // net_amount on credit notes
  creditVatMinor: number;       // tax_amount on credit notes
  netTaxableMinor: number;      // taxableSalesMinor - taxableCreditMinor
  netVatMinor: number;          // outputVatMinor - creditVatMinor
}

export interface EisStatusCounts {
  not_required: number;
  pending: number;
  processing: number;
  accepted: number;
  rejected: number;
  failed: number;
}

export interface VatReportTotals {
  totalOutputVatMinor: number;
  totalCreditVatMinor: number;
  netOutputVatMinor: number;
  totalTaxableSalesMinor: number;
}

export interface VatReportResult {
  from: string;
  to: string;
  locationId?: string;
  generatedAt: string;
  rows: VatByRateRow[];
  totals: VatReportTotals;
  eisCounts: EisStatusCounts;
  disclaimer: string;
}

function nextDayStart(dateStr: string): Date {
  const d = new Date(dateStr + 'T00:00:00+02:00');
  d.setDate(d.getDate() + 1);
  return d;
}

export async function getVatSummary(
  from: string,
  to: string,
  locationId?: string,
): Promise<VatReportResult> {
  const fromInstant = startOfDayInCompanyTz(from);
  const toInstant = nextDayStart(to);

  const locationFilter = locationId
    ? sql`AND sd.location_id = ${locationId}::uuid`
    : sql``;

  // ── VAT by rate (reads rates from data, not hard-coded) ──────────────────────
  const vatResult = await db.execute<{
    tax_rate_id: string | null;
    rate_name: string;
    rate_percent: string;
    taxable_sales_minor: string;
    output_vat_minor: string;
    taxable_credit_minor: string;
    credit_vat_minor: string;
  }>(sql`
    SELECT
      sdl.tax_rate_id,
      COALESCE(tr.name, CONCAT((sdl.tax_rate_basis_points::numeric / 100)::text, '%')) AS rate_name,
      (sdl.tax_rate_basis_points::numeric / 100)::text AS rate_percent,
      SUM(CASE WHEN sd.document_type = 'invoice' THEN (sdl.line_total_minor - sdl.tax_minor) ELSE 0 END)::text AS taxable_sales_minor,
      SUM(CASE WHEN sd.document_type = 'invoice' THEN sdl.tax_minor ELSE 0 END)::text AS output_vat_minor,
      SUM(CASE WHEN sd.document_type = 'credit_note' THEN (sdl.line_total_minor - sdl.tax_minor) ELSE 0 END)::text AS taxable_credit_minor,
      SUM(CASE WHEN sd.document_type = 'credit_note' THEN sdl.tax_minor ELSE 0 END)::text AS credit_vat_minor
    FROM sales_documents sd
    JOIN sales_document_lines sdl ON sdl.document_id = sd.id
    LEFT JOIN tax_rates tr ON tr.id = sdl.tax_rate_id
    WHERE sd.issue_date >= ${fromInstant}
      AND sd.issue_date < ${toInstant}
      AND sd.status != 'void'
      AND sd.document_type IN ('invoice', 'credit_note')
      ${locationFilter}
    GROUP BY sdl.tax_rate_id, tr.name, sdl.tax_rate_basis_points
    ORDER BY rate_percent DESC
  `);

  const rows: VatByRateRow[] = vatResult.rows.map((r) => {
    const taxSales = Number(r.taxable_sales_minor);
    const outVat = Number(r.output_vat_minor);
    const taxCredit = Number(r.taxable_credit_minor);
    const credVat = Number(r.credit_vat_minor);
    return {
      taxRateId: r.tax_rate_id,
      rateName: r.rate_name,
      ratePercent: Number(r.rate_percent),
      taxableSalesMinor: taxSales,
      outputVatMinor: outVat,
      taxableCreditMinor: taxCredit,
      creditVatMinor: credVat,
      netTaxableMinor: taxSales - taxCredit,
      netVatMinor: outVat - credVat,
    };
  });

  // ── EIS status counts ─────────────────────────────────────────────────────────
  const eisResult = await db.execute<{
    status: string;
    count: string;
  }>(sql`
    SELECT
      es.status,
      COUNT(*)::text AS count
    FROM eis_submissions es
    JOIN sales_documents sd ON sd.id = es.document_id
    WHERE sd.issue_date >= ${fromInstant}
      AND sd.issue_date < ${toInstant}
      ${locationFilter}
    GROUP BY es.status
  `);

  const eisCounts: EisStatusCounts = {
    not_required: 0,
    pending: 0,
    processing: 0,
    accepted: 0,
    rejected: 0,
    failed: 0,
  };

  for (const row of eisResult.rows) {
    const status = row.status as keyof EisStatusCounts;
    if (status in eisCounts) {
      eisCounts[status] = Number(row.count);
    }
  }

  const totals: VatReportTotals = {
    totalOutputVatMinor: rows.reduce((s, r) => s + r.outputVatMinor, 0),
    totalCreditVatMinor: rows.reduce((s, r) => s + r.creditVatMinor, 0),
    netOutputVatMinor: rows.reduce((s, r) => s + r.netVatMinor, 0),
    totalTaxableSalesMinor: rows.reduce((s, r) => s + r.netTaxableMinor, 0),
  };

  return {
    from,
    to,
    locationId,
    generatedAt: new Date().toISOString(),
    rows,
    totals,
    eisCounts,
    disclaimer:
      'OUTPUT VAT ONLY — Ace Holdings does not track input/purchase VAT in this system. ' +
      'This report reflects output tax on issued invoices minus credit notes for the selected period.',
  };
}

