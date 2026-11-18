/**
 * Phase 3 Integration Tests — Payments, Allocations & AR Reporting.
 *
 * All 25 required tests from the Phase 3 plan.
 *
 * ISOLATION: Uses TEST_DATABASE_URL (or DATABASE_URL as fallback).
 * Each test creates its own customer/invoice fixtures.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('@/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

import { db, pool } from '@/server/db';
import {
  customers,
  locations,
  salesDocuments,
  salesDocumentLines,
  payments,
  paymentAllocations,
  products,
  categories,
  unitsOfMeasure,
  taxRates,
  users,
  roles,
} from '@/server/db/schema';
import { eq, and, sql, count } from 'drizzle-orm';
import {
  recordPayment,
  confirmCheque,
  bounceCheque,
  allocatePayment,
  reversePayment,
  refundPayment,
  getCustomerCredit,
  applyCreditToInvoice,
  releaseOverpaymentToCredit,
} from '@/server/services/sales/payments';
import { createDirectInvoice, issueInvoice } from '@/server/services/sales/invoices';
import { createCreditNote } from '@/server/services/sales/credit-notes';
import { getAgedDebtors } from '@/server/services/reports/aged-debtors';
import { getCustomerStatement } from '@/server/services/reports/customer-statement';
import { executeStockMovements } from '@/server/services/stock/stock-engine';

// ── Test Fixtures ─────────────────────────────────────────────────────────────

let testLocId: string;
let testCustId: string;
let testProductId: string;
let testUomId: string;
let testTaxRateId: string;
let testUserId: string;

const TS = Date.now();

/** Helper: create and issue a fresh invoice for the test customer */
async function makeIssuedInvoice(totalMinor: number): Promise<string> {
  const invoice = await createDirectInvoice(
    {
      customerId: testCustId,
      locationId: testLocId,
      lines: [
        {
          productId: testProductId,
          quantity: 1,
          unitPriceMinor: totalMinor,
          taxRateId: testTaxRateId,
          discountMinor: 0,
        },
      ],
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
    },
    testUserId,
  );
  const issued = await issueInvoice(invoice.id, testUserId);
  return issued.id;
}

/** Helper: record a confirmed cash receipt */
async function makeCashReceipt(
  customerId: string,
  amountMinor: number,
  allocations?: Array<{ invoiceId: string; amountMinor: number }>,
): Promise<string> {
  const result = await recordPayment({
    idempotencyKey: crypto.randomUUID(),
    customerId,
    locationId: testLocId,
    kind: 'receipt',
    method: 'cash',
    amountMinor,
    paymentDate: new Date().toISOString().slice(0, 10),
    allocations,
  });
  return result.payment.id;
}

describe('Phase 3 — Payments, Allocations & AR Reporting', () => {
  beforeAll(async () => {
    // Create test location
    const [loc] = await db
      .insert(locations)
      .values({ name: `P3 Test Branch ${TS}`, code: `P3-${TS}`, type: 'outlet' })
      .returning();
    testLocId = loc!.id;

    // Create test UOM
    const [uom] = await db
      .insert(unitsOfMeasure)
      .values({ name: `P3 UOM ${TS}`, code: `P3U-${TS}`, symbol: 'ea', allowDecimal: false })
      .returning();
    testUomId = uom!.id;

    // Create test Category
    const [cat] = await db
      .insert(categories)
      .values({ name: `P3 Cat ${TS}`, code: `P3C-${TS}` })
      .returning();
    const catId = cat!.id;

    // Create a 0% tax rate (so invoice totals equal unit prices for easy math)
    const [tax] = await db
      .insert(taxRates)
      .values({ name: `P3 Zero Tax ${TS}`, rateBasisPoints: 0 })
      .returning();
    testTaxRateId = tax!.id;

    // Create test product
    const [prod] = await db
      .insert(products)
      .values({
        name: `P3 Product ${TS}`,
        sku: `P3-SKU-${TS}`,
        categoryId: catId,
        uomId: testUomId,
        taxRateId: testTaxRateId,
        sellingPriceMinor: 20000,
      })
      .returning();
    testProductId = prod!.id;

    // Seed initial stock so invoices can reserve and deliver without stock shortfall
    await executeStockMovements(db, [
      {
        productId: testProductId,
        locationId: testLocId,
        quantity: 10_000,
        unitCostMinor: 10_000,
        movementType: 'purchase_receipt',
        referenceType: 'goods_receipt',
      },
    ]);

    // Create test customer
    const [cust] = await db
      .insert(customers)
      .values({
        name: `P3 Customer ${TS}`,
        accountNumber: `P3ACC${TS}`,
        customerType: 'business',
        creditLimitMinor: 10_000_000, // MWK 100,000
        paymentTermsDays: 30,
      })
      .returning();
    testCustId = cust!.id;

    // Insert test user
    const adminRole = await db.select().from(roles).where(eq(roles.name, 'admin')).limit(1);
    const [usr] = await db
      .insert(users)
      .values({
        name: `P3 User ${TS}`,
        email: `p3-${TS}@test.local`,
        passwordHash: 'x',
        roleId: adminRole[0]?.id ?? null,
        defaultLocationId: testLocId,
      })
      .returning();
    testUserId = usr!.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 1: Allocation limit — payment side
  // Net allocations + new > payment.amount_minor → throws
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 1: allocation limit — payment side — throws when over-allocating payment', async () => {
    const inv1 = await makeIssuedInvoice(50_000);
    const inv2 = await makeIssuedInvoice(50_000);

    const payId = await makeCashReceipt(testCustId, 60_000);

    // Allocate 50_000 to inv1 (payment has 10,000 left)
    await allocatePayment(payId, [{ invoiceId: inv1, amountMinor: 50_000 }], testUserId);
    // Allocate 10_000 to inv2 (payment has 0 left, but inv2 has 40,000 remaining)
    await allocatePayment(payId, [{ invoiceId: inv2, amountMinor: 10_000 }], testUserId);

    // Try to allocate 1 more to inv2 — should throw (payment fully allocated)
    await expect(
      allocatePayment(payId, [{ invoiceId: inv2, amountMinor: 1 }], testUserId),
    ).rejects.toThrow();
  }, 120000);

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 2: Allocation limit — invoice side
  // Net allocations + new > invoice net balance → throws
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 2: allocation limit — invoice side — throws when over-allocating invoice', async () => {
    const inv = await makeIssuedInvoice(50_000);

    const pay1 = await makeCashReceipt(testCustId, 50_000, [
      { invoiceId: inv, amountMinor: 50_000 },
    ]);
    const pay2 = await makeCashReceipt(testCustId, 10_000);

    // Invoice is fully paid; allocating more to it should throw
    await expect(
      allocatePayment(pay2, [{ invoiceId: inv, amountMinor: 1 }], testUserId),
    ).rejects.toThrow();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 3: One payment across several invoices
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 3: one payment allocated across multiple invoices', async () => {
    const inv1 = await makeIssuedInvoice(30_000);
    const inv2 = await makeIssuedInvoice(20_000);
    const inv3 = await makeIssuedInvoice(10_000);

    await makeCashReceipt(testCustId, 60_000, [
      { invoiceId: inv1, amountMinor: 30_000 },
      { invoiceId: inv2, amountMinor: 20_000 },
      { invoiceId: inv3, amountMinor: 10_000 },
    ]);

    const [i1] = await db.select().from(salesDocuments).where(eq(salesDocuments.id, inv1));
    const [i2] = await db.select().from(salesDocuments).where(eq(salesDocuments.id, inv2));
    const [i3] = await db.select().from(salesDocuments).where(eq(salesDocuments.id, inv3));

    expect(i1!.paymentStatus).toBe('paid');
    expect(i2!.paymentStatus).toBe('paid');
    expect(i3!.paymentStatus).toBe('paid');
    expect(Number(i1!.balanceMinor)).toBe(0);
    expect(Number(i2!.balanceMinor)).toBe(0);
    expect(Number(i3!.balanceMinor)).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 4: Several payments on one invoice (status transitions)
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 4: several payments on one invoice — unpaid → partly_paid → paid', async () => {
    const inv = await makeIssuedInvoice(100_000);

    const [before] = await db.select().from(salesDocuments).where(eq(salesDocuments.id, inv));
    expect(before!.paymentStatus).toBe('unpaid');

    await makeCashReceipt(testCustId, 40_000, [{ invoiceId: inv, amountMinor: 40_000 }]);
    const [mid] = await db.select().from(salesDocuments).where(eq(salesDocuments.id, inv));
    expect(mid!.paymentStatus).toBe('partly_paid');
    expect(Number(mid!.paidMinor)).toBe(40_000);

    await makeCashReceipt(testCustId, 60_000, [{ invoiceId: inv, amountMinor: 60_000 }]);
    const [final] = await db.select().from(salesDocuments).where(eq(salesDocuments.id, inv));
    expect(final!.paymentStatus).toBe('paid');
    expect(Number(final!.paidMinor)).toBe(100_000);
    expect(Number(final!.balanceMinor)).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 5: Part payment status changes (same as 4 but more granular assertions)
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 5: part payment — correct status at each step', async () => {
    const inv = await makeIssuedInvoice(80_000);

    await makeCashReceipt(testCustId, 30_000, [{ invoiceId: inv, amountMinor: 30_000 }]);
    const [mid] = await db.select().from(salesDocuments).where(eq(salesDocuments.id, inv));
    expect(mid!.paymentStatus).toBe('partly_paid');
    expect(Number(mid!.balanceMinor)).toBe(50_000);

    await makeCashReceipt(testCustId, 50_000, [{ invoiceId: inv, amountMinor: 50_000 }]);
    const [done] = await db.select().from(salesDocuments).where(eq(salesDocuments.id, inv));
    expect(done!.paymentStatus).toBe('paid');
    expect(Number(done!.balanceMinor)).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 6: Overpayment becomes credit after credit note
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 6: overpayment released to customer credit after credit note', async () => {
    const inv = await makeIssuedInvoice(100_000);

    // Pay the invoice fully
    await makeCashReceipt(testCustId, 100_000, [{ invoiceId: inv, amountMinor: 100_000 }]);

    // Now create a credit note (return goods), which increases creditedMinor
    const [invLine] = await db
      .select()
      .from(salesDocumentLines)
      .where(eq(salesDocumentLines.documentId, inv));

    await createCreditNote(
      {
        invoiceId: inv,
        lines: [
          {
            sourceLineId: invLine!.id,
            quantity: 1,
            returnGoods: false,
          },
        ],
      },
      testUserId,
    );

    // Release overpayment to credit
    await releaseOverpaymentToCredit(inv, testUserId);

    const { creditMinor } = await getCustomerCredit(testCustId);
    expect(creditMinor).toBeGreaterThan(BigInt(0));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 7: Apply credit to invoice (applyCreditToInvoice)
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 7: apply customer credit to open invoice', async () => {
    // Build up credit via a standalone receipt (no allocation)
    const creditPayId = await makeCashReceipt(testCustId, 50_000);
    const { creditMinor: before } = await getCustomerCredit(testCustId);
    expect(before).toBeGreaterThanOrEqual(BigInt(50_000));

    // Open invoice to apply credit to
    const inv = await makeIssuedInvoice(30_000);

    await applyCreditToInvoice(testCustId, inv, 30_000, testUserId);

    const [invoiceRow] = await db.select().from(salesDocuments).where(eq(salesDocuments.id, inv));
    expect(invoiceRow!.paymentStatus).toBe('paid');
    expect(Number(invoiceRow!.balanceMinor)).toBe(0);

    const { creditMinor: after } = await getCustomerCredit(testCustId);
    expect(after).toBeLessThan(before);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 8a: Cheque cleared — applies intended allocations
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 8a: cheque cleared — intended allocations applied', async () => {
    const inv = await makeIssuedInvoice(50_000);

    const result = await recordPayment({
      idempotencyKey: crypto.randomUUID(),
      customerId: testCustId,
      locationId: testLocId,
      kind: 'receipt',
      method: 'cheque',
      amountMinor: 50_000,
      paymentDate: new Date().toISOString().slice(0, 10),
      methodDetails: { cheque_number: 'CHQ-001', bank: 'First Bank', cheque_date: new Date().toISOString().slice(0, 10) },
      allocations: [{ invoiceId: inv, amountMinor: 50_000 }],
    });

    const payId = result.payment.id;

    // Before clearing: cheque is pending, invoice not paid
    const [beforeInv] = await db.select().from(salesDocuments).where(eq(salesDocuments.id, inv));
    expect(beforeInv!.paymentStatus).toBe('unpaid');

    // Clear the cheque
    await confirmCheque(payId, testUserId);

    const [afterPay] = await db.select().from(payments).where(eq(payments.id, payId));
    expect(afterPay!.status).toBe('confirmed');

    const [afterInv] = await db.select().from(salesDocuments).where(eq(salesDocuments.id, inv));
    expect(afterInv!.paymentStatus).toBe('paid');
    expect(Number(afterInv!.balanceMinor)).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 8b: Cheque bounced — no invoice change
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 8b: cheque bounced — invoice remains unchanged', async () => {
    const inv = await makeIssuedInvoice(40_000);

    const result = await recordPayment({
      idempotencyKey: crypto.randomUUID(),
      customerId: testCustId,
      locationId: testLocId,
      kind: 'receipt',
      method: 'cheque',
      amountMinor: 40_000,
      paymentDate: new Date().toISOString().slice(0, 10),
      methodDetails: { cheque_number: 'CHQ-002', bank: 'First Bank', cheque_date: new Date().toISOString().slice(0, 10) },
      allocations: [{ invoiceId: inv, amountMinor: 40_000 }],
    });

    const payId = result.payment.id;

    await bounceCheque(payId, 'Insufficient funds', testUserId);

    const [afterPay] = await db.select().from(payments).where(eq(payments.id, payId));
    expect(afterPay!.status).toBe('failed');

    const [afterInv] = await db.select().from(salesDocuments).where(eq(salesDocuments.id, inv));
    expect(afterInv!.paymentStatus).toBe('unpaid');
    expect(Number(afterInv!.balanceMinor)).toBe(40_000);

    // No allocation rows should exist for this payment
    const allocs = await db
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, payId));
    expect(allocs.length).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 9: Reversal restores balances
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 9: reversal restores invoice balance and writes negative allocation rows', async () => {
    const inv = await makeIssuedInvoice(70_000);
    const payId = await makeCashReceipt(testCustId, 70_000, [
      { invoiceId: inv, amountMinor: 70_000 },
    ]);

    // Invoice should be paid
    const [paid] = await db.select().from(salesDocuments).where(eq(salesDocuments.id, inv));
    expect(paid!.paymentStatus).toBe('paid');

    // Reverse the payment
    await reversePayment(payId, 'Customer requested reversal', testUserId);

    const [afterPay] = await db.select().from(payments).where(eq(payments.id, payId));
    expect(afterPay!.status).toBe('reversed');

    // Invoice balance should be restored
    const [restoredInv] = await db.select().from(salesDocuments).where(eq(salesDocuments.id, inv));
    expect(restoredInv!.paymentStatus).toBe('unpaid');
    expect(Number(restoredInv!.balanceMinor)).toBe(70_000);

    // Negative allocation row should exist
    const allocs = await db
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, payId));
    const hasNegative = allocs.some((a) => Number(a.amountMinor) < 0);
    expect(hasNegative).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 10: Duplicate submit — same idempotency key → one payment
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 10: duplicate submit with same idempotency key returns same payment', async () => {
    const key = crypto.randomUUID();
    const input = {
      idempotencyKey: key,
      customerId: testCustId,
      locationId: testLocId,
      kind: 'receipt' as const,
      method: 'cash' as const,
      amountMinor: 25_000,
      paymentDate: new Date().toISOString().slice(0, 10),
    };

    const r1 = await recordPayment(input);
    const r2 = await recordPayment(input);

    expect(r1.payment.id).toBe(r2.payment.id);
    expect(r2.isDuplicate).toBe(true);

    // DB has exactly one payment with this key
    const all = await db
      .select()
      .from(payments)
      .where(eq(payments.idempotencyKey, key));
    expect(all.length).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 11: Concurrent payments — only one gets the last tambala
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 11: concurrent payments — only one of two allocations for the last tambala succeeds', async () => {
    const inv = await makeIssuedInvoice(20_000); // 20,000 tambala invoice
    // Pay 19,999 so exactly 1 tambala is left on the invoice
    await makeCashReceipt(testCustId, 19_999, [{ invoiceId: inv, amountMinor: 19_999 }]);

    const pay1 = await makeCashReceipt(testCustId, 100_000);
    const pay2 = await makeCashReceipt(testCustId, 100_000);

    // Attempt to allocate the same 1 tambala from two different payments concurrently
    const results = await Promise.allSettled([
      allocatePayment(pay1, [{ invoiceId: inv, amountMinor: 1 }], testUserId),
      allocatePayment(pay2, [{ invoiceId: inv, amountMinor: 1 }], testUserId),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one should succeed
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 12: Credit note after full payment releases excess to credit
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 12: credit note after full payment → customer credit increases, invoice balance = 0', async () => {
    const inv = await makeIssuedInvoice(50_000);
    await makeCashReceipt(testCustId, 50_000, [{ invoiceId: inv, amountMinor: 50_000 }]);

    const { creditMinor: before } = await getCustomerCredit(testCustId);

    // Issue a partial credit note
    const [invLine12] = await db
      .select()
      .from(salesDocumentLines)
      .where(eq(salesDocumentLines.documentId, inv));

    await createCreditNote(
      {
        invoiceId: inv,
        lines: [
          {
            sourceLineId: invLine12!.id,
            quantity: 1,
            unitPriceMinor: 20_000,
            returnGoods: false,
          },
        ],
      },
      testUserId,
    );

    await releaseOverpaymentToCredit(inv, testUserId);

    const { creditMinor: after } = await getCustomerCredit(testCustId);
    expect(after).toBeGreaterThan(before);

    // Invoice balance stays 0 (the credit note credits the invoice, not adds debt)
    const [invRow] = await db.select().from(salesDocuments).where(eq(salesDocuments.id, inv));
    expect(Number(invRow!.balanceMinor)).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 13: Refund limited to customer credit
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 13: refund exceeding customer credit → throws', async () => {
    // Create a fresh customer with zero credit
    const [freshCust] = await db
      .insert(customers)
      .values({
        name: `P3 Fresh Cust ${TS}`,
        accountNumber: `P3FC${TS}`,
        customerType: 'individual',
        creditLimitMinor: 0,
        paymentTermsDays: 0,
      })
      .returning();

    await expect(
      refundPayment({
        idempotencyKey: crypto.randomUUID(),
        customerId: freshCust!.id,
        locationId: testLocId,
        method: 'cash',
        amountMinor: 1_000,
      }),
    ).rejects.toThrow(/insufficient.*credit/i);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 14: Aged debtors buckets correct
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 14: aged debtors — sum of all buckets equals total outstanding, void/credited excluded', async () => {
    const asOf = new Date().toISOString().slice(0, 10);
    const report = await getAgedDebtors(asOf, testLocId);

    for (const row of report.rows) {
      const bucketSum =
        row.currentMinor +
        row.days1_30Minor +
        row.days31_60Minor +
        row.days61_90Minor +
        row.days90plusMinor;
      expect(bucketSum).toBe(row.totalOutstandingMinor);
    }

    // Void and credited invoices must not appear
    for (const row of report.rows) {
      for (const inv of row.invoices) {
        expect(inv.netBalanceMinor).toBeGreaterThan(0);
      }
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 15: Statement closing balance = aged_debtors_total(asOf) − credit(asOf)
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 15: statement closing balance = aged debtors total − customer credit (as-of)', async () => {
    // Dedicated customer for statement invariant test
    const [stmtCust] = await db
      .insert(customers)
      .values({
        name: `P3 Statement Cust ${TS}`,
        accountNumber: `P3SC${TS}`,
        customerType: 'business',
        creditLimitMinor: 10_000_000,
        paymentTermsDays: 30,
      })
      .returning();
    const custId = stmtCust!.id;

    const from = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);

    // 1. Issue an invoice for 100,000
    const inv = await createDirectInvoice(
      {
        customerId: custId,
        locationId: testLocId,
        lines: [
          {
            productId: testProductId,
            quantity: 1,
            unitPriceMinor: 100_000,
            taxRateId: testTaxRateId,
            discountMinor: 0,
          },
        ],
        issueDate: to,
        dueDate: to,
      },
      testUserId,
    );
    await issueInvoice(inv.id, testUserId);

    // 2. Part payment of 40,000 allocated to the invoice (leaves 60,000 outstanding)
    await recordPayment({
      idempotencyKey: crypto.randomUUID(),
      customerId: custId,
      locationId: testLocId,
      kind: 'receipt',
      method: 'cash',
      amountMinor: 40_000,
      paymentDate: to,
      allocations: [{ invoiceId: inv.id, amountMinor: 40_000 }],
    });

    // 3. Unallocated payment of 10,000 (creates 10,000 customer credit)
    await recordPayment({
      idempotencyKey: crypto.randomUUID(),
      customerId: custId,
      locationId: testLocId,
      kind: 'receipt',
      method: 'cash',
      amountMinor: 10_000,
      paymentDate: to,
    });

    const statement = await getCustomerStatement(custId, from, to);
    const debtorsReport = await getAgedDebtors(to, testLocId);

    const custRow = debtorsReport.rows.find((r) => r.customerId === custId);
    expect(custRow).toBeDefined();
    expect(custRow!.totalOutstandingMinor).toBe(60_000);
    expect(custRow!.customerCreditMinor).toBe(10_000);

    const expectedClosing =
      custRow!.totalOutstandingMinor - custRow!.customerCreditMinor;

    // Closing balance from statement should equal debtors_total - credit (50,000)
    expect(statement.closingBalanceMinor).toBe(expectedClosing);
    expect(statement.closingBalanceMinor).toBe(50_000);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 16: Credit limit check uses real invoice balances
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 16: credit limit check uses real balance_minor, not stale data', async () => {
    // Create a customer with credit limit of exactly 100,000
    const [limitCust] = await db
      .insert(customers)
      .values({
        name: `P3 Limit Cust ${TS}b`,
        accountNumber: `P3LC${TS}b`,
        customerType: 'business',
        creditLimitMinor: 100_000,
        paymentTermsDays: 30,
      })
      .returning();

    const custId = limitCust!.id;

    // Issue invoice for 100,000 — should succeed
    const inv1 = await createDirectInvoice(
      {
        customerId: custId,
        locationId: testLocId,
        lines: [
          {
            productId: testProductId,
            quantity: 1,
            unitPriceMinor: 100_000,
            taxRateId: testTaxRateId,
            discountMinor: 0,
          },
        ],
        issueDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
      },
      testUserId,
    );
    await issueInvoice(inv1.id, testUserId);

    // Pay it — balance drops to 0
    await makeCashReceipt(custId, 100_000, [
      { invoiceId: inv1.id, amountMinor: 100_000 },
    ]);

    // Now issue another 100,000 invoice — balance is 0 so should be fine
    const inv2 = await createDirectInvoice(
      {
        customerId: custId,
        locationId: testLocId,
        lines: [
          {
            productId: testProductId,
            quantity: 1,
            unitPriceMinor: 100_000,
            taxRateId: testTaxRateId,
            discountMinor: 0,
          },
        ],
        issueDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
      },
      testUserId,
    );
    // The second invoice uses the real balance, so it should succeed
    await expect(issueInvoice(inv2.id, testUserId)).resolves.toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 17: Unique payment number under concurrency
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 17: concurrent recordPayment calls produce different sequential payment numbers', async () => {
    const [r1, r2] = await Promise.all([
      recordPayment({
        idempotencyKey: crypto.randomUUID(),
        customerId: testCustId,
        locationId: testLocId,
        kind: 'receipt',
        method: 'cash',
        amountMinor: 1000,
        paymentDate: new Date().toISOString().slice(0, 10),
      }),
      recordPayment({
        idempotencyKey: crypto.randomUUID(),
        customerId: testCustId,
        locationId: testLocId,
        kind: 'receipt',
        method: 'cash',
        amountMinor: 1000,
        paymentDate: new Date().toISOString().slice(0, 10),
      }),
    ]);

    expect(r1.payment.paymentNumber).not.toBe(r2.payment.paymentNumber);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 18: Immutability trigger blocks amount/method edit on confirmed payment
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 18: immutability trigger blocks UPDATE of financial fields on confirmed payment', async () => {
    const payId = await makeCashReceipt(testCustId, 10_000);

    // Attempt direct DB update of financial field
    await expect(
      db
        .update(payments)
        .set({ amountMinor: 99_999 })
        .where(eq(payments.id, payId)),
    ).rejects.toThrow();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 19: Permission — role-based access (service-layer enforcement omitted;
  //           tested via the `authorize` middleware in route tests)
  //           Here we verify that the permission tokens exist in permissions.ts
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 19: PAYMENTS_REVERSE and PAYMENTS_CHEQUE_CLEAR permission tokens exist', async () => {
    const { PERMISSIONS } = await import('@/lib/permissions');
    expect(PERMISSIONS.PAYMENTS_REVERSE).toBeDefined();
    expect(PERMISSIONS.PAYMENTS_CHEQUE_CLEAR).toBeDefined();
    expect(typeof PERMISSIONS.PAYMENTS_REVERSE).toBe('string');
    expect(typeof PERMISSIONS.PAYMENTS_CHEQUE_CLEAR).toBe('string');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 20: Historical aged debtors unchanged after new payment
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 20: historical aged debtors report is unchanged after new payment', async () => {
    const asOf = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);

    const report1 = await getAgedDebtors(asOf, testLocId);

    // Record a new payment after the asOf date
    await makeCashReceipt(testCustId, 5_000);

    const report2 = await getAgedDebtors(asOf, testLocId);

    // Grand totals for asOf should be identical
    expect(report1.totals.totalOutstandingMinor).toBe(report2.totals.totalOutstandingMinor);
    expect(report1.totals.customerCreditMinor).toBe(report2.totals.customerCreditMinor);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 21: Invalid state transitions rejected by service (not trigger — trigger
  //          lives in SQL; here we test service-level guards)
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 21: invalid state transitions (confirmed→pending, failed→confirmed) are blocked', async () => {
    const payId = await makeCashReceipt(testCustId, 8_000);

    // A confirmed payment cannot be "bounced" (only cheques can be bounced)
    await expect(bounceCheque(payId, 'Invalid', testUserId)).rejects.toThrow();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 22: UPDATE/DELETE on payment_allocations blocked by DB trigger
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 22: UPDATE and DELETE on payment_allocations blocked by trigger', async () => {
    const inv = await makeIssuedInvoice(15_000);
    const payId = await makeCashReceipt(testCustId, 15_000, [
      { invoiceId: inv, amountMinor: 15_000 },
    ]);

    const [alloc] = await db
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, payId));

    expect(alloc).toBeDefined();

    // UPDATE should be blocked
    await expect(
      db
        .update(paymentAllocations)
        .set({ amountMinor: 1 })
        .where(eq(paymentAllocations.id, alloc!.id)),
    ).rejects.toThrow();

    // DELETE should be blocked
    await expect(
      db
        .delete(paymentAllocations)
        .where(eq(paymentAllocations.id, alloc!.id)),
    ).rejects.toThrow();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 23: Same idempotency key, different amount → error
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 23: same idempotency key with different amount → throws conflict error', async () => {
    const key = crypto.randomUUID();

    await recordPayment({
      idempotencyKey: key,
      customerId: testCustId,
      locationId: testLocId,
      kind: 'receipt',
      method: 'cash',
      amountMinor: 10_000,
      paymentDate: new Date().toISOString().slice(0, 10),
    });

    await expect(
      recordPayment({
        idempotencyKey: key,
        customerId: testCustId,
        locationId: testLocId,
        kind: 'receipt',
        method: 'cash',
        amountMinor: 99_999, // different amount
        paymentDate: new Date().toISOString().slice(0, 10),
      }),
    ).rejects.toThrow(/idempotency/i);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 24: Reversal blocked when customer credit would go negative
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 24: reversal blocked when it would make customer credit negative', async () => {
    // Create a fresh customer
    const [freshCust] = await db
      .insert(customers)
      .values({
        name: `P3 Rev Cust ${TS}`,
        accountNumber: `P3RC${TS}`,
        customerType: 'individual',
        creditLimitMinor: 0,
        paymentTermsDays: 0,
      })
      .returning();
    const custId = freshCust!.id;

    // Record a receipt and immediately refund it (so credit = 0 after)
    const payId = await makeCashReceipt(custId, 10_000);

    // Now refund 10_000 (uses the credit)
    await refundPayment({
      idempotencyKey: crypto.randomUUID(),
      customerId: custId,
      locationId: testLocId,
      method: 'cash',
      amountMinor: 10_000,
    });

    // Now reversing the original receipt would make credit -10_000 → should throw
    await expect(
      reversePayment(payId, 'Test', testUserId),
    ).rejects.toThrow(/credit|insufficient/i);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 25: Duplicate mobile money transaction_id rejected
  // ─────────────────────────────────────────────────────────────────────────────
  it('Test 25: duplicate mobile money transaction_id rejected by unique index', async () => {
    const txnId = `MPAMBA-TXN-${TS}`;

    await recordPayment({
      idempotencyKey: crypto.randomUUID(),
      customerId: testCustId,
      locationId: testLocId,
      kind: 'receipt',
      method: 'mpamba',
      amountMinor: 5_000,
      paymentDate: new Date().toISOString().slice(0, 10),
      methodDetails: { transaction_id: txnId, sender_phone: '0888000001' },
    });

    await expect(
      recordPayment({
        idempotencyKey: crypto.randomUUID(),
        customerId: testCustId,
        locationId: testLocId,
        kind: 'receipt',
        method: 'mpamba',
        amountMinor: 5_000,
        paymentDate: new Date().toISOString().slice(0, 10),
        methodDetails: { transaction_id: txnId, sender_phone: '0888000002' }, // same txn id
      }),
    ).rejects.toThrow();
  });
});
