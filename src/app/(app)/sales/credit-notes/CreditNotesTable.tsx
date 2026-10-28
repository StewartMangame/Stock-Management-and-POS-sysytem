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
import { Plus, Search, Eye, Download, RotateCcw } from 'lucide-react';

export interface CreditNoteListItem {
  id: string;
  documentNumber: string | null;
  sourceInvoiceId: string | null;
  sourceInvoiceNumber: string | null;
  customerName: string;
  customerAccount: string;
  issueDate: string;
  status: string;
  totalMinor: number;
  linesCount: number;
}

interface CreditNotesTableProps {
  creditNotes: CreditNoteListItem[];
}

export function CreditNotesTable({ creditNotes }: CreditNotesTableProps) {
  const [search, setSearch] = useState('');

  const filtered = creditNotes.filter((cn) => {
    const matchesSearch =
      (cn.documentNumber && cn.documentNumber.toLowerCase().includes(search.toLowerCase())) ||
      (cn.sourceInvoiceNumber && cn.sourceInvoiceNumber.toLowerCase().includes(search.toLowerCase())) ||
      cn.customerName.toLowerCase().includes(search.toLowerCase()) ||
      cn.customerAccount.toLowerCase().includes(search.toLowerCase());

    return matchesSearch;
  });

  return (
    <div className="space-y-4">
      {/* Top Search Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by CN #, invoice #, customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-card"
          />
        </div>

        <Button asChild className="bg-ace-gold text-ace-navy hover:bg-ace-gold/90 font-semibold shadow-sm">
          <Link href="/sales/credit-notes/new">
            <Plus className="mr-1.5 h-4 w-4" /> Issue Credit Note
          </Link>
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="w-[140px]">Credit Note #</TableHead>
              <TableHead>Source Invoice #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Issue Date</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="text-right">Credited Amount (MWK)</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  No credit notes found matching your search.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((cn) => (
                <TableRow key={cn.id} className="hover:bg-muted/30 transition">
                  <TableCell className="font-mono text-xs font-semibold text-ace-navy">
                    <Link href={`/sales/credit-notes/${cn.id}`} className="hover:underline">
                      {cn.documentNumber || 'DRAFT'}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {cn.sourceInvoiceId ? (
                      <Link href={`/sales/invoices/${cn.sourceInvoiceId}`} className="text-blue-600 hover:underline">
                        {cn.sourceInvoiceNumber || 'View Invoice'}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="font-semibold text-foreground">{cn.customerName}</div>
                    <div className="text-xs font-mono text-muted-foreground">{cn.customerAccount}</div>
                  </TableCell>
                  <TableCell className="text-xs">{new Date(cn.issueDate).toLocaleDateString()}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className="capitalize text-xs bg-rose-50 text-rose-700 border-rose-200">
                      {cn.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold text-rose-600">
                    {(cn.totalMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0" title="View Credit Note">
                        <Link href={`/sales/credit-notes/${cn.id}`}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0" title="Download PDF">
                        <a href={`/api/pdf/credit_note/${cn.id}`} target="_blank" rel="noreferrer">
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
