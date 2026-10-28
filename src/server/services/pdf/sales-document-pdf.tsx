/**
 * Sales Document PDF Generator on Ace Holdings Letterhead.
 *
 * Implements:
 *   - Professional letterhead with navy header band and branding
 *   - Prominent diagonal 'DRAFT' watermark if status === 'draft'
 *   - Formatted currency in MWK tambala
 *   - Detailed lines with SKU, Description, Qty, Unit Price, Tax, and Total
 *   - Payment instructions setting on invoices
 *   - Reserved block for MRA EIS QR Code and reference
 *   - Footer with page numbers and confidentiality note
 */

import React from 'react';
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { db } from '@/server/db';
import {
  quotations,
  quotationLines,
  salesDocuments,
  salesDocumentLines,
  deliveryNotes,
  deliveryNoteLines,
  customers,
  products,
} from '@/server/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { getAllSettings } from '@/server/services/settings';

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
    fontSize: 90,
    color: 'rgba(226, 232, 240, 0.45)',
    fontWeight: 'bold',
    letterSpacing: 10,
    zIndex: -1,
  },
  headerBand: {
    backgroundColor: '#0B2545',
    color: '#FFFFFF',
    padding: 12,
    borderRadius: 4,
    marginBottom: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  companyName: {
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1,
    color: '#FFFFFF',
  },
  companySubtitle: {
    fontSize: 8,
    color: '#94A3B8',
  },
  docTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#C9A227', // Ace accent gold
    textAlign: 'right',
  },
  docNumber: {
    fontSize: 10,
    color: '#FFFFFF',
    textAlign: 'right',
  },
  metaGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  metaColumn: {
    width: '48%',
  },
  metaHeading: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#0B2545',
    borderBottomWidth: 1,
    borderBottomColor: '#CBD5E1',
    paddingBottom: 2,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  metaRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  metaLabel: {
    width: '35%',
    color: '#64748B',
    fontSize: 8,
  },
  metaValue: {
    width: '65%',
    fontWeight: 'medium',
    fontSize: 8,
  },
  table: {
    marginTop: 10,
    marginBottom: 15,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#0B2545',
    color: '#FFFFFF',
    padding: 5,
    borderRadius: 2,
    fontWeight: 'bold',
    fontSize: 8,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#E2E8F0',
    paddingVertical: 5,
    paddingHorizontal: 4,
    fontSize: 8,
  },
  tableRowZebra: {
    backgroundColor: '#F8FAFC',
  },
  colSku: { width: '15%' },
  colDesc: { width: '33%' },
  colQty: { width: '10%', textAlign: 'right' },
  colUnitPrice: { width: '14%', textAlign: 'right' },
  colTax: { width: '12%', textAlign: 'right' },
  colTotal: { width: '16%', textAlign: 'right' },
  totalsContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 10,
    marginBottom: 20,
  },
  totalsBox: {
    width: '45%',
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: '#E2E8F0',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#0B2545',
    paddingTop: 4,
    marginTop: 4,
  },
  grandTotalLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#0B2545',
  },
  grandTotalValue: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#0B2545',
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#FEF3C7',
    padding: 4,
    borderRadius: 2,
    marginTop: 4,
  },
  balanceLabel: {
    fontWeight: 'bold',
    color: '#92400E',
  },
  balanceValue: {
    fontWeight: 'bold',
    color: '#92400E',
  },
  instructionsBox: {
    padding: 8,
    backgroundColor: '#F1F5F9',
    borderRadius: 4,
    marginBottom: 15,
  },
  instructionsTitle: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#0B2545',
    marginBottom: 2,
  },
  instructionsText: {
    fontSize: 7.5,
    color: '#475569',
  },
  eisPlaceholderBox: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderStyle: 'dashed',
    padding: 8,
    borderRadius: 4,
    marginBottom: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eisText: {
    fontSize: 7.5,
    color: '#64748B',
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 30,
    right: 30,
    borderTopWidth: 0.5,
    borderTopColor: '#CBD5E1',
    paddingTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7,
    color: '#94A3B8',
  },
});

export interface SalesDocumentPdfData {
  title: string; // 'TAX INVOICE' | 'PROFORMA QUOTATION' | 'CREDIT NOTE' | 'DELIVERY NOTE'
  documentNumber: string;
  status: string; // 'draft' | 'issued' | 'void'
  date: string;
  dueDate?: string;
  currency: string;
  company: {
    name: string;
    address?: string;
    phone?: string;
    email?: string;
    taxNumber?: string;
  };
  customer: {
    accountNumber: string;
    name: string;
    address?: string;
    phone?: string;
    taxNumber?: string;
  };
  lines: Array<{
    sku: string;
    description?: string;
    quantity: string | number;
    unitPriceMinor: number;
    discountMinor?: number;
    taxMinor: number;
    lineTotalMinor: number;
    serials?: string[];
  }>;
  totals?: {
    subtotalMinor: number;
    discountMinor: number;
    taxMinor: number;
    totalMinor: number;
    creditedMinor?: number;
    paidMinor?: number;
    balanceMinor?: number;
  };
  notes?: string;
  terms?: string;
  paymentInstructions?: string;
  eisStatus?: string;
  eisReference?: string;
}

function formatMWK(minor: number): string {
  return `MWK ${(minor / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export const SalesDocumentPdf: React.FC<{ data: SalesDocumentPdfData }> = ({ data }) => {
  const isDraft = data.status === 'draft';

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Draft Watermark */}
        {isDraft && <Text style={styles.watermark}>DRAFT</Text>}

        {/* Header Band */}
        <View style={styles.headerBand}>
          <View>
            <Text style={styles.companyName}>{data.company.name}</Text>
            <Text style={styles.companySubtitle}>
              {data.company.address || 'Victoria Avenue, Blantyre, Malawi'}
            </Text>
            <Text style={styles.companySubtitle}>
              Tel: {data.company.phone || '+265 1 820 000'} | TPIN: {data.company.taxNumber || '10000000'}
            </Text>
          </View>
          <View>
            <Text style={styles.docTitle}>{data.title}</Text>
            <Text style={styles.docNumber}>{data.documentNumber || 'UNASSIGNED'}</Text>
          </View>
        </View>

        {/* Customer & Document Meta */}
        <View style={styles.metaGrid}>
          <View style={styles.metaColumn}>
            <Text style={styles.metaHeading}>Billed To</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Customer:</Text>
              <Text style={styles.metaValue}>{data.customer.name}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Account #:</Text>
              <Text style={styles.metaValue}>{data.customer.accountNumber}</Text>
            </View>
            {data.customer.taxNumber && (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>TPIN:</Text>
                <Text style={styles.metaValue}>{data.customer.taxNumber}</Text>
              </View>
            )}
            {data.customer.address && (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Address:</Text>
                <Text style={styles.metaValue}>{data.customer.address}</Text>
              </View>
            )}
          </View>

          <View style={styles.metaColumn}>
            <Text style={styles.metaHeading}>Document Details</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Date:</Text>
              <Text style={styles.metaValue}>{data.date}</Text>
            </View>
            {data.dueDate && (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Due Date:</Text>
                <Text style={styles.metaValue}>{data.dueDate}</Text>
              </View>
            )}
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Status:</Text>
              <Text style={styles.metaValue}>{data.status.toUpperCase()}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Currency:</Text>
              <Text style={styles.metaValue}>{data.currency}</Text>
            </View>
          </View>
        </View>

        {/* Line Items Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.colSku}>SKU</Text>
            <Text style={styles.colDesc}>Description</Text>
            <Text style={styles.colQty}>Qty</Text>
            <Text style={styles.colUnitPrice}>Unit Price</Text>
            <Text style={styles.colTax}>VAT</Text>
            <Text style={styles.colTotal}>Total</Text>
          </View>

          {data.lines.map((line, idx) => (
            <View
              key={idx}
              style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowZebra : {}]}
            >
              <Text style={styles.colSku}>{line.sku}</Text>
              <View style={styles.colDesc}>
                <Text>{line.description || line.sku}</Text>
                {line.serials && line.serials.length > 0 && (
                  <Text style={{ fontSize: 6.5, color: '#64748B', marginTop: 2 }}>
                    S/N: {line.serials.join(', ')}
                  </Text>
                )}
              </View>
              <Text style={styles.colQty}>{line.quantity}</Text>
              <Text style={styles.colUnitPrice}>{formatMWK(line.unitPriceMinor)}</Text>
              <Text style={styles.colTax}>{formatMWK(line.taxMinor)}</Text>
              <Text style={styles.colTotal}>{formatMWK(line.lineTotalMinor)}</Text>
            </View>
          ))}
        </View>

        {/* Totals Box */}
        {data.totals && (
          <View style={styles.totalsContainer}>
            <View style={styles.totalsBox}>
              <View style={styles.totalRow}>
                <Text style={{ color: '#64748B' }}>Subtotal:</Text>
                <Text>{formatMWK(data.totals.subtotalMinor)}</Text>
              </View>
              {data.totals.discountMinor > 0 && (
                <View style={styles.totalRow}>
                  <Text style={{ color: '#64748B' }}>Discount:</Text>
                  <Text>-{formatMWK(data.totals.discountMinor)}</Text>
                </View>
              )}
              <View style={styles.totalRow}>
                <Text style={{ color: '#64748B' }}>VAT (17.5%):</Text>
                <Text>{formatMWK(data.totals.taxMinor)}</Text>
              </View>
              <View style={styles.grandTotalRow}>
                <Text style={styles.grandTotalLabel}>Total:</Text>
                <Text style={styles.grandTotalValue}>{formatMWK(data.totals.totalMinor)}</Text>
              </View>

              {data.totals.balanceMinor !== undefined && (
                <View style={styles.balanceRow}>
                  <Text style={styles.balanceLabel}>Balance Due:</Text>
                  <Text style={styles.balanceValue}>{formatMWK(data.totals.balanceMinor)}</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Payment Instructions Setting */}
        {data.paymentInstructions && (
          <View style={styles.instructionsBox}>
            <Text style={styles.instructionsTitle}>Payment Instructions</Text>
            <Text style={styles.instructionsText}>{data.paymentInstructions}</Text>
          </View>
        )}

        {/* EIS Integration Block Placeholder */}
        <View style={styles.eisPlaceholderBox}>
          <View>
            <Text style={{ fontSize: 8, fontWeight: 'bold', color: '#0B2545' }}>
              MRA Electronic Invoicing System (EIS)
            </Text>
            <Text style={styles.eisText}>
              Status: {data.eisStatus || 'not_required'} | Ref:{' '}
              {data.eisReference || 'PENDING SUBMISSION'}
            </Text>
          </View>
          <View
            style={{
              width: 40,
              height: 40,
              borderWidth: 1,
              borderColor: '#94A3B8',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 6, color: '#94A3B8' }}>QR CODE</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>Thank you for choosing {data.company.name}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
};

export async function generateSalesDocumentPdfBuffer(
  data: SalesDocumentPdfData,
): Promise<Buffer> {
  return await renderToBuffer(<SalesDocumentPdf data={data} />);
}

/**
 * Loads and constructs the complete data object needed to render a sales document PDF.
 */
export async function fetchSalesDocumentPdfData(
  documentType: 'quotation' | 'invoice' | 'credit_note' | 'delivery_note',
  id: string,
): Promise<SalesDocumentPdfData> {
  const allSettings = await getAllSettings();

  const company = {
    name: (allSettings.company_name as string) || 'Ace Holdings Limited',
    address: (allSettings.company_address as string) || 'Plot 4/128, Kenyatta Drive, Lilongwe, Malawi',
    phone: (allSettings.company_phone as string) || '+265 1 750 000',
    email: (allSettings.company_email as string) || 'info@aceholdings.mw',
    taxNumber: (allSettings.company_tax_number as string) || 'TPIN: 1002345678',
  };

  const paymentInstructions = (allSettings.invoice_payment_instructions as string) || undefined;

  if (documentType === 'quotation') {
    const [quote] = await db.select().from(quotations).where(eq(quotations.id, id));
    if (!quote) throw new Error('Quotation not found');

    const [cust] = await db.select().from(customers).where(eq(customers.id, quote.customerId));
    const lines = await db.select().from(quotationLines).where(eq(quotationLines.quotationId, id));

    return {
      title: 'PROFORMA QUOTATION',
      documentNumber: quote.quotationNumber || 'DRAFT',
      status: quote.status,
      date: quote.quotationDate ? new Date(quote.quotationDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      dueDate: quote.validUntil ? new Date(quote.validUntil).toISOString().slice(0, 10) : undefined,
      currency: quote.currency || 'MWK',
      company,
      customer: {
        accountNumber: cust?.accountNumber || '',
        name: cust?.name || '',
        address: cust?.address || undefined,
        phone: cust?.phone || undefined,
        taxNumber: cust?.taxNumber || undefined,
      },
      lines: lines.map((l) => ({
        sku: l.sku || '',
        description: l.description || '',
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
        discountMinor: l.discountMinor,
        taxMinor: l.taxMinor,
        lineTotalMinor: l.lineTotalMinor,
      })),
      totals: {
        subtotalMinor: quote.subtotalMinor,
        discountMinor: quote.discountMinor,
        taxMinor: quote.taxMinor,
        totalMinor: quote.totalMinor,
      },
      notes: quote.notes || undefined,
      terms: quote.terms || undefined,
      paymentInstructions,
    };
  }

  if (documentType === 'invoice' || documentType === 'credit_note') {
    const [doc] = await db.select().from(salesDocuments).where(eq(salesDocuments.id, id));
    if (!doc) throw new Error(`${documentType} not found`);

    const [cust] = await db.select().from(customers).where(eq(customers.id, doc.customerId));
    const lines = await db.select().from(salesDocumentLines).where(eq(salesDocumentLines.documentId, id));

    return {
      title: doc.documentType === 'credit_note' ? 'CREDIT NOTE' : 'TAX INVOICE',
      documentNumber: doc.documentNumber || 'DRAFT',
      status: doc.status,
      date: doc.issueDate ? new Date(doc.issueDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      dueDate: doc.dueDate ? new Date(doc.dueDate).toISOString().slice(0, 10) : undefined,
      currency: doc.currency || 'MWK',
      company,
      customer: {
        accountNumber: cust?.accountNumber || '',
        name: cust?.name || '',
        address: cust?.address || undefined,
        phone: cust?.phone || undefined,
        taxNumber: cust?.taxNumber || undefined,
      },
      lines: lines.map((l) => ({
        sku: l.sku || '',
        description: l.description || '',
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
        discountMinor: l.discountMinor,
        taxMinor: l.taxMinor,
        lineTotalMinor: l.lineTotalMinor,
      })),
      totals: {
        subtotalMinor: doc.subtotalMinor,
        discountMinor: doc.discountMinor,
        taxMinor: doc.taxMinor,
        totalMinor: doc.totalMinor,
        creditedMinor: doc.creditedMinor,
        paidMinor: doc.paidMinor,
        balanceMinor: doc.balanceMinor,
      },
      notes: doc.notes || undefined,
      paymentInstructions: doc.documentType === 'invoice' ? paymentInstructions : undefined,
      eisStatus: doc.eisStatus || undefined,
      eisReference: doc.eisReference || undefined,
    };
  }

  if (documentType === 'delivery_note') {
    const [dn] = await db.select().from(deliveryNotes).where(eq(deliveryNotes.id, id));
    if (!dn) throw new Error('Delivery note not found');

    const [cust] = await db.select().from(customers).where(eq(customers.id, dn.customerId));
    const [invoice] = await db.select().from(salesDocuments).where(eq(salesDocuments.id, dn.salesDocumentId));
    const dnLines = await db.select().from(deliveryNoteLines).where(eq(deliveryNoteLines.deliveryNoteId, id));

    const productIds = dnLines.map((l) => l.productId);
    const fetchedProds = productIds.length > 0
      ? await db.select().from(products).where(inArray(products.id, productIds))
      : [];
    const prodMap = new Map(fetchedProds.map((p) => [p.id, p]));

    return {
      title: 'DELIVERY NOTE',
      documentNumber: dn.deliveryNumber || 'DISPATCHED',
      status: dn.status,
      date: dn.deliveryDate ? new Date(dn.deliveryDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      currency: invoice?.currency || 'MWK',
      company,
      customer: {
        accountNumber: cust?.accountNumber || '',
        name: cust?.name || '',
        address: cust?.address || undefined,
        phone: cust?.phone || undefined,
        taxNumber: cust?.taxNumber || undefined,
      },
      lines: dnLines.map((l) => {
        const p = prodMap.get(l.productId);
        return {
          sku: p?.sku || '',
          description: p?.name || '',
          quantity: l.quantity,
          unitPriceMinor: 0,
          taxMinor: 0,
          lineTotalMinor: 0,
          serials: l.serialNumbers || undefined,
        };
      }),
      notes: dn.notes || undefined,
    };
  }

  throw new Error(`Unsupported document type: ${documentType}`);
}

