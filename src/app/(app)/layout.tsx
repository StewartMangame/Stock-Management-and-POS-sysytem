import { AppShell } from '@/components/shell/AppShell';
import { auth } from '@/auth';
import { db } from '@/server/db';
import { roles } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { PERMISSIONS } from '@/lib/permissions';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ace Holdings POS',
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  // The JWT carries roleId but NOT the permissions array.
  // Look up the role in the DB so the sidebar can show the right nav items.
  let permissions: string[] = [];
  try {
    const roleId = session?.user?.roleId;
    if (roleId && typeof roleId === 'string' && roleId.trim() !== '') {
      const [role] = await db
        .select({ name: roles.name, permissions: roles.permissions })
        .from(roles)
        .where(eq(roles.id, roleId))
        .limit(1);
      if (role) {
        const isSystemAdmin = role.name?.toLowerCase() === 'admin';
        permissions = isSystemAdmin
          ? (Object.values(PERMISSIONS) as string[])
          : (role.permissions ?? []);
      }
    }
  } catch (err) {
    console.error('Failed to load user permissions for sidebar:', err);
  }

  return <AppShell permissions={permissions}>{children}</AppShell>;
}
