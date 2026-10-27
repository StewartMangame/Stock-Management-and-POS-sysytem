'use client';

import { useState } from 'react';
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
import { Truck, Plus, Edit, Mail, Phone } from 'lucide-react';
import { SupplierDialog } from './SupplierDialog';

interface SupplierItem {
  id: string;
  name: string;
  code: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxNumber: string | null;
  defaultCurrency: string;
  paymentTermsDays: number;
  isActive: boolean;
  createdAt: Date;
}

interface Props {
  suppliers: SupplierItem[];
}

export function SuppliersTable({ suppliers }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierItem | undefined>(undefined);

  const handleCreate = () => {
    setSelectedSupplier(undefined);
    setDialogOpen(true);
  };

  const handleEdit = (sup: SupplierItem) => {
    setSelectedSupplier(sup);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ace-navy">Suppliers</h1>
          <p className="text-sm text-ace-muted">
            Manage vendors, default procurement currencies, and payment terms.
          </p>
        </div>
        <Button onClick={handleCreate} id="add-supplier-btn">
          <Plus className="mr-2 h-4 w-4" />
          Add Supplier
        </Button>
      </div>

      <div className="rounded-lg border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Supplier Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Default Currency</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Terms</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {suppliers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-ace-muted">
                  No suppliers registered yet.
                </TableCell>
              </TableRow>
            ) : (
              suppliers.map((sup) => (
                <TableRow key={sup.id}>
                  <TableCell className="font-medium text-ace-navy">
                    <div className="flex items-center gap-2">
                      <Truck className="h-4 w-4 text-ace-blue shrink-0" />
                      <div>
                        <div>{sup.name}</div>
                        {sup.taxNumber && (
                          <div className="text-xs text-ace-muted">TPIN: {sup.taxNumber}</div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <code className="rounded bg-gray-100 px-2 py-0.5 text-xs font-mono font-semibold">
                      {sup.code}
                    </code>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono font-bold text-ace-navy">
                      {sup.defaultCurrency}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {sup.contactName && <div className="font-medium">{sup.contactName}</div>}
                    <div className="flex flex-col text-xs text-ace-muted">
                      {sup.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" /> {sup.email}
                        </span>
                      )}
                      {sup.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {sup.phone}
                        </span>
                      )}
                      {!sup.contactName && !sup.email && !sup.phone && '—'}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {sup.paymentTermsDays} days
                  </TableCell>
                  <TableCell>
                    <Badge variant={sup.isActive ? 'outline' : 'destructive'} className={sup.isActive ? 'border-emerald-500 text-emerald-700 bg-emerald-50' : ''}>
                      {sup.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(sup)}
                      id={`edit-sup-${sup.code.toLowerCase()}`}
                    >
                      <Edit className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <SupplierDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        supplier={selectedSupplier}
      />
    </div>
  );
}
