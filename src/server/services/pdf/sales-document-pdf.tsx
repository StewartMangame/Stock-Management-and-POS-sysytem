/**
 * Sales Document PDF Generator on Ace Holdings Letterhead.
 *
 * Implements:
 *   - Official Ace Holdings Letterhead matching company quotations exactly
 *   - Left: ACE HOLDINGS LTD and company address block
 *   - Right: Official Ace Holdings brand logo
 *   - Subheader with Quotation title, ADDRESS block, and Document metadata (QUOTATION, DATE, EXPIRATION DATE)
 *   - Lavender/blue-gray table header bar for line items (PRODUCT/SERVICE, DESCRIPTION, QTY, RATE, AMOUNT)
 *   - Clean multi-line descriptions and formatted numbers
 *   - Subtotal, Tax, and large MWK Grand Total
 *   - TAX SUMMARY breakdown table (RATE, TAX, NET) with MRA VAT Agency @ 17.5%
 *   - Accepted By / Accepted Date signature blocks
 *   - Diagonal DRAFT / CANCELLED / EXPIRED watermarks and subtle background emblem
 *   - Centered page footer ('Page 1 of 1')
 */

import React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  renderToBuffer,
} from '@react-pdf/renderer';
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
import { ACE_LOGO_DATA_URI } from './assets';
import { isStaging } from '@/lib/env';

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 40,
    paddingHorizontal: 40,
    fontSize: 8.5,
    fontFamily: 'Helvetica',
    color: '#1E293B',
    lineHeight: 1.35,
    backgroundColor: '#FFFFFF',
  },
  draftWatermark: {
    position: 'absolute',
    top: '38%',
    left: '14%',
    transform: 'rotate(-45deg)',
    fontSize: 76,
    color: 'rgba(203, 213, 225, 0.40)',
    fontWeight: 'bold',
    letterSpacing: 8,
    zIndex: -1,
  },
  backgroundWatermark: {
    position: 'absolute',
    top: '32%',
    left: '26%',
    width: 280,
    opacity: 0.035,
    zIndex: -2,
  },
  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  headerLeft: {
    width: '55%',
  },
  companyName: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#0F172A',
    marginBottom: 2,
    letterSpacing: 0.5,
  },
  companyLine: {
    fontSize: 8.5,
    color: '#334155',
    lineHeight: 1.3,
  },
  headerRight: {
    width: '40%',
    alignItems: 'flex-end',
  },
  logo: {
    width: 140,
    height: 84,
    objectFit: 'contain',
  },
  // Subheader
  titleMetaSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
    marginTop: 4,
  },
  titleAddressCol: {
    width: '52%',
  },
  docTitle: {
    fontSize: 20,
    fontWeight: 'normal',
    color: '#556885', // That distinct slate blue-gray from the reference PDF
    marginBottom: 12,
  },
  addressBlock: {
    marginTop: 2,
  },
  addressLabel: {
    fontSize: 7.5,
    fontWeight: 'bold',
    color: '#94A3B8',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  customerName: {
    fontSize: 9.5,
    fontWeight: 'medium',
    color: '#0F172A',
  },
  customerAddress: {
    fontSize: 8.5,
    color: '#475569',
    marginTop: 1,
  },
  metaDetailsCol: {
    width: '44%',
    alignItems: 'flex-end',
    paddingTop: 10,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 3,
    width: '100%',
  },
  metaLabel: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#94A3B8',
    textAlign: 'left',
    width: 110,
  },
  metaValue: {
    fontSize: 8.5,
    color: '#0F172A',
    textAlign: 'right',
    width: 90,
  },
  // Items Table
  table: {
    marginTop: 8,
    marginBottom: 4,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#EAEFF5', // Soft lavender / blue-gray from the reference
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 2,
  },
  colProductServiceHeader: {
    width: '24%',
    fontSize: 7.5,
    fontWeight: 'bold',
    color: '#475569',
  },
  colDescriptionHeader: {
    width: '42%',
    fontSize: 7.5,
    fontWeight: 'bold',
    color: '#475569',
  },
  colQtyHeader: {
    width: '8%',
    fontSize: 7.5,
    fontWeight: 'bold',
    color: '#475569',
    textAlign: 'right',
  },
  colRateHeader: {
    width: '13%',
    fontSize: 7.5,
    fontWeight: 'bold',
    color: '#475569',
    textAlign: 'right',
  },
  colAmountHeader: {
    width: '13%',
    fontSize: 7.5,
    fontWeight: 'bold',
    color: '#475569',
    textAlign: 'right',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  colProductService: {
    width: '24%',
    paddingRight: 6,
  },
  productNameText: {
    fontSize: 8.5,
    fontWeight: 'bold',
    color: '#0F172A',
  },
  skuText: {
    fontSize: 7,
    color: '#64748B',
    marginTop: 1,
  },
  colDescription: {
    width: '42%',
    paddingRight: 6,
  },
  descriptionText: {
    fontSize: 8,
    color: '#334155',
    lineHeight: 1.35,
  },
  colQty: {
    width: '8%',
    textAlign: 'right',
    fontSize: 8.5,
    color: '#0F172A',
  },
  colRate: {
    width: '13%',
    textAlign: 'right',
    fontSize: 8.5,
    color: '#0F172A',
  },
  colAmount: {
    width: '13%',
    textAlign: 'right',
    fontSize: 8.5,
    color: '#0F172A',
  },
  tableDivider: {
    borderBottomWidth: 1,
    borderBottomColor: '#CBD5E1',
    borderBottomStyle: 'dotted',
    marginTop: 6,
    marginBottom: 8,
  },
  // Totals
  totalsContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 16,
  },
  totalsBox: {
    width: '42%',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  totalLabel: {
    fontSize: 8,
    color: '#94A3B8',
    fontWeight: 'bold',
  },
  totalValue: {
    fontSize: 8.5,
    color: '#0F172A',
    textAlign: 'right',
  },
  grandTotalDivider: {
    borderTopWidth: 1,
    borderTopColor: '#CBD5E1',
    marginVertical: 4,
  },
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 2,
  },
  grandTotalLabel: {
    fontSize: 8.5,
    fontWeight: 'bold',
    color: '#64748B',
  },
  grandTotalValue: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#0F172A',
    textAlign: 'right',
  },
  // Tax Summary
  taxSummarySection: {
    marginTop: 4,
    marginBottom: 18,
    width: '100%',
  },
  taxSummaryTitle: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#475569',
    marginBottom: 4,
  },
  taxSummaryHeader: {
    flexDirection: 'row',
    backgroundColor: '#EAEFF5',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 2,
  },
  taxSummaryRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  taxColRate: {
    width: '40%',
    fontSize: 7.5,
    fontWeight: 'bold',
    color: '#475569',
  },
  taxColTax: {
    width: '30%',
    fontSize: 7.5,
    fontWeight: 'bold',
    color: '#475569',
    textAlign: 'center',
  },
  taxColNet: {
    width: '30%',
    fontSize: 7.5,
    fontWeight: 'bold',
    color: '#475569',
    textAlign: 'right',
  },
  taxColRateText: {
    width: '40%',
    fontSize: 8,
    color: '#0F172A',
  },
  taxColTaxText: {
    width: '30%',
    fontSize: 8,
    color: '#0F172A',
    textAlign: 'center',
  },
  taxColNetText: {
    width: '30%',
    fontSize: 8,
    color: '#0F172A',
    textAlign: 'right',
  },
  // Acceptance
  acceptanceSection: {
    marginTop: 6,
    marginBottom: 16,
    width: '50%',
  },
  acceptanceField: {
    marginBottom: 14,
  },
  acceptanceLabel: {
    fontSize: 8,
    color: '#64748B',
    marginBottom: 8,
  },
  acceptanceLine: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#CBD5E1',
    width: 180,
  },
  // Notes / Terms / Instructions
  notesBox: {
    marginTop: 8,
    marginBottom: 12,
    padding: 8,
    backgroundColor: '#F8FAFC',
    borderRadius: 3,
    borderWidth: 0.5,
    borderColor: '#E2E8F0',
  },
  notesTitle: {
    fontSize: 7.5,
    fontWeight: 'bold',
    color: '#475569',
    marginBottom: 2,
  },
  notesContent: {
    fontSize: 7.5,
    color: '#64748B',
  },
  // Footer
  footer: {
    position: 'absolute',
    bottom: 25,
    left: 40,
    right: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerText: {
    fontSize: 7.5,
    color: '#94A3B8',
  },
});

export interface SalesDocumentPdfData {
  title: string; // 'Quotation' | 'TAX INVOICE' | 'PROFORMA QUOTATION' | 'CREDIT NOTE' | 'DELIVERY NOTE'
  documentNumber: string;
  status: string; // 'draft' | 'issued' | 'void' | 'sent' | 'accepted' | 'cancelled' | 'expired'
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
    productName?: string;
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

function formatAmount(minor: number): string {
  return (minor / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDisplayDate(dateStr?: string | Date): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function getCompanyHeaderLines(company: SalesDocumentPdfData['company']) {
  let addrLines: string[] = [];
  if (company.address && company.address.includes('\n')) {
    addrLines = company.address.split('\n').map((s) => s.trim()).filter(Boolean);
  } else if (company.address && company.address.includes('Livingstone Avenue')) {
    addrLines = ['First House', '53 Livingstone Avenue', 'BLANTYRE 3000'];
  } else if (company.address) {
    addrLines = [company.address];
  } else {
    addrLines = ['First House', '53 Livingstone Avenue', 'BLANTYRE 3000'];
  }

  const phone = company.phone || '+265999257356';
  const email = company.email || 'ace@ace.co.mw';

  return {
    name: 'ACE HOLDINGS LTD',
    lines: [...addrLines, phone, email],
  };
}

export const SalesDocumentPdf: React.FC<{ data: SalesDocumentPdfData }> = ({ data }) => {
  const isQuotation = data.title.toLowerCase().includes('quotation');
  const companyInfo = getCompanyHeaderLines(data.company);

  // Status for watermark
  const isDraft = data.status === 'draft';
  const isCancelled = data.status === 'cancelled';
  const isExpired = data.status === 'expired';

  // Calculate tax rate label
  const taxRatePercent =
    data.totals && data.totals.subtotalMinor > 0
      ? ((data.totals.taxMinor / data.totals.subtotalMinor) * 100).toFixed(1)
      : '17.5';
  const taxRateLabel = `MRA VAT Agency @ ${taxRatePercent}%`;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Subtle Ace Holdings Logo Background Watermark */}
        <Image src={ACE_LOGO_DATA_URI} style={styles.backgroundWatermark} />

        {isStaging() && (
          <View style={{ backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#ef4444', padding: 5, marginBottom: 8, alignItems: 'center' }}>
            <Text style={{ color: '#b91c1c', fontSize: 9.5, fontWeight: 'bold' }}>
              STAGING, TEST DATA, NOT A REAL TAX INVOICE
            </Text>
          </View>
        )}

        {/* Status Watermarks */}
        {isDraft && <Text style={styles.draftWatermark}>DRAFT</Text>}
        {isCancelled && (
          <Text style={[styles.draftWatermark, { color: 'rgba(244, 63, 94, 0.25)' }]}>
            CANCELLED
          </Text>
        )}
        {isExpired && (
          <Text style={[styles.draftWatermark, { color: 'rgba(245, 158, 11, 0.25)' }]}>
            EXPIRED
          </Text>
        )}

        {/* Top Header: Company details on left, Logo on right */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.companyName}>{companyInfo.name}</Text>
            {companyInfo.lines.map((line, idx) => (
              <Text key={idx} style={styles.companyLine}>
                {line}
              </Text>
            ))}
          </View>
          <View style={styles.headerRight}>
            <Image src={ACE_LOGO_DATA_URI} style={styles.logo} />
          </View>
        </View>

        {/* Subheader: Quotation & ADDRESS on left, Metadata on right */}
        <View style={styles.titleMetaSection}>
          <View style={styles.titleAddressCol}>
            <Text style={styles.docTitle}>{isQuotation ? 'Quotation' : data.title}</Text>
            <View style={styles.addressBlock}>
              <Text style={styles.addressLabel}>ADDRESS</Text>
              <Text style={styles.customerName}>{data.customer.name}</Text>
              {data.customer.address && (
                <Text style={styles.customerAddress}>{data.customer.address}</Text>
              )}
            </View>
          </View>

          <View style={styles.metaDetailsCol}>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>
                {isQuotation ? 'QUOTATION' : data.title.toUpperCase()}
              </Text>
              <Text style={styles.metaValue}>{data.documentNumber || 'DRAFT'}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>DATE</Text>
              <Text style={styles.metaValue}>{formatDisplayDate(data.date)}</Text>
            </View>
            {data.dueDate && (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>
                  {isQuotation ? 'EXPIRATION DATE' : 'DUE DATE'}
                </Text>
                <Text style={styles.metaValue}>{formatDisplayDate(data.dueDate)}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Products / Services Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.colProductServiceHeader}>PRODUCT/SERVICE</Text>
            <Text style={styles.colDescriptionHeader}>DESCRIPTION</Text>
            <Text style={styles.colQtyHeader}>QTY</Text>
            <Text style={styles.colRateHeader}>RATE</Text>
            <Text style={styles.colAmountHeader}>AMOUNT</Text>
          </View>

          {data.lines.map((line, idx) => {
            const prodTitle = line.productName || line.sku;
            const desc =
              line.description && line.description !== prodTitle
                ? line.description
                : line.description || '';

            return (
              <View key={idx} style={styles.tableRow}>
                <View style={styles.colProductService}>
                  <Text style={styles.productNameText}>{prodTitle}</Text>
                  {line.sku && line.sku !== prodTitle && (
                    <Text style={styles.skuText}>SKU: {line.sku}</Text>
                  )}
                  {line.serials && line.serials.length > 0 && (
                    <Text style={{ fontSize: 6.5, color: '#64748B', marginTop: 1 }}>
                      S/N: {line.serials.join(', ')}
                    </Text>
                  )}
                </View>

                <View style={styles.colDescription}>
                  <Text style={styles.descriptionText}>{desc}</Text>
                </View>

                <Text style={styles.colQty}>{line.quantity}</Text>
                <Text style={styles.colRate}>{formatAmount(line.unitPriceMinor)}</Text>
                <Text style={styles.colAmount}>{formatAmount(line.lineTotalMinor)}</Text>
              </View>
            );
          })}
        </View>

        {/* Dotted divider at bottom of table */}
        <View style={styles.tableDivider} />

        {/* Totals Section */}
        {data.totals && (
          <View style={styles.totalsContainer}>
            <View style={styles.totalsBox}>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>SUBTOTAL</Text>
                <Text style={styles.totalValue}>{formatAmount(data.totals.subtotalMinor)}</Text>
              </View>
              {data.totals.discountMinor > 0 && (
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>DISCOUNT</Text>
                  <Text style={styles.totalValue}>-{formatAmount(data.totals.discountMinor)}</Text>
                </View>
              )}
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>TAX</Text>
                <Text style={styles.totalValue}>{formatAmount(data.totals.taxMinor)}</Text>
              </View>

              <View style={styles.grandTotalDivider} />

              <View style={styles.grandTotalRow}>
                <Text style={styles.grandTotalLabel}>TOTAL</Text>
                <Text style={styles.grandTotalValue}>
                  {data.currency} {formatAmount(data.totals.totalMinor)}
                </Text>
              </View>

              {data.totals.balanceMinor !== undefined && data.totals.balanceMinor > 0 && (
                <View style={[styles.totalRow, { marginTop: 4 }]}>
                  <Text style={[styles.totalLabel, { color: '#B45309' }]}>BALANCE DUE</Text>
                  <Text style={[styles.totalValue, { color: '#B45309', fontWeight: 'bold' }]}>
                    {data.currency} {formatAmount(data.totals.balanceMinor)}
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* TAX SUMMARY Section */}
        {data.totals && (
          <View style={styles.taxSummarySection}>
            <Text style={styles.taxSummaryTitle}>TAX SUMMARY</Text>
            <View style={styles.taxSummaryHeader}>
              <Text style={styles.taxColRate}>RATE</Text>
              <Text style={styles.taxColTax}>TAX</Text>
              <Text style={styles.taxColNet}>NET</Text>
            </View>
            <View style={styles.taxSummaryRow}>
              <Text style={styles.taxColRateText}>{taxRateLabel}</Text>
              <Text style={styles.taxColTaxText}>{formatAmount(data.totals.taxMinor)}</Text>
              <Text style={styles.taxColNetText}>{formatAmount(data.totals.subtotalMinor)}</Text>
            </View>
          </View>
        )}

        {/* Acceptance Section */}
        <View style={styles.acceptanceSection}>
          <View style={styles.acceptanceField}>
            <Text style={styles.acceptanceLabel}>Accepted By</Text>
            <View style={styles.acceptanceLine} />
          </View>
          <View style={styles.acceptanceField}>
            <Text style={styles.acceptanceLabel}>Accepted Date</Text>
            <View style={styles.acceptanceLine} />
          </View>
        </View>

        {/* Optional Notes & Terms */}
        {(data.notes || data.terms || data.paymentInstructions) && (
          <View style={styles.notesBox}>
            {data.notes && (
              <View style={{ marginBottom: 4 }}>
                <Text style={styles.notesTitle}>Notes</Text>
                <Text style={styles.notesContent}>{data.notes}</Text>
              </View>
            )}
            {data.terms && (
              <View style={{ marginBottom: 4 }}>
                <Text style={styles.notesTitle}>Terms & Conditions</Text>
                <Text style={styles.notesContent}>{data.terms}</Text>
              </View>
            )}
            {data.paymentInstructions && (
              <View>
                <Text style={styles.notesTitle}>Payment Instructions</Text>
                <Text style={styles.notesContent}>{data.paymentInstructions}</Text>
              </View>
            )}
          </View>
        )}

        {/* Centered Page Footer */}
        <View style={styles.footer} fixed>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
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
    name: (allSettings.company_name as string) || 'ACE HOLDINGS LTD',
    address: (allSettings.company_address as string) || 'First House\n53 Livingstone Avenue\nBLANTYRE 3000',
    phone: (allSettings.company_phone as string) || '+265999257356',
    email: (allSettings.company_email as string) || 'ace@ace.co.mw',
    taxNumber: (allSettings.company_tax_number as string) || '',
  };

  const paymentInstructions = (allSettings.invoice_payment_instructions as string) || undefined;

  if (documentType === 'quotation') {
    const [quote] = await db.select().from(quotations).where(eq(quotations.id, id));
    if (!quote) throw new Error('Quotation not found');

    const [cust] = await db.select().from(customers).where(eq(customers.id, quote.customerId));
    const lines = await db
      .select({
        id: quotationLines.id,
        sku: quotationLines.sku,
        description: quotationLines.description,
        quantity: quotationLines.quantity,
        unitPriceMinor: quotationLines.unitPriceMinor,
        discountMinor: quotationLines.discountMinor,
        taxMinor: quotationLines.taxMinor,
        lineTotalMinor: quotationLines.lineTotalMinor,
        notes: quotationLines.notes,
        productName: products.name,
      })
      .from(quotationLines)
      .innerJoin(products, eq(quotationLines.productId, products.id))
      .where(eq(quotationLines.quotationId, id));

    return {
      title: 'Quotation',
      documentNumber: quote.quotationNumber || 'DRAFT',
      status: quote.status,
      date: quote.quotationDate
        ? new Date(quote.quotationDate).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      dueDate: quote.validUntil
        ? new Date(quote.validUntil).toISOString().slice(0, 10)
        : undefined,
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
        productName: l.productName || l.sku || '',
        description: l.description || l.notes || '',
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
    const lines = await db
      .select({
        id: salesDocumentLines.id,
        sku: salesDocumentLines.sku,
        description: salesDocumentLines.description,
        quantity: salesDocumentLines.quantity,
        unitPriceMinor: salesDocumentLines.unitPriceMinor,
        discountMinor: salesDocumentLines.discountMinor,
        taxMinor: salesDocumentLines.taxMinor,
        lineTotalMinor: salesDocumentLines.lineTotalMinor,
        productName: products.name,
      })
      .from(salesDocumentLines)
      .leftJoin(products, eq(salesDocumentLines.productId, products.id))
      .where(eq(salesDocumentLines.documentId, id));

    return {
      title: doc.documentType === 'credit_note' ? 'CREDIT NOTE' : 'TAX INVOICE',
      documentNumber: doc.documentNumber || 'DRAFT',
      status: doc.status,
      date: doc.issueDate
        ? new Date(doc.issueDate).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      dueDate: doc.dueDate
        ? new Date(doc.dueDate).toISOString().slice(0, 10)
        : undefined,
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
        productName: l.productName || l.sku || '',
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
    const [invoice] = await db
      .select()
      .from(salesDocuments)
      .where(eq(salesDocuments.id, dn.salesDocumentId));
    const dnLines = await db
      .select()
      .from(deliveryNoteLines)
      .where(eq(deliveryNoteLines.deliveryNoteId, id));

    const productIds = dnLines.map((l) => l.productId);
    const fetchedProds =
      productIds.length > 0
        ? await db.select().from(products).where(inArray(products.id, productIds))
        : [];
    const prodMap = new Map(fetchedProds.map((p) => [p.id, p]));

    return {
      title: 'DELIVERY NOTE',
      documentNumber: dn.deliveryNumber || 'DISPATCHED',
      status: dn.status,
      date: dn.deliveryDate
        ? new Date(dn.deliveryDate).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
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
          productName: p?.name || '',
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
