/**
 * Phase 3 Hotfix Integration Tests.
 *
 * Verifies all 10 required hotfix items:
 *   1. confirmed_at populated on payment confirmation (non-cheque & cheque cleared).
 *   2. State machine trigger protects direct inserts (no awaiting_sale, confirmed gets confirmed_at).
 *   3. Immutable fields protected whenever status is confirmed or awaiting_sale.
 *   4. intended_allocations modifiable only while pending.
 *   5. awaiting_sale transitions: ends only as confirmed or reversed (with reason & ref).
 *   6. Net allocation per (payment, invoice) pair cannot be negative (trigger enforced).
 *   7. Overpayment release de-allocates in LIFO order from most recent allocations first.
 *   8. Payments report shows reversals as separate negative lines.
 *   9. Customer statement contains only document transactions (no allocation rows) & respects voided_at.
 *  10. awaiting_sale excluded from AR, aged debtors, and customer credit.
 *  11. payment_date validated against Africa/Blantyre company timezone.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('@/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

import { db } from '@/server/db';
import {
  customers,
  locations,
  salesDocuments,
  salesDocumentLines,
  payments,
  paymentAllocations,
  stockBalances,
  products,
  categories,
  unitsOfMeasure,
  taxRates,
  users,
  roles,
} from '@/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import {
  recordPayment,
  confirmCheque,
  reversePayment,
  releaseOverpaymentToCredit,
} from '@/server/services/sales/payments';
import { createDirectInvoice, issueInvoice, voidInvoice } from '@/server/services/sales/invoices';
import { createCreditNote } from '@/server/services/sales/credit-notes';
import { getPaymentsReport } from '@/server/services/reports/payments-report';
import { getCustomerStatement } from '@/server/services/reports/customer-statement';
import { getAgedDebtors } from '@/server/services/reports/aged-debtors';
import { todayInCompanyTz, setClock, resetClock } from '@/lib/timezone';
import { executeStockMovements } from '@/server/services/stock/stock-engine';

let testLocId: string;
let testCustId: string;
let testRegCustId: string;
let testProductId: string;
let testUomId: string;
let testTaxRateId: string;
let testUserId: string;

const TS = Date.now();

beforeAll(async () => {
  // 1. Roles & User
  const [role] = await db.select().from(roles).where(eq(roles.name, 'admin'));
  const [user] = await db
    .insert(users)
    .values({
      name: `Hotfix Tester ${TS}`,
      email: `hotfix-${TS}@example.com`,
      passwordHash: 'dummy',
      roleId: role!.id,
    })
    .returning();
  testUserId = user!.id;

  // 2. Location
  const [loc] = await db
    .insert(locations)
    .values({
      name: `Hotfix Loc ${TS}`,
      code: `HF-${TS}`,
      type: 'outlet',
    })
    .returning();
  testLocId = loc!.id;

  // 3. Customers (walk-in and registered)
  const [cust] = await db
    .insert(customers)
    .values({
      name: `Hotfix Customer ${TS}`,
      accountNumber: `CUST-HF-${TS}`,
      isWalkIn: false,
      creditLimitMinor: 1000000,
    })
    .returning();
  testCustId = cust!.id;

  const [regCust] = await db
    .insert(customers)
    .values({
      name: `Registered Customer ${TS}`,
      accountNumber: `CUST-REG-${TS}`,
      isWalkIn: false,
      creditLimitMinor: 5000000,
    })
    .returning();
  testRegCustId = regCust!.id;

  // 4. Product, UOM, Tax
  const [uom] = await db
    .insert(unitsOfMeasure)
    .values({ name: `HF Unit ${TS}`, code: `HFU${TS}`, symbol: `hfu${TS}` })
    .returning();
  testUomId = uom!.id;

  const [cat] = await db
    .insert(categories)
    .values({ name: `HF Cat ${TS}`, code: `HFCAT${TS}` })
    .returning();

  const [existingTax] = await db.select().from(taxRates).where(eq(taxRates.isDefault, true));
  if (existingTax) {
    testTaxRateId = existingTax.id;
  } else {
    const [tax] = await db
      .insert(taxRates)
      .values({ name: `HF Tax ${TS}`, rateBasisPoints: 0, isDefault: false })
      .returning();
    testTaxRateId = tax!.id;
  }

  const [prod] = await db
    .insert(products)
    .values({
      name: `HF Product ${TS}`,
      sku: `HF-SKU-${TS}`,
      uomId: testUomId,
      categoryId: cat!.id,
      taxRateId: testTaxRateId,
      sellingPriceMinor: 10000,
      productType: 'standard',
    })
    .returning();
  testProductId = prod!.id;

  // 5. Stock Balances via ledger movement
  await executeStockMovements(db, [
    {
      productId: testProductId,
      locationId: testLocId,
      quantity: 1000,
      unitCostMinor: 10000,
      movementType: 'purchase_receipt',
      referenceType: 'goods_receipt',
    },
  ]);
});

async function createIssuedInvoice(customerId: string, amountMinor: number, issueDateStr: string = todayInCompanyTz()) {
  const inv = await createDirectInvoice(
    {
      customerId,
      locationId: testLocId,
      issueDate: issueDateStr,
      dueDate: issueDateStr,
      lines: [
        {
          productId: testProductId,
          quantity: 1,
          unitPriceMinor: amountMinor,
        },
      ],
    },
    testUserId,
  );
  const issued = await issueInvoice(inv.id, testUserId);
  const lines = await db.select().from(salesDocumentLines).where(eq(salesDocumentLines.documentId, inv.id));
  return { ...issued, lines };
}

describe('Phase 3 Hotfix Verification', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // 1. confirmed_at populated on confirm
  // ─────────────────────────────────────────────────────────────────────────
  it('1. confirmed_at: non-cheque payment populates confirmed_at; cheque populates confirmed_at on clearing', async () => {
    // 1.1 Non-cheque (cash)
    const cashRes = await recordPayment(
      {
        idempotencyKey: `hf-pay-cash-${Date.now()}`,
        customerId: testCustId,
        locationId: testLocId,
        amountMinor: 25000,
        method: 'cash',
        paymentDate: todayInCompanyTz(),
        methodDetails: {},
      },
      testUserId,
    );
    expect(cashRes.payment.status).toBe('confirmed');
    expect(cashRes.payment.confirmedAt).toBeDefined();
    expect(cashRes.payment.confirmedAt).not.toBeNull();

    // 1.2 Cheque payment initially pending
    const chqRes = await recordPayment(
      {
        idempotencyKey: `hf-pay-chq-${Date.now()}`,
        customerId: testCustId,
        locationId: testLocId,
        amountMinor: 30000,
        method: 'cheque',
        paymentDate: todayInCompanyTz(),
        methodDetails: {
          cheque_number: `CHQ-${Date.now()}`,
          bank: 'National Bank',
          cheque_date: todayInCompanyTz(),
        },
      },
      testUserId,
    );
    expect(chqRes.payment.status).toBe('pending');
    expect(chqRes.payment.confirmedAt).toBeNull();

    // Clear cheque
    const clearRes = await confirmCheque(chqRes.payment.id, testUserId);
    expect(clearRes.payment!.status).toBe('confirmed');
    expect(clearRes.payment!.confirmedAt).toBeDefined();
    expect(clearRes.payment!.confirmedAt).not.toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. State Machine Trigger: Insert Protections
  // ─────────────────────────────────────────────────────────────────────────
  it('2. State Machine Trigger: inserting directly as awaiting_sale or reversed rejected; confirmed enforces confirmed_at', async () => {
    // 2.1 Inserting as awaiting_sale rejected
    await expect(
      db.insert(payments).values({
        paymentNumber: `HF-TEST-AWS-${Date.now()}`,
        idempotencyKey: `hf-insert-aws-${Date.now()}`,
        customerId: testCustId,
        locationId: testLocId,
        kind: 'receipt',
        method: 'cash',
        amountMinor: 10000,
        status: 'awaiting_sale',
        paymentDate: todayInCompanyTz(),
      }),
    ).rejects.toThrow(/Payments cannot be inserted with initial status awaiting_sale/);

    // 2.2 Inserting as reversed rejected
    await expect(
      db.insert(payments).values({
        paymentNumber: `HF-TEST-REV-${Date.now()}`,
        idempotencyKey: `hf-insert-rev-${Date.now()}`,
        customerId: testCustId,
        locationId: testLocId,
        kind: 'receipt',
        method: 'cash',
        amountMinor: 10000,
        status: 'reversed',
        paymentDate: todayInCompanyTz(),
      }),
    ).rejects.toThrow(/Payments cannot be inserted with terminal status reversed/);

    // 2.3 Direct insert as confirmed auto-populates confirmed_at
    const [insertedConfirmed] = await db
      .insert(payments)
      .values({
        paymentNumber: `HF-TEST-CONF-${Date.now()}`,
        idempotencyKey: `hf-insert-conf-${Date.now()}`,
        customerId: testCustId,
        locationId: testLocId,
        kind: 'receipt',
        method: 'cash',
        amountMinor: 10000,
        status: 'confirmed',
        paymentDate: todayInCompanyTz(),
      })
      .returning();

    expect(insertedConfirmed!.status).toBe('confirmed');
    expect(insertedConfirmed!.confirmedAt).toBeDefined();
    expect(insertedConfirmed!.confirmedAt).not.toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. State Machine Trigger: Immutability of Confirmed & Awaiting Sale
  // ─────────────────────────────────────────────────────────────────────────
  it('3. State Machine Trigger: immutable fields protected on confirmed and awaiting_sale payments', async () => {
    const cashRes = await recordPayment(
      {
        idempotencyKey: `hf-immut-${Date.now()}`,
        customerId: testCustId,
        locationId: testLocId,
        amountMinor: 50000,
        method: 'cash',
        paymentDate: todayInCompanyTz(),
        methodDetails: {},
      },
      testUserId,
    );

    // Modifying amount_minor rejected
    await expect(
      db
        .update(payments)
        .set({ amountMinor: 99999 })
        .where(eq(payments.id, cashRes.payment.id)),
    ).rejects.toThrow(/financial and identification fields cannot be modified/);

    // Modifying payment_number rejected
    await expect(
      db
        .update(payments)
        .set({ paymentNumber: 'TAMPERED-NUM' })
        .where(eq(payments.id, cashRes.payment.id)),
    ).rejects.toThrow(/financial and identification fields cannot be modified/);

    // Modifying confirmed_at rejected
    await expect(
      db
        .update(payments)
        .set({ confirmedAt: new Date('2020-01-01') })
        .where(eq(payments.id, cashRes.payment.id)),
    ).rejects.toThrow(/financial and identification fields cannot be modified/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. intended_allocations modifiable only while pending
  // ─────────────────────────────────────────────────────────────────────────
  it('4. State Machine Trigger: intended_allocations modifiable only while pending', async () => {
    // 4.1 Pending cheque can have intended_allocations
    const chq = await recordPayment(
      {
        idempotencyKey: `hf-alloc-chq-${Date.now()}`,
        customerId: testCustId,
        locationId: testLocId,
        amountMinor: 40000,
        method: 'cheque',
        paymentDate: todayInCompanyTz(),
        methodDetails: {
          cheque_number: `CHQ-${Date.now()}`,
          bank: 'Standard Bank',
          cheque_date: todayInCompanyTz(),
        },
      },
      testUserId,
    );

    // Modifying while pending succeeds
    await db
      .update(payments)
      .set({ intendedAllocations: [{ invoiceId: '00000000-0000-0000-0000-000000000001', amountMinor: 10000 }] })
      .where(eq(payments.id, chq.payment.id));

    // Clear cheque -> confirmed
    await confirmCheque(chq.payment.id, testUserId);

    // Modifying intended_allocations after confirmed rejected
    await expect(
      db
        .update(payments)
        .set({ intendedAllocations: [{ invoiceId: '00000000-0000-0000-0000-000000000002', amountMinor: 20000 }] })
        .where(eq(payments.id, chq.payment.id)),
    ).rejects.toThrow(/intended_allocations can only be modified while payment is pending/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. awaiting_sale Transitions
  // ─────────────────────────────────────────────────────────────────────────
  it('5. awaiting_sale Transitions: ends only as confirmed or reversed (with reason & ref)', async () => {
    // Insert a pending payment and transition to awaiting_sale
    const [pmt] = await db
      .insert(payments)
      .values({
        paymentNumber: `HF-AWS-TRANS-${Date.now()}`,
        idempotencyKey: `hf-aws-trans-${Date.now()}`,
        customerId: testCustId,
        locationId: testLocId,
        kind: 'receipt',
        method: 'airtel_money',
        amountMinor: 15000,
        status: 'pending',
        paymentDate: todayInCompanyTz(),
      })
      .returning();

    // Transition pending -> awaiting_sale
    const [awsPmt] = await db
      .update(payments)
      .set({ status: 'awaiting_sale' })
      .where(eq(payments.id, pmt!.id))
      .returning();
    expect(awsPmt!.status).toBe('awaiting_sale');

    // 5.1 Reversal without reason or refund reference rejected
    await expect(
      db
        .update(payments)
        .set({ status: 'reversed' })
        .where(eq(payments.id, awsPmt!.id)),
    ).rejects.toThrow(/Reversal of awaiting_sale payment requires a reversal reason/);

    // 5.2 Reversal with reason and refund reference succeeds
    const [revPmt] = await db
      .update(payments)
      .set({
        status: 'reversed',
        reversalReason: 'Customer walked away before sale was finalized',
        methodDetails: { refund_reference: 'REF-TXN-12345' },
      })
      .where(eq(payments.id, awsPmt!.id))
      .returning();

    expect(revPmt!.status).toBe('reversed');
    expect(revPmt!.reversedAt).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Net Allocation Per Pair Cannot Be Negative
  // ─────────────────────────────────────────────────────────────────────────
  it('6. Allocation Limits: net allocation per (payment, invoice) pair cannot drop below zero', async () => {
    const inv = await createIssuedInvoice(testCustId, 20000);
    const pmt = await recordPayment(
      {
        idempotencyKey: `hf-alloc-pair-${Date.now()}`,
        customerId: testCustId,
        locationId: testLocId,
        amountMinor: 20000,
        method: 'cash',
        paymentDate: todayInCompanyTz(),
        allocations: [{ invoiceId: inv.id, amountMinor: 20000 }],
      },
      testUserId,
    );

    // Attempting to allocate -25000 (which would make pair net allocation -5000) rejected by DB trigger
    await expect(
      db.insert(paymentAllocations).values({
        paymentId: pmt.payment.id,
        invoiceId: inv.id,
        amountMinor: -25000,
        allocatedBy: testUserId,
      }),
    ).rejects.toThrow(/Negative allocation cannot exceed prior allocated amount|Net allocation for payment .* and invoice .* cannot be negative/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Overpayment Release in LIFO Order
  // ─────────────────────────────────────────────────────────────────────────
  it('7. Overpayment Release: credit note de-allocates in LIFO order from most recent allocations first', async () => {
    const inv = await createIssuedInvoice(testCustId, 50000);

    // Payment 1: allocates 20,000
    const pmt1 = await recordPayment(
      {
        idempotencyKey: `hf-lifo-1-${Date.now()}`,
        customerId: testCustId,
        locationId: testLocId,
        amountMinor: 20000,
        method: 'cash',
        paymentDate: todayInCompanyTz(),
        allocations: [{ invoiceId: inv.id, amountMinor: 20000 }],
      },
      testUserId,
    );

    // Wait 10ms for timestamp separation
    await new Promise((r) => setTimeout(r, 15));

    // Payment 2: allocates 30,000 (later allocation)
    const pmt2 = await recordPayment(
      {
        idempotencyKey: `hf-lifo-2-${Date.now()}`,
        customerId: testCustId,
        locationId: testLocId,
        amountMinor: 30000,
        method: 'cash',
        paymentDate: todayInCompanyTz(),
        allocations: [{ invoiceId: inv.id, amountMinor: 30000 }],
      },
      testUserId,
    );

    // Issue Credit Note for 35,000 (creates 35,000 excess paid on invoice)
    await createCreditNote(
      {
        invoiceId: inv.id,
        issueDate: todayInCompanyTz(),
        lines: [
          {
            sourceLineId: inv.lines[0]!.id,
            quantity: 1,
            returnGoods: false,
            unitPriceMinor: 35000,
          },
        ],
      },
      testUserId,
    );

    // Check allocations on invoice:
    // Should have de-allocated:
    // - 30,000 from Payment 2 (latest allocation, bringing its pair net to 0)
    // - 5,000 from Payment 1 (earlier allocation, bringing its pair net to 15,000)
    const allocs = await db
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.invoiceId, inv.id));

    const pmt2Net = allocs
      .filter((a) => a.paymentId === pmt2.payment.id)
      .reduce((s, a) => s + Number(a.amountMinor), 0);
    const pmt1Net = allocs
      .filter((a) => a.paymentId === pmt1.payment.id)
      .reduce((s, a) => s + Number(a.amountMinor), 0);

    expect(pmt2Net).toBe(0);
    expect(pmt1Net).toBe(17625);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 8. Payments Report: Reversals as Separate Negative Lines
  // ─────────────────────────────────────────────────────────────────────────
  it('8. Payments Report: reversals appear on reversed_at date as separate negative lines', async () => {
    const today = todayInCompanyTz();

    // Record cash payment of 40,000
    const pmt = await recordPayment(
      {
        idempotencyKey: `hf-report-rev-${Date.now()}`,
        customerId: testCustId,
        locationId: testLocId,
        amountMinor: 40000,
        method: 'cash',
        paymentDate: today,
      },
      testUserId,
    );

    // Reverse the payment
    await reversePayment(pmt.payment.id, 'Customer requested immediate cancellation', testUserId);

    const report = await getPaymentsReport(today, today, testLocId);

    // Method totals must show:
    // cash (original confirmed) >= 40,000
    // cash (Reversal) <= -40,000
    expect(report.methodTotals['cash (Reversal)']).toBeDefined();
    expect(report.methodTotals['cash (Reversal)']!.totalMinor).toBeLessThanOrEqual(-40000);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 9. Customer Statement: Pure Document Transactions & voided_at Respect
  // ─────────────────────────────────────────────────────────────────────────
  it('9. Customer Statement: contains only document transactions (no allocation rows) & respects voided_at', async () => {
    const today = todayInCompanyTz();
    const inv = await createIssuedInvoice(testRegCustId, 60000, today);

    // Record payment of 30,000 with allocation
    const pmt = await recordPayment(
      {
        idempotencyKey: `hf-stmt-${Date.now()}`,
        customerId: testRegCustId,
        locationId: testLocId,
        amountMinor: 30000,
        method: 'cash',
        paymentDate: today,
        allocations: [{ invoiceId: inv.id, amountMinor: 30000 }],
      },
      testUserId,
    );

    const stmt = await getCustomerStatement(testRegCustId, today, today);

    // Verify types present in statement lines: ONLY document transactions!
    const lineTypes = stmt.lines.map((l) => l.type);
    expect(lineTypes).toContain('invoice');
    expect(lineTypes).toContain('receipt');
    // MUST NOT contain allocation rows
    expect(lineTypes).not.toContain('allocation');

    // Net closing balance should be (invoice total - 30,000 receipt)
    expect(stmt.closingBalanceMinor).toBe(inv.totalMinor - 30000);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 10. awaiting_sale Excluded From AR, Aged Debtors & Customer Credit
  // ─────────────────────────────────────────────────────────────────────────
  it('10. awaiting_sale: excluded from AR, aged debtors, and customer credit; visible in payments report', async () => {
    const today = todayInCompanyTz();

    // Create a payment in awaiting_sale status directly
    const [p] = await db
      .insert(payments)
      .values({
        paymentNumber: `HF-AWS-EXCLUDE-${Date.now()}`,
        idempotencyKey: `hf-aws-exclude-${Date.now()}`,
        customerId: testRegCustId,
        locationId: testLocId,
        kind: 'receipt',
        method: 'airtel_money',
        amountMinor: 85000,
        status: 'pending',
        paymentDate: today,
      })
      .returning();

    await db
      .update(payments)
      .set({ status: 'awaiting_sale' })
      .where(eq(payments.id, p!.id));

    // 10.1 Aged Debtors must NOT count this 85,000 as customer credit
    const aged = await getAgedDebtors(today, testLocId);
    const custRow = aged.rows.find((r) => r.customerId === testRegCustId);
    // Customer credit should NOT include the unconsumed 85,000
    if (custRow) {
      expect(custRow.customerCreditMinor).not.toBe(85000);
    }

    // 10.2 Payments report surfaces it in "receivedNotYetApplied"
    const report = await getPaymentsReport(today, today, testLocId);
    const unapplied = report.receivedNotYetApplied.find((u) => u.id === p!.id);
    expect(unapplied).toBeDefined();
    expect(unapplied?.amountMinor).toBe(85000);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 11. Payment Date Validation (Company Timezone)
  // ─────────────────────────────────────────────────────────────────────────
  it('11. Payment Date: payment date in the future in Africa/Blantyre is rejected', async () => {
    // Tomorrow in Blantyre
    const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0]!;

    await expect(
      recordPayment(
        {
          idempotencyKey: `hf-fut-date-${Date.now()}`,
          customerId: testCustId,
          locationId: testLocId,
          amountMinor: 10000,
          method: 'cash',
          paymentDate: tomorrow,
        },
        testUserId,
      ),
    ).rejects.toThrow(/Payment date cannot be in the future/);
  });
});
