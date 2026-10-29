/**
 * POS Shift Service.
 *
 * Manages cashier shifts, blind cash-up calculations, X-Reports, Z-Reports,
 * and manager reviews.
 */

import { db, type DbTransaction } from '@/server/db';
import {
  posShifts,
  cashMovements,
  heldSales,
  payments,
  salesDocuments,
  users,
  locations,
} from '@/server/db/schema';
import { eq, and, sql, desc, asc } from 'drizzle-orm';
import { nextSequenceNumber } from '@/server/services/sequences';
import { writeAuditLog } from '@/server/services/audit';
import { getNow, todayInCompanyTz } from '@/lib/timezone';
import { getSetting } from '@/server/services/settings';
import { PERMISSIONS } from '@/lib/permissions';

export interface OpenShiftInput {
  cashierId: string;
  locationId: string;
  openingFloatMinor?: number;
  notes?: string;
}

export interface CloseShiftInput {
  shiftId: string;
  cashierId: string;
  countedCashMinor: number;
  denominationCount?: Record<string, number>;
  cardTerminalTotals?: Array<{ terminalId: string; batchTotalMinor: number }>;
  notes?: string;
}

export interface ReviewShiftInput {
  shiftId: string;
  reviewerId: string;
  reviewNote?: string;
}

/**
 * Returns the active open shift for a cashier, if one exists.
 */
export async function getCurrentShift(cashierId: string, locationId?: string) {
  const query = db
    .select({
      id: posShifts.id,
      shiftNumber: posShifts.shiftNumber,
      cashierId: posShifts.cashierId,
      locationId: posShifts.locationId,
      status: posShifts.status,
      openedAt: posShifts.openedAt,
      openingFloatMinor: posShifts.openingFloatMinor,
      notes: posShifts.notes,
      locationName: locations.name,
      cashierName: users.name,
    })
    .from(posShifts)
    .innerJoin(locations, eq(posShifts.locationId, locations.id))
    .innerJoin(users, eq(posShifts.cashierId, users.id))
    .where(
      locationId
        ? and(eq(posShifts.cashierId, cashierId), eq(posShifts.status, 'open'), eq(posShifts.locationId, locationId))
        : and(eq(posShifts.cashierId, cashierId), eq(posShifts.status, 'open')),
    )
    .limit(1);

  const [row] = await query;
  return row ?? null;
}

/**
 * Opens a new shift for the cashier.
 * Enforces:
 * - Cashier can only have one open shift at any time.
 * - Gap-free sequential shift numbering via nextSequenceNumber.
 */
export async function openShift(input: OpenShiftInput, userId?: string) {
  const openingFloatMinor = Math.max(0, Math.floor(input.openingFloatMinor ?? 0));

  return await db.transaction(async (tx) => {
    // 1. Check existing open shift for this cashier
    const [existingOpen] = await tx
      .select({ id: posShifts.id, shiftNumber: posShifts.shiftNumber })
      .from(posShifts)
      .where(and(eq(posShifts.cashierId, input.cashierId), eq(posShifts.status, 'open')))
      .for('update');

    if (existingOpen) {
      throw new Error(
        `Cashier already has an active open shift (${existingOpen.shiftNumber}). Please close it before opening a new one.`,
      );
    }

    // 2. Generate sequential shift number under lock
    const shiftNumber = await nextSequenceNumber(tx, 'shift', input.locationId);

    // 3. Create shift row
    const [shift] = await tx
      .insert(posShifts)
      .values({
        shiftNumber,
        cashierId: input.cashierId,
        locationId: input.locationId,
        status: 'open',
        openingFloatMinor,
        openedAt: getNow(),
        notes: input.notes ?? null,
      })
      .returning();

    if (!shift) {
      throw new Error('Failed to open shift');
    }

    await writeAuditLog(tx, {
      userId: userId ?? input.cashierId,
      action: 'pos.shift.open',
      entityType: 'pos_shift',
      entityId: shift.id,
      after: {
        shiftNumber: shift.shiftNumber,
        locationId: shift.locationId,
        openingFloatMinor: shift.openingFloatMinor,
      },
    });

    return shift;
  });
}

/**
 * Computes live expected cash for a shift:
 * expected_cash = opening_float + cash_receipts - cash_refunds + cash_paid_in - cash_paid_out
 */
export async function computeShiftFinancialTotals(shiftId: string, tx: DbTransaction) {
  // 1. Get shift opening float
  const [shift] = await tx
    .select({
      openingFloatMinor: posShifts.openingFloatMinor,
      locationId: posShifts.locationId,
    })
    .from(posShifts)
    .where(eq(posShifts.id, shiftId));

  if (!shift) throw new Error(`Shift ${shiftId} not found`);

  // 2. Payments on this shift
  const paymentsOnShift = await tx
    .select({
      method: payments.method,
      kind: payments.kind,
      amountMinor: payments.amountMinor,
      status: payments.status,
    })
    .from(payments)
    .where(and(eq(payments.shiftId, shiftId), eq(payments.status, 'confirmed')));

  let cashReceiptsMinor = 0;
  let cashRefundsMinor = 0;
  let cardReceiptsMinor = 0;
  let cardRefundsMinor = 0;
  let mobileMoneyReceiptsMinor = 0;
  let mobileMoneyRefundsMinor = 0;
  let otherReceiptsMinor = 0;

  for (const p of paymentsOnShift) {
    const amt = Number(p.amountMinor);
    if (p.method === 'cash') {
      if (p.kind === 'receipt') cashReceiptsMinor += amt;
      else if (p.kind === 'refund') cashRefundsMinor += amt;
    } else if (p.method === 'card') {
      if (p.kind === 'receipt') cardReceiptsMinor += amt;
      else if (p.kind === 'refund') cardRefundsMinor += amt;
    } else if (p.method === 'airtel_money' || p.method === 'mpamba') {
      if (p.kind === 'receipt') mobileMoneyReceiptsMinor += amt;
      else if (p.kind === 'refund') mobileMoneyRefundsMinor += amt;
    } else {
      if (p.kind === 'receipt') otherReceiptsMinor += amt;
    }
  }

  // 3. Cash movements on this shift
  const movements = await tx
    .select({
      kind: cashMovements.kind,
      amountMinor: cashMovements.amountMinor,
    })
    .from(cashMovements)
    .where(eq(cashMovements.shiftId, shiftId));

  let cashPaidInMinor = 0;
  let cashPaidOutMinor = 0;

  for (const m of movements) {
    const amt = Number(m.amountMinor);
    if (m.kind === 'paid_in') cashPaidInMinor += amt;
    else if (m.kind === 'paid_out') cashPaidOutMinor += amt;
  }

  const expectedCashMinor =
    Number(shift.openingFloatMinor) +
    cashReceiptsMinor -
    cashRefundsMinor +
    cashPaidInMinor -
    cashPaidOutMinor;

  return {
    openingFloatMinor: Number(shift.openingFloatMinor),
    cashReceiptsMinor,
    cashRefundsMinor,
    cardReceiptsMinor,
    cardRefundsMinor,
    mobileMoneyReceiptsMinor,
    mobileMoneyRefundsMinor,
    otherReceiptsMinor,
    cashPaidInMinor,
    cashPaidOutMinor,
    expectedCashMinor,
    netSalesMinor:
      cashReceiptsMinor -
      cashRefundsMinor +
      cardReceiptsMinor -
      cardRefundsMinor +
      mobileMoneyReceiptsMinor -
      mobileMoneyRefundsMinor +
      otherReceiptsMinor,
  };
}

/**
 * Closes an open shift.
 * The cashier enters their counted cash (blindly if configured).
 * Calculates expected cash and variance atomically.
 */
export async function closeShift(input: CloseShiftInput, userId?: string) {
  const countedCashMinor = Math.floor(input.countedCashMinor);
  if (isNaN(countedCashMinor) || countedCashMinor < 0) {
    throw new Error('Counted cash must be a non-negative number');
  }

  return await db.transaction(async (tx) => {
    // 1. Lock shift row FOR UPDATE
    const [shift] = await tx
      .select()
      .from(posShifts)
      .where(eq(posShifts.id, input.shiftId))
      .for('update');

    if (!shift) throw new Error('Shift not found');
    if (shift.status !== 'open') {
      throw new Error(`Cannot close shift in status '${shift.status}'`);
    }
    if (shift.cashierId !== input.cashierId) {
      throw new Error('Only the assigned cashier can close this shift');
    }

    // 2. Compute expected figures
    const figures = await computeShiftFinancialTotals(shift.id, tx);
    const cashVarianceMinor = countedCashMinor - figures.expectedCashMinor;

    // 3. Update shift to closed
    const [closedShift] = await tx
      .update(posShifts)
      .set({
        status: 'closed',
        closedAt: getNow(),
        countedCashMinor,
        denominationCount: input.denominationCount ?? null,
        cardTerminalTotals: input.cardTerminalTotals ?? null,
        expectedCashMinor: figures.expectedCashMinor,
        cashVarianceMinor,
        notes: input.notes ?? shift.notes,
        updatedAt: getNow(),
      })
      .where(eq(posShifts.id, shift.id))
      .returning();

    // 4. Cascade delete any remaining held sales for this shift
    await tx.delete(heldSales).where(eq(heldSales.shiftId, shift.id));

    await writeAuditLog(tx, {
      userId: userId ?? input.cashierId,
      action: 'pos.shift.close',
      entityType: 'pos_shift',
      entityId: shift.id,
      after: {
        shiftNumber: shift.shiftNumber,
        countedCashMinor,
        expectedCashMinor: figures.expectedCashMinor,
        cashVarianceMinor,
      },
    });

    return {
      shift: closedShift,
      figures,
      varianceMinor: cashVarianceMinor,
    };
  });
}

/**
 * Manager review of a closed shift.
 * Enforces reviewNote is provided if there is any variance.
 */
export async function reviewShift(input: ReviewShiftInput) {
  const { shiftId, reviewerId, reviewNote } = input;

  return await db.transaction(async (tx) => {
    const [shift] = await tx
      .select()
      .from(posShifts)
      .where(eq(posShifts.id, shiftId))
      .for('update');

    if (!shift) throw new Error('Shift not found');
    if (shift.status !== 'closed') {
      throw new Error(`Only closed shifts can be reviewed (current status: '${shift.status}')`);
    }

    const variance = Number(shift.cashVarianceMinor ?? 0);
    if (variance !== 0 && (!reviewNote || reviewNote.trim() === '')) {
      throw new Error('A review note is required when there is a cash variance');
    }

    const [reviewed] = await tx
      .update(posShifts)
      .set({
        status: 'reviewed',
        reviewedAt: getNow(),
        reviewedBy: reviewerId,
        reviewNote: reviewNote?.trim() ?? null,
        updatedAt: getNow(),
      })
      .where(eq(posShifts.id, shiftId))
      .returning();

    await writeAuditLog(tx, {
      userId: reviewerId,
      action: 'pos.shift.review',
      entityType: 'pos_shift',
      entityId: shiftId,
      after: {
        shiftNumber: shift.shiftNumber,
        status: 'reviewed',
        variance,
        reviewNote,
      },
    });

    return reviewed;
  });
}

/**
 * Generates an X-Report for an ongoing shift.
 * If pos_blind_cash_up is active and requesting user is the cashier,
 * hides cash totals and expected cash.
 */
export async function getXReport(shiftId: string, requestingUser: { id: string; roleName: string; permissions: string[] }) {
  const [shift] = await db
    .select({
      id: posShifts.id,
      shiftNumber: posShifts.shiftNumber,
      cashierId: posShifts.cashierId,
      cashierName: users.name,
      locationId: posShifts.locationId,
      locationName: locations.name,
      status: posShifts.status,
      openedAt: posShifts.openedAt,
      openingFloatMinor: posShifts.openingFloatMinor,
    })
    .from(posShifts)
    .innerJoin(users, eq(posShifts.cashierId, users.id))
    .innerJoin(locations, eq(posShifts.locationId, locations.id))
    .where(eq(posShifts.id, shiftId));

  if (!shift) throw new Error('Shift not found');

  const figures = await db.transaction(async (tx) => {
    return await computeShiftFinancialTotals(shift.id, tx);
  });

  // Sales count on this shift
  const [salesCountRes] = await db
    .select({
      count: sql<string>`COUNT(*)`,
      totalMinor: sql<string>`COALESCE(SUM(${salesDocuments.totalMinor}), 0)`,
    })
    .from(salesDocuments)
    .where(and(eq(salesDocuments.shiftId, shiftId), eq(salesDocuments.status, 'issued')));

  // Check blind cash-up
  const blindSetting = await getSetting('pos_blind_cash_up');
  const isBlind = Boolean(blindSetting);
  const isManager =
    requestingUser.roleName === 'admin' ||
    requestingUser.permissions.includes(PERMISSIONS.SHIFTS_MANAGE) ||
    requestingUser.permissions.includes(PERMISSIONS.POS_OVERRIDE);

  const shouldHideCash = isBlind && !isManager;

  return {
    reportType: 'X-REPORT',
    shift: {
      id: shift.id,
      shiftNumber: shift.shiftNumber,
      cashierName: shift.cashierName,
      locationName: shift.locationName,
      openedAt: shift.openedAt,
      generatedAt: getNow(),
    },
    sales: {
      transactionCount: parseInt(salesCountRes?.count ?? '0', 10),
      grossSalesMinor: shouldHideCash ? null : figures.netSalesMinor,
    },
    cash: {
      openingFloatMinor: shouldHideCash ? null : figures.openingFloatMinor,
      cashReceiptsMinor: shouldHideCash ? null : figures.cashReceiptsMinor,
      cashRefundsMinor: shouldHideCash ? null : figures.cashRefundsMinor,
      paidInMinor: shouldHideCash ? null : figures.cashPaidInMinor,
      paidOutMinor: shouldHideCash ? null : figures.cashPaidOutMinor,
      expectedCashMinor: shouldHideCash ? null : figures.expectedCashMinor,
    },
    nonCash: {
      cardReceiptsMinor: figures.cardReceiptsMinor,
      cardRefundsMinor: figures.cardRefundsMinor,
      mobileMoneyReceiptsMinor: figures.mobileMoneyReceiptsMinor,
      mobileMoneyRefundsMinor: figures.mobileMoneyRefundsMinor,
    },
    isBlindCashUp: shouldHideCash,
  };
}

/**
 * Generates a Z-Report for a closed or reviewed shift.
 */
export async function getZReport(shiftId: string, requestingUser: { id: string; roleName: string; permissions: string[] }) {
  const [shift] = await db
    .select({
      id: posShifts.id,
      shiftNumber: posShifts.shiftNumber,
      cashierId: posShifts.cashierId,
      cashierName: users.name,
      locationId: posShifts.locationId,
      locationName: locations.name,
      status: posShifts.status,
      openedAt: posShifts.openedAt,
      closedAt: posShifts.closedAt,
      reviewedAt: posShifts.reviewedAt,
      reviewedBy: posShifts.reviewedBy,
      reviewNote: posShifts.reviewNote,
      openingFloatMinor: posShifts.openingFloatMinor,
      countedCashMinor: posShifts.countedCashMinor,
      expectedCashMinor: posShifts.expectedCashMinor,
      cashVarianceMinor: posShifts.cashVarianceMinor,
      cardTerminalTotals: posShifts.cardTerminalTotals,
      denominationCount: posShifts.denominationCount,
      notes: posShifts.notes,
    })
    .from(posShifts)
    .innerJoin(users, eq(posShifts.cashierId, users.id))
    .innerJoin(locations, eq(posShifts.locationId, locations.id))
    .where(eq(posShifts.id, shiftId));

  if (!shift) throw new Error('Shift not found');
  if (shift.status === 'open') {
    throw new Error('Z-Report is only available for closed or reviewed shifts');
  }

  // Permissions check: cashier can view their own Z-report; managers can view all
  const isOwner = shift.cashierId === requestingUser.id;
  const isManager =
    requestingUser.roleName === 'admin' ||
    requestingUser.permissions.includes(PERMISSIONS.SHIFTS_MANAGE);

  if (!isOwner && !isManager) {
    throw new Error('Access denied: You do not have permission to view this Z-Report');
  }

  const figures = await db.transaction(async (tx) => {
    return await computeShiftFinancialTotals(shift.id, tx);
  });

  const [salesCountRes] = await db
    .select({
      count: sql<string>`COUNT(*)`,
      totalMinor: sql<string>`COALESCE(SUM(${salesDocuments.totalMinor}), 0)`,
    })
    .from(salesDocuments)
    .where(and(eq(salesDocuments.shiftId, shiftId), eq(salesDocuments.status, 'issued')));

  return {
    reportType: 'Z-REPORT',
    shift: {
      id: shift.id,
      shiftNumber: shift.shiftNumber,
      cashierName: shift.cashierName,
      locationName: shift.locationName,
      status: shift.status,
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      reviewedAt: shift.reviewedAt,
      reviewNote: shift.reviewNote,
    },
    sales: {
      transactionCount: parseInt(salesCountRes?.count ?? '0', 10),
      netSalesMinor: figures.netSalesMinor,
    },
    reconciliation: {
      openingFloatMinor: Number(shift.openingFloatMinor),
      cashReceiptsMinor: figures.cashReceiptsMinor,
      cashRefundsMinor: figures.cashRefundsMinor,
      paidInMinor: figures.cashPaidInMinor,
      paidOutMinor: figures.cashPaidOutMinor,
      expectedCashMinor: Number(shift.expectedCashMinor),
      countedCashMinor: Number(shift.countedCashMinor),
      cashVarianceMinor: Number(shift.cashVarianceMinor),
      denominationCount: shift.denominationCount,
      cardTerminalTotals: shift.cardTerminalTotals,
    },
    paymentBreakdown: {
      cashNetMinor: figures.cashReceiptsMinor - figures.cashRefundsMinor,
      cardNetMinor: figures.cardReceiptsMinor - figures.cardRefundsMinor,
      mobileMoneyNetMinor: figures.mobileMoneyReceiptsMinor - figures.mobileMoneyRefundsMinor,
      otherNetMinor: figures.otherReceiptsMinor,
    },
  };
}
