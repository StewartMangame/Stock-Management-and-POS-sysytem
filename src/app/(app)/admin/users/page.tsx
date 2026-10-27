import type { Metadata } from 'next';
import { authorize } from '@/server/auth/authorize';
import { listUsers, listRoles } from '@/server/services/users';
import { db } from '@/server/db';
import { locations } from '@/server/db/schema';
import { PERMISSIONS } from '@/lib/permissions';
import { redirect } from 'next/navigation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTime, capitalize } from '@/lib/utils';
import { UserPlus } from 'lucide-react';
import { UserActionsMenu } from './UserActionsMenu';
import { CreateUserDialog } from './CreateUserDialog';

export const metadata: Metadata = { title: 'Users' };

export default async function UsersPage() {
  try {
    await authorize(PERMISSIONS.USERS_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const [{ users }, allRoles, allLocations] = await Promise.all([
    listUsers({ pageSize: 100 }),
    listRoles(),
    db.select({ id: locations.id, name: locations.name }).from(locations),
  ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ace-navy">Users</h1>
          <p className="text-sm text-ace-muted">{users.length} user{users.length !== 1 ? 's' : ''} in the system</p>
        </div>
        <CreateUserDialog roles={allRoles} locations={allLocations}>
          <Button id="create-user-btn">
            <UserPlus className="mr-2 h-4 w-4" />
            New User
          </Button>
        </CreateUserDialog>
      </div>

      {/* Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last Login</TableHead>
            <TableHead className="w-20">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id} id={`user-row-${user.id}`}>
              <TableCell className="font-medium">{user.name}</TableCell>
              <TableCell className="text-ace-muted">{user.email}</TableCell>
              <TableCell>
                <Badge variant="info">{capitalize(user.role?.name ?? '—')}</Badge>
              </TableCell>
              <TableCell className="text-ace-muted">
                {user.defaultLocation?.name ?? '—'}
              </TableCell>
              <TableCell>
                {user.isActive ? (
                  <Badge variant="success">Active</Badge>
                ) : (
                  <Badge variant="destructive">Inactive</Badge>
                )}
                {user.forcePasswordChange && (
                  <Badge variant="warning" className="ml-1">
                    Pwd required
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-ace-muted text-xs">
                {formatDateTime(user.lastLoginAt)}
              </TableCell>
              <TableCell>
                <UserActionsMenu
                  user={{
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    roleId: user.roleId ?? '',
                    defaultLocationId: user.defaultLocationId ?? null,
                    isActive: user.isActive,
                  }}
                  roles={allRoles}
                  locations={allLocations}
                />
              </TableCell>
            </TableRow>
          ))}

          {users.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="py-10 text-center text-ace-muted">
                No users found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
