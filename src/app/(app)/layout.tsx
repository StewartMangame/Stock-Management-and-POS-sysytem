import { Sidebar } from '@/components/shell/Sidebar';
import { Topbar } from '@/components/shell/Topbar';
import { Providers } from '@/components/shell/Providers';
import { auth } from '@/auth';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ace Holdings POS',
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  // Pull permissions from the session role; fall back to empty array
  const permissions: string[] = (session?.user as { role?: { permissions?: string[] } })?.role?.permissions ?? [];

  return (
    <Providers>
      <div className="flex h-screen w-full overflow-hidden bg-ace-bg">
        {/* Sidebar — receives user permissions for role-based nav filtering */}
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
