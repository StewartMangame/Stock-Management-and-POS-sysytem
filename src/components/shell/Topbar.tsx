'use client';

import { signOut } from 'next-auth/react';
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
import { LogOut, User, Settings } from 'lucide-react';
import Link from 'next/link';
import { initials } from '@/lib/utils';

export function Topbar() {
  const { data: session } = useSession();
  const userName = session?.user?.name ?? 'User';
  const userEmail = session?.user?.email ?? '';

  return (
    <header className="flex h-14 w-full items-center justify-between border-b border-ace-band bg-white px-6">
      {/* Left: page title slot (breadcrumb filled by pages) */}
      <div id="topbar-breadcrumb" className="flex items-center gap-2 text-sm text-ace-muted" />

      {/* Right: user menu */}
      <div className="flex items-center gap-3">
        <span className="hidden text-sm text-ace-muted sm:block">{userEmail}</span>

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
              onClick={() => signOut({ callbackUrl: '/login' })}
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
