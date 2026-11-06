/**
 * authorize() — server-side permission guard.
 *
 * Call this at the top of every server action or API route that requires
 * a permission. It re-reads the user's role and is_active from the database
 * on every call so that role changes and deactivations take effect immediately
 * without waiting for the JWT to expire.
 *
 * Usage:
 *   const actor = await authorize('invoices:void');
 *
 * Throws:
 *   - 'UNAUTHENTICATED' — no valid session
 *   - 'ACCOUNT_INACTIVE' — user was deactivated since login
 *   - 'FORBIDDEN' — role does not have the required permission
 */

import { auth } from '@/auth';
import { db } from '@/server/db';
import { users, roles } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { PERMISSIONS, ROLE_PERMISSIONS, type Permission } from '@/lib/permissions';

export class AuthorizationError extends Error {
  constructor(
    public readonly code: 'UNAUTHENTICATED' | 'ACCOUNT_INACTIVE' | 'FORBIDDEN',
    message: string,
  ) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export type AuthorizedUser = InferSelectModel<typeof users> & {
  role: InferSelectModel<typeof roles>;
};

/**
 * Verifies the current session and checks that the user holds the given permission.
 * Re-reads role and is_active from the database on every call.
 *
 * @param permission  A value from PERMISSIONS (e.g. 'invoices:void')
 * @returns           The full user row including role data
 * @throws            AuthorizationError
 */
export async function authorize(permission: Permission): Promise<AuthorizedUser> {
  const session = await auth();

  if (!session?.user?.id) {
    throw new AuthorizationError('UNAUTHENTICATED', 'Not signed in.');
  }

  const result = await db
    .select()
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, session.user.id))
    .limit(1);

  const row = result[0];

  if (!row || !row.users.isActive) {
    throw new AuthorizationError('ACCOUNT_INACTIVE', 'Account is inactive or not found.');
  }

  const roleName = row.roles.name?.toLowerCase() ?? '';
  const isSystemAdmin = roleName === 'admin';
  const configuredPerms = (ROLE_PERMISSIONS[roleName] ?? []) as string[];
  const effectivePermissions = isSystemAdmin
    ? (Object.values(PERMISSIONS) as string[])
    : Array.from(new Set([...(row.roles.permissions ?? []), ...configuredPerms]));

  if (!effectivePermissions.includes(permission)) {
    throw new AuthorizationError(
      'FORBIDDEN',
      `Permission '${permission}' is required.`,
    );
  }

  return {
    ...row.users,
    role: {
      ...row.roles,
      permissions: effectivePermissions,
    },
  } as AuthorizedUser;
}

/**
 * Returns the current user without checking any permission.
 * Use for operations that just require a valid session (e.g. reading own profile).
 */
export async function currentUser(): Promise<AuthorizedUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const result = await db
    .select()
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, session.user.id))
    .limit(1);

  const row = result[0];
  if (!row || !row.users.isActive) return null;

  const roleName = row.roles.name?.toLowerCase() ?? '';
  const isSystemAdmin = roleName === 'admin';
  const configuredPerms = (ROLE_PERMISSIONS[roleName] ?? []) as string[];
  const effectivePermissions = isSystemAdmin
    ? (Object.values(PERMISSIONS) as string[])
    : Array.from(new Set([...(row.roles.permissions ?? []), ...configuredPerms]));

  return {
    ...row.users,
    role: {
      ...row.roles,
      permissions: effectivePermissions,
    },
  } as AuthorizedUser;
}
