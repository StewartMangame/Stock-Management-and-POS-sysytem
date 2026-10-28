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
import { ArrowLeft, Download, Truck, Building2, Calendar, FileText, CheckCircle2 } from 'lucide-react';

interface DeliveryNoteDetailProps {
  deliveryNote: {
    id: string;
    deliveryNumber: string;
    deliveryDate: string;
    status: string;
    notes: string | null;
    receivedByCustomer: string | null;
    createdAt: string;
    invoice: {
      id: string;
      documentNumber: string | null;
    };
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
      isBundleComponent: boolean;
      serialNumbers: string[] | null;
    }>;
  };
}

export function DeliveryNoteDetailClient({ deliveryNote: dn }: DeliveryNoteDetailProps) {
  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm" className="h-8 gap-1">
            <Link href="/sales/delivery-notes">
              <ArrowLeft className="h-4 w-4" /> Back to Delivery Notes
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-ace-navy">
                Delivery Note {dn.deliveryNumber}
              </h1>
              <Badge variant="outline" className="capitalize text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                {dn.status}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Dispatched on {new Date(dn.deliveryDate).toLocaleDateString()} for Invoice{' '}
              <Link href={`/sales/invoices/${dn.invoice.id}`} className="font-mono text-ace-navy hover:underline">
                {dn.invoice.documentNumber || 'Draft'}
              </Link>
            </p>
          </div>
        </div>

        <Button asChild variant="outline" size="sm" className="h-9 gap-1.5 shadow-sm">
          <a href={`/api/pdf/delivery_note/${dn.id}`} target="_blank" rel="noreferrer">
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
              href={`/sales/customers/${dn.customer.id}`}
              className="text-base font-bold text-ace-navy hover:underline"
            >
              {dn.customer.name}
            </Link>
            <div className="text-xs font-mono text-muted-foreground">
              Account: {dn.customer.accountNumber}
            </div>
            {dn.customer.taxNumber && (
              <div className="text-xs text-muted-foreground">TPIN: {dn.customer.taxNumber}</div>
            )}
            {dn.customer.phone && (
              <div className="text-xs text-muted-foreground">Tel: {dn.customer.phone}</div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1.5">
              <Truck className="h-3.5 w-3.5" /> Dispatch Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Branch Location:</span>
              <span className="font-semibold">{dn.location.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Dispatched By:</span>
              <span className="font-semibold">{dn.createdByUser?.name || 'System'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Received By Customer:</span>
              <span className="font-semibold text-foreground">{dn.receivedByCustomer || '—'}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> Timeline
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Delivery Date:</span>
              <span className="font-mono">{new Date(dn.deliveryDate).toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created At:</span>
              <span className="font-mono">{new Date(dn.createdAt).toLocaleString()}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Dispatched Lines Table */}
      <Card className="shadow-sm overflow-hidden">
        <CardHeader className="bg-muted/30 pb-3">
          <CardTitle className="text-sm font-bold text-ace-navy">
            Dispatched Items ({dn.lines.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/20">
              <TableRow>
                <TableHead className="w-10 text-center">#</TableHead>
                <TableHead>Product / Description</TableHead>
                <TableHead className="text-right">Quantity Dispatched</TableHead>
                <TableHead>Captured Serial Numbers & Warranty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dn.lines.map((line, idx) => (
                <TableRow key={line.id}>
                  <TableCell className="text-center font-mono text-xs text-muted-foreground">
                    {idx + 1}
                  </TableCell>
                  <TableCell>
                    <div className="font-semibold text-foreground">
                      {line.productName}
                      {line.isBundleComponent && (
                        <span className="ml-2 text-[10px] text-muted-foreground">(Bundle Component)</span>
                      )}
                    </div>
                    <div className="text-xs font-mono text-muted-foreground">SKU: {line.sku}</div>
                  </TableCell>
                  <TableCell className="text-right font-mono font-bold text-sm text-foreground">
                    {parseFloat(line.quantity).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {line.serialNumbers && line.serialNumbers.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {line.serialNumbers.map((s) => (
                          <Badge
                            key={s}
                            variant="secondary"
                            className="font-mono text-[11px] bg-slate-100 text-slate-800"
                          >
                            {s}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">No serial numbers</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Notes */}
      {dn.notes && (
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">
              Dispatch Notes
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs whitespace-pre-wrap text-muted-foreground">
            {dn.notes}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
