'use client';

import { signOut } from 'next-auth/react';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogOut, User, Settings, Menu } from 'lucide-react';
import Link from 'next/link';
import { initials } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function Topbar({ onOpenMobileMenu }: { onOpenMobileMenu?: () => void }) {
  const { data: session } = useSession();
  const userName = session?.user?.name ?? 'User';
  const userEmail = session?.user?.email ?? '';

  return (
    <header className="flex h-14 w-full items-center justify-between border-b border-ace-band bg-white px-3 sm:px-6">
      {/* Left: Mobile hamburger menu trigger & breadcrumb slot */}
      <div className="flex items-center gap-2 sm:gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onOpenMobileMenu}
          className="h-9 w-9 p-0 text-ace-navy hover:bg-ace-band md:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* Small mobile branding */}
        <div className="flex items-center gap-1.5 md:hidden">
          <div className="relative flex h-6 w-6 shrink-0 items-center justify-center">
            <Image
              src="/brand/ace-logo.png"
              alt="Ace Holdings Logo"
              width={24}
              height={24}
              className="h-6 w-auto max-w-[24px] object-contain"
              priority
            />
          </div>
          <span className="text-xs font-bold text-ace-navy-deep sm:inline hidden">ACE</span>
        </div>

        {/* Page title / breadcrumb slot (filled by pages) */}
        <div id="topbar-breadcrumb" className="flex items-center gap-1.5 text-xs sm:text-sm text-ace-muted truncate" />
      </div>

      {/* Right: user menu */}
      <div className="flex items-center gap-2 sm:gap-3">
        <span className="hidden text-xs sm:text-sm text-ace-muted md:inline">{userEmail}</span>

        <DropdownMenu>
          <DropdownMenuTrigger
            id="user-menu-trigger"
            className="flex items-center gap-2 rounded-full outline-none focus:ring-2 focus:ring-ace-sky focus:ring-offset-2"
            aria-label="User menu"
          >
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-xs">{initials(userName)}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>
              <p className="text-sm font-semibold text-ace-navy">{userName}</p>
              <p className="text-xs text-ace-muted">{userEmail}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/profile" id="nav-profile">
                <User className="mr-2 h-4 w-4" />
                My Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/admin/settings" id="nav-settings-topbar">
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              id="sign-out-btn"
              className="text-red-600 focus:bg-red-50 focus:text-red-700"
              onClick={() => {
                try {
                  sessionStorage.removeItem('ace_pos_cart');
                } catch {}
                signOut({ callbackUrl: '/login' });
              }}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
