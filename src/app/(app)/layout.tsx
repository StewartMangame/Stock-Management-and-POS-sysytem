import { Sidebar } from '@/components/shell/Sidebar';
import { Topbar } from '@/components/shell/Topbar';
import { Providers } from '@/components/shell/Providers';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Ace Holdings POS',
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div className="flex h-screen w-full overflow-hidden bg-ace-bg">
        {/* Sidebar */}
        <Sidebar />

        {/* Main area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <Topbar />
          <main className="flex-1 overflow-y-auto p-6 animate-fade-in">{children}</main>
        </div>
      </div>
    </Providers>
  );
}
