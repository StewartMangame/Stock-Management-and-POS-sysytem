import { Sidebar } from '@/components/shell/Sidebar';
import { Topbar } from '@/components/shell/Topbar';
import { Providers } from '@/components/shell/Providers';
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

  return (
    <Providers>
      <div className="flex h-screen w-full overflow-hidden bg-ace-bg">
        {/* Sidebar receives the role's permission strings for nav filtering */}
        <Sidebar permissions={permissions} />

        {/* Main area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <Topbar />
          <main className="flex-1 overflow-y-auto p-6 animate-fade-in">{children}</main>
        </div>
      </div>
    </Providers>
  );
}
