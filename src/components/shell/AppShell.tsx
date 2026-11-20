'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AppShellProps {
  permissions: string[];
  children: React.ReactNode;
}

export function AppShell({ permissions, children }: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pathname = usePathname();

  // Automatically close mobile menu on route changes
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Handle ESC key to dismiss mobile navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileNavOpen) {
        setMobileNavOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileNavOpen]);

  // Prevent body scrolling when mobile drawer is open
  useEffect(() => {
    if (mobileNavOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileNavOpen]);

  return (
    <div className="flex h-dvh min-h-dvh w-full overflow-hidden bg-ace-bg">
      {/* Desktop Persistent Sidebar */}
      <Sidebar permissions={permissions} className="hidden md:flex" />

      {/* Mobile Drawer (Accessible Sheet/Slide-over) */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation drawer">
          {/* Backdrop overlay */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity duration-300 animate-in fade-in-0"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />

          {/* Slide-over panel */}
          <div className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-white shadow-2xl transition-transform duration-300 animate-in slide-in-from-left">
            <div className="flex h-14 items-center justify-between border-b border-ace-band px-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded bg-ace-navy text-xs font-bold text-white">
                  A
                </div>
                <div className="leading-tight">
                  <p className="text-xs font-bold text-ace-navy-deep">ACE HOLDINGS</p>
                  <p className="text-[10px] text-ace-muted">POS System</p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setMobileNavOpen(false)}
                className="h-10 w-10 p-0 text-ace-navy hover:bg-ace-band"
                aria-label="Close navigation menu"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <Sidebar
              permissions={permissions}
              onNavigate={() => setMobileNavOpen(false)}
              className="w-full flex-1 border-r-0"
            />
          </div>
        </div>
      )}

      {/* Main Workspace Area */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <Topbar onOpenMobileMenu={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 animate-fade-in focus:outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
