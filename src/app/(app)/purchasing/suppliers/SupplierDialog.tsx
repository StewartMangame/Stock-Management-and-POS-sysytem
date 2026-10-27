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
import { createSupplierAction, updateSupplierAction } from './actions';

interface SupplierData {
  id?: string;
  name: string;
  code: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  taxNumber?: string | null;
  defaultCurrency?: string;
  paymentTermsDays?: number;
  isActive?: boolean;
}

interface Props {
  supplier?: SupplierData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SupplierDialog({ supplier, open, onOpenChange }: Props) {
  const isEditing = !!supplier?.id;
  const [name, setName] = useState(supplier?.name ?? '');
  const [code, setCode] = useState(supplier?.code ?? '');
  const [contactName, setContactName] = useState(supplier?.contactName ?? '');
  const [email, setEmail] = useState(supplier?.email ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [address, setAddress] = useState(supplier?.address ?? '');
  const [taxNumber, setTaxNumber] = useState(supplier?.taxNumber ?? '');
  const [defaultCurrency, setDefaultCurrency] = useState(supplier?.defaultCurrency ?? 'MWK');
  const [paymentTermsDays, setPaymentTermsDays] = useState(supplier?.paymentTermsDays?.toString() ?? '30');
  const [isActive, setIsActive] = useState(supplier?.isActive ?? true);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        name,
        code,
        contactName: contactName || null,
        email: email || null,
        phone: phone || null,
        address: address || null,
        taxNumber: taxNumber || null,
        defaultCurrency,
        paymentTermsDays: parseInt(paymentTermsDays, 10) || 30,
        isActive,
      };

      if (isEditing) {
        await updateSupplierAction(supplier.id!, payload);
        toast.success('Supplier updated successfully');
      } else {
        await createSupplierAction(payload);
        toast.success('Supplier created successfully');
      }
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save supplier');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Supplier' : 'Add New Supplier'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update vendor contact details and default trading currency.'
              : 'Add a new vendor or overseas supplier for purchase orders.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label htmlFor="sup-name">Supplier Name</Label>
              <Input
                id="sup-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Dell South Africa"
                required
              />
            </div>

            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label htmlFor="sup-code">Vendor Code</Label>
              <Input
                id="sup-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. DELL-SA"
                required
                maxLength={20}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="sup-contact">Contact Person</Label>
              <Input
                id="sup-contact"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="e.g. Sipho Moyo"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sup-currency">Default Currency</Label>
              <Select value={defaultCurrency} onValueChange={setDefaultCurrency}>
                <SelectTrigger id="sup-currency">
                  <SelectValue placeholder="Select currency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MWK">MWK (Malawian Kwacha)</SelectItem>
                  <SelectItem value="USD">USD (US Dollar)</SelectItem>
                  <SelectItem value="ZAR">ZAR (South African Rand)</SelectItem>
                  <SelectItem value="GBP">GBP (British Pound)</SelectItem>
                  <SelectItem value="EUR">EUR (Euro)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="sup-email">Email Address</Label>
              <Input
                id="sup-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="orders@supplier.com"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sup-phone">Phone Number</Label>
              <Input
                id="sup-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+27 11 555 1234"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="sup-tax">TPIN / Tax Number</Label>
              <Input
                id="sup-tax"
                value={taxNumber}
                onChange={(e) => setTaxNumber(e.target.value)}
                placeholder="e.g. 100234567"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sup-terms">Payment Terms (Days)</Label>
              <Input
                id="sup-terms"
                type="number"
                min="0"
                value={paymentTermsDays}
                onChange={(e) => setPaymentTermsDays(e.target.value)}
                placeholder="30"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sup-address">Physical / Postal Address</Label>
            <Input
              id="sup-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="e.g. Sandton, Johannesburg, South Africa"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="sup-active">Active Vendor</Label>
              <p className="text-xs text-ace-muted">Inactive vendors cannot be selected for new purchase orders</p>
            </div>
            <Switch
              id="sup-active"
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading} id="save-supplier-btn">
              {loading ? 'Saving...' : isEditing ? 'Update Supplier' : 'Create Supplier'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
