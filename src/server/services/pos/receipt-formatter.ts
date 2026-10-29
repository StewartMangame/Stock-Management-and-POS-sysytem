/**
 * POS Receipt Formatter.
 *
 * Generates:
 *   - Structured receipt data (for display or printing)
 *   - Printable HTML/CSS snippet optimised for 80mm thermal printers
 *
 * Includes: company header, TPIN, invoice/credit note number, cashier,
 * date/time, line items, tax breakdown, payment split (cash tendered & change),
 * footer notes.
 *
 * Reprints include a prominent DUPLICATE REPRINT watermark.
 */

import { db } from '@/server/db';
import {
  salesDocuments,
  salesDocumentLines,
  payments,
  paymentAllocations,
  users,
  locations,
  customers,
  posShifts,
  taxRates,
} from '@/server/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { getAllSettings } from '@/server/services/settings';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReceiptLine {
  sku: string;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number;
  taxRateBasisPoints: number;
  lineTotalMinor: number;
}

export interface ReceiptPayment {
  method: string;
  amountMinor: number;
  tenderedMinor?: number;
  changeMinor?: number;
  reference?: string;
}

export interface ReceiptData {
  // Header
  companyName: string;
  companyAddress?: string;
  companyPhone?: string;
  companyTpin?: string;
  locationName: string;

  // Document
  documentType: 'invoice' | 'credit_note';
  documentNumber: string;
  isReprint: boolean;

  // Parties
  cashierName: string;
  customerName: string;
  isWalkIn: boolean;

  // Dates
  saleDateTime: string; // ISO
  printDateTime: string; // ISO

  // Lines
  lines: ReceiptLine[];

  // Totals
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;

  // Tax breakdown
  taxBreakdown: Array<{
    label: string;
    rateBasisPoints: number;
    netMinor: number;
    taxMinor: number;
  }>;

  // Payments
  payments: ReceiptPayment[];
  changeMinor: number;

  // Optional shift info
  shiftNumber?: string;

  // Footer
  footerNote?: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Builds a structured receipt data object for an invoice or credit note.
 *
 * @param documentId - The sales_documents.id to generate a receipt for.
 * @param isReprint - Set true when the receipt is a reprint (adds watermark).
 */
export async function buildReceiptData(
  documentId: string,
  isReprint = false,
): Promise<ReceiptData> {
  // ── Fetch document ──────────────────────────────────────────────────────────
  const [doc] = await db
    .select()
    .from(salesDocuments)
    .where(eq(salesDocuments.id, documentId));

  if (!doc) throw new Error('Document not found.');
  if (doc.documentType !== 'invoice' && doc.documentType !== 'credit_note') {
    throw new Error('Receipt can only be generated for invoices or credit notes.');
  }

  // ── Fetch document lines ────────────────────────────────────────────────────
  const lines = await db
    .select()
    .from(salesDocumentLines)
    .where(eq(salesDocumentLines.documentId, documentId));

  // ── Fetch tax rates for breakdown ───────────────────────────────────────────
  const taxRateIds = [...new Set(lines.map((l) => l.taxRateId))];
  const fetchedTaxRates = taxRateIds.length
    ? await db.select().from(taxRates).where(inArray(taxRates.id, taxRateIds))
    : [];
  const taxRateMap = new Map(fetchedTaxRates.map((t) => [t.id, t]));

  // ── Fetch cashier name ──────────────────────────────────────────────────────
  const cashierName = doc.createdBy
    ? (await db.select({ name: users.name }).from(users).where(eq(users.id, doc.createdBy)))[0]
        ?.name ?? 'Unknown'
    : 'Unknown';

  // ── Fetch location info ─────────────────────────────────────────────────────
  const [location] = await db
    .select({ name: locations.name })
    .from(locations)
    .where(eq(locations.id, doc.locationId));

  // ── Fetch customer info ─────────────────────────────────────────────────────
  const [customer] = await db
    .select({ name: customers.name, isWalkIn: customers.isWalkIn })
    .from(customers)
    .where(eq(customers.id, doc.customerId));

  // ── Fetch shift number ──────────────────────────────────────────────────────
  let shiftNumber: string | undefined;
  if (doc.shiftId) {
    const [shift] = await db
      .select({ shiftNumber: posShifts.shiftNumber })
      .from(posShifts)
      .where(eq(posShifts.id, doc.shiftId));
    shiftNumber = shift?.shiftNumber;
  }

  // ── Fetch payments allocated to this document ───────────────────────────────
  const allocations = await db
    .select({ paymentId: paymentAllocations.paymentId })
    .from(paymentAllocations)
    .where(eq(paymentAllocations.invoiceId, documentId));

  const paymentIds = [...new Set(allocations.map((a) => a.paymentId))];
  const paymentRows = paymentIds.length
    ? await db.select().from(payments).where(inArray(payments.id, paymentIds))
    : [];

  // ── Fetch company settings ──────────────────────────────────────────────────
  const allSettings = await getAllSettings();
  const companyName = String(allSettings.company_name ?? 'Company Name');
  const companyAddress = allSettings.company_address ? String(allSettings.company_address) : undefined;
  const companyPhone = allSettings.company_phone ? String(allSettings.company_phone) : undefined;
  const companyTpin = allSettings.company_tax_number ? String(allSettings.company_tax_number) : undefined;
  // receipt_footer is not a current setting key — use invoice_payment_instructions as footer
  const footerNote = allSettings.invoice_payment_instructions
    ? String(allSettings.invoice_payment_instructions)
    : undefined;

  // ── Build receipt lines ─────────────────────────────────────────────────────
  const receiptLines: ReceiptLine[] = lines.map((l) => ({
    sku: l.sku,
    description: l.description ?? l.sku,
    quantity: parseFloat(l.quantity),
    unitPriceMinor: l.unitPriceMinor,
    discountMinor: l.discountMinor,
    taxRateBasisPoints: l.taxRateBasisPoints,
    lineTotalMinor: l.lineTotalMinor,
  }));

  // ── Build tax breakdown grouped by rate ────────────────────────────────────
  const taxGroupMap = new Map<string, { label: string; rateBasisPoints: number; netMinor: number; taxMinor: number }>();
  for (const l of lines) {
    const taxRate = taxRateMap.get(l.taxRateId);
    const key = l.taxRateId;
    const existing = taxGroupMap.get(key);
    const net = l.lineTotalMinor - l.taxMinor;
    if (existing) {
      existing.netMinor += net;
      existing.taxMinor += l.taxMinor;
    } else {
      taxGroupMap.set(key, {
        label: taxRate?.name ?? `Tax ${l.taxRateBasisPoints / 100}%`,
        rateBasisPoints: l.taxRateBasisPoints,
        netMinor: net,
        taxMinor: l.taxMinor,
      });
    }
  }
  const taxBreakdown = Array.from(taxGroupMap.values());

  // ── Build payments breakdown ────────────────────────────────────────────────
  let totalChangeMinor = 0;
  const receiptPayments: ReceiptPayment[] = paymentRows.map((p) => {
    const details = p.methodDetails as Record<string, unknown> | null ?? {};
    const tendered = details.tendered_minor ? Number(details.tendered_minor) : undefined;
    const change = details.change_minor ? Number(details.change_minor) : undefined;
    if (change) totalChangeMinor += change;

    let reference: string | undefined;
    if (p.method === 'card') reference = String(details.slip_number ?? '');
    if (p.method === 'airtel_money' || p.method === 'mpamba') {
      reference = String(details.transaction_id ?? '');
    }
    if (p.method === 'bank_transfer') reference = String(details.bank_reference ?? '');

    return {
      method: p.method,
      amountMinor: Number(p.amountMinor),
      tenderedMinor: tendered,
      changeMinor: change,
      reference,
    };
  });

  // ── Assemble result ─────────────────────────────────────────────────────────
  const saleDateTime = doc.clientCreatedAt?.toISOString() ?? doc.createdAt.toISOString();

  return {
    companyName,
    companyAddress,
    companyPhone,
    companyTpin,
    locationName: location?.name ?? 'Unknown Location',
    documentType: doc.documentType as 'invoice' | 'credit_note',
    documentNumber: doc.documentNumber ?? '',
    isReprint,
    cashierName,
    customerName: customer?.name ?? 'Unknown',
    isWalkIn: customer?.isWalkIn ?? false,
    saleDateTime,
    printDateTime: new Date().toISOString(),
    lines: receiptLines,
    subtotalMinor: doc.subtotalMinor,
    discountMinor: doc.discountMinor,
    taxMinor: doc.taxMinor,
    totalMinor: doc.totalMinor,
    taxBreakdown,
    payments: receiptPayments,
    changeMinor: totalChangeMinor,
    shiftNumber,
    footerNote,
  };
}

// ── HTML Receipt Renderer ─────────────────────────────────────────────────────

function formatMinor(minor: number): string {
  return `MK ${(minor / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `${date} ${time}`;
}

function methodLabel(method: string): string {
  const labels: Record<string, string> = {
    cash: 'Cash',
    card: 'Card',
    bank_transfer: 'Bank Transfer',
    cheque: 'Cheque',
    airtel_money: 'Airtel Money',
    mpamba: 'TNM Mpamba',
  };
  return labels[method] ?? method;
}

/**
 * Renders receipt data as printable HTML for an 80mm thermal printer.
 * Embed in a print iframe or open in a print window.
 */
export function renderReceiptHtml(data: ReceiptData): string {
  const isCredit = data.documentType === 'credit_note';
  const docLabel = isCredit ? 'CREDIT NOTE / REFUND' : 'RECEIPT';

  const linesHtml = data.lines
    .map((l) => {
      const lineTotal = formatMinor(l.lineTotalMinor);
      const discount = l.discountMinor > 0 ? `<br><span class="disc">  Disc: -${formatMinor(l.discountMinor)}</span>` : '';
      return `
      <tr>
        <td class="desc">${escapeHtml(l.description)}<br><small>${escapeHtml(l.sku)}</small>${discount}</td>
        <td class="qty">${l.quantity}</td>
        <td class="price">${formatMinor(l.unitPriceMinor)}</td>
        <td class="total">${lineTotal}</td>
      </tr>`;
    })
    .join('');

  const taxBreakdownHtml = data.taxBreakdown
    .map(
      (t) => `
      <tr>
        <td class="tax-label">${escapeHtml(t.label)} (${(t.rateBasisPoints / 100).toFixed(1)}%)</td>
        <td class="tax-net">${formatMinor(t.netMinor)}</td>
        <td class="tax-amount">${formatMinor(t.taxMinor)}</td>
      </tr>`,
    )
    .join('');

  const paymentsHtml = data.payments
    .map((p) => {
      const ref = p.reference ? ` <small>[${escapeHtml(p.reference)}]</small>` : '';
      const rows = [`<tr><td>${methodLabel(p.method)}${ref}</td><td class="amount">${formatMinor(p.amountMinor)}</td></tr>`];
      if (p.tenderedMinor !== undefined) {
        rows.push(`<tr><td>  Tendered</td><td class="amount">${formatMinor(p.tenderedMinor)}</td></tr>`);
      }
      if (p.changeMinor !== undefined && p.changeMinor > 0) {
        rows.push(`<tr><td>  Change</td><td class="amount">${formatMinor(p.changeMinor)}</td></tr>`);
      }
      return rows.join('\n');
    })
    .join('');

  const reprintBanner = data.isReprint
    ? `<div class="reprint-banner">*** DUPLICATE REPRINT ***</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(data.documentNumber)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 11px;
    width: 72mm;
    padding: 4mm;
    color: #000;
  }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .company-name { font-size: 14px; font-weight: bold; }
  .doc-type { font-size: 13px; font-weight: bold; margin: 3px 0; }
  .reprint-banner {
    border: 2px solid #000;
    text-align: center;
    font-weight: bold;
    font-size: 12px;
    padding: 2px;
    margin: 4px 0;
  }
  hr { border: none; border-top: 1px dashed #000; margin: 4px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1px 2px; vertical-align: top; }
  .desc { width: 45%; }
  .qty { width: 10%; text-align: right; }
  .price { width: 20%; text-align: right; }
  .total { width: 25%; text-align: right; }
  .tax-label { width: 55%; }
  .tax-net { width: 20%; text-align: right; }
  .tax-amount { width: 25%; text-align: right; }
  .amount { text-align: right; }
  .disc { color: #555; font-size: 10px; }
  .totals-row { font-weight: bold; }
  .grand-total { font-size: 13px; font-weight: bold; }
  .footer { text-align: center; font-size: 10px; margin-top: 6px; }
  small { font-size: 9px; }
  @media print {
    body { padding: 0; }
  }
</style>
</head>
<body>
  <div class="center">
    <div class="company-name">${escapeHtml(data.companyName)}</div>
    ${data.companyAddress ? `<div>${escapeHtml(data.companyAddress)}</div>` : ''}
    ${data.companyPhone ? `<div>Tel: ${escapeHtml(data.companyPhone)}</div>` : ''}
    ${data.companyTpin ? `<div>TPIN: ${escapeHtml(data.companyTpin)}</div>` : ''}
    <div class="doc-type">${docLabel}</div>
    ${reprintBanner}
  </div>
  <hr>
  <table>
    <tr><td>Receipt #:</td><td class="amount bold">${escapeHtml(data.documentNumber)}</td></tr>
    <tr><td>Location:</td><td class="amount">${escapeHtml(data.locationName)}</td></tr>
    <tr><td>Cashier:</td><td class="amount">${escapeHtml(data.cashierName)}</td></tr>
    ${data.shiftNumber ? `<tr><td>Shift:</td><td class="amount">${escapeHtml(data.shiftNumber)}</td></tr>` : ''}
    <tr><td>Date:</td><td class="amount">${formatDateTime(data.saleDateTime)}</td></tr>
    <tr><td>Customer:</td><td class="amount">${escapeHtml(data.customerName)}</td></tr>
  </table>
  <hr>
  <table>
    <thead>
      <tr>
        <th class="desc">Item</th>
        <th class="qty">Qty</th>
        <th class="price">Price</th>
        <th class="total">Total</th>
      </tr>
    </thead>
    <tbody>
      ${linesHtml}
    </tbody>
  </table>
  <hr>
  <table>
    <tr><td>Subtotal</td><td class="amount">${formatMinor(data.subtotalMinor)}</td></tr>
    ${data.discountMinor > 0 ? `<tr><td>Discount</td><td class="amount">-${formatMinor(data.discountMinor)}</td></tr>` : ''}
    <tr><td>Tax</td><td class="amount">${formatMinor(data.taxMinor)}</td></tr>
    <tr class="totals-row grand-total"><td>TOTAL</td><td class="amount">${formatMinor(data.totalMinor)}</td></tr>
  </table>
  ${data.taxBreakdown.length > 0 ? `
  <hr>
  <div><small>Tax Breakdown</small></div>
  <table>
    <thead><tr><th class="tax-label">Rate</th><th class="tax-net">Net</th><th class="tax-amount">VAT</th></tr></thead>
    <tbody>${taxBreakdownHtml}</tbody>
  </table>` : ''}
  <hr>
  <div class="bold">Payment</div>
  <table>${paymentsHtml}</table>
  <hr>
  <div class="center footer">
    ${data.footerNote ? `<div>${escapeHtml(data.footerNote)}</div>` : ''}
    <div>Thank you for your business!</div>
    <div>Printed: ${formatDateTime(data.printDateTime)}</div>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export { buildReceiptData as generateReceiptData, renderReceiptHtml as generateThermalReceiptHtml };
