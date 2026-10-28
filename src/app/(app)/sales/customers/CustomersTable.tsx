'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Plus, Search, Building2, User, Eye, Pencil, ShieldAlert } from 'lucide-react';
import { CustomerDialog } from './CustomerDialog';
import type { Customer } from '@/server/services/sales/customers';

interface CustomersTableProps {
  customers: Customer[];
}

export function CustomersTable({ customers }: CustomersTableProps) {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  const filtered = customers.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.accountNumber.toLowerCase().includes(search.toLowerCase()) ||
      (c.phone && c.phone.includes(search)) ||
      (c.email && c.email.toLowerCase().includes(search.toLowerCase()));

    if (!matchesSearch) return false;
    if (filterType === 'all') return true;
    if (filterType === 'walk_in') return c.isWalkIn;
    return c.customerType === filterType && !c.isWalkIn;
  });

  function handleOpenCreate() {
    setSelectedCustomer(null);
    setDialogOpen(true);
  }

  function handleOpenEdit(customer: Customer) {
    setSelectedCustomer(customer);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-4">
      {/* Top action bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search customers by name, account, phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-card"
            />
          </div>

          <div className="flex items-center gap-1.5 rounded-lg border bg-card p-1 text-xs">
            <button
              onClick={() => setFilterType('all')}
              className={`rounded px-2.5 py-1 font-medium transition ${
                filterType === 'all' ? 'bg-ace-navy text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All ({customers.length})
            </button>
            <button
              onClick={() => setFilterType('business')}
              className={`rounded px-2.5 py-1 font-medium transition ${
                filterType === 'business' ? 'bg-ace-navy text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Corporate
            </button>
            <button
              onClick={() => setFilterType('individual')}
              className={`rounded px-2.5 py-1 font-medium transition ${
                filterType === 'individual' ? 'bg-ace-navy text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Individual
            </button>
            <button
              onClick={() => setFilterType('walk_in')}
              className={`rounded px-2.5 py-1 font-medium transition ${
                filterType === 'walk_in' ? 'bg-ace-navy text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Walk-in
            </button>
          </div>
        </div>

        <Button onClick={handleOpenCreate} className="bg-ace-gold text-ace-navy hover:bg-ace-gold/90 font-semibold shadow-sm">
          <Plus className="mr-1.5 h-4 w-4" /> Add Customer
        </Button>
      </div>

      {/* Customers Table */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="w-[140px]">Account No</TableHead>
              <TableHead>Customer Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Phone / Email</TableHead>
              <TableHead className="text-right">Credit Limit</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  No customers found matching your criteria.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((c) => (
                <TableRow key={c.id} className="hover:bg-muted/30 transition">
                  <TableCell className="font-mono text-xs font-semibold text-ace-navy">
                    {c.accountNumber}
                  </TableCell>
                  <TableCell>
                    <div className="font-semibold text-foreground flex items-center gap-2">
                      {c.name}
                      {c.isWalkIn && (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] font-mono">
                          PROTECTED
                        </Badge>
                      )}
                    </div>
                    {c.address && <div className="text-xs text-muted-foreground truncate max-w-xs">{c.address}</div>}
                  </TableCell>
                  <TableCell>
                    {c.isWalkIn ? (
                      <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-900 border-none font-normal text-xs">
                        Walk-in
                      </Badge>
                    ) : c.customerType === 'business' ? (
                      <Badge variant="outline" className="gap-1 bg-blue-50 text-blue-700 border-blue-200 font-normal text-xs">
                        <Building2 className="h-3 w-3" /> Corporate
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 bg-slate-50 text-slate-700 border-slate-200 font-normal text-xs">
                        <User className="h-3 w-3" /> Individual
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{c.phone || '—'}</div>
                    <div className="text-muted-foreground">{c.email || ''}</div>
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium">
                    {c.isWalkIn ? (
                      <span className="text-muted-foreground text-xs italic">Cash only</span>
                    ) : c.creditLimitMinor > 0 ? (
                      <span className="text-foreground">
                        MWK {(c.creditLimitMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">MWK 0.00</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {c.isActive ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 border border-emerald-200">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 border border-rose-200">
                        Inactive
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 hover:bg-ace-gold/20 hover:text-ace-navy"
                        title="View Customer 360°"
                      >
                        <Link href={`/sales/customers/${c.id}`}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenEdit(c)}
                        className="h-8 w-8 p-0"
                        title="Edit Customer"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <CustomerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        customer={selectedCustomer}
      />
    </div>
  );
}
