/**
 * Tests for authorize() — verifies that:
 *  - Every role can access what it should
 *  - Every role is blocked from what it shouldn't have
 *  - Deactivated users are always blocked
 *  - Missing sessions are always blocked
 *
 * These tests mock the DB and Auth.js session so no database is needed.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { AuthorizationError } from '@/server/auth/authorize';
import { PERMISSIONS, ROLE_PERMISSIONS } from '@/lib/permissions';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// vi.hoisted ensures these are defined before vi.mock factory runs (which is hoisted to top of file)
const { mockLimit, mockWhere, mockInnerJoin, mockFrom, mockSelect } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockInnerJoin = vi.fn(() => ({ where: mockWhere }));
  const mockFrom = vi.fn(() => ({ innerJoin: mockInnerJoin }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return { mockLimit, mockWhere, mockInnerJoin, mockFrom, mockSelect };
});

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

vi.mock('@/server/db', () => ({
  db: {
    select: mockSelect,
  },
}));

import { auth } from '@/auth';
import { authorize } from '@/server/auth/authorize';

const mockAuth = auth as Mock;

function makeSession(userId = 'user-1') {
  return { user: { id: userId, name: 'Test', email: 'test@ace.co.mw' } };
}

function makeQueryResult(roleName: string, isActive = true) {
  const permissions = ROLE_PERMISSIONS[roleName] ?? [];
  return [{
    users: {
      id: 'user-1',
      name: 'Test User',
      email: 'test@ace.co.mw',
      isActive,
      forcePasswordChange: false,
      roleId: 'role-1',
      passwordHash: 'hash',
      defaultLocationId: null,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: null,
      createdBy: null,
    },
    roles: {
      id: 'role-1',
      name: roleName,
      permissions,
      createdAt: new Date(),
      updatedAt: null,
    },
  }];
}

function setQueryResult(result: ReturnType<typeof makeQueryResult> | []) {
  mockLimit.mockResolvedValue(result);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('authorize()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-wire the chain after clearAllMocks
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockInnerJoin.mockReturnValue({ where: mockWhere });
    mockFrom.mockReturnValue({ innerJoin: mockInnerJoin });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it('throws UNAUTHENTICATED when there is no session', async () => {
    mockAuth.mockResolvedValue(null);
    await expect(authorize(PERMISSIONS.USERS_MANAGE)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('throws UNAUTHENTICATED when session has no user id', async () => {
    mockAuth.mockResolvedValue({ user: {} });
    await expect(authorize(PERMISSIONS.USERS_MANAGE)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('throws ACCOUNT_INACTIVE for a deactivated user', async () => {
    mockAuth.mockResolvedValue(makeSession());
    setQueryResult(makeQueryResult('admin', false));
    await expect(authorize(PERMISSIONS.USERS_MANAGE)).rejects.toMatchObject({
      code: 'ACCOUNT_INACTIVE',
    });
  });

  it('throws ACCOUNT_INACTIVE when user is not found in DB', async () => {
    mockAuth.mockResolvedValue(makeSession());
    setQueryResult([]);
    await expect(authorize(PERMISSIONS.USERS_MANAGE)).rejects.toMatchObject({
      code: 'ACCOUNT_INACTIVE',
    });
  });

  it('throws FORBIDDEN when the role does not have the permission', async () => {
    mockAuth.mockResolvedValue(makeSession());
    setQueryResult(makeQueryResult('viewer'));
    await expect(authorize(PERMISSIONS.USERS_MANAGE)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('resolves and returns the user for a valid session + permission', async () => {
    mockAuth.mockResolvedValue(makeSession());
    setQueryResult(makeQueryResult('admin'));
    const user = await authorize(PERMISSIONS.USERS_MANAGE);
    expect(user.id).toBe('user-1');
    expect(user.role.name).toBe('admin');
  });

  // ── Role-by-role permission spot-checks ───────────────────────────────────

  const permitted: Array<[string, string]> = [
    ['admin',       PERMISSIONS.USERS_MANAGE],
    ['admin',       PERMISSIONS.INVOICES_VOID],
    ['manager',     PERMISSIONS.DISCOUNTS_APPROVE],
    ['manager',     PERMISSIONS.INVOICES_VOID],
    ['sales',       PERMISSIONS.QUOTATIONS_MANAGE],
    ['sales',       PERMISSIONS.PAYMENTS_RECORD],
    ['storekeeper', PERMISSIONS.GOODS_RECEIPTS_MANAGE],
    ['storekeeper', PERMISSIONS.STOCK_ADJUST],
    ['cashier',     PERMISSIONS.POS_ACCESS],
    ['cashier',     PERMISSIONS.PAYMENTS_RECORD],
    ['viewer',      PERMISSIONS.REPORTS_VIEW],
  ];

  const forbidden: Array<[string, string]> = [
    ['viewer',      PERMISSIONS.USERS_MANAGE],
    ['viewer',      PERMISSIONS.INVOICES_VOID],
    ['viewer',      PERMISSIONS.GOODS_RECEIPTS_MANAGE],
    ['cashier',     PERMISSIONS.USERS_MANAGE],
    ['cashier',     PERMISSIONS.INVOICES_VOID],
    ['cashier',     PERMISSIONS.STOCK_ADJUST],
    ['sales',       PERMISSIONS.USERS_MANAGE],
    ['sales',       PERMISSIONS.STOCK_ADJUST],
    ['storekeeper', PERMISSIONS.INVOICES_VOID],
    ['storekeeper', PERMISSIONS.PAYMENTS_REFUND],
  ];

  it.each(permitted)('%s can use permission %s', async (role, permission) => {
    mockAuth.mockResolvedValue(makeSession());
    setQueryResult(makeQueryResult(role));
    await expect(authorize(permission as typeof PERMISSIONS.USERS_MANAGE)).resolves.toBeDefined();
  });

  it.each(forbidden)('%s is FORBIDDEN from permission %s', async (role, permission) => {
    mockAuth.mockResolvedValue(makeSession());
    setQueryResult(makeQueryResult(role));
    await expect(authorize(permission as typeof PERMISSIONS.USERS_MANAGE)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('re-reads the DB on every call (role change takes effect without re-login)', async () => {
    mockAuth.mockResolvedValue(makeSession());

    // First call: user is viewer (no USERS_MANAGE)
    mockLimit.mockResolvedValueOnce(makeQueryResult('viewer'));
    await expect(authorize(PERMISSIONS.USERS_MANAGE)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // Second call: same session, but DB now returns admin role
    mockLimit.mockResolvedValueOnce(makeQueryResult('admin'));
    const user = await authorize(PERMISSIONS.USERS_MANAGE);
    expect(user.role.name).toBe('admin');

    expect(mockLimit).toHaveBeenCalledTimes(2);
  });

  it('AuthorizationError is an instance of Error', () => {
    const err = new AuthorizationError('FORBIDDEN', 'test');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('FORBIDDEN');
    expect(err.name).toBe('AuthorizationError');
  });
});
