'use server';

import { revalidatePath } from 'next/cache';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import { posShifts, locations } from '@/server/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  openShift,
  closeShift,
  reviewShift,
  getXReport,
  getZReport,
} from '@/server/services/pos/shifts';
import {
  recordCashMovement,
  listCashMovements,
} from '@/server/services/pos/cash-movements';
import {
  createCounterSale,
  type CreateCounterSaleInput,
} from '@/server/services/pos/counter-sale';
import {
  createCounterReturn,
  type CreateCounterReturnInput,
} from '@/server/services/pos/counter-return';
import {
  holdSale,
  listHeldSales,
  recallHeldSale,
  discardHeldSale,
} from '@/server/services/pos/held-sales';
import { verifyManagerOverride } from '@/server/services/pos/override';
import {
  initiatePosMobileMoneyPrompt,
  checkPosMobileMoneyStatus,
  cancelPosMobileMoneyPrompt,
} from '@/server/services/pos/pos-mobile-money';

/**
 * Returns the currently active (open) shift for the logged-in cashier.
 */
export async function getCurrentShiftAction() {
  const actor = await authorize(PERMISSIONS.POS_ACCESS);

  const [shift] = await db
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
      locationCode: locations.code,
    })
    .from(posShifts)
    .innerJoin(locations, eq(posShifts.locationId, locations.id))
    .where(and(eq(posShifts.cashierId, actor.id), eq(posShifts.status, 'open')))
    .limit(1);

  if (!shift) return null;

  return {
    ...shift,
    openingFloatMinor: shift.openingFloatMinor.toString(),
  };
}

/**
 * Lists all active locations where a cashier can open a shift.
 */
export async function listLocationsAction() {
  await authorize(PERMISSIONS.POS_ACCESS);

  return await db
    .select({
      id: locations.id,
      name: locations.name,
      code: locations.code,
      type: locations.type,
    })
    .from(locations)
    .where(eq(locations.isActive, true));
}

/**
 * Opens a new POS shift for the current cashier.
 */
export async function openShiftAction(input: {
  locationId: string;
  openingFloatMinor: number | string | bigint;
  notes?: string;
}) {
  const actor = await authorize(PERMISSIONS.POS_ACCESS);

  const shift = await openShift(
    {
      cashierId: actor.id,
      locationId: input.locationId,
      openingFloatMinor: Number(input.openingFloatMinor),
      notes: input.notes,
    },
    actor.id,
  );

  revalidatePath('/pos');
  revalidatePath('/pos/shifts');

  return {
    success: true,
    shift: {
      ...shift,
      openingFloatMinor: shift.openingFloatMinor.toString(),
    },
  };
}

/**
 * Closes an active POS shift with counted cash and optional terminal totals.
 */
export async function closeShiftAction(input: {
  shiftId: string;
  countedCashMinor: number | string | bigint;
  denominationCount?: Record<string, number>;
  cardTerminalTotals?: Record<string, number>;
  notes?: string;
}) {
  const actor = await authorize(PERMISSIONS.POS_ACCESS);

  const terminalTotals = input.cardTerminalTotals
    ? Object.entries(input.cardTerminalTotals).map(([terminalId, batchTotalMinor]) => ({
        terminalId,
        batchTotalMinor: Number(batchTotalMinor),
      }))
    : undefined;

  const result = await closeShift(
    {
      shiftId: input.shiftId,
      cashierId: actor.id,
      countedCashMinor: Number(input.countedCashMinor),
      denominationCount: input.denominationCount,
      cardTerminalTotals: terminalTotals,
      notes: input.notes,
    },
    actor.id,
  );

  if (!result.shift) {
    throw new Error('Failed to close shift');
  }

  revalidatePath('/pos');
  revalidatePath('/pos/shifts');

  return {
    success: true,
    shift: {
      ...result.shift,
      openingFloatMinor: result.shift.openingFloatMinor.toString(),
      countedCashMinor: result.shift.countedCashMinor ? result.shift.countedCashMinor.toString() : null,
      expectedCashMinor: result.shift.expectedCashMinor ? result.shift.expectedCashMinor.toString() : null,
      cashVarianceMinor: result.shift.cashVarianceMinor ? result.shift.cashVarianceMinor.toString() : null,
    },
    figures: result.figures,
    varianceMinor: result.varianceMinor,
  };
}

/**
 * Reviews a closed shift (Manager action).
 */
export async function reviewShiftAction(input: {
  shiftId: string;
  reviewNote?: string;
}) {
  const actor = await authorize(PERMISSIONS.SHIFTS_MANAGE);

  const shift = await reviewShift({
    shiftId: input.shiftId,
    reviewerId: actor.id,
    reviewNote: input.reviewNote,
  });

  revalidatePath('/pos/shifts');

  return { success: true, shift };
}

/**
 * Records cash paid in or paid out during an active shift.
 */
export async function recordCashMovementAction(input: {
  shiftId: string;
  kind: 'paid_in' | 'paid_out';
  amountMinor: number | string | bigint;
  reason: string;
  overridePin?: string;
}) {
  const actor = await authorize(PERMISSIONS.POS_ACCESS);

  const movement = await recordCashMovement({
    shiftId: input.shiftId,
    kind: input.kind,
    amountMinor: Number(input.amountMinor),
    reason: input.reason,
    overridePin: input.overridePin,
    cashierUserId: actor.id,
  });

  revalidatePath('/pos');
  revalidatePath('/pos/shifts');

  return {
    success: true,
    movement: {
      ...movement,
      amountMinor: movement.amountMinor.toString(),
    },
  };
}

/**
 * Lists cash movements for a shift.
 */
export async function listCashMovementsAction(shiftId: string) {
  await authorize(PERMISSIONS.POS_ACCESS);
  const movements = await listCashMovements(shiftId);
  return movements.map((m) => ({
    ...m,
    amountMinor: m.amountMinor.toString(),
  }));
}

/**
 * Gets live X-Report for an active shift (respects blind cash-up rule).
 */
export async function getXReportAction(shiftId: string) {
  const actor = await authorize(PERMISSIONS.POS_ACCESS);
  return await getXReport(shiftId, {
    id: actor.id,
    roleName: actor.role.name,
    permissions: actor.role.permissions,
  });
}

/**
 * Gets Z-Report for a closed shift.
 */
export async function getZReportAction(shiftId: string) {
  const actor = await authorize(PERMISSIONS.POS_ACCESS);
  return await getZReport(shiftId, {
    id: actor.id,
    roleName: actor.role.name,
    permissions: actor.role.permissions,
  });
}

/**
 * Submits an atomic counter sale.
 */
export async function createCounterSaleAction(input: CreateCounterSaleInput) {
  const actor = await authorize(PERMISSIONS.POS_ACCESS);

  const sale = await createCounterSale(input, actor.id);

  revalidatePath('/pos');
  revalidatePath('/pos/shifts');

  return {
    success: true,
    sale: {
      ...sale.invoice,
      subtotalMinor: sale.invoice.subtotalMinor.toString(),
      taxMinor: sale.invoice.taxMinor.toString(),
      discountMinor: sale.invoice.discountMinor.toString(),
      totalMinor: sale.invoice.totalMinor.toString(),
      lines: sale.invoiceLines.map((l) => ({
        ...l,
        unitPriceMinor: l.unitPriceMinor.toString(),
        discountMinor: l.discountMinor.toString(),
        taxMinor: l.taxMinor.toString(),
        lineTotalMinor: l.lineTotalMinor.toString(),
      })),
      payments: sale.payments.map((p) => ({
        ...p.payment,
        amountMinor: p.payment.amountMinor.toString(),
      })),
      changeMinor: sale.changeMinor,
      isDuplicate: sale.isDuplicate,
    },
  };
}

/**
 * Submits an atomic counter return and refund.
 */
export async function createCounterReturnAction(input: CreateCounterReturnInput) {
  const actor = await authorize(PERMISSIONS.POS_ACCESS);

  const result = await createCounterReturn(input, actor.id);

  revalidatePath('/pos');
  revalidatePath('/pos/returns');
  revalidatePath('/pos/shifts');

  return {
    success: true,
    creditNote: {
      ...result.creditNote,
      totalMinor: result.creditNote.totalMinor.toString(),
    },
    refundPayment: {
      ...result.refund.payment,
      amountMinor: result.refund.payment.amountMinor.toString(),
    },
  };
}

/**
 * Holds a cart in progress.
 */
export async function holdSaleAction(input: {
  shiftId: string;
  holdReference: string;
  customerId?: string;
  cartPayload: unknown;
}) {
  const actor = await authorize(PERMISSIONS.POS_ACCESS);

  const held = await holdSale({
    shiftId: input.shiftId,
    holdReference: input.holdReference,
    customerId: input.customerId,
    cartPayload: input.cartPayload as any,
    userId: actor.id,
  });

  return { success: true, heldSale: held };
}

/**
 * Lists all held sales for a shift.
 */
export async function listHeldSalesAction(shiftId: string) {
  await authorize(PERMISSIONS.POS_ACCESS);
  return await listHeldSales(shiftId);
}

/**
 * Recalls and re-prices a held sale cart.
 */
export async function recallHeldSaleAction(heldSaleId: string) {
  await authorize(PERMISSIONS.POS_ACCESS);
  return await recallHeldSale(heldSaleId);
}

/**
 * Discards a held sale.
 */
export async function discardHeldSaleAction(heldSaleId: string) {
  await authorize(PERMISSIONS.POS_ACCESS);
  await discardHeldSale(heldSaleId);
  return { success: true };
}

/**
 * Verifies a 6-digit manager PIN for an override.
 */
export async function verifyManagerOverrideAction(input: {
  pin: string;
  action: string;
  reason?: string;
}) {
  const actor = await authorize(PERMISSIONS.POS_ACCESS);

  const result = await verifyManagerOverride({
    pin: input.pin,
    cashierUserId: actor.id,
    action: input.action,
    reason: input.reason,
  });

  return result;
}

/**
 * Initiates an Airtel Money or TNM Mpamba push prompt at the counter.
 */
export async function initiatePosMobileMoneyAction(input: {
  shiftId: string;
  locationId: string;
  customerId?: string;
  method: 'airtel_money' | 'mpamba';
  phone: string;
  amountMinor: number;
}) {
  const actor = await authorize(PERMISSIONS.POS_ACCESS);

  return await initiatePosMobileMoneyPrompt({
    shiftId: input.shiftId,
    locationId: input.locationId,
    cashierId: actor.id,
    customerId: input.customerId,
    method: input.method,
    phone: input.phone,
    amountMinor: input.amountMinor,
  });
}

/**
 * Checks the status of a pending POS mobile money push prompt.
 */
export async function checkPosMobileMoneyStatusAction(paymentId: string) {
  await authorize(PERMISSIONS.POS_ACCESS);
  return await checkPosMobileMoneyStatus(paymentId);
}

/**
 * Cancels a pending POS mobile money prompt.
 */
export async function cancelPosMobileMoneyAction(input: {
  paymentId: string;
  reason: string;
}) {
  const actor = await authorize(PERMISSIONS.POS_ACCESS);
  await cancelPosMobileMoneyPrompt(input.paymentId, input.reason, actor.id);
  return { success: true };
}
