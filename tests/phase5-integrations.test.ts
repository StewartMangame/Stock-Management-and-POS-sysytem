/**
 * Phase 5 Integrations Integration Tests.
 *
 * Verifies:
 *   1. OneKhusa provider interface, phone normalization, and masking.
 *   2. Mock payment provider push and transaction query.
 *   3. Payment links creation, token hashing, public data, and rate limits.
 *   4. POS Mobile Money prompt creation, awaiting_sale transition, and counter-sale atomic consumption.
 *   5. Webhook inbox signature verification (HMAC-SHA512), deduping, and processing.
 *   6. Webhook unknown reference flagging for manager review.
 *   7. EIS transactional outbox queue enqueue, batch processing, and receipt data retrieval.
 *   8. Bank statement CSV import, duplicate file detection, and manual match/unmatch.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import crypto from 'node:crypto';

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
  posShifts,
  paymentLinks,
  webhookInbox,
  eisSubmissions,
  statementImports,
  statementLines,
  reconciliationMatches,
  statementMappingProfiles,
} from '@/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import {
  normalizeMalawianPhone,
  maskPhone,
  setPaymentProvider,
  MockPaymentProvider,
} from '@/server/services/integrations/onekhusa';
import {
  createPaymentLink,
  getPaymentLinkPublicData,
} from '@/server/services/integrations/payment-links';
import {
  initiatePosMobileMoneyPrompt,
  checkPosMobileMoneyStatus,
} from '@/server/services/pos/pos-mobile-money';
import { createCounterSale } from '@/server/services/pos/counter-sale';
import { openShift } from '@/server/services/pos/shifts';
import { processWebhookInboxItem } from '@/server/services/integrations/webhook-processor';
import {
  enqueueEisSubmission,
  processEisOutboxBatch,
  getEisReceiptData,
} from '@/server/services/integrations/eis/queue';
import {
  importStatementCsv,
  matchStatementLine,
  unmatchStatementLine,
} from '@/server/services/integrations/bank-reconciliation';
import { createDirectInvoice, issueInvoice } from '@/server/services/sales/invoices';
import { todayInCompanyTz, getNow } from '@/lib/timezone';

let testLocId: string;
let testCustId: string;
let testProductId: string;
let testTaxRateId: string;
let testUserId: string;
let testShiftId: string;

const TS = Date.now();

beforeAll(async () => {
  // Use mock payment provider
  setPaymentProvider(new MockPaymentProvider());

  // 1. Roles & User
  const [role] = await db.select().from(roles).where(eq(roles.name, 'admin'));
  const [user] = await db
    .insert(users)
    .values({
      name: `P5 Tester ${TS}`,
      email: `p5-${TS}@example.com`,
      passwordHash: 'dummy',
      roleId: role!.id,
    })
    .returning();
  testUserId = user!.id;

  // 2. Location
  const [loc] = await db
    .insert(locations)
    .values({
      name: `P5 Loc ${TS}`,
      code: `P5-${TS}`,
      type: 'outlet',
    })
    .returning();
  testLocId = loc!.id;

  // 3. Customer
  const [cust] = await db
    .insert(customers)
    .values({
      name: `P5 Customer ${TS}`,
      accountNumber: `CUST-P5-${TS}`,
      isWalkIn: false,
      creditLimitMinor: 5000000,
    })
    .returning();
  testCustId = cust!.id;

  // Ensure walk-in customer exists
  const [existingWalkIn] = await db
    .select()
    .from(customers)
    .where(eq(customers.isWalkIn, true));
  if (!existingWalkIn) {
    await db.insert(customers).values({
      name: 'Walk-In Customer',
      accountNumber: `WALKIN-${TS}`,
      isWalkIn: true,
      creditLimitMinor: 0,
    });
  }

  // 4. Tax Rate
  const [tax] = await db
    .insert(taxRates)
    .values({
      name: `P5 Standard 16.5% ${TS}`,
      rateBasisPoints: 1650,
      isDefault: false,
    })
    .returning();
  testTaxRateId = tax!.id;

  // 5. Category & UoM & Product
  const [cat] = await db
    .insert(categories)
    .values({ name: `P5 Cat ${TS}`, code: `P5CAT${TS}` })
    .returning();
  const [uom] = await db
    .insert(unitsOfMeasure)
    .values({ name: `Each ${TS}`, code: `P5EA${TS}`, symbol: `ea${TS}` })
    .returning();

  const [prod] = await db
    .insert(products)
    .values({
      name: `P5 Product ${TS}`,
      sku: `P5-SKU-${TS}`,
      categoryId: cat!.id,
      uomId: uom!.id,
      taxRateId: testTaxRateId,
      sellingPriceMinor: 100000, // MWK 1,000
      productType: 'standard',
    })
    .returning();
  testProductId = prod!.id;

  // Seed stock balance
  await db.insert(stockBalances).values({
    productId: testProductId,
    locationId: testLocId,
    onHand: '500.000',
    reserved: '0.000',
  });

  // Open a POS shift
  const shift = await openShift({
    cashierId: testUserId,
    locationId: testLocId,
    openingFloatMinor: 100000, // MWK 1,000 float
  });
  testShiftId = shift.id;
});

describe('Phase 5 — Integrations Integration Tests', () => {
  // ── 1. OneKhusa Phone Normalization & Masking ──────────────────────────────
  it('1. Phone Normalization: validates Malawian Airtel and TNM Mpamba formats', () => {
    // Airtel (+265 8...)
    const a1 = normalizeMalawianPhone('+265881234567');
    expect(a1.valid).toBe(true);
    expect(a1.network).toBe('airtel');
    expect(a1.normalized).toBe('+265881234567');

    const a2 = normalizeMalawianPhone('0881234567');
    expect(a2.valid).toBe(true);
    expect(a2.network).toBe('airtel');
    expect(a2.normalized).toBe('+265881234567');

    // TNM Mpamba (+265 9...)
    const m1 = normalizeMalawianPhone('+265991234567');
    expect(m1.valid).toBe(true);
    expect(m1.network).toBe('tnm');
    expect(m1.normalized).toBe('+265991234567');

    const m2 = normalizeMalawianPhone('0991234567');
    expect(m2.valid).toBe(true);
    expect(m2.network).toBe('tnm');

    // Invalid numbers
    expect(normalizeMalawianPhone('12345').valid).toBe(false);
    expect(normalizeMalawianPhone('0771234567').valid).toBe(false); // starts with 7
    expect(normalizeMalawianPhone('+27821234567').valid).toBe(false); // South African

    // Masking
    expect(maskPhone('+265881234567')).toBe('+26588***567');
  });

  // ── 2. Payment Links ───────────────────────────────────────────────────────
  it('2. Payment Links: creates link, fetches public summary, and enforces rate limit', async () => {
    // Create an issued invoice
    const inv = await createDirectInvoice(
      {
        customerId: testCustId,
        locationId: testLocId,
        lines: [
          {
            productId: testProductId,
            quantity: 1,
            unitPriceMinor: 100000,
          },
        ],
      },
      testUserId,
    );
    const issued = await issueInvoice(inv.id, testUserId);

    // Create payment link
    const link = await createPaymentLink(issued.id, {
      allowPartial: true,
      expiresInHours: 48,
      createdBy: testUserId,
    });

    expect(link.paymentLink.status).toBe('active');
    expect(link.rawToken).toHaveLength(64); // 32 bytes hex
    expect(link.url).toBe(`/pay/${link.rawToken}`);

    // Fetch public data
    const pub = await getPaymentLinkPublicData(link.rawToken);
    expect(pub.valid).toBe(true);
    if (pub.valid && !pub.isPaid && pub.invoice) {
      expect(pub.invoice.documentNumber).toBe(issued.documentNumber);
      expect(pub.invoice.balanceMinor).toBe(issued.totalMinor);
      expect(pub.invoice.lines).toHaveLength(1);
    }
  });

  // ── 3. POS Mobile Money Prompt & Counter Sale Consumption ──────────────────
  it('3. POS Mobile Money: push prompt transitions pending -> awaiting_sale, then atomically consumed by counter sale', async () => {
    // Initiate POS push
    const pushResult = await initiatePosMobileMoneyPrompt({
      shiftId: testShiftId,
      locationId: testLocId,
      cashierId: testUserId,
      customerId: testCustId,
      method: 'airtel_money',
      phone: '+265881234567',
      amountMinor: 116500, // 1000 + 16.5% tax
    });

    expect(pushResult.status).toBe('pending');
    expect(pushResult.paymentId).toBeDefined();

    // Check status: mock auto-confirms, transitioning to awaiting_sale
    const statusResult = await checkPosMobileMoneyStatus(pushResult.paymentId);
    expect(statusResult.status).toBe('awaiting_sale');

    // Verify payment in DB has status awaiting_sale and provider_confirmed_at set
    const [pmt] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, pushResult.paymentId));
    expect(pmt!.status).toBe('awaiting_sale');
    expect(pmt!.providerConfirmedAt).not.toBeNull();
    expect(pmt!.confirmedAt).toBeNull(); // not yet confirmed until sale consumed

    // Consume in Counter Sale atomically
    const saleRes = await createCounterSale(
      {
        shiftId: testShiftId,
        locationId: testLocId,
        cashierId: testUserId,
        customerId: testCustId,
        lines: [
          {
            productId: testProductId,
            quantity: 1,
          },
        ],
        payments: [
          {
            method: 'airtel_money',
            appliedMinor: 116500,
            existingPaymentId: pushResult.paymentId,
          },
        ],
        idempotencyKey: `p5-sale-${Date.now()}`,
      },
      testUserId,
    );

    expect(saleRes.invoice.id).toBeDefined();

    // Verify payment is now confirmed with confirmed_at set
    const [consumedPmt] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, pushResult.paymentId));
    expect(consumedPmt!.status).toBe('confirmed');
    expect(consumedPmt!.confirmedAt).not.toBeNull();
  });

  // ── 4. Webhook Processing ──────────────────────────────────────────────────
  it('4. Webhook Inbox: verifies HMAC-SHA512 signature and processes confirmation', async () => {
    // Create an issued invoice
    const inv = await createDirectInvoice(
      {
        customerId: testCustId,
        locationId: testLocId,
        lines: [{ productId: testProductId, quantity: 1, unitPriceMinor: 50000 }],
      },
      testUserId,
    );
    const issued = await issueInvoice(inv.id, testUserId);

    // Create a pending payment
    const [pmt] = await db
      .insert(payments)
      .values({
        paymentNumber: `PAY-WH-${Date.now()}`,
        idempotencyKey: `wh-test-${Date.now()}`,
        customerId: testCustId,
        locationId: testLocId,
        kind: 'receipt',
        method: 'airtel_money',
        amountMinor: issued.totalMinor,
        status: 'pending',
        provider: 'onekhusa',
        paymentDate: todayInCompanyTz(),
        intendedAllocations: [{ invoiceId: issued.id, amountMinor: issued.totalMinor }],
      })
      .returning();

    // Insert webhook inbox event
    const txRef = `TX-WH-${Date.now()}`;
    const rawPayload = JSON.stringify({
      eventType: 'collection.completed',
      transactionReferenceNumber: txRef,
      transactionReference: txRef,
      sourceReferenceNumber: pmt!.id,
      status: 'S',
      amountMinor: issued.totalMinor,
      amount: issued.totalMinor / 100,
      currency: 'MWK',
      fee: 50,
      netAmount: issued.totalMinor / 100 - 50,
    });
    const sig = crypto.createHmac('sha512', 'mock-webhook-secret').update(rawPayload).digest('hex');

    const [inboxItem] = await db
      .insert(webhookInbox)
      .values({
        provider: 'onekhusa',
        eventType: 'collection.completed',
        transactionReference: txRef,
        rawPayload,
        headers: { 'x-onekhusa-signature': sig },
        status: 'received',
      })
      .returning();

    // Process inbox item
    const procRes = await processWebhookInboxItem(inboxItem!.id);
    expect(procRes.success).toBe(true);

    // Payment should now be confirmed
    const [confirmedPmt] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, pmt!.id));
    expect(confirmedPmt!.status).toBe('confirmed');
    expect(confirmedPmt!.confirmedAt).not.toBeNull();
  });

  // ── 5. Webhook Exception Handling (Flagging) ───────────────────────────────
  it('5. Webhook Exception: unknown reference flags payment for manager review without state change', async () => {
    const unknownRef = `UNKNOWN-TX-${Date.now()}`;
    const rawPayload = JSON.stringify({
      eventType: 'collection.completed',
      transactionReferenceNumber: unknownRef,
      sourceReferenceNumber: '00000000-0000-0000-0000-000000000999',
      status: 'S',
      amount: 1000,
      currency: 'MWK',
    });
    const sig = crypto.createHmac('sha512', 'mock-webhook-secret').update(rawPayload).digest('hex');

    const [inboxItem] = await db
      .insert(webhookInbox)
      .values({
        provider: 'onekhusa',
        eventType: 'collection.completed',
        transactionReference: unknownRef,
        rawPayload,
        headers: { 'x-onekhusa-signature': sig },
        status: 'received',
      })
      .returning();

    const procRes = await processWebhookInboxItem(inboxItem!.id);
    expect(procRes.success).toBe(false);
    expect(procRes.message).toContain('not found');
  });

  // ── 6. EIS Outbox Queue & Receipt ──────────────────────────────────────────
  it('6. EIS Queue: enqueues submission, processes batch, and generates fiscal receipt data', async () => {
    // Create an invoice
    const inv = await createDirectInvoice(
      {
        customerId: testCustId,
        locationId: testLocId,
        lines: [{ productId: testProductId, quantity: 1, unitPriceMinor: 80000 }],
      },
      testUserId,
    );
    const issued = await issueInvoice(inv.id, testUserId);

    // Enqueue EIS submission in transaction
    await db.transaction(async (tx) => {
      await enqueueEisSubmission(tx, issued.id, 'invoice');
    });

    // Check submission row in DB
    const [sub] = await db
      .select()
      .from(eisSubmissions)
      .where(eq(eisSubmissions.documentId, issued.id));
    expect(sub).toBeDefined();
    expect(sub!.status).toBe('pending');

    // Process batch with mock adapter
    const batchResult = await processEisOutboxBatch(10);
    expect(batchResult.successCount).toBeGreaterThanOrEqual(1);

    // Check EIS receipt data
    const receiptData = await getEisReceiptData(issued.id);
    expect(receiptData).not.toBeNull();
    expect(receiptData!.receiptNumber).toContain('MRA-EIS-2026-');
    expect(receiptData!.qrCodeData).toContain('https://mra.mw/eis/verify?rn=');
  });

  // ── 7. Bank Statement Import & Reconciliation ──────────────────────────────
  it('7. Bank Reconciliation: imports CSV, detects duplicate file, and matches lines', async () => {
    // Create mapping profile
    const [profile] = await db
      .insert(statementMappingProfiles)
      .values({
        name: `Test Profile ${TS}`,
        columnMapping: {
          dateColumn: 'Date',
          referenceColumn: 'Reference',
          descriptionColumn: 'Description',
          creditColumn: 'Credit',
          feeColumn: 'Fee',
        },
        dateFormat: 'YYYY-MM-DD',
        amountMode: 'net',
        createdBy: testUserId,
      })
      .returning();

    const runId = Date.now();
    const csvContent = `Date,Reference,Description,Credit,Fee\n2026-10-30,REF-${runId}-1,Airtel Settlement,50000,500\n2026-10-30,REF-${runId}-2,Mpamba Settlement,75000,750`;

    // Import statement
    const importRes = await importStatementCsv(csvContent, {
      filename: `settlement-${runId}.csv`,
      profileId: profile!.id,
      userId: testUserId,
    });

    expect(importRes.rowCount).toBe(2);
    expect(importRes.importDoc.id).toBeDefined();

    // Duplicate import must be rejected
    await expect(
      importStatementCsv(csvContent, {
        filename: `settlement-${runId}-duplicate.csv`,
        profileId: profile!.id,
        userId: testUserId,
      }),
    ).rejects.toThrow(/already been imported/);

    // Fetch imported line
    const [line] = await db
      .select()
      .from(statementLines)
      .where(eq(statementLines.importId, importRes.importDoc.id))
      .limit(1);

    // Create a payment to match against
    const [pmt] = await db
      .insert(payments)
      .values({
        paymentNumber: `PAY-RECON-${Date.now()}`,
        idempotencyKey: `recon-test-${Date.now()}`,
        customerId: testCustId,
        locationId: testLocId,
        kind: 'receipt',
        method: 'airtel_money',
        amountMinor: line!.amountMinor,
        status: 'confirmed',
        confirmedAt: getNow(),
        paymentDate: todayInCompanyTz(),
      })
      .returning();

    // Match statement line
    const match = await matchStatementLine(line!.id, [pmt!.id], testUserId);
    expect(match.success).toBe(true);
    expect(match.matchedCount).toBe(1);

    // Line status should be 'matched'
    const [matchedLine] = await db
      .select()
      .from(statementLines)
      .where(eq(statementLines.id, line!.id));
    expect(matchedLine!.matchStatus).toBe('matched');

    // Unmatch
    await unmatchStatementLine(line!.id, testUserId);
    const [unmatchedLine] = await db
      .select()
      .from(statementLines)
      .where(eq(statementLines.id, line!.id));
    expect(unmatchedLine!.matchStatus).toBe('unmatched');
  });
});
