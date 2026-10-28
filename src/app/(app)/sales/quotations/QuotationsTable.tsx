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
import { Plus, Search, Eye, Download, FileText } from 'lucide-react';

export interface QuotationListItem {
  id: string;
  quotationNumber: string | null;
  customerName: string;
  customerAccount: string;
  quotationDate: string | null;
  validUntil: string | null;
  status: string;
  totalMinor: number;
  linesCount: number;
}

interface QuotationsTableProps {
  quotations: QuotationListItem[];
}

export function QuotationsTable({ quotations }: QuotationsTableProps) {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const filtered = quotations.filter((q) => {
    const matchesSearch =
      (q.quotationNumber && q.quotationNumber.toLowerCase().includes(search.toLowerCase())) ||
      q.customerName.toLowerCase().includes(search.toLowerCase()) ||
      q.customerAccount.toLowerCase().includes(search.toLowerCase());

    if (!matchesSearch) return false;
    if (filterStatus === 'all') return true;
    return q.status === filterStatus;
  });

  return (
    <div className="space-y-4">
      {/* Top action bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by quote # or customer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-card"
            />
          </div>

          <div className="flex items-center gap-1.5 rounded-lg border bg-card p-1 text-xs">
            {['all', 'draft', 'sent', 'accepted', 'converted', 'expired', 'cancelled'].map((st) => (
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
        </div>

        <Button asChild className="bg-ace-gold text-ace-navy hover:bg-ace-gold/90 font-semibold shadow-sm">
          <Link href="/sales/quotations/new">
            <Plus className="mr-1.5 h-4 w-4" /> New Quotation
          </Link>
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="w-[140px]">Quote Number</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Valid Until</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="text-right">Total Amount</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  No quotations found matching your criteria.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((q) => (
                <TableRow key={q.id} className="hover:bg-muted/30 transition">
                  <TableCell className="font-mono text-xs font-semibold text-ace-navy">
                    <Link href={`/sales/quotations/${q.id}`} className="hover:underline">
                      {q.quotationNumber || 'DRAFT'}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="font-semibold text-foreground">{q.customerName}</div>
                    <div className="text-xs font-mono text-muted-foreground">{q.customerAccount}</div>
                  </TableCell>
                  <TableCell className="text-xs">{q.quotationDate ? new Date(q.quotationDate).toLocaleDateString() : '—'}</TableCell>
                  <TableCell className="text-xs">{q.validUntil ? new Date(q.validUntil).toLocaleDateString() : '—'}</TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant="outline"
                      className={`capitalize text-xs ${
                        q.status === 'accepted'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : q.status === 'converted'
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : q.status === 'sent'
                          ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                          : q.status === 'expired' || q.status === 'cancelled'
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : 'bg-slate-50 text-slate-700 border-slate-200'
                      }`}
                    >
                      {q.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium">
                    MWK {(q.totalMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0" title="View Details">
                        <Link href={`/sales/quotations/${q.id}`}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0" title="Download PDF">
                        <a href={`/api/pdf/quotation/${q.id}`} target="_blank" rel="noreferrer">
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
