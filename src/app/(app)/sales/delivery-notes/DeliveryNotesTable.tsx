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
import { Plus, Search, Eye, Download, Truck, FileText } from 'lucide-react';

export interface DeliveryNoteListItem {
  id: string;
  deliveryNumber: string;
  salesDocumentId: string;
  invoiceNumber: string | null;
  customerName: string;
  customerAccount: string;
  deliveryDate: string;
  status: string;
  receivedByCustomer: string | null;
  itemsCount: number;
}

interface DeliveryNotesTableProps {
  deliveryNotes: DeliveryNoteListItem[];
}

export function DeliveryNotesTable({ deliveryNotes }: DeliveryNotesTableProps) {
  const [search, setSearch] = useState('');

  const filtered = deliveryNotes.filter((dn) => {
    const matchesSearch =
      dn.deliveryNumber.toLowerCase().includes(search.toLowerCase()) ||
      (dn.invoiceNumber && dn.invoiceNumber.toLowerCase().includes(search.toLowerCase())) ||
      dn.customerName.toLowerCase().includes(search.toLowerCase()) ||
      dn.customerAccount.toLowerCase().includes(search.toLowerCase()) ||
      (dn.receivedByCustomer && dn.receivedByCustomer.toLowerCase().includes(search.toLowerCase()));

    return matchesSearch;
  });

  return (
    <div className="space-y-4">
      {/* Top Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by DN #, invoice #, customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-card"
          />
        </div>

        <Button asChild className="bg-ace-gold text-ace-navy hover:bg-ace-gold/90 font-semibold shadow-sm">
          <Link href="/sales/delivery-notes/new">
            <Plus className="mr-1.5 h-4 w-4" /> New Dispatch
          </Link>
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="w-[140px]">Delivery Note #</TableHead>
              <TableHead>Invoice #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead>Received By</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                  No delivery notes found matching your search.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((dn) => (
                <TableRow key={dn.id} className="hover:bg-muted/30 transition">
                  <TableCell className="font-mono text-xs font-semibold text-ace-navy">
                    <Link href={`/sales/delivery-notes/${dn.id}`} className="hover:underline">
                      {dn.deliveryNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/sales/invoices/${dn.salesDocumentId}`} className="text-blue-600 hover:underline">
                      {dn.invoiceNumber || 'Draft Invoice'}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="font-semibold text-foreground">{dn.customerName}</div>
                    <div className="text-xs font-mono text-muted-foreground">{dn.customerAccount}</div>
                  </TableCell>
                  <TableCell className="text-xs">{new Date(dn.deliveryDate).toLocaleDateString()}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className="capitalize text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                      {dn.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {dn.receivedByCustomer || '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-medium">
                    {dn.itemsCount}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0" title="View Delivery Note">
                        <Link href={`/sales/delivery-notes/${dn.id}`}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0" title="Download PDF">
                        <a href={`/api/pdf/delivery_note/${dn.id}`} target="_blank" rel="noreferrer">
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
