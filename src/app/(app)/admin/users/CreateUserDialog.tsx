'use client';

import { useState, useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createUserAction } from './actions';
import { capitalize } from '@/lib/utils';

interface Props {
  roles: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  children: React.ReactNode;
}

export function CreateUserDialog({ roles, locations, children }: Props) {
  const [open, setOpen] = useState(false);
  const [state, action, isPending] = useActionState(createUserAction, {});

  useEffect(() => {
    if (state.success) {
      toast.success('User created. They must change their password on first login.');
      setOpen(false);
    }
    if (state.error) {
      toast.error(state.error);
    }
  }, [state]);

  return (
    <>
      <div onClick={() => setOpen(true)}>{children}</div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New User</DialogTitle>
            <DialogDescription>
              The user will be required to change their password on first login.
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="create-name">Full name</Label>
                <Input id="create-name" name="name" placeholder="Jane Banda" required />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="create-email">Email address</Label>
                <Input id="create-email" name="email" type="email" placeholder="jane@ace.co.mw" required />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="create-password">Temporary password</Label>
                <Input id="create-password" name="password" type="password" placeholder="Min 8 chars, 1 uppercase, 1 number" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-role">Role</Label>
                <Select name="roleId" required>
                  <SelectTrigger id="create-role">
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
                <Label htmlFor="create-location">Default location</Label>
                <Select name="defaultLocationId">
                  <SelectTrigger id="create-location">
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
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isPending} id="create-user-submit">
                {isPending ? 'Creating…' : 'Create user'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
