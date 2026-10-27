'use client';

import { useState, useActionState } from 'react';
import { toast } from 'sonner';
import { useEffect } from 'react';
import { MoreHorizontal, Edit2, UserCheck, UserX } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { updateUserAction, toggleUserActiveAction } from './actions';
import { capitalize } from '@/lib/utils';

interface UserRow {
  id: string;
  name: string;
  email: string;
  roleId: string;
  defaultLocationId: string | null;
  isActive: boolean;
}

interface Props {
  user: UserRow;
  roles: { id: string; name: string }[];
  locations: { id: string; name: string }[];
}

export function UserActionsMenu({ user, roles, locations }: Props) {
  const [editOpen, setEditOpen] = useState(false);

  const updateBound = updateUserAction.bind(null, user.id);
  const [editState, editAction, isEditPending] = useActionState(updateBound, {});

  useEffect(() => {
    if (editState.success) {
      toast.success('User updated.');
      setEditOpen(false);
    }
    if (editState.error) {
      toast.error(editState.error);
    }
  }, [editState]);

  const handleToggleActive = async () => {
    const result = await toggleUserActiveAction(user.id, !user.isActive);
    if (result.success) {
      toast.success(user.isActive ? 'User deactivated.' : 'User reactivated.');
    } else {
      toast.error(result.error ?? 'Failed.');
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            id={`user-actions-${user.id}`}
            aria-label={`Actions for ${user.name}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Actions</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Edit2 className="mr-2 h-4 w-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleToggleActive}
            className={user.isActive ? 'text-red-600 focus:bg-red-50 focus:text-red-700' : ''}
          >
            {user.isActive ? (
              <><UserX className="mr-2 h-4 w-4" />Deactivate</>
            ) : (
              <><UserCheck className="mr-2 h-4 w-4" />Reactivate</>
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>Update name, role, or location for {user.email}.</DialogDescription>
          </DialogHeader>
          <form action={editAction} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={`edit-name-${user.id}`}>Full name</Label>
              <Input id={`edit-name-${user.id}`} name="name" defaultValue={user.name} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`edit-role-${user.id}`}>Role</Label>
              <Select name="roleId" defaultValue={user.roleId}>
                <SelectTrigger id={`edit-role-${user.id}`}>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{capitalize(r.name)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`edit-location-${user.id}`}>Default location</Label>
              <Select name="defaultLocationId" defaultValue={user.defaultLocationId ?? ''}>
                <SelectTrigger id={`edit-location-${user.id}`}>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isEditPending} id={`save-user-${user.id}`}>
                {isEditPending ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
