/**
 * Cash Movements Service (Paid In / Paid Out).
 *
 * Implements:
 * - Append-only paid_in and paid_out operations.
 * - Shift row locked FOR SHARE during creation.
 * - Enforces shift must be 'open'.
 * - Manager override verification if required.
 * - Audit logging.
 */

import { db } from '@/server/db';
import { cashMovements, posShifts, users } from '@/server/db/schema';
import { eq, asc, desc } from 'drizzle-orm';
import { writeAuditLog } from '@/server/services/audit';
import { verifyManagerOverride } from './override';
import { getNow } from '@/lib/timezone';

export interface RecordCashMovementInput {
  shiftId: string;
  kind: 'paid_in' | 'paid_out';
  amountMinor: number;
  reason: string;
  requiresOverride?: boolean;
  overridePin?: string;
  cashierUserId: string;
}

export async function recordCashMovement(input: RecordCashMovementInput) {
  const { shiftId, kind, reason, cashierUserId, overridePin } = input;
  const amountMinor = Math.floor(input.amountMinor);

  if (isNaN(amountMinor) || amountMinor <= 0) {
    throw new Error('Cash movement amount must be greater than zero');
  }

  if (!reason || reason.trim() === '') {
    throw new Error('A reason is required for cash movements');
  }

  // If requires override (or any paid_out), verify manager PIN before opening transaction
  const needsOverride = Boolean(input.requiresOverride || kind === 'paid_out');
  let approvedBy: string | null = null;

  if (needsOverride) {
    if (!overridePin) {
      throw new Error('Manager PIN is required for this cash movement');
    }
    const override = await verifyManagerOverride({
      pin: overridePin,
      cashierUserId,
      action: `cash_movement.${kind}`,
      reason,
      metadata: { shiftId, amountMinor },
    });
    approvedBy = override.approverId;
  }

  return await db.transaction(async (tx) => {
    // Lock shift row FOR SHARE
    const [shift] = await tx
      .select({ id: posShifts.id, status: posShifts.status, shiftNumber: posShifts.shiftNumber })
      .from(posShifts)
      .where(eq(posShifts.id, shiftId))
      .for('share');

    if (!shift) throw new Error('Shift not found');
    if (shift.status !== 'open') {
      throw new Error(`Cash movements are not permitted on a ${shift.status} shift`);
    }

    const [movement] = await tx
      .insert(cashMovements)
      .values({
        shiftId,
        kind,
        amountMinor,
        reason: reason.trim(),
        approvedBy,
        requiresOverride: needsOverride,
        createdAt: getNow(),
        createdBy: cashierUserId,
      })
      .returning();

    if (!movement) {
      throw new Error('Failed to record cash movement');
    }

    await writeAuditLog(tx, {
      userId: cashierUserId,
      action: `pos.cash_movement.${kind}`,
      entityType: 'cash_movement',
      entityId: movement.id,
      after: {
        shiftId,
        shiftNumber: shift.shiftNumber,
        kind,
        amountMinor,
        reason: movement.reason,
        approvedBy,
      },
    });

    return movement;
  });
}

/**
 * Lists all cash movements on a given shift.
 */
export async function listCashMovements(shiftId: string) {
  return await db
    .select({
      id: cashMovements.id,
      shiftId: cashMovements.shiftId,
      kind: cashMovements.kind,
      amountMinor: cashMovements.amountMinor,
      reason: cashMovements.reason,
      requiresOverride: cashMovements.requiresOverride,
      createdAt: cashMovements.createdAt,
      createdBy: cashMovements.createdBy,
      createdByName: users.name,
    })
    .from(cashMovements)
    .leftJoin(users, eq(cashMovements.createdBy, users.id))
    .where(eq(cashMovements.shiftId, shiftId))
    .orderBy(asc(cashMovements.createdAt));
}
