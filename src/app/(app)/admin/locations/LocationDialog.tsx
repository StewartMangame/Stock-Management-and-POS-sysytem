'use client';

import { useState } from 'react';
import { toast } from 'sonner';
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
import { Switch } from '@/components/ui/switch';
import { createLocationAction, updateLocationAction } from './actions';

interface LocationData {
  id?: string;
  name: string;
  code: string;
  type: 'outlet' | 'warehouse' | string;
  address?: string | null;
  isActive?: boolean;
}

interface Props {
  location?: LocationData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: React.ReactNode;
}

export function LocationDialog({ location, open, onOpenChange }: Props) {
  const isEditing = !!location?.id;
  const [name, setName] = useState(location?.name ?? '');
  const [code, setCode] = useState(location?.code ?? '');
  const [type, setType] = useState<'outlet' | 'warehouse'>((location?.type as 'outlet' | 'warehouse') ?? 'outlet');
  const [address, setAddress] = useState(location?.address ?? '');
  const [isActive, setIsActive] = useState(location?.isActive ?? true);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isEditing) {
        await updateLocationAction(location.id!, {
          name,
          code,
          type,
          address,
          isActive,
        });
        toast.success('Location updated successfully');
      } else {
        await createLocationAction({
          name,
          code,
          type,
          address,
          isActive,
        });
        toast.success('Location created successfully');
      }
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save location');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Location' : 'Add New Location'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update location details and settings.'
              : 'Add an outlet store or storage warehouse with auto-provisioned document sequences.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="loc-name">Location Name</Label>
            <Input
              id="loc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Limbe Branch"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="loc-code">Short Code</Label>
              <Input
                id="loc-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. LIMBE"
                required
                maxLength={10}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="loc-type">Type</Label>
              <Select value={type} onValueChange={(val: 'outlet' | 'warehouse') => setType(val)}>
                <SelectTrigger id="loc-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="outlet">Outlet / Retail Store</SelectItem>
                  <SelectItem value="warehouse">Warehouse / Depot</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="loc-address">Physical Address / City</Label>
            <Input
              id="loc-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="e.g. Churchill Road, Limbe"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="loc-active">Active Status</Label>
              <p className="text-xs text-ace-muted">Inactive locations cannot receive or sell stock</p>
            </div>
            <Switch
              id="loc-active"
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading} id="save-location-btn">
              {loading ? 'Saving...' : isEditing ? 'Update Location' : 'Create Location'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
