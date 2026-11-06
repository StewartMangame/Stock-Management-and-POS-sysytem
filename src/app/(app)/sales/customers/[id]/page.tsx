import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import {
  customers,
  salesDocuments,
  quotations,
  deliveryNotes,
  serialNumbers,
  products,
  payments,
} from '@/server/db/schema';
import { eq, desc } from 'drizzle-orm';
import { getCustomerById, getCustomerCreditStatus } from '@/server/services/sales/customers';
import { getCustomerCredit } from '@/server/services/sales/payments';
import { EntityHistoryTab } from '@/components/shared/EntityHistoryTab';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Building2,
  User,
  ArrowLeft,
  FileText,
  Truck,
  RotateCcw,
  ShieldCheck,
  CreditCard,
  Download,
} from 'lucide-react';

interface CustomerDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function CustomerDetailPage({ params }: CustomerDetailPageProps) {
  try {
    await authorize(PERMISSIONS.CUSTOMERS_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const { id } = await params;
  const customer = await getCustomerById(id);
  if (!customer) notFound();

  const creditStatus = await getCustomerCreditStatus(id);
  const customerCredit = await getCustomerCredit(id);

  // Fetch all sales documents for this customer
  const documents = await db
    .select()
    .from(salesDocuments)
    .where(eq(salesDocuments.customerId, id))
    .orderBy(desc(salesDocuments.createdAt));

  // Fetch payments for this customer
  const customerPayments = await db
    .select()
    .from(payments)
    .where(eq(payments.customerId, id))
    .orderBy(desc(payments.createdAt));

  // Fetch quotations for this customer
  const customerQuotes = await db
    .select()
    .from(quotations)
    .where(eq(quotations.customerId, id))
    .orderBy(desc(quotations.createdAt));

  // Fetch delivery notes for this customer
  const customerDeliveries = await db
    .select()
    .from(deliveryNotes)
    .where(eq(deliveryNotes.customerId, id))
    .orderBy(desc(deliveryNotes.createdAt));

  // Fetch owned serial numbers with product details
  const customerSerials = await db
    .select({
      id: serialNumbers.id,
      serialNumber: serialNumbers.serialNumber,
      warrantyStart: serialNumbers.warrantyStart,
      warrantyEnd: serialNumbers.warrantyEnd,
      status: serialNumbers.status,
      productName: products.name,
      productSku: products.sku,
    })
    .from(serialNumbers)
    .innerJoin(products, eq(serialNumbers.productId, products.id))
    .where(eq(serialNumbers.customerId, id))
    .orderBy(desc(serialNumbers.updatedAt));

  return (
    <div className="space-y-6">
      {/* Top Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm" className="h-8 gap-1">
            <Link href="/sales/customers">
              <ArrowLeft className="h-4 w-4" /> Back to Customers
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-ace-navy">{customer.name}</h1>
              {customer.isWalkIn ? (
                <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-300">
                  WALK-IN (PROTECTED)
                </Badge>
              ) : customer.customerType === 'business' ? (
                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                  <Building2 className="mr-1 h-3 w-3" /> Corporate
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">
                  <User className="mr-1 h-3 w-3" /> Individual
                </Badge>
              )}
            </div>
            <p className="text-xs font-mono text-muted-foreground">Account #{customer.accountNumber}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 shadow-sm">
            <Link href={`/reports/customer-statement?customerId=${customer.id}`}>
              <FileText className="h-3.5 w-3.5" /> Customer Statement
            </Link>
          </Button>
          <Button asChild size="sm" className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 font-semibold shadow-sm">
            <Link href={`/sales/payments/new?customerId=${customer.id}`}>
              <CreditCard className="h-3.5 w-3.5" /> Record Payment
            </Link>
          </Button>
        </div>
      </div>

      {/* Profile & Credit Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">
              Credit Limit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold font-mono text-foreground">
              {customer.isWalkIn ? (
                <span className="text-muted-foreground text-sm">N/A</span>
              ) : (
                `MWK ${(creditStatus.creditLimitMinor / 100).toLocaleString('en-MW', {
                  minimumFractionDigits: 2,
                })}`
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Terms: {customer.paymentTermsDays} days
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">
              Outstanding Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold font-mono text-amber-600">
              MWK {(creditStatus.outstandingBalanceMinor / 100).toLocaleString('en-MW', {
                minimumFractionDigits: 2,
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Across unpaid issued invoices</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">
              Available Credit Limit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-xl font-bold font-mono ${creditStatus.availableCreditMinor < 0 ? 'text-rose-600' : 'text-foreground'}`}>
              MWK {(creditStatus.availableCreditMinor / 100).toLocaleString('en-MW', {
                minimumFractionDigits: 2,
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {creditStatus.isOverLimit ? 'Credit limit exceeded' : 'Credit standing good'}
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-emerald-200 bg-emerald-50/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-emerald-800 uppercase flex items-center gap-1">
              <CreditCard className="h-3 w-3 text-emerald-600" /> Customer Credit (Deposits)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold font-mono text-emerald-700">
              MWK {(Number(customerCredit.creditMinor) / 100).toLocaleString('en-MW', {
                minimumFractionDigits: 2,
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Unallocated funds / on deposit
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">
              Contact & Tax
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-1">
            <div><span className="text-muted-foreground">TPIN:</span> {customer.taxNumber || '—'}</div>
            <div><span className="text-muted-foreground">Phone:</span> {customer.phone || '—'}</div>
            <div className="truncate"><span className="text-muted-foreground">Email:</span> {customer.email || '—'}</div>
          </CardContent>
        </Card>
      </div>

      {/* Invoices & Credit Notes Section */}
      <Card className="shadow-sm overflow-hidden">
        <CardHeader className="bg-muted/30 border-b py-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold text-ace-navy flex items-center gap-2">
            <FileText className="h-4 w-4" /> Tax Invoices & Credit Notes ({documents.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/20">
              <TableRow>
                <TableHead>Doc Number</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Delivery Status</TableHead>
                <TableHead>Payment Status</TableHead>
                <TableHead className="text-right">Total Amount</TableHead>
                <TableHead className="text-right">Balance Due</TableHead>
                <TableHead className="text-right">PDF</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    No invoices or credit notes recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="font-mono font-medium text-ace-navy">
                      <Link href={`/sales/invoices/${doc.id}`} className="hover:underline">
                        {doc.documentNumber || 'DRAFT'}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {doc.documentType === 'credit_note' ? (
                        <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200">
                          Credit Note
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                          Invoice
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{doc.issueDate}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize text-xs">
                        {doc.deliveryStatus.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          doc.paymentStatus === 'paid'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : doc.paymentStatus === 'partly_paid'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                        }
                      >
                        {doc.paymentStatus.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      MWK {(doc.totalMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold text-ace-navy">
                      MWK {(doc.balanceMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm" className="h-7 w-7 p-0">
                        <a href={`/api/pdf/${doc.documentType}/${doc.id}`} target="_blank" rel="noreferrer">
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Payments & Receipts Section */}
      <Card className="shadow-sm overflow-hidden">
        <CardHeader className="bg-muted/30 border-b py-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold text-ace-navy flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-emerald-600" /> Payments & Receipts ({customerPayments.length})
          </CardTitle>
          <Button asChild variant="outline" size="sm" className="h-7 text-xs gap-1">
            <Link href={`/sales/payments/new?customerId=${customer.id}`}>
              + Record Payment
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/20">
              <TableRow>
                <TableHead>Payment #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total Amount</TableHead>
                <TableHead className="text-right">Receipt PDF</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customerPayments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No payments recorded for this customer yet.
                  </TableCell>
                </TableRow>
              ) : (
                customerPayments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono font-semibold text-ace-navy">
                      <Link href={`/sales/payments/${p.id}`} className="hover:underline">
                        {p.paymentNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">
                      {new Date(p.paymentDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="capitalize text-xs">
                      {p.method.replace('_', ' ')}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          p.status === 'confirmed'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 capitalize'
                            : p.status === 'pending'
                            ? 'bg-amber-50 text-amber-700 border-amber-200 capitalize'
                            : 'bg-rose-50 text-rose-700 border-rose-200 capitalize'
                        }
                      >
                        {p.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      MWK {(p.amountMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm" className="h-7 w-7 p-0">
                        <a href={`/api/pdf/receipt/${p.id}`} target="_blank" rel="noreferrer">
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Quotations & Delivery Notes Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Quotations */}
        <Card className="shadow-sm overflow-hidden">
          <CardHeader className="bg-muted/30 border-b py-3">
            <CardTitle className="text-base font-semibold text-ace-navy flex items-center gap-2">
              <FileText className="h-4 w-4" /> Quotations ({customerQuotes.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/20">
                <TableRow>
                  <TableHead>Quote #</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customerQuotes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-20 text-center text-muted-foreground text-xs">
                      No quotations issued yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  customerQuotes.map((q) => (
                    <TableRow key={q.id}>
                      <TableCell className="font-mono text-xs font-semibold">
                        <Link href={`/sales/quotations/${q.id}`} className="hover:underline">
                          {q.quotationNumber || 'DRAFT'}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize text-[10px]">
                          {q.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-medium">
                        MWK {(q.totalMinor / 100).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm" className="h-6 w-6 p-0">
                          <a href={`/api/pdf/quotation/${q.id}`} target="_blank" rel="noreferrer">
                            <Download className="h-3 w-3" />
                          </a>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Delivery Notes */}
        <Card className="shadow-sm overflow-hidden">
          <CardHeader className="bg-muted/30 border-b py-3">
            <CardTitle className="text-base font-semibold text-ace-navy flex items-center gap-2">
              <Truck className="h-4 w-4" /> Dispatches & Deliveries ({customerDeliveries.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/20">
                <TableRow>
                  <TableHead>DN Number</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">PDF</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customerDeliveries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-20 text-center text-muted-foreground text-xs">
                      No deliveries dispatched yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  customerDeliveries.map((dn) => (
                    <TableRow key={dn.id}>
                      <TableCell className="font-mono text-xs font-semibold text-ace-navy">
                        {dn.deliveryNumber}
                      </TableCell>
                      <TableCell className="text-xs">{dn.deliveryDate}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 text-[10px]">
                          Dispatched
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm" className="h-6 w-6 p-0">
                          <a href={`/api/pdf/delivery_note/${dn.id}`} target="_blank" rel="noreferrer">
                            <Download className="h-3 w-3" />
                          </a>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Owned Serial Numbers with Warranty Information */}
      <Card className="shadow-sm overflow-hidden">
        <CardHeader className="bg-muted/30 border-b py-3">
          <CardTitle className="text-base font-semibold text-ace-navy flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Owned Equipment & Warranty Tracking ({customerSerials.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/20">
              <TableRow>
                <TableHead>Serial Number</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Warranty Start</TableHead>
                <TableHead>Warranty End</TableHead>
                <TableHead className="text-right">Warranty Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customerSerials.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No serialized equipment registered to this customer.
                  </TableCell>
                </TableRow>
              ) : (
                customerSerials.map((s) => {
                  const isExpired = s.warrantyEnd ? new Date(s.warrantyEnd) < new Date() : false;
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono font-semibold text-ace-navy">{s.serialNumber}</TableCell>
                      <TableCell className="font-medium">{s.productName}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{s.productSku}</TableCell>
                      <TableCell className="text-xs">{s.warrantyStart || '—'}</TableCell>
                      <TableCell className="text-xs">{s.warrantyEnd || '—'}</TableCell>
                      <TableCell className="text-right">
                        {s.warrantyEnd ? (
                          isExpired ? (
                            <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200">
                              Expired
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                              Active
                            </Badge>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">N/A</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Historical Audit Log Timeline */}
      <EntityHistoryTab entityType="customer" entityId={customer.id} />
    </div>
  );
}
