/**
 * Payment Receipt, Customer Statement, and Aged Debtors PDF Generator.
 * Built using @react-pdf/renderer with Ace Holdings Limited letterhead.
 */

import React from 'react';
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { db } from '@/server/db';
import { payments, paymentAllocations, salesDocuments, customers } from '@/server/db/schema';
import { eq, asc } from 'drizzle-orm';
import { getAllSettings } from '@/server/services/settings';
import { formatTambala } from '@/lib/money';
import { getCustomerStatement } from '@/server/services/reports/customer-statement';
import { getAgedDebtors } from '@/server/services/reports/aged-debtors';
import { isStaging } from '@/lib/env';

const styles = StyleSheet.create({
  page: {
    padding: 30,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: '#1E293B',
    lineHeight: 1.4,
  },
  watermark: {
    position: 'absolute',
    top: '35%',
    left: '15%',
    transform: 'rotate(-45deg)',
    fontSize: 80,
    color: 'rgba(239, 68, 68, 0.35)',
    fontWeight: 'bold',
    letterSpacing: 10,
    zIndex: -1,
  },
  watermarkPending: {
    position: 'absolute',
    top: '35%',
    left: '15%',
    transform: 'rotate(-45deg)',
    fontSize: 80,
    color: 'rgba(234, 179, 8, 0.35)',
    fontWeight: 'bold',
    letterSpacing: 10,
    zIndex: -1,
  },
  headerBand: {
    backgroundColor: '#0B2545',
    color: '#FFFFFF',
    padding: 12,
    borderRadius: 4,
    marginBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  companyName: {
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1,
    color: '#FFFFFF',
  },
  companySubtitle: {
    fontSize: 8,
    color: '#94A3B8',
  },
  docTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'right',
  },
  docMetaRight: {
    fontSize: 8,
    color: '#94A3B8',
    textAlign: 'right',
  },
  section: {
    marginBottom: 14,
  },
  twoCol: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  card: {
    backgroundColor: '#F8FAFC',
    border: '1pt solid #E2E8F0',
    borderRadius: 4,
    padding: 8,
    flex: 1,
    marginRight: 8,
  },
  cardLast: {
    backgroundColor: '#F8FAFC',
    border: '1pt solid #E2E8F0',
    borderRadius: 4,
    padding: 8,
    flex: 1,
  },
  cardTitle: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#64748B',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  cardText: {
    fontSize: 9,
    color: '#1E293B',
  },
  table: {
    marginTop: 10,
    marginBottom: 14,
    border: '1pt solid #E2E8F0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderBottom: '1pt solid #E2E8F0',
    padding: 6,
    fontWeight: 'bold',
    fontSize: 8,
    color: '#475569',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottom: '1pt solid #F1F5F9',
    padding: 6,
    fontSize: 8,
  },
  tableRowTotal: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    borderTop: '1.5pt solid #CBD5E1',
    padding: 6,
    fontWeight: 'bold',
    fontSize: 8,
  },
  colNumber: { width: '22%' },
  colDate: { width: '18%' },
  colDesc: { width: '35%' },
  colAmount: { width: '25%', textAlign: 'right' },
  colDebit: { width: '18%', textAlign: 'right' },
  colCredit: { width: '18%', textAlign: 'right' },
  colBalance: { width: '18%', textAlign: 'right' },
  noticeBox: {
    backgroundColor: '#FEF3C7',
    border: '1pt solid #F59E0B',
    borderRadius: 4,
    padding: 8,
    marginBottom: 12,
  },
  noticeText: {
    fontSize: 9,
    color: '#92400E',
    fontWeight: 'bold',
  },
  footer: {
    position: 'absolute',
    bottom: 25,
    left: 30,
    right: 30,
    borderTop: '1pt solid #E2E8F0',
    paddingTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7,
    color: '#94A3B8',
  },
});

// ── Payment Receipt Document ─────────────────────────────────────────────────

export function PaymentReceiptDocument({
  payment,
  customer,
  allocations,
  company,
}: {
  payment: any;
  customer: any;
  allocations: any[];
  company: any;
}) {
  const isReversed = payment.status === 'reversed';
  const isPending = payment.status === 'pending';
  const isFailed = payment.status === 'failed';

  const totalAllocated = allocations.reduce((sum, a) => sum + Number(a.amountMinor), 0);
  const unallocatedCredit = Number(payment.amountMinor) - totalAllocated;

  const methodDetails = payment.methodDetails || {};

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {isStaging() && (
          <View style={{ backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#ef4444', padding: 4, marginBottom: 8, alignItems: 'center' }}>
            <Text style={{ color: '#b91c1c', fontSize: 9.5, fontWeight: 'bold' }}>
              STAGING, TEST DATA, NOT A REAL TAX INVOICE
            </Text>
          </View>
        )}
        {isReversed && <Text style={styles.watermark}>REVERSED</Text>}
        {isPending && <Text style={styles.watermarkPending}>PENDING</Text>}
        {isFailed && <Text style={styles.watermark}>FAILED</Text>}

        {/* Header */}
        <View style={styles.headerBand}>
          <View>
            <Text style={styles.companyName}>{company.company_name || 'ACE HOLDINGS LIMITED'}</Text>
            <Text style={styles.companySubtitle}>Point of Sale & Stock Management System</Text>
          </View>
          <View>
            <Text style={styles.docTitle}>
              {payment.kind === 'refund' ? 'REFUND VOUCHER' : 'OFFICIAL RECEIPT'}
            </Text>
            <Text style={styles.docMetaRight}>No: {payment.paymentNumber}</Text>
            <Text style={styles.docMetaRight}>Date: {payment.paymentDate}</Text>
          </View>
        </View>

        {/* Pending Cheque notice */}
        {payment.method === 'cheque' && isPending && (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>
              NOTICE: Cheque received, subject to clearing. Provisional allocations will apply once cleared.
            </Text>
          </View>
        )}

        {/* Customer & Payment Info */}
        <View style={styles.twoCol}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Received From</Text>
            <Text style={[styles.cardText, { fontWeight: 'bold' }]}>{customer?.name || 'Walk-in'}</Text>
            <Text style={styles.cardText}>Account: {customer?.accountNumber || '—'}</Text>
            {customer?.taxNumber && <Text style={styles.cardText}>TPIN: {customer.taxNumber}</Text>}
            {customer?.phone && <Text style={styles.cardText}>Phone: {customer.phone}</Text>}
          </View>
          <View style={styles.cardLast}>
            <Text style={styles.cardTitle}>Payment Details</Text>
            <Text style={styles.cardText}>
              Method: <Text style={{ fontWeight: 'bold' }}>{payment.method.toUpperCase().replace('_', ' ')}</Text>
            </Text>
            <Text style={styles.cardText}>Status: {payment.status.toUpperCase()}</Text>

            {/* Method Details */}
            {payment.method === 'cheque' && (
              <>
                <Text style={styles.cardText}>Cheque No: {methodDetails.cheque_number || '—'}</Text>
                <Text style={styles.cardText}>Bank: {methodDetails.bank || '—'}</Text>
                <Text style={styles.cardText}>Cheque Date: {methodDetails.cheque_date || '—'}</Text>
              </>
            )}
            {payment.method === 'bank_transfer' && (
              <>
                <Text style={styles.cardText}>Bank Ref: {methodDetails.bank_reference || '—'}</Text>
                {methodDetails.bank_name && <Text style={styles.cardText}>Bank: {methodDetails.bank_name}</Text>}
              </>
            )}
            {payment.method === 'card' && (
              <>
                <Text style={styles.cardText}>Approval Code: {methodDetails.approval_code || '—'}</Text>
                <Text style={styles.cardText}>Slip No: {methodDetails.slip_number || '—'}</Text>
              </>
            )}
            {(payment.method === 'airtel_money' || payment.method === 'mpamba') && (
              <>
                <Text style={styles.cardText}>Txn ID: {methodDetails.transaction_id || '—'}</Text>
                <Text style={styles.cardText}>Sender Phone: {methodDetails.sender_phone || '—'}</Text>
              </>
            )}
          </View>
        </View>

        {/* Total Amount Box */}
        <View
          style={{
            backgroundColor: '#0B2545',
            padding: 10,
            borderRadius: 4,
            marginBottom: 14,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: 'bold' }}>TOTAL AMOUNT RECEIVED</Text>
          <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: 'bold' }}>
            {formatTambala(payment.amountMinor)}
          </Text>
        </View>

        {/* Allocations Table */}
        <View style={styles.section}>
          <Text style={{ fontSize: 9, fontWeight: 'bold', color: '#0B2545', marginBottom: 4 }}>
            ALLOCATIONS TO INVOICES
          </Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={styles.colNumber}>Invoice #</Text>
              <Text style={styles.colDesc}>Notes</Text>
              <Text style={styles.colDate}>Allocated Date</Text>
              <Text style={styles.colAmount}>Allocated (MWK)</Text>
            </View>

            {allocations.length === 0 ? (
              <View style={styles.tableRow}>
                <Text style={{ width: '100%', fontStyle: 'italic', color: '#64748B' }}>
                  No invoice allocations — amount placed on customer account credit.
                </Text>
              </View>
            ) : (
              allocations.map((a: any, idx: number) => (
                <View key={idx} style={styles.tableRow}>
                  <Text style={styles.colNumber}>{a.documentNumber || a.invoiceId.slice(0, 8)}</Text>
                  <Text style={styles.colDesc}>{a.notes || 'Payment allocation'}</Text>
                  <Text style={styles.colDate}>
                    {a.allocatedAt ? new Date(a.allocatedAt).toISOString().slice(0, 10) : '—'}
                  </Text>
                  <Text style={styles.colAmount}>{formatTambala(a.amountMinor)}</Text>
                </View>
              ))
            )}

            {unallocatedCredit > 0 && (
              <View style={[styles.tableRow, { backgroundColor: '#F0FDF4' }]}>
                <Text style={styles.colNumber}>ACCOUNT CREDIT</Text>
                <Text style={styles.colDesc}>Applied to account credit for future invoices</Text>
                <Text style={styles.colDate}>—</Text>
                <Text style={[styles.colAmount, { color: '#166534', fontWeight: 'bold' }]}>
                  {formatTambala(unallocatedCredit)}
                </Text>
              </View>
            )}

            <View style={styles.tableRowTotal}>
              <Text style={{ width: '75%', fontWeight: 'bold' }}>Total Accounted For</Text>
              <Text style={styles.colAmount}>{formatTambala(payment.amountMinor)}</Text>
            </View>
          </View>
        </View>

        {payment.notes && (
          <View style={styles.section}>
            <Text style={styles.cardTitle}>Notes</Text>
            <Text style={styles.cardText}>{payment.notes}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text>Ace Holdings Limited — Official Receipt</Text>
          <Text>System Generated Document</Text>
        </View>
      </Page>
    </Document>
  );
}

// ── Customer Statement Document ──────────────────────────────────────────────

export function CustomerStatementDocument({
  statement,
  company,
}: {
  statement: any;
  company: any;
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {isStaging() && (
          <View style={{ backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#ef4444', padding: 4, marginBottom: 8, alignItems: 'center' }}>
            <Text style={{ color: '#b91c1c', fontSize: 9.5, fontWeight: 'bold' }}>
              STAGING, TEST DATA, NOT A REAL TAX INVOICE
            </Text>
          </View>
        )}
        {/* Header */}
        <View style={styles.headerBand}>
          <View>
            <Text style={styles.companyName}>{company.company_name || 'ACE HOLDINGS LIMITED'}</Text>
            <Text style={styles.companySubtitle}>Accounts Receivable — Customer Statement</Text>
          </View>
          <View>
            <Text style={styles.docTitle}>ACCOUNT STATEMENT</Text>
            <Text style={styles.docMetaRight}>
              Period: {statement.period.from} to {statement.period.to}
            </Text>
          </View>
        </View>

        {/* Customer Card */}
        <View style={styles.twoCol}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Customer</Text>
            <Text style={[styles.cardText, { fontWeight: 'bold' }]}>{statement.customer.name}</Text>
            <Text style={styles.cardText}>Account: {statement.customer.accountNumber}</Text>
            {statement.customer.taxNumber && <Text style={styles.cardText}>TPIN: {statement.customer.taxNumber}</Text>}
            {statement.customer.phone && <Text style={styles.cardText}>Phone: {statement.customer.phone}</Text>}
          </View>
          <View style={styles.cardLast}>
            <Text style={styles.cardTitle}>Account Summary</Text>
            <Text style={styles.cardText}>Opening Balance: {formatTambala(statement.openingBalanceMinor)}</Text>
            <Text style={styles.cardText}>Total Invoiced (Debits): {formatTambala(statement.totalDebitsMinor)}</Text>
            <Text style={styles.cardText}>Total Paid (Credits): {formatTambala(statement.totalCreditsMinor)}</Text>
            <Text style={[styles.cardText, { fontWeight: 'bold', marginTop: 4 }]}>
              Closing Balance: {formatTambala(statement.closingBalanceMinor)}
            </Text>
          </View>
        </View>

        {/* Transactions Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={{ width: '15%' }}>Date</Text>
            <Text style={{ width: '22%' }}>Reference</Text>
            <Text style={{ width: '27%' }}>Description</Text>
            <Text style={styles.colDebit}>Debit (MWK)</Text>
            <Text style={styles.colCredit}>Credit (MWK)</Text>
            <Text style={styles.colBalance}>Balance (MWK)</Text>
          </View>

          {/* Opening balance row */}
          <View style={[styles.tableRow, { backgroundColor: '#F8FAFC' }]}>
            <Text style={{ width: '15%' }}>{statement.period.from}</Text>
            <Text style={{ width: '22%' }}>OPENING</Text>
            <Text style={{ width: '27%', fontStyle: 'italic' }}>Opening Balance</Text>
            <Text style={styles.colDebit}>—</Text>
            <Text style={styles.colCredit}>—</Text>
            <Text style={[styles.colBalance, { fontWeight: 'bold' }]}>
              {formatTambala(statement.openingBalanceMinor)}
            </Text>
          </View>

          {statement.lines.map((line: any, idx: number) => (
            <View key={idx} style={styles.tableRow}>
              <Text style={{ width: '15%' }}>{line.date}</Text>
              <Text style={{ width: '22%' }}>{line.reference}</Text>
              <Text style={{ width: '27%' }}>{line.description}</Text>
              <Text style={styles.colDebit}>
                {line.debitMinor > 0 ? formatTambala(line.debitMinor) : '—'}
              </Text>
              <Text style={styles.colCredit}>
                {line.creditMinor > 0 ? formatTambala(line.creditMinor) : '—'}
              </Text>
              <Text style={[styles.colBalance, { fontWeight: 'bold' }]}>
                {formatTambala(line.runningBalanceMinor)}
              </Text>
            </View>
          ))}

          {/* Closing balance row */}
          <View style={styles.tableRowTotal}>
            <Text style={{ width: '64%', fontWeight: 'bold' }}>CLOSING BALANCE DUE</Text>
            <Text style={[styles.colBalance, { width: '36%', fontSize: 9 }]}>
              {formatTambala(statement.closingBalanceMinor)}
            </Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text>Ace Holdings Limited — Customer Statement</Text>
          <Text>Generated on: {new Date(statement.generatedAt).toLocaleDateString()}</Text>
        </View>
      </Page>
    </Document>
  );
}

// ── Aged Debtors Document ────────────────────────────────────────────────────

export function AgedDebtorsDocument({
  report,
  company,
}: {
  report: any;
  company: any;
}) {
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        {isStaging() && (
          <View style={{ backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#ef4444', padding: 4, marginBottom: 8, alignItems: 'center' }}>
            <Text style={{ color: '#b91c1c', fontSize: 9.5, fontWeight: 'bold' }}>
              STAGING, TEST DATA, NOT A REAL TAX INVOICE
            </Text>
          </View>
        )}
        {/* Header */}
        <View style={styles.headerBand}>
          <View>
            <Text style={styles.companyName}>{company.company_name || 'ACE HOLDINGS LIMITED'}</Text>
            <Text style={styles.companySubtitle}>Accounts Receivable — Aged Debtors Ledger</Text>
          </View>
          <View>
            <Text style={styles.docTitle}>AGED DEBTORS REPORT</Text>
            <Text style={styles.docMetaRight}>As of Date: {report.asOf}</Text>
          </View>
        </View>

        <Text style={{ fontSize: 8, fontStyle: 'italic', color: '#64748B', marginBottom: 8 }}>
          * Excludes void invoices and fully-credited invoices. Historical point-in-time calculation.
        </Text>

        {/* Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={{ width: '18%' }}>Customer</Text>
            <Text style={{ width: '9%', textAlign: 'right' }}>Current</Text>
            <Text style={{ width: '9%', textAlign: 'right' }}>1-30 Days</Text>
            <Text style={{ width: '9%', textAlign: 'right' }}>31-60 Days</Text>
            <Text style={{ width: '9%', textAlign: 'right' }}>61-90 Days</Text>
            <Text style={{ width: '9%', textAlign: 'right' }}>90+ Days</Text>
            <Text style={{ width: '13%', textAlign: 'right' }}>Total Outstanding</Text>
            <Text style={{ width: '11%', textAlign: 'right' }}>Credit</Text>
            <Text style={{ width: '13%', textAlign: 'right' }}>Net Due</Text>
          </View>

          {report.rows.length === 0 ? (
            <View style={styles.tableRow}>
              <Text style={{ width: '100%', textAlign: 'center', color: '#64748B', fontStyle: 'italic' }}>
                No outstanding debtors as of {report.asOf}.
              </Text>
            </View>
          ) : (
            report.rows.map((row: any, idx: number) => (
              <View key={idx} style={styles.tableRow}>
                <Text style={{ width: '18%' }}>{row.customerName}</Text>
                <Text style={{ width: '9%', textAlign: 'right' }}>{formatTambala(row.currentMinor)}</Text>
                <Text style={{ width: '9%', textAlign: 'right' }}>{formatTambala(row.days1_30Minor)}</Text>
                <Text style={{ width: '9%', textAlign: 'right' }}>{formatTambala(row.days31_60Minor)}</Text>
                <Text style={{ width: '9%', textAlign: 'right' }}>{formatTambala(row.days61_90Minor)}</Text>
                <Text style={{ width: '9%', textAlign: 'right' }}>{formatTambala(row.days90plusMinor)}</Text>
                <Text style={{ width: '13%', textAlign: 'right', fontWeight: 'bold' }}>
                  {formatTambala(row.totalOutstandingMinor)}
                </Text>
                <Text style={{ width: '11%', textAlign: 'right', color: '#166534' }}>
                  {formatTambala(row.customerCreditMinor)}
                </Text>
                <Text style={{ width: '13%', textAlign: 'right', fontWeight: 'bold' }}>
                  {formatTambala(row.netDueMinor)}
                </Text>
              </View>
            ))
          )}

          {/* Grand Totals */}
          <View style={styles.tableRowTotal}>
            <Text style={{ width: '18%', fontWeight: 'bold' }}>GRAND TOTALS</Text>
            <Text style={{ width: '9%', textAlign: 'right' }}>{formatTambala(report.totals.currentMinor)}</Text>
            <Text style={{ width: '9%', textAlign: 'right' }}>{formatTambala(report.totals.days1_30Minor)}</Text>
            <Text style={{ width: '9%', textAlign: 'right' }}>{formatTambala(report.totals.days31_60Minor)}</Text>
            <Text style={{ width: '9%', textAlign: 'right' }}>{formatTambala(report.totals.days61_90Minor)}</Text>
            <Text style={{ width: '9%', textAlign: 'right' }}>{formatTambala(report.totals.days90plusMinor)}</Text>
            <Text style={{ width: '13%', textAlign: 'right', fontWeight: 'bold' }}>
              {formatTambala(report.totals.totalOutstandingMinor)}
            </Text>
            <Text style={{ width: '11%', textAlign: 'right', color: '#166534', fontWeight: 'bold' }}>
              {formatTambala(report.totals.customerCreditMinor)}
            </Text>
            <Text style={{ width: '13%', textAlign: 'right', fontWeight: 'bold' }}>
              {formatTambala(report.totals.netDueMinor)}
            </Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text>Ace Holdings Limited — Confidential</Text>
          <Text>Generated on: {new Date(report.generatedAt).toLocaleString()}</Text>
        </View>
      </Page>
    </Document>
  );
}

// ── PDF Generation Buffers ───────────────────────────────────────────────────

export async function generatePaymentReceiptPdfBuffer(paymentId: string): Promise<Buffer> {
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!payment) throw new Error(`Payment ${paymentId} not found`);

  const [customer] = await db.select().from(customers).where(eq(customers.id, payment.customerId));

  const allocations = await db
    .select({
      id: paymentAllocations.id,
      invoiceId: paymentAllocations.invoiceId,
      amountMinor: paymentAllocations.amountMinor,
      allocatedAt: paymentAllocations.allocatedAt,
      notes: paymentAllocations.notes,
      documentNumber: salesDocuments.documentNumber,
    })
    .from(paymentAllocations)
    .innerJoin(salesDocuments, eq(paymentAllocations.invoiceId, salesDocuments.id))
    .where(eq(paymentAllocations.paymentId, paymentId))
    .orderBy(asc(paymentAllocations.allocatedAt));

  const company = await getAllSettings();

  return await renderToBuffer(
    <PaymentReceiptDocument
      payment={payment}
      customer={customer}
      allocations={allocations}
      company={company}
    />,
  );
}

export async function generateCustomerStatementPdfBuffer(
  customerId: string,
  from: string,
  to: string,
): Promise<Buffer> {
  const statement = await getCustomerStatement(customerId, from, to);
  const company = await getAllSettings();

  return await renderToBuffer(
    <CustomerStatementDocument statement={statement} company={company} />,
  );
}

export async function generateAgedDebtorsPdfBuffer(
  asOf: string,
  locationId?: string,
): Promise<Buffer> {
  const report = await getAgedDebtors(asOf, locationId);
  const company = await getAllSettings();

  return await renderToBuffer(
    <AgedDebtorsDocument report={report} company={company} />,
  );
}
