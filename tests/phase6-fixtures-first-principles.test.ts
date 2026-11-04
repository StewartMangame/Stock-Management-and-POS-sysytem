/**
 * First-Principles Hand-Computable Fixture Tests (Phase 6, Item A.3).
 *
 * Three carefully controlled fixtures:
 *   Fixture 1: Standard invoice — 2 lines @ 17.5% VAT, quantity-based profit
 *   Fixture 2: Zero-rated invoice — 1 line @ 0% VAT
 *   Fixture 3: Credit note (customer return) partially reversing Fixture 1
 *
 * ALL expected values are computed BY HAND from first principles in comments.
 * Tests verify that the report services return exactly these values.
 *
 * Database: TEST_DATABASE_URL only. Tests are isolated with beforeAll/afterAll cleanup.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../src/server/db';
import { sql } from 'drizzle-orm';
import { getSalesByItem } from '../src/server/services/reports/sales-report';
import { getVatSummary } from '../src/server/services/reports/vat-report';
import { getStockOnHand } from '../src/server/services/reports/stock-report';
import {
  stripCostColumns,
  type ReportColumnDef,
  type ReportUser,
} from '../src/lib/report-framework';

// ── Fixture constants (all amounts in tambala = 1/100 MWK) ───────────────────

// PRODUCT A: "Widget Pro" — cost MWK 1,000.00 = 100,000 tambala
const PROD_A_COST = 100_000;
// PRODUCT B: "Cable Pack" — cost MWK  500.00 =  50,000 tambala
const PROD_B_COST =  50_000;

// VAT rate: 17.5% = 1750 basis points
// Zero rate: 0%   = 0 basis points

// ── FIXTURE 1: Standard Invoice ───────────────────────────────────────────────
// Line 1: 3 × Widget Pro @ MWK 1,500 net = MWK 4,500 net
//         VAT 17.5% = 787.50 MWK → 78,750 tambala
//         Gross = 4,500 + 787.50 = 5,287.50 MWK
// Line 2: 2 × Cable Pack @ MWK  800 net = MWK 1,600 net
//         VAT 17.5% = 280.00 MWK → 28,000 tambala
//         Gross = 1,600 + 280 = 1,880.00 MWK
//
// Invoice totals:
//   Net (subtotal)  = 4,500 + 1,600 = 6,100 MWK → 610,000 tambala
//   VAT             = 787.50 + 280  = 1,067.50 MWK → 106,750 tambala
//   Total           = 7,167.50 MWK → 716,750 tambala
//
// Profit (cost):
//   Line 1 cost = 3 × 1,000 = 3,000 MWK → 300,000 tambala
//   Line 2 cost = 2 × 500   = 1,000 MWK → 100,000 tambala
//   Total cost  = 4,000 MWK → 400,000 tambala
//   Gross profit = 6,100 − 4,000 = 2,100 MWK → 210,000 tambala
//   Margin % = 2,100 / 6,100 = 34.43%

const F1_NET_MINOR     = 610_000;   // 6,100.00 MWK
const F1_VAT_MINOR     = 106_750;   // 1,067.50 MWK (78,750 + 28,000)
const F1_TOTAL_MINOR   = 716_750;
const F1_COST_MINOR    = 400_000;   // 4,000.00 MWK
const F1_PROFIT_MINOR  = 210_000;   // 2,100.00 MWK

// ── FIXTURE 2: Zero-Rated Invoice ────────────────────────────────────────────
// Line 1: 5 × Widget Pro @ MWK 2,000 net = MWK 10,000 net
//         VAT 0% = 0
//         Total = 10,000 MWK → 1,000,000 tambala
//
// Profit:
//   Cost = 5 × 1,000 = 5,000 MWK → 500,000 tambala
//   Gross profit = 10,000 − 5,000 = 5,000 MWK → 500,000 tambala
//   Margin % = 50.00%

const F2_NET_MINOR     = 1_000_000; // 10,000.00 MWK
const F2_VAT_MINOR     = 0;
const F2_TOTAL_MINOR   = 1_000_000;
const F2_COST_MINOR    = 500_000;   // 5,000.00 MWK
const F2_PROFIT_MINOR  = 500_000;   // 5,000.00 MWK

// ── FIXTURE 3: Credit Note (partial return of Fixture 1) ─────────────────────
// Credits back: 1 × Widget Pro @ MWK 1,500 net
//   Net credit  = 1,500 MWK → 150,000 tambala
//   VAT 17.5%   = 262.50 MWK → 26,250 tambala
//   Total credit = 1,762.50 MWK → 176,250 tambala
//
// Cost reversed = 1 × 1,000 = 1,000 MWK → 100,000 tambala

const F3_NET_MINOR    = 150_000;    // 1,500.00 MWK credit
const F3_VAT_MINOR    =  26_250;    // 262.50 MWK credit
const F3_COST_MINOR   = 100_000;    // 1,000.00 MWK reversed cost

// ── COMBINED expected net figures ────────────────────────────────────────────
// Net sales = F1 + F2 − F3 = 610,000 + 1,000,000 − 150,000 = 1,460,000 tambala
// Net VAT   = F1_VAT + F2_VAT − F3_VAT = 106,750 + 0 − 26,250 = 80,500 tambala
// Net cost  = (F1_COST + F2_COST) − F3_COST = 400,000 + 500,000 − 100,000 = 800,000 tambala
// Net profit = net_sales − net_cost = 1,460,000 − 800,000 = 660,000 tambala

const COMBINED_NET_MINOR     = 1_460_000;
const COMBINED_VAT_MINOR     =    80_500;
const COMBINED_COST_MINOR    =   800_000;
const COMBINED_PROFIT_MINOR  =   660_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

type FPRow = { id: string };

let locationId: string;
let customerId: string;
let taxRate17Id: string;
let taxRate0Id: string;
let productAId: string;
let productBId: string;

const TEST_DATE = '2026-10-01';
const TEST_DATE_END = '2026-10-01';

/** Create all fixture data inside a serialised setup */
beforeAll(async () => {
  // Fetch existing unit of measure
  const uomRes = await db.execute<{ id: string }>(sql`
    SELECT id FROM units_of_measure LIMIT 1
  `);
  if (!uomRes.rows[0]) {
    throw new Error('No unit of measure found in database. Seed units_of_measure first.');
  }
  const uomId = uomRes.rows[0].id;

  // Create location with type = 'outlet'
  const locCode = 'FP-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const locRes = await db.execute<FPRow>(sql`
    INSERT INTO locations (name, code, type, address, is_active)
    VALUES ('FP Test Branch', ${locCode}, 'outlet', 'Test Address', TRUE)
    RETURNING id
  `);
  locationId = locRes.rows[0]!.id;

  // Create customer (business, not walk-in)
  const custRes = await db.execute<FPRow>(sql`
    INSERT INTO customers (account_number, name, customer_type, is_walk_in, credit_limit_minor, payment_terms_days, is_active)
    VALUES ('FP-CUST-' || gen_random_uuid()::text, 'FP Test Customer Ltd', 'business', FALSE, 100000000, 30, TRUE)
    RETURNING id
  `);
  customerId = custRes.rows[0]!.id;

  // Create tax rates
  const tr17Res = await db.execute<FPRow>(sql`
    INSERT INTO tax_rates (name, rate_basis_points, is_active)
    VALUES ('FP Standard VAT 17.5', 1750, TRUE)
    RETURNING id
  `);
  taxRate17Id = tr17Res.rows[0]!.id;

  const tr0Res = await db.execute<FPRow>(sql`
    INSERT INTO tax_rates (name, rate_basis_points, is_active)
    VALUES ('FP Zero Rated', 0, TRUE)
    RETURNING id
  `);
  taxRate0Id = tr0Res.rows[0]!.id;

  // Create products with uomId
  const pARes = await db.execute<FPRow>(sql`
    INSERT INTO products (sku, name, uom_id, product_type, avg_cost_minor, is_active)
    VALUES ('FP-WIDGET-PRO-' || gen_random_uuid()::text, 'FP Widget Pro', ${uomId}::uuid, 'standard', ${PROD_A_COST}, TRUE)
    RETURNING id
  `);
  productAId = pARes.rows[0]!.id;

  const pBRes = await db.execute<FPRow>(sql`
    INSERT INTO products (sku, name, uom_id, product_type, avg_cost_minor, is_active)
    VALUES ('FP-CABLE-PACK-' || gen_random_uuid()::text, 'FP Cable Pack', ${uomId}::uuid, 'standard', ${PROD_B_COST}, TRUE)
    RETURNING id
  `);
  productBId = pBRes.rows[0]!.id;

  // Seed stock balances (enough for all fixtures)
  await db.execute(sql`
    INSERT INTO stock_balances (product_id, location_id, on_hand, reserved)
    VALUES
      (${productAId}::uuid, ${locationId}::uuid, 100, 0),
      (${productBId}::uuid, ${locationId}::uuid, 100, 0)
    ON CONFLICT (product_id, location_id) DO UPDATE
      SET on_hand = EXCLUDED.on_hand
  `);
});

afterAll(async () => {
  try {
    if (customerId) {
      // Revert status to 'draft' so immutability trigger allows line deletion
      await db.execute(sql`
        UPDATE sales_documents SET status = 'draft' WHERE customer_id = ${customerId}::uuid
      `);
      await db.execute(sql`
        DELETE FROM sales_document_lines WHERE document_id IN (
          SELECT id FROM sales_documents WHERE customer_id = ${customerId}::uuid
        )
      `);
      await db.execute(sql`DELETE FROM sales_documents WHERE customer_id = ${customerId}::uuid`);
      await db.execute(sql`DELETE FROM customers WHERE id = ${customerId}::uuid`);
    }
    if (productAId && productBId) {
      await db.execute(sql`DELETE FROM stock_balances WHERE product_id IN (${productAId}::uuid, ${productBId}::uuid)`);
      await db.execute(sql`DELETE FROM products WHERE id IN (${productAId}::uuid, ${productBId}::uuid)`);
    }
    if (taxRate17Id && taxRate0Id) {
      await db.execute(sql`DELETE FROM tax_rates WHERE id IN (${taxRate17Id}::uuid, ${taxRate0Id}::uuid)`);
    }
    if (locationId) {
      await db.execute(sql`DELETE FROM locations WHERE id = ${locationId}::uuid`);
    }
  } catch (e) {
    console.warn('Fixture cleanup note:', e);
  }
});

// ── Helper to insert a sales document with lines ──────────────────────────────

async function insertSalesDoc(opts: {
  docType: 'invoice' | 'credit_note';
  sourceDocId?: string;
  netMinor: number;
  taxMinor: number;
  lines: Array<{
    productId: string;
    sku: string;
    qty: number;
    unitNetMinor: number;
    taxRateId: string;
    taxRateBasisPoints: number;
    lineNetMinor: number;
    lineTaxMinor: number;
    unitCostMinor: number;
  }>;
}): Promise<string> {
  const totalMinor = opts.netMinor + opts.taxMinor;
  const docNumber = 'FP-' + (opts.docType === 'invoice' ? 'INV-' : 'CN-') + Math.random().toString(36).slice(2, 8).toUpperCase();

  const docRes = await db.execute<FPRow>(sql`
    INSERT INTO sales_documents (
      document_type, document_number, customer_id, location_id, status,
      issue_date, due_date,
      subtotal_minor, tax_minor, total_minor, balance_minor,
      channel
      ${opts.sourceDocId ? sql`, source_document_id` : sql``}
    )
    VALUES (
      ${opts.docType}, ${docNumber}, ${customerId}::uuid, ${locationId}::uuid, 'draft',
      ${TEST_DATE}::date, ${TEST_DATE}::date,
      ${opts.netMinor}, ${opts.taxMinor}, ${totalMinor}, ${totalMinor},
      'office'
      ${opts.sourceDocId ? sql`, ${opts.sourceDocId}::uuid` : sql``}
    )
    RETURNING id
  `);
  const docId = docRes.rows[0]!.id;

  for (let i = 0; i < opts.lines.length; i++) {
    const ln = opts.lines[i]!;
    const lineTotal = ln.lineNetMinor + ln.lineTaxMinor;
    await db.execute(sql`
      INSERT INTO sales_document_lines (
        document_id, product_id, sku,
        quantity, unit_price_minor,
        tax_rate_id, tax_rate_basis_points, tax_minor,
        line_total_minor, unit_cost_minor
      )
      VALUES (
        ${docId}::uuid, ${ln.productId}::uuid, ${ln.sku},
        ${ln.qty}, ${ln.unitNetMinor},
        ${ln.taxRateId}::uuid, ${ln.taxRateBasisPoints}, ${ln.lineTaxMinor},
        ${lineTotal}, ${ln.unitCostMinor}
      )
    `);
  }

  // Once lines are added, transition document to 'issued'
  await db.execute(sql`
    UPDATE sales_documents SET status = 'issued' WHERE id = ${docId}::uuid
  `);

  return docId;
}

// ── TESTS ─────────────────────────────────────────────────────────────────────

describe('First-principles fixture: VAT by rate', () => {
  let invoiceF1Id: string;
  let invoiceF2Id: string;
  let creditNoteF3Id: string;

  beforeAll(async () => {
    // Insert Fixture 1: Standard invoice (17.5% VAT)
    // Line 1: 3 × MWK 1,500 net = 450,000 tambala net; VAT = 78,750 tambala
    // Line 2: 2 × MWK 800 net = 160,000 tambala net; VAT = 28,000 tambala
    invoiceF1Id = await insertSalesDoc({
      docType: 'invoice',
      netMinor: F1_NET_MINOR,
      taxMinor: F1_VAT_MINOR,
      lines: [
        {
          productId: productAId,
          sku: 'FP-WIDGET-PRO',
          qty: 3,
          unitNetMinor: 150_000, // MWK 1,500
          taxRateId: taxRate17Id,
          taxRateBasisPoints: 1750,
          lineNetMinor: 450_000, // 3 × 150,000
          lineTaxMinor:  78_750, // 450,000 × 17.5% = 78,750
          unitCostMinor: PROD_A_COST,
        },
        {
          productId: productBId,
          sku: 'FP-CABLE-PACK',
          qty: 2,
          unitNetMinor: 80_000,  // MWK 800
          taxRateId: taxRate17Id,
          taxRateBasisPoints: 1750,
          lineNetMinor: 160_000, // 2 × 80,000
          lineTaxMinor:  28_000, // 160,000 × 17.5% = 28,000
          unitCostMinor: PROD_B_COST,
        },
      ],
    });

    // Insert Fixture 2: Zero-rated invoice
    // 5 × MWK 2,000 net = 1,000,000 tambala net; VAT = 0
    invoiceF2Id = await insertSalesDoc({
      docType: 'invoice',
      netMinor: F2_NET_MINOR,
      taxMinor: F2_VAT_MINOR,
      lines: [
        {
          productId: productAId,
          sku: 'FP-WIDGET-PRO',
          qty: 5,
          unitNetMinor: 200_000,  // MWK 2,000
          taxRateId: taxRate0Id,
          taxRateBasisPoints: 0,
          lineNetMinor: 1_000_000, // 5 × 200,000
          lineTaxMinor: 0,
          unitCostMinor: PROD_A_COST,
        },
      ],
    });

    // Insert Fixture 3: Credit note (partial return of F1)
    // 1 × Widget Pro @ MWK 1,500 net = 150,000 tambala net; VAT 17.5% = 26,250 tambala
    creditNoteF3Id = await insertSalesDoc({
      docType: 'credit_note',
      sourceDocId: invoiceF1Id,
      netMinor: F3_NET_MINOR,
      taxMinor: F3_VAT_MINOR,
      lines: [
        {
          productId: productAId,
          sku: 'FP-WIDGET-PRO',
          qty: 1,
          unitNetMinor: 150_000, // MWK 1,500
          taxRateId: taxRate17Id,
          taxRateBasisPoints: 1750,
          lineNetMinor: 150_000,
          lineTaxMinor:  26_250, // 150,000 × 17.5% = 26,250
          unitCostMinor: PROD_A_COST,
        },
      ],
    });
  });

  it('VAT report: 17.5% rate rows show correct invoice net and credit net', async () => {
    const result = await getVatSummary(TEST_DATE, TEST_DATE_END, locationId);

    const row17 = result.rows.find((r: any) => r.ratePercent === 17.5 || Math.abs(r.ratePercent - 17.5) < 0.01);
    expect(row17).toBeDefined();

    // F1 invoice net at 17.5%:
    // Line 1: 450,000 tambala, Line 2: 160,000 → total invoice net at 17.5% = 610,000
    // F3 credit note at 17.5%: 150,000
    expect(row17!.taxableSalesMinor).toBe(610_000);
    expect(row17!.taxableCreditMinor).toBe(150_000);

    // Net VAT at 17.5% = (78,750 + 28,000) − 26,250 = 80,500
    const netVat17 = row17!.outputVatMinor - row17!.creditVatMinor;
    expect(netVat17).toBe(80_500);
  });

  it('VAT report: 0% rate row shows zero-rated invoice correctly', async () => {
    const result = await getVatSummary(TEST_DATE, TEST_DATE_END, locationId);

    const row0 = result.rows.find((r: any) => r.ratePercent === 0);
    expect(row0).toBeDefined();
    // Net = 1,000,000 tambala, VAT = 0
    expect(row0!.taxableSalesMinor).toBe(F2_NET_MINOR);
    expect(row0!.outputVatMinor).toBe(0);
    expect(row0!.netVatMinor).toBe(0);
  });

  it('VAT report totals: combined net VAT = 80,500 tambala (MWK 805.00)', async () => {
    const result = await getVatSummary(TEST_DATE, TEST_DATE_END, locationId);
    expect(result.totals.netOutputVatMinor).toBe(COMBINED_VAT_MINOR);
  });

  it('Sales report: net revenue equals F1 + F2 − F3 = 1,460,000 tambala', async () => {
    const result = await getSalesByItem({
      from: TEST_DATE,
      to: TEST_DATE_END,
      locationId,
      groupBy: 'item',
    });

    // Net revenue = 610,000 + 1,000,000 − 150,000 = 1,460,000 tambala
    expect(result.totals.netRevenueMinor).toBe(COMBINED_NET_MINOR);
  });

  it('Stock report: fixture products have correct avg cost (tambala vs kwacha)', async () => {
    const result = await getStockOnHand(locationId);

    // Widget Pro: avg_cost_minor = 100,000 tambala = MWK 1,000.00
    const widgetRow = result.rows.find((r: any) =>
      r.productId === productAId
    );
    expect(widgetRow).toBeDefined();
    expect(widgetRow!.avgCostMinor).toBe(PROD_A_COST); // 100,000 tambala

    // Cable Pack: avg_cost_minor = 50,000 tambala = MWK 500.00
    const cableRow = result.rows.find((r: any) =>
      r.productId === productBId
    );
    expect(cableRow).toBeDefined();
    expect(cableRow!.avgCostMinor).toBe(PROD_B_COST); // 50,000 tambala
  });

  it('Combined arithmetic check: net = 1,460,000, vat = 80,500, profit = 660,000 tambala', async () => {
    // This test validates the hand calculation is internally consistent
    // Net sales:   F1(610k) + F2(1,000k) - F3(150k) = 1,460,000 ✓
    // Net VAT:     F1(106,750) + F2(0) - F3(26,250) = 80,500 ✓
    // Net cost:    (F1_COST(400k) + F2_COST(500k)) - F3_COST(100k) = 800,000 ✓
    // Net profit:  1,460,000 - 800,000 = 660,000 ✓
    // Margin:      660,000 / 1,460,000 = 45.21%

    expect(F1_NET_MINOR + F2_NET_MINOR - F3_NET_MINOR).toBe(COMBINED_NET_MINOR);
    expect(F1_VAT_MINOR + F2_VAT_MINOR - F3_VAT_MINOR).toBe(COMBINED_VAT_MINOR);
    expect(F1_COST_MINOR + F2_COST_MINOR - F3_COST_MINOR).toBe(COMBINED_COST_MINOR);
    expect(COMBINED_NET_MINOR - COMBINED_COST_MINOR).toBe(COMBINED_PROFIT_MINOR);

    // Margin %
    const marginPct = (COMBINED_PROFIT_MINOR / COMBINED_NET_MINOR) * 100;
    expect(marginPct).toBeCloseTo(45.21, 1);
  });
});

describe('First-principles fixture: cost column access control', () => {
  const salesReportColumns: ReportColumnDef<any>[] = [
    { key: 'productId', header: 'Product ID', render: (r: any) => r.productId },
    { key: 'productName', header: 'Product Name', render: (r: any) => r.productName },
    { key: 'quantitySold', header: 'Qty', render: (r: any) => r.quantitySold },
    { key: 'revenueMinor', header: 'Revenue', render: (r: any) => r.revenueMinor },
    { key: 'costMinor', header: 'Cost', costColumn: true, render: (r: any) => r.costMinor },
    { key: 'marginMinor', header: 'Margin', costColumn: true, render: (r: any) => r.marginMinor },
    { key: 'marginPct', header: 'Margin %', costColumn: true, render: (r: any) => r.marginPct },
  ];

  it('cost columns stripped for sales role', async () => {
    const salesUser: ReportUser = {
      id: 'test-sales',
      name: 'Sales User',
      permissions: ['reports:view'], // No reports:cost
    };
    const result = await getSalesByItem({
      from: TEST_DATE,
      to: TEST_DATE_END,
      locationId,
      groupBy: 'item',
    });
    const stripped = stripCostColumns(result.rows as any, salesReportColumns, salesUser);
    // costMinor, marginMinor, marginPct must be absent in every row
    for (const row of stripped) {
      expect(row).not.toHaveProperty('costMinor');
      expect(row).not.toHaveProperty('marginMinor');
      expect(row).not.toHaveProperty('marginPct');
    }
  });

  it('cost columns present for manager role', async () => {
    const mgr: ReportUser = {
      id: 'test-mgr',
      name: 'Manager',
      permissions: ['reports:view', 'reports:cost'],
    };
    const result = await getSalesByItem({
      from: TEST_DATE,
      to: TEST_DATE_END,
      locationId,
      groupBy: 'item',
    });
    const withCost = stripCostColumns(result.rows as any, salesReportColumns, mgr);
    for (const row of withCost) {
      expect(row).toHaveProperty('costMinor');
    }
  });
});

describe('First-principles fixture: Blantyre timezone boundary', () => {
  it('a sale at 00:30 Blantyre (UTC+2) on 2026-10-02 appears on Oct 2, not Oct 1', async () => {
    // 00:30 Blantyre = 22:30 UTC previous day = issue_date in DB is Oct 2 (stored as date)
    // The report uses issue_date column (DATE type), which is set by the app to Blantyre local date.
    // This test verifies that if we filter by from=2026-10-02 we see the sale,
    // and if we filter by to=2026-10-01 we do NOT see it.

    const docNumber = 'FP-TZ-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const earlyMorningRes = await db.execute<FPRow>(sql`
      INSERT INTO sales_documents (
        document_type, document_number, customer_id, location_id, status,
        issue_date, due_date,
        subtotal_minor, tax_minor, total_minor, balance_minor, channel
      )
      VALUES (
        'invoice', ${docNumber}, ${customerId}::uuid, ${locationId}::uuid, 'draft',
        '2026-10-02'::date, '2026-10-02'::date,
        50000, 0, 50000, 50000, 'office'
      )
      RETURNING id
    `);
    const earlyMorningDocId = earlyMorningRes.rows[0]!.id;

    await db.execute(sql`
      INSERT INTO sales_document_lines (
        document_id, product_id, sku,
        quantity, unit_price_minor,
        tax_rate_id, tax_rate_basis_points, tax_minor,
        line_total_minor, unit_cost_minor
      )
      VALUES (
        ${earlyMorningDocId}::uuid, ${productAId}::uuid, 'FP-WIDGET-PRO',
        1, 50000,
        ${taxRate0Id}::uuid, 0, 0,
        50000, ${PROD_A_COST}
      )
    `);

    await db.execute(sql`
      UPDATE sales_documents SET status = 'issued' WHERE id = ${earlyMorningDocId}::uuid
    `);

    // Filter to Oct 1 only → should NOT include the Oct 2 sale
    const oct1Result = await getSalesByItem({ from: '2026-10-01', to: '2026-10-01', locationId, groupBy: 'item' });
    expect(oct1Result.totals.netRevenueMinor).toBe(COMBINED_NET_MINOR);

    // Filter to Oct 2 → should include the early-morning sale
    const oct2Result = await getSalesByItem({ from: '2026-10-02', to: '2026-10-02', locationId, groupBy: 'item' });
    expect(oct2Result.totals.netRevenueMinor).toBe(50_000);

    // Cleanup (revert to draft first so lines can be deleted)
    await db.execute(sql`UPDATE sales_documents SET status = 'draft' WHERE id = ${earlyMorningDocId}::uuid`);
    await db.execute(sql`DELETE FROM sales_document_lines WHERE document_id = ${earlyMorningDocId}::uuid`);
    await db.execute(sql`DELETE FROM sales_documents WHERE id = ${earlyMorningDocId}::uuid`);
  });
});
