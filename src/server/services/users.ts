/**
 * User management service — all user CRUD lives here.
 * Pages and server actions call these functions; they never touch the DB directly.
 */

import { db } from '@/server/db';
import { users, roles } from '@/server/db/schema';
import { eq, ilike, desc, count } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import { writeAuditLog } from './audit';
import type { CreateUserInput, UpdateUserInput } from '@/lib/validation';

const ARGON2_OPTIONS = {
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
};

export async function listUsers(opts?: { search?: string; page?: number; pageSize?: number }) {
  const { page = 1, pageSize = 50 } = opts ?? {};
  const offset = (page - 1) * pageSize;

  const query = db.query.users.findMany({
    with: { role: { columns: { name: true } }, defaultLocation: { columns: { name: true } } },
    orderBy: [desc(users.createdAt)],
    limit: pageSize,
    offset,
    // Drizzle relational query doesn't support WHERE on relations — use findMany from the main table
  });

  const [list, countResult] = await Promise.all([
    query,
    db.select({ total: count() }).from(users),
  ]);

  return { users: list, total: countResult[0]?.total ?? 0 };
}

export async function getUserById(id: string) {
  return db.query.users.findFirst({
    where: eq(users.id, id),
    with: { role: true, defaultLocation: { columns: { name: true, id: true } } },
  });
}

export async function createUser(
  input: CreateUserInput,
  actorId: string,
  ip?: string,
) {
  const passwordHash = await hash(input.password, ARGON2_OPTIONS);

  const [user] = await db
    .insert(users)
    .values({
      name: input.name,
      email: input.email,
      passwordHash,
      roleId: input.roleId,
      defaultLocationId: input.defaultLocationId ?? null,
      isActive: true,
      forcePasswordChange: true, // new users must change password on first login
      createdBy: actorId,
    })
    .returning();

  if (!user) throw new Error('Failed to create user');

  await writeAuditLog(db, {
    userId: actorId,
    action: 'user.create',
    entityType: 'user',
    entityId: user.id,
    after: { name: user.name, email: user.email, roleId: user.roleId },
    ip,
  });

  return user;
}

export async function updateUser(
  id: string,
  input: UpdateUserInput,
  actorId: string,
  ip?: string,
) {
  const existing = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!existing) throw new Error('User not found');

  const [updated] = await db
    .update(users)
    .set({
      name: input.name,
      roleId: input.roleId,
      defaultLocationId: input.defaultLocationId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, id))
    .returning();

  await writeAuditLog(db, {
    userId: actorId,
    action: 'user.update',
    entityType: 'user',
    entityId: id,
    before: { name: existing.name, roleId: existing.roleId },
    after: { name: input.name, roleId: input.roleId },
    ip,
  });

  return updated;
}

export async function setUserActive(
  id: string,
  isActive: boolean,
  actorId: string,
  ip?: string,
) {
  const [updated] = await db
    .update(users)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning({ id: users.id, isActive: users.isActive });

  await writeAuditLog(db, {
    userId: actorId,
    action: isActive ? 'user.reactivate' : 'user.deactivate',
    entityType: 'user',
    entityId: id,
    after: { isActive },
    ip,
  });

  return updated;
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  actorId: string,
  ip?: string,
): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error('User not found');

  const { verify } = await import('@node-rs/argon2');
  const valid = await verify(user.passwordHash, currentPassword);
  if (!valid) throw new Error('Current password is incorrect');

  const newHash = await hash(newPassword, ARGON2_OPTIONS);

  await db
    .update(users)
    .set({ passwordHash: newHash, forcePasswordChange: false, updatedAt: new Date() })
    .where(eq(users.id, userId));

  await writeAuditLog(db, {
    userId: actorId,
    action: 'user.password_change',
    entityType: 'user',
    entityId: userId,
    ip,
  });
}

export async function listRoles() {
  return db.select().from(roles).orderBy(roles.name);
}
