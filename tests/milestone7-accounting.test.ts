/**
 * Milestone 7: General Ledger Accounting Export Tests (DRAFT ONLY).
 *
 * Verifies:
 *   1. Account Mappings: Standard placeholder accounts exist with is_placeholder = true.
 *   2. Balanced Batches: Every generated journal batch has Debits === Credits exactly.
 *   3. Event Deduplication: journal_source_events prevents any transaction from being batched twice.
 *   4. Append-Only Invariants: UPDATE and DELETE on journal_batches and journal_lines are blocked.
 *   5. CSV Export Format: Starts with UTF-8 BOM (\uFEFF) and contains DRAFT watermark.
 *   6. Formula Injection Escaping: Values starting with '=', '+', '-', '@' are escaped with leading quote.
 *   7. Re-export Controls: Re-exporting an already-exported batch requires manager authorization & reason.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '@/server/db';
import {
  journalBatches,
  journalLines,
  journalBatchExports,
  journalSourceEvents,
  accountMappings,
  salesDocuments,
  salesDocumentLines,
  customers,
  locations,
  users,
  roles,
} from '@/server/db/schema';
import { eq, sql, desc } from 'drizzle-orm';
import {
  createJournalBatch,
  seedDefaultAccountMappings,
} from '@/server/services/accounting/journal-engine';
import {
  exportJournalBatchToCsv,
  sanitizeCsvField,
} from '@/server/services/accounting/batch-export';

describe('Milestone 7: Accounting Export & General Ledger Invariants', () => {
  let testLocationId: string;
  let testCustomerId: string;
  let testManagerId: string;
  let createdBatchId: string;

  beforeAll(async () => {
    await seedDefaultAccountMappings(db);

    // 1. Setup test location
    const [loc] = await db
      .insert(locations)
      .values({
        name: `M7 Test Location ${Date.now()}`,
        code: `M7-LOC-${Date.now()}`,
        type: 'outlet',
      })
      .returning();
    testLocationId = loc!.id;

    // 2. Setup test customer
    const [cust] = await db
      .insert(customers)
      .values({
        name: `M7 Test Customer ${Date.now()}`,
        accountNumber: `M7-ACC-${Date.now()}`,
      })
      .returning();
    testCustomerId = cust!.id;

    // 3. Setup test manager
    const [mgrRole] = await db.select().from(roles).where(eq(roles.name, 'manager'));
    const [mgr] = await db
      .insert(users)
      .values({
        name: 'M7 Test Manager',
        email: `m7mgr_${Date.now()}@ace.co.mw`,
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=1$fakehash',
        roleId: mgrRole!.id,
        defaultLocationId: testLocationId,
      })
      .returning();
    testManagerId = mgr!.id;

    // 4. Create an issued invoice in the test period
    const docNumber = `INV-M7-${Date.now()}`;
    const [doc] = await db
      .insert(salesDocuments)
      .values({
        documentNumber: docNumber,
        documentType: 'invoice',
        customerId: testCustomerId,
        locationId: testLocationId,
        status: 'issued',
        issueDate: '2026-10-15',
        dueDate: '2026-10-15',
        currency: 'MWK',
        exchangeRate: '1.000000',
        subtotalMinor: 1000000, // MWK 10,000.00
        taxMinor: 175000,       // MWK 1,750.00 (17.5%)
        totalMinor: 1175000,    // MWK 11,750.00
        balanceMinor: 1175000,
      })
      .returning();

    // 5. Create a batch covering October 2026
    const batchResult = await createJournalBatch(
      new Date('2026-10-01T00:00:00Z'),
      new Date('2026-10-31T23:59:59Z'),
      testManagerId,
    );
    createdBatchId = batchResult.batchId;
  });

  it('1. Account Mappings: Standard placeholder accounts exist with is_placeholder = true', async () => {
    const mappings = await db.select().from(accountMappings);
    expect(mappings.length).toBeGreaterThanOrEqual(16);

    const arMapping = mappings.find(
      (m) => m.eventType === 'invoice.issued' && m.role === 'debit',
    );
    expect(arMapping).toBeDefined();
    expect(arMapping!.accountCode).toBe('1200');
    expect(arMapping!.isPlaceholder).toBe(true);

    const revMapping = mappings.find(
      (m) => m.eventType === 'invoice.issued' && m.role === 'credit',
    );
    expect(revMapping).toBeDefined();
    expect(revMapping!.accountCode).toBe('4000');
    expect(revMapping!.isPlaceholder).toBe(true);
  });

  it('2. Balanced Batches: Every journal batch satisfies Debits === Credits exactly', async () => {
    const [batch] = await db
      .select()
      .from(journalBatches)
      .where(eq(journalBatches.id, createdBatchId));

    expect(batch).toBeDefined();
    expect(batch!.isDraft).toBe(true);
    expect(batch!.totalDebitMinor).toBe(batch!.totalCreditMinor);
    expect(batch!.totalDebitMinor).toBeGreaterThan(0);

    // Sum individual lines from journal_lines table directly to verify DB state
    const lineSums = await db.execute<{ debits: string; credits: string }>(sql`
      SELECT
        COALESCE(SUM(debit_minor), 0)::text AS debits,
        COALESCE(SUM(credit_minor), 0)::text AS credits
      FROM journal_lines
      WHERE batch_id = ${createdBatchId}::uuid
    `);

    expect(lineSums.rows[0]?.debits).toBeDefined();
    expect(lineSums.rows[0]?.debits).toBe(lineSums.rows[0]?.credits);
  });

  it('3. Event Deduplication: journal_source_events prevents any transaction from being batched twice', async () => {
    // Generate a second batch for the exact same period
    const secondBatch = await createJournalBatch(
      new Date('2026-10-01T00:00:00Z'),
      new Date('2026-10-31T23:59:59Z'),
      testManagerId,
    );

    // Any already-batched invoices must not be processed again
    const linesInSecond = await db
      .select()
      .from(journalLines)
      .where(eq(journalLines.batchId, secondBatch.batchId));

    // Lines must be 0 for already batched events
    expect(linesInSecond.length).toBe(0);
    expect(secondBatch.totalDebitMinor).toBe(0);
    expect(secondBatch.totalCreditMinor).toBe(0);
  });

  it('4. Append-Only Database Triggers: Prohibits UPDATE and DELETE on journal_batches and journal_lines', async () => {
    // Direct SQL UPDATE on journal_batches financial amounts must fail
    await expect(
      db.execute(sql`
        UPDATE journal_batches SET total_debit_minor = 999999 WHERE id = ${createdBatchId}::uuid
      `),
    ).rejects.toThrow();

    // Direct SQL DELETE on journal_batches must fail
    await expect(
      db.execute(sql`
        DELETE FROM journal_batches WHERE id = ${createdBatchId}::uuid
      `),
    ).rejects.toThrow();

    // Direct SQL UPDATE on journal_lines must fail
    await expect(
      db.execute(sql`
        UPDATE journal_lines SET debit_minor = 0 WHERE batch_id = ${createdBatchId}::uuid
      `),
    ).rejects.toThrow();

    // Direct SQL DELETE on journal_lines must fail
    await expect(
      db.execute(sql`
        DELETE FROM journal_lines WHERE batch_id = ${createdBatchId}::uuid
      `),
    ).rejects.toThrow();
  });

  it('5. CSV Export Format: Starts with UTF-8 BOM (\\uFEFF) and contains DRAFT watermark', async () => {
    const exportRes = await exportJournalBatchToCsv(createdBatchId, testManagerId);

    expect(exportRes.isDraft).toBe(true);
    expect(exportRes.isBalanced).toBe(true);
    expect(exportRes.csvContent.startsWith('\uFEFF')).toBe(true);
    expect(exportRes.csvContent).toContain('DRAFT — ACCOUNT CODES ARE PLACEHOLDERS');
    expect(exportRes.csvContent).toContain('Balance Check: OK (Debits equal Credits)');
  });

  it('6. Formula Injection Escaping: Values starting with dangerous characters are escaped with leading quote', () => {
    expect(sanitizeCsvField('=SUM(A1:A10)')).toBe('"\'=SUM(A1:A10)"');
    expect(sanitizeCsvField('+12345')).toBe('"\'+\'12345"'.length > 0 ? '"\'+12345"' : '');
    expect(sanitizeCsvField('-12345')).toBe('"\'\-12345"'.length > 0 ? '"\'-12345"' : '');
    expect(sanitizeCsvField('@calc')).toBe('"\'@calc"');
    expect(sanitizeCsvField('Normal Text')).toBe('"Normal Text"');
  });

  it('7. Re-export Controls: Re-exporting an already-exported batch requires manager authorization & reason', async () => {
    // First export succeeds (done in test 5, so an export record now exists in journal_batch_exports)
    const priorExports = await db
      .select()
      .from(journalBatchExports)
      .where(eq(journalBatchExports.batchId, createdBatchId));
    expect(priorExports.length).toBeGreaterThan(0);
    expect(priorExports[0]?.exportType).toBe('initial');

    // Attempting re-export without manager approval must fail
    await expect(
      exportJournalBatchToCsv(createdBatchId, testManagerId),
    ).rejects.toThrow(/re-export requires manager approval and a stated reason/i);

    // Re-export with manager approval and reason succeeds
    const reExportRes = await exportJournalBatchToCsv(createdBatchId, testManagerId, {
      approvedByManagerId: testManagerId,
      reason: 'Downstream ERP import format reconciliation requested by Finance Director',
    });

    expect(reExportRes.isDraft).toBe(true);

    const exportsAfter = await db
      .select()
      .from(journalBatchExports)
      .where(eq(journalBatchExports.batchId, createdBatchId))
      .orderBy(desc(journalBatchExports.exportedAt));
    expect(exportsAfter.length).toBe(2);
    expect(exportsAfter[0]?.exportType).toBe('re_export');
    expect(exportsAfter[0]?.reExportApprovedBy).toBe(testManagerId);
    expect(exportsAfter[0]?.reExportReason).toBe(
      'Downstream ERP import format reconciliation requested by Finance Director',
    );
  });
});
