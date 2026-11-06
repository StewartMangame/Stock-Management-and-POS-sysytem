'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createCustomerAction, updateCustomerAction } from './actions';
import type { Customer } from '@/server/services/sales/customers';

interface CustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer?: Customer | null;
  initialName?: string;
  onCustomerCreated?: (customer: Customer) => void;
}

export function CustomerDialog({
  open,
  onOpenChange,
  customer,
  initialName,
  onCustomerCreated,
}: CustomerDialogProps) {
  const router = useRouter();
  const isEditing = Boolean(customer);

  const [loading, setLoading] = useState(false);
  const [customerType, setCustomerType] = useState<'individual' | 'business'>(
    customer?.customerType === 'business' ? 'business' : 'individual',
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    try {
      const formData = new FormData(e.currentTarget);
      const name = formData.get('name') as string;
      const email = (formData.get('email') as string) || undefined;
      const phone = (formData.get('phone') as string) || undefined;
      const address = (formData.get('address') as string) || undefined;
      const taxNumber = (formData.get('taxNumber') as string) || undefined;
      const creditLimitMwk = parseFloat((formData.get('creditLimit') as string) || '0');
      const creditLimitMinor = Math.round((isNaN(creditLimitMwk) ? 0 : creditLimitMwk) * 100);
      const paymentTermsDays = parseInt((formData.get('paymentTermsDays') as string) || '30', 10);

      if (isEditing && customer) {
        await updateCustomerAction(customer.id, {
          name,
          customerType,
          email,
          phone,
          address,
          taxNumber,
          creditLimitMinor,
          paymentTermsDays,
        });
        toast.success('Customer updated successfully');
      } else {
        const result = await createCustomerAction({
          name,
          customerType,
          email,
          phone,
          address,
          taxNumber,
          creditLimitMinor,
          paymentTermsDays,
        });
        onCustomerCreated?.(result.customer);
        toast.success(`Customer created successfully: ${result.customer.accountNumber}`);
      }

      onOpenChange(false);
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Customer' : 'Add New Customer'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="customerType">Customer Type</Label>
            <Select
              value={customerType}
              onValueChange={(val) => setCustomerType(val as 'individual' | 'business')}
              disabled={customer?.isWalkIn}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select customer type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="individual">Individual</SelectItem>
                <SelectItem value="business">Business / Corporate</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="name">Full Name / Company Name *</Label>
            <Input
              id="name"
              name="name"
              defaultValue={customer?.name ?? initialName}
              required
              placeholder="e.g. Acme Corporation"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                name="phone"
                defaultValue={customer?.phone || ''}
                placeholder="+265 999 123 456"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={customer?.email || ''}
                placeholder="accounts@example.mw"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="address">Physical / Postal Address</Label>
            <Input
              id="address"
              name="address"
              defaultValue={customer?.address || ''}
              placeholder="Plot 10, Area 4, Lilongwe"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="taxNumber">Tax Identification Number (TPIN)</Label>
            <Input
              id="taxNumber"
              name="taxNumber"
              defaultValue={customer?.taxNumber || ''}
              placeholder="e.g. 1002345678"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="creditLimit">Credit Limit (MWK)</Label>
              <Input
                id="creditLimit"
                name="creditLimit"
                type="number"
                step="any"
                min="0"
                disabled={customer?.isWalkIn}
                defaultValue={customer ? (customer.creditLimitMinor / 100).toFixed(2) : '0'}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="paymentTermsDays">Payment Terms (Days)</Label>
              <Input
                id="paymentTermsDays"
                name="paymentTermsDays"
                type="number"
                min="0"
                defaultValue={customer?.paymentTermsDays ?? 30}
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="bg-ace-gold text-ace-navy hover:bg-ace-gold/90">
              {loading ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Customer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
