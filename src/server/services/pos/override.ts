/**
 * POS Manager Override Service.
 *
 * Enforces:
 * - 6-digit numeric PIN.
 * - Approver must be an active user with 'pos:override' permission.
 * - Approver must NOT be the cashier requesting the override.
 * - PIN is locked for 15 minutes after 5 failed attempts.
 * - Every attempt (successful or failed) is recorded in audit_log.
 * - Verified BEFORE opening the database transaction.
 */

import { db } from '@/server/db';
import { users, roles } from '@/server/db/schema';
import { eq, sql } from 'drizzle-orm';
import { hash, verify } from '@node-rs/argon2';
import { writeAuditLog } from '@/server/services/audit';
import { getNow } from '@/lib/timezone';
import { PERMISSIONS } from '@/lib/permissions';

const ARGON2_PIN_OPTIONS = {
  memoryCost: 19456, // 19 MiB for fast interactive PIN checking
  timeCost: 2,
  parallelism: 1,
};

const MAX_PIN_FAILURES = 5;
const LOCKOUT_MINUTES = 15;

export interface VerifyOverrideInput {
  pin: string;
  cashierUserId: string;
  action: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface VerifyOverrideResult {
  approverId: string;
  approverName: string;
}

/**
 * Sets or updates a 6-digit POS PIN for a user.
 */
export async function setUserPin(userId: string, pin: string): Promise<void> {
  if (!/^\d{6}$/.test(pin)) {
    throw new Error('PIN must be exactly 6 digits');
  }

  const pinHash = await hash(pin, ARGON2_PIN_OPTIONS);

  await db
    .update(users)
    .set({
      pinHash,
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      updatedAt: getNow(),
    })
    .where(eq(users.id, userId));
}

/**
 * Verifies a manager PIN for a POS override.
 * Throws an informative error if verification fails or account is locked.
 */
export async function verifyManagerOverride(
  input: VerifyOverrideInput,
): Promise<VerifyOverrideResult> {
  const { pin, cashierUserId, action, reason, metadata } = input;

  if (!pin || !/^\d{6}$/.test(pin)) {
    await writeAuditLog(db, {
      userId: cashierUserId,
      action: 'pos.override.failed',
      entityType: 'pos_override',
      after: { reason: 'Malformed PIN format (must be 6 digits)', action, metadata },
    });
    throw new Error('Manager PIN must be exactly 6 digits');
  }

  // Find all active users with 'pos:override' permission who have a PIN configured
  const candidateManagers = await db
    .select({
      id: users.id,
      name: users.name,
      isActive: users.isActive,
      pinHash: users.pinHash,
      pinFailedAttempts: users.pinFailedAttempts,
      pinLockedUntil: users.pinLockedUntil,
      permissions: roles.permissions,
    })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.isActive, true));

  const eligibleManagers = candidateManagers.filter(
    (u) =>
      u.permissions.includes(PERMISSIONS.POS_OVERRIDE) ||
      u.permissions.includes('pos:override'),
  );

  if (eligibleManagers.length === 0) {
    throw new Error('No active managers with POS override permission configured');
  }

  const now = getNow();

  // Test against each eligible manager
  for (const manager of eligibleManagers) {
    if (!manager.pinHash) continue;

    // Check if locked
    if (manager.pinLockedUntil && manager.pinLockedUntil > now) {
      // Check if this is the manager who entered the pin
      let isCandidate = false;
      try {
        isCandidate = await verify(manager.pinHash, pin);
      } catch {
        // ignore
      }
      if (isCandidate) {
        const remainingMinutes = Math.ceil(
          (manager.pinLockedUntil.getTime() - now.getTime()) / 60000,
        );
        await writeAuditLog(db, {
          userId: manager.id,
          action: 'pos.override.failed',
          entityType: 'pos_override',
          entityId: manager.id,
          after: {
            reason: `PIN locked for ${remainingMinutes} more minutes`,
            action,
            cashierUserId,
            metadata,
          },
        });
        throw new Error(
          `Manager account is locked due to too many failed attempts. Try again in ${remainingMinutes} minutes.`,
        );
      }
      continue;
    }

    let isMatch = false;
    try {
      isMatch = await verify(manager.pinHash, pin);
    } catch {
      isMatch = false;
    }

    if (isMatch) {
      // Approver must not be the cashier
      if (manager.id === cashierUserId) {
        await writeAuditLog(db, {
          userId: cashierUserId,
          action: 'pos.override.failed',
          entityType: 'pos_override',
          entityId: manager.id,
          after: {
            reason: 'Cashier attempted to approve their own override',
            action,
            metadata,
          },
        });
        throw new Error('Manager override cannot be approved by the cashier');
      }

      // Reset failed attempts on success
      if (manager.pinFailedAttempts > 0) {
        await db
          .update(users)
          .set({ pinFailedAttempts: 0, pinLockedUntil: null, updatedAt: now })
          .where(eq(users.id, manager.id));
      }

      await writeAuditLog(db, {
        userId: manager.id,
        action: 'pos.override.approved',
        entityType: 'pos_override',
        entityId: manager.id,
        after: {
          action,
          reason,
          cashierUserId,
          metadata,
        },
      });

      return { approverId: manager.id, approverName: manager.name };
    }
  }

  // If no match was found, record failure on any active manager that was tried
  // Increment failed attempts on the active manager if there's only one or log generic failure
  for (const manager of eligibleManagers) {
    if (manager.pinHash && (!manager.pinLockedUntil || manager.pinLockedUntil <= now)) {
      const newFailures = (manager.pinFailedAttempts || 0) + 1;
      const willLock = newFailures >= MAX_PIN_FAILURES;
      const lockedUntil = willLock ? new Date(now.getTime() + LOCKOUT_MINUTES * 60 * 1000) : null;

      await db
        .update(users)
        .set({
          pinFailedAttempts: newFailures,
          pinLockedUntil: lockedUntil,
          updatedAt: now,
        })
        .where(eq(users.id, manager.id));

      await writeAuditLog(db, {
        userId: manager.id,
        action: 'pos.override.failed',
        entityType: 'pos_override',
        entityId: manager.id,
        after: {
          reason: 'Invalid PIN entered',
          failures: newFailures,
          locked: willLock,
          action,
          cashierUserId,
          metadata,
        },
      });
      break;
    }
  }

  throw new Error('Invalid manager PIN');
}
