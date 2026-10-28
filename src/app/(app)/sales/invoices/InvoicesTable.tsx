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
import { Plus, Search, Eye, Download, FileText, Truck } from 'lucide-react';

export interface InvoiceListItem {
  id: string;
  documentNumber: string | null;
  customerName: string;
  customerAccount: string;
  issueDate: string;
  dueDate: string;
  status: 'draft' | 'issued' | 'void';
  deliveryStatus: 'not_delivered' | 'partly_delivered' | 'delivered';
  paymentStatus: 'unpaid' | 'partly_paid' | 'paid';
  totalMinor: number;
  balanceMinor: number;
  linesCount: number;
}

interface InvoicesTableProps {
  invoices: InvoiceListItem[];
}

export function InvoicesTable({ invoices }: InvoicesTableProps) {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterDelivery, setFilterDelivery] = useState<string>('all');
  const [filterPayment, setFilterPayment] = useState<string>('all');

  const filtered = invoices.filter((inv) => {
    const matchesSearch =
      (inv.documentNumber && inv.documentNumber.toLowerCase().includes(search.toLowerCase())) ||
      inv.customerName.toLowerCase().includes(search.toLowerCase()) ||
      inv.customerAccount.toLowerCase().includes(search.toLowerCase());

    if (!matchesSearch) return false;
    if (filterStatus !== 'all' && inv.status !== filterStatus) return false;
    if (filterDelivery !== 'all' && inv.deliveryStatus !== filterDelivery) return false;
    if (filterPayment !== 'all' && inv.paymentStatus !== filterPayment) return false;

    return true;
  });

  return (
    <div className="space-y-4">
      {/* Search and Filters Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by invoice # or customer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-card"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1 rounded-lg border bg-card p-1 text-xs">
            <span className="px-2 text-muted-foreground font-medium">Status:</span>
            {['all', 'draft', 'issued', 'void'].map((st) => (
              <button
                key={st}
                onClick={() => setFilterStatus(st)}
                className={`rounded px-2.5 py-1 font-medium capitalize transition ${
                  filterStatus === st
                    ? 'bg-ace-navy text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          {/* Delivery Status Filter */}
          <div className="flex items-center gap-1 rounded-lg border bg-card p-1 text-xs">
            <span className="px-2 text-muted-foreground font-medium">Delivery:</span>
            {[
              { id: 'all', label: 'All' },
              { id: 'not_delivered', label: 'Undelivered' },
              { id: 'partly_delivered', label: 'Partial' },
              { id: 'delivered', label: 'Delivered' },
            ].map((d) => (
              <button
                key={d.id}
                onClick={() => setFilterDelivery(d.id)}
                className={`rounded px-2 py-1 font-medium transition ${
                  filterDelivery === d.id
                    ? 'bg-ace-navy text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <Button asChild className="bg-ace-gold text-ace-navy hover:bg-ace-gold/90 font-semibold shadow-sm">
          <Link href="/sales/invoices/new">
            <Plus className="mr-1.5 h-4 w-4" /> Direct Invoice
          </Link>
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="w-[140px]">Invoice #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Issue Date</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="text-center">Delivery</TableHead>
              <TableHead className="text-center">Payment</TableHead>
              <TableHead className="text-right">Total (MWK)</TableHead>
              <TableHead className="text-right">Balance (MWK)</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="h-32 text-center text-muted-foreground">
                  No sales invoices found matching your filters.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((inv) => (
                <TableRow key={inv.id} className="hover:bg-muted/30 transition">
                  <TableCell className="font-mono text-xs font-semibold text-ace-navy">
                    <Link href={`/sales/invoices/${inv.id}`} className="hover:underline">
                      {inv.documentNumber || 'DRAFT'}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="font-semibold text-foreground">{inv.customerName}</div>
                    <div className="text-xs font-mono text-muted-foreground">{inv.customerAccount}</div>
                  </TableCell>
                  <TableCell className="text-xs">{new Date(inv.issueDate).toLocaleDateString()}</TableCell>
                  <TableCell className="text-xs">{new Date(inv.dueDate).toLocaleDateString()}</TableCell>

                  {/* Status */}
                  <TableCell className="text-center">
                    <Badge
                      variant="outline"
                      className={`capitalize text-xs font-semibold ${
                        inv.status === 'issued'
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : inv.status === 'void'
                          ? 'bg-rose-50 text-rose-700 border-rose-200 line-through'
                          : 'bg-slate-50 text-slate-700 border-slate-200'
                      }`}
                    >
                      {inv.status}
                    </Badge>
                  </TableCell>

                  {/* Delivery Status */}
                  <TableCell className="text-center">
                    <Badge
                      variant="outline"
                      className={`text-xs capitalize ${
                        inv.deliveryStatus === 'delivered'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : inv.deliveryStatus === 'partly_delivered'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-gray-50 text-gray-600 border-gray-200'
                      }`}
                    >
                      {inv.deliveryStatus.replace('_', ' ')}
                    </Badge>
                  </TableCell>

                  {/* Payment Status */}
                  <TableCell className="text-center">
                    <Badge
                      variant="outline"
                      className={`text-xs capitalize ${
                        inv.paymentStatus === 'paid'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : inv.paymentStatus === 'partly_paid'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-rose-50 text-rose-700 border-rose-200'
                      }`}
                    >
                      {inv.paymentStatus.replace('_', ' ')}
                    </Badge>
                  </TableCell>

                  {/* Total */}
                  <TableCell className="text-right font-mono font-medium">
                    {(inv.totalMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                  </TableCell>

                  {/* Balance */}
                  <TableCell className="text-right font-mono font-semibold text-foreground">
                    {(inv.balanceMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                  </TableCell>

                  {/* Actions */}
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0" title="View Invoice">
                        <Link href={`/sales/invoices/${inv.id}`}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0" title="Download PDF">
                        <a href={`/api/pdf/invoice/${inv.id}`} target="_blank" rel="noreferrer">
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
