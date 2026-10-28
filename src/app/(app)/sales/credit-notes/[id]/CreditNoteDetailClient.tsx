'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowLeft, Download, RotateCcw, Building2, Calendar, FileText, CheckCircle2 } from 'lucide-react';

interface CreditNoteDetailProps {
  creditNote: {
    id: string;
    documentNumber: string | null;
    issueDate: string;
    status: string;
    subtotalMinor: number;
    discountMinor: number;
    taxMinor: number;
    totalMinor: number;
    notes: string | null;
    terms: string | null;
    createdAt: string;
    sourceInvoice?: {
      id: string;
      documentNumber: string | null;
    } | null;
    customer: {
      id: string;
      name: string;
      accountNumber: string;
      email: string | null;
      phone: string | null;
      taxNumber: string | null;
    };
    location: {
      id: string;
      name: string;
      code: string;
    };
    createdByUser?: {
      name: string;
    } | null;
    lines: Array<{
      id: string;
      productName: string;
      sku: string;
      quantity: string;
      unitPriceMinor: number;
      discountMinor: number;
      taxRateBasisPoints: number;
      taxMinor: number;
      lineTotalMinor: number;
      returnGoods: boolean;
      notes: string | null;
    }>;
  };
}

export function CreditNoteDetailClient({ creditNote: cn }: CreditNoteDetailProps) {
  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm" className="h-8 gap-1">
            <Link href="/sales/credit-notes">
              <ArrowLeft className="h-4 w-4" /> Back to Credit Notes
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-ace-navy">
                Credit Note {cn.documentNumber || 'DRAFT'}
              </h1>
              <Badge variant="outline" className="capitalize text-xs bg-rose-50 text-rose-700 border-rose-200">
                {cn.status}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Issued on {new Date(cn.issueDate).toLocaleDateString()}
              {cn.sourceInvoice && (
                <>
                  {' '}against Invoice{' '}
                  <Link
                    href={`/sales/invoices/${cn.sourceInvoice.id}`}
                    className="font-mono text-ace-navy hover:underline"
                  >
                    {cn.sourceInvoice.documentNumber || 'View Invoice'}
                  </Link>
                </>
              )}
            </p>
          </div>
        </div>

        <Button asChild variant="outline" size="sm" className="h-9 gap-1.5 shadow-sm">
          <a href={`/api/pdf/credit_note/${cn.id}`} target="_blank" rel="noreferrer">
            <Download className="h-4 w-4" /> Download PDF
          </a>
        </Button>
      </div>

      {/* Meta Grid */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5" /> Customer Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <Link
              href={`/sales/customers/${cn.customer.id}`}
              className="text-base font-bold text-ace-navy hover:underline"
            >
              {cn.customer.name}
            </Link>
            <div className="text-xs font-mono text-muted-foreground">
              Account: {cn.customer.accountNumber}
            </div>
            {cn.customer.taxNumber && (
              <div className="text-xs text-muted-foreground">TPIN: {cn.customer.taxNumber}</div>
            )}
            {cn.customer.phone && (
              <div className="text-xs text-muted-foreground">Tel: {cn.customer.phone}</div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" /> Credit Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Branch Location:</span>
              <span className="font-semibold">{cn.location.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Issued By:</span>
              <span className="font-semibold">{cn.createdByUser?.name || 'System'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Source Invoice:</span>
              <span className="font-mono font-semibold">
                {cn.sourceInvoice ? (
                  <Link
                    href={`/sales/invoices/${cn.sourceInvoice.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {cn.sourceInvoice.documentNumber}
                  </Link>
                ) : (
                  '—'
                )}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm bg-rose-50/20 border-rose-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-rose-800 uppercase flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Credited Financials
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Net Credited:</span>
              <span className="font-mono">
                MWK {(cn.subtotalMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">VAT Credited:</span>
              <span className="font-mono">
                MWK {(cn.taxMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="border-t pt-1.5 flex justify-between text-sm font-bold text-rose-700">
              <span>Total Credited:</span>
              <span className="font-mono">
                MWK {(cn.totalMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Credited Lines Table */}
      <Card className="shadow-sm overflow-hidden">
        <CardHeader className="bg-muted/30 pb-3">
          <CardTitle className="text-sm font-bold text-ace-navy">
            Credited Items ({cn.lines.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/20">
              <TableRow>
                <TableHead className="w-10 text-center">#</TableHead>
                <TableHead>Product / Description</TableHead>
                <TableHead className="text-right">Qty Credited</TableHead>
                <TableHead className="text-center">Restocked</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right font-semibold">Credited Total (MWK)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cn.lines.map((line, idx) => (
                <TableRow key={line.id}>
                  <TableCell className="text-center font-mono text-xs text-muted-foreground">
                    {idx + 1}
                  </TableCell>
                  <TableCell>
                    <div className="font-semibold text-foreground">{line.productName}</div>
                    <div className="text-xs font-mono text-muted-foreground">SKU: {line.sku}</div>
                    {line.notes && <div className="text-xs text-muted-foreground mt-0.5">{line.notes}</div>}
                  </TableCell>
                  <TableCell className="text-right font-mono font-bold text-sm text-foreground">
                    {parseFloat(line.quantity).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        line.returnGoods
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                          : 'bg-gray-50 text-gray-600 border-gray-200'
                      }`}
                    >
                      {line.returnGoods ? 'Restocked to Stock' : 'Credit Only'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {(line.unitPriceMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {(line.taxMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right font-mono font-bold text-rose-600">
                    {(line.lineTotalMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Notes & Terms */}
      {(cn.notes || cn.terms) && (
        <div className="grid gap-4 md:grid-cols-2">
          {cn.notes && (
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">
                  Credit Reason & Notes
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs whitespace-pre-wrap text-muted-foreground">
                {cn.notes}
              </CardContent>
            </Card>
          )}
          {cn.terms && (
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">
                  Terms
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs whitespace-pre-wrap text-muted-foreground">
                {cn.terms}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
