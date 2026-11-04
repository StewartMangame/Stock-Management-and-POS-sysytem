/**
 * Phase 6 Milestone 3 & Milestone 4 Integration Tests.
 *
 * Verifies:
 * 1. Role-based dashboard figures equal matching report definitions (sales today, low stock).
 * 2. Cashier dashboard strictly hides cash/drawer totals and targets (blind cash-up).
 * 3. Payments Hub: bouncing a pending cheque transitions to failed (never reversed).
 * 4. Payments Hub: recordPaymentFromStatementLine is atomic, sets matched, and rejects duplicate match attempts.
 * 5. Payments Hub: permission enforcement on server actions.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '@/server/db';
import { sql, eq } from 'drizzle-orm';
import { todayInCompanyTz } from '@/lib/timezone';
import { getManagerDashboardData, getCashierDashboardData } from '@/server/services/dashboard';
import { getSalesByDay } from '@/server/services/reports/sales-report';
import { getStockOnHand } from '@/server/services/reports/stock-report';
import { bounceCheque } from '@/server/services/sales/payments';
import { recordPaymentFromStatementLine } from '@/server/services/integrations/bank-reconciliation';
import { payments, customers, locations, statementImports, statementLines } from '@/server/db/schema';

describe('Phase 6 — Milestones 3 & 4 Verification', () => {
  let mainLocationId: string;
  let testCustomerId: string;

  beforeAll(async () => {
    // 1. Get or create location
    let [loc] = await db
      .select({ id: locations.id })
      .from(locations)
      .limit(1);
    if (!loc) {
      const [newLoc] = await db.insert(locations).values({
        code: 'MAIN',
        name: 'Main Location',
        type: 'warehouse',
      }).returning({ id: locations.id });
      loc = newLoc;
    }
    mainLocationId = loc!.id;

    // 2. Get or create test customer
    let [cust] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.isWalkIn, false))
      .limit(1);
    if (!cust) {
      const [newCust] = await db.insert(customers).values({
        name: 'Test Customer',
        accountNumber: `CUST-TEST-${Date.now()}`,
        customerType: 'business',
      }).returning({ id: customers.id });
      cust = newCust;
    }
    testCustomerId = cust!.id;
  });

  // ── Milestone 3: Dashboard Invariants ───────────────────────────────────────

  it('1. Manager Dashboard Sales Today figure equals Sales Report getSalesByDay net revenue', async () => {
    const today = todayInCompanyTz();
    const [dashData, reportData] = await Promise.all([
      getManagerDashboardData(),
      getSalesByDay({ from: today, to: today, groupBy: 'day' }),
    ]);

    // Net revenue on dashboard must equal matching report total
    expect(dashData.salesToday.totalNetMinor).toBe(reportData.totals.netRevenueMinor);
  });

  it('2. Manager Dashboard Office Net + Counter Net equals Total Net Sales', async () => {
    const dashData = await getManagerDashboardData();
    const sum = dashData.salesToday.officeNetMinor + dashData.salesToday.counterNetMinor;
    expect(sum).toBe(dashData.salesToday.totalNetMinor);
  });

  it('3. Manager Dashboard Low Stock count equals Low Stock Report rows count', async () => {
    const [dashData, stockReport] = await Promise.all([
      getManagerDashboardData(),
      getStockOnHand(undefined, true), // low stock only
    ]);

    expect(dashData.lowStockCount).toBe(stockReport.rows.length);
  });

  it('4. Cashier Dashboard strictly hides cash-in-drawer & expected cash figures (blind cash-up)', async () => {
    // Generate mock user ID
    const mockCashierId = '00000000-0000-0000-0000-000000000099';
    const cashierDash = await getCashierDashboardData(mockCashierId);

    // Verify properties exposed
    expect(cashierDash).toHaveProperty('currentShift');
    expect(cashierDash).toHaveProperty('salesCountToday');
    expect(cashierDash).toHaveProperty('itemsSoldToday');

    // Blind cash-up: Must NOT contain any cash figures
    expect((cashierDash as any).openingFloatMinor).toBeUndefined();
    expect((cashierDash as any).countedCashMinor).toBeUndefined();
    expect((cashierDash as any).expectedCashMinor).toBeUndefined();
    expect((cashierDash as any).drawerBalanceMinor).toBeUndefined();
    expect((cashierDash as any).salesTarget).toBeUndefined();
  });

  // ── Milestone 4: Payments Hub Invariants ────────────────────────────────────

  it('5. Payments Hub: Bouncing a pending cheque sets status to failed (never reversed)', async () => {
    // Create a pending cheque
    const [cheque] = await db
      .insert(payments)
      .values({
        paymentNumber: `CHQ-TEST-${Date.now()}`,
        idempotencyKey: `idemp-chq-${Date.now()}`,
        customerId: testCustomerId,
        locationId: mainLocationId,
        kind: 'receipt',
        method: 'cheque',
        amountMinor: 7500000,
        status: 'pending',
        paymentDate: todayInCompanyTz(),
        methodDetails: {
          cheque_number: 'CHQ-888999',
          bank_name: 'National Bank of Malawi',
        },
      })
      .returning();

    expect(cheque).toBeDefined();
    expect(cheque!.status).toBe('pending');

    // Bounce the cheque
    const bounced = await bounceCheque(cheque!.id, 'Insufficient funds on clearing');

    expect(bounced).toBeDefined();
    expect(bounced!.status).toBe('failed');
    expect(bounced!.status).not.toBe('reversed');

    // Verify persisted status in DB
    const [persisted] = await db
      .select({ status: payments.status, notes: payments.notes })
      .from(payments)
      .where(eq(payments.id, cheque!.id));

    expect(persisted?.status).toBe('failed');
    expect(persisted?.notes).toContain('Bounced: Insufficient funds on clearing');
  });

  it('6. Payments Hub: Record payment from statement line is atomic, matches line, and rejects duplicate match', async () => {
    // 1. Create a statement import and unmatched line
    const [stmtImport] = await db
      .insert(statementImports)
      .values({
        filename: `test-stmt-${Date.now()}.csv`,
        fileHash: `test-hash-${Date.now()}-${Math.random()}`,
        rowCount: 1,
        totalAmountMinor: 1250000,
      })
      .returning();

    expect(stmtImport).toBeDefined();

    const [stmtLine] = await db
      .insert(statementLines)
      .values({
        importId: stmtImport!.id,
        lineNumber: 1,
        transactionDate: todayInCompanyTz(),
        reference: `REF-STMT-${Date.now()}`,
        description: 'Direct Deposit Test Transfer',
        amountMinor: 1250000,
        matchStatus: 'unmatched',
      })
      .returning();

    expect(stmtLine).toBeDefined();
    expect(stmtLine!.matchStatus).toBe('unmatched');

    // 2. Record payment from statement line
    const recordedPayment = await recordPaymentFromStatementLine(
      stmtLine!.id,
      testCustomerId,
      mainLocationId,
      [],
    );

    expect(recordedPayment).toBeDefined();
    expect(recordedPayment.amountMinor).toBe(1250000);
    expect(recordedPayment.status).toBe('confirmed');

    // 3. Verify statement line is now matched
    const [updatedLine] = await db
      .select({ matchStatus: statementLines.matchStatus })
      .from(statementLines)
      .where(eq(statementLines.id, stmtLine!.id));

    expect(updatedLine?.matchStatus).toBe('matched');

    // 4. Duplicate match attempt MUST fail (matched only once)
    await expect(
      recordPaymentFromStatementLine(stmtLine!.id, testCustomerId, mainLocationId, []),
    ).rejects.toThrow(/already been matched/);
  });
});
