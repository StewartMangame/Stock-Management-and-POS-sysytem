/**
 * Warranty & Sales Pipeline Report Services (Phase 6).
 *
 * Warranty: Expiring in 30, 60, and 90 days by customer; lookup by serial.
 * Pipeline: Open quotations, conversion rate, expiring soon.
 */

import { db } from '@/server/db';
import { sql } from 'drizzle-orm';
import { startOfDayInCompanyTz } from '@/lib/timezone';

// ── Warranty Report ───────────────────────────────────────────────────────────

export interface WarrantyExpiringRow {
  serialId: string;
  serialNumber: string;
  productId: string;
  productName: string;
  customerId: string | null;
  customerName: string | null;
  warrantyExpiresAt: string;
  daysUntilExpiry: number;
  bucket: '30d' | '60d' | '90d';
}

export async function getWarrantyExpiring(
  locationId?: string,
): Promise<{ rows: WarrantyExpiringRow[] }> {
  const now = new Date();
  const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const locationFilter = locationId
    ? sql`AND sn.location_id = ${locationId}::uuid`
    : sql``;

  const result = await db.execute<{
    serial_id: string;
    serial_number: string;
    product_id: string;
    product_name: string;
    customer_id: string | null;
    customer_name: string | null;
    warranty_expires_at: string;
    days_until_expiry: string;
  }>(sql`
    SELECT
      sn.id AS serial_id,
      sn.serial_number,
      p.id AS product_id,
      p.name AS product_name,
      c.id AS customer_id,
      c.name AS customer_name,
      to_char(sn.warranty_end, 'YYYY-MM-DD') AS warranty_expires_at,
      EXTRACT(DAY FROM sn.warranty_end::timestamp - NOW())::text AS days_until_expiry
    FROM serial_numbers sn
    JOIN products p ON p.id = sn.product_id
    LEFT JOIN customers c ON c.id = sn.customer_id
    WHERE sn.warranty_end IS NOT NULL
      AND sn.warranty_end > CURRENT_DATE
      AND sn.warranty_end <= CURRENT_DATE + INTERVAL '90 days'
      AND sn.status = 'sold'
      ${locationFilter}
    ORDER BY sn.warranty_end
  `);

  const rows: WarrantyExpiringRow[] = result.rows.map((r) => {
    const days = Number(r.days_until_expiry);
    return {
      serialId: r.serial_id,
      serialNumber: r.serial_number,
      productId: r.product_id,
      productName: r.product_name,
      customerId: r.customer_id,
      customerName: r.customer_name,
      warrantyExpiresAt: r.warranty_expires_at,
      daysUntilExpiry: days,
      bucket: days <= 30 ? '30d' : days <= 60 ? '60d' : '90d',
    };
  });

  return { rows };
}

// ── Sales Pipeline Report ─────────────────────────────────────────────────────

export interface PipelineRow {
  quotationId: string;
  quotationNumber: string;
  customerId: string;
  customerName: string;
  issueDate: string;
  expiresDate: string | null;
  totalMinor: number;
  status: string;
  daysOpen: number;
  isExpiringSoon: boolean;
  convertedToInvoiceId: string | null;
}

export interface PipelineTotals {
  totalOpen: number;
  totalValueMinor: number;
  convertedCount: number;
  expiredCount: number;
  conversionRate: number;
  expiringIn7: number;
  expiringIn14: number;
  expiringIn30: number;
}

export async function getSalesPipeline(
  locationId?: string,
): Promise<{ rows: PipelineRow[]; totals: PipelineTotals }> {
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const locationFilter = locationId
    ? sql`AND sd.location_id = ${locationId}::uuid`
    : sql``;

  const result = await db.execute<{
    quotation_id: string;
    quotation_number: string;
    customer_id: string;
    customer_name: string;
    issue_date: string;
    expires_date: string | null;
    total_minor: string;
    status: string;
    days_open: string;
    converted_to_invoice_id: string | null;
  }>(sql`
    SELECT
      q.id AS quotation_id,
      q.quotation_number,
      c.id AS customer_id,
      c.name AS customer_name,
      to_char(q.quotation_date, 'YYYY-MM-DD') AS issue_date,
      to_char(q.valid_until, 'YYYY-MM-DD') AS expires_date,
      q.total_minor::text AS total_minor,
      q.status,
      EXTRACT(DAY FROM NOW() - q.created_at)::text AS days_open,
      inv.id::text AS converted_to_invoice_id
    FROM quotations q
    JOIN customers c ON c.id = q.customer_id
    LEFT JOIN sales_documents inv
      ON inv.source_document_id = q.id AND inv.document_type = 'invoice'
    ORDER BY q.quotation_date DESC
  `);

  const rows: PipelineRow[] = result.rows.map((r) => {
    const expiresDate = r.expires_date;
    const isExpiringSoon = expiresDate
      ? new Date(expiresDate) <= in30 && new Date(expiresDate) > now
      : false;
    return {
      quotationId: r.quotation_id,
      quotationNumber: r.quotation_number,
      customerId: r.customer_id,
      customerName: r.customer_name,
      issueDate: r.issue_date,
      expiresDate,
      totalMinor: Number(r.total_minor),
      status: r.status,
      daysOpen: Number(r.days_open),
      isExpiringSoon,
      convertedToInvoiceId: r.converted_to_invoice_id,
    };
  });

  const openRows = rows.filter((r) => r.status === 'open');
  const convertedCount = rows.filter((r) => r.convertedToInvoiceId).length;
  const total = rows.length;

  return {
    rows,
    totals: {
      totalOpen: openRows.length,
      totalValueMinor: openRows.reduce((s, r) => s + r.totalMinor, 0),
      convertedCount,
      expiredCount: rows.filter((r) => r.status === 'expired').length,
      conversionRate: total > 0 ? Math.round((convertedCount / total) * 10000) / 100 : 0,
      expiringIn7: openRows.filter((r) => r.expiresDate &&
        new Date(r.expiresDate) <= new Date(now.getTime() + 7 * 86400000) &&
        new Date(r.expiresDate) > now).length,
      expiringIn14: openRows.filter((r) => r.expiresDate &&
        new Date(r.expiresDate) <= new Date(now.getTime() + 14 * 86400000) &&
        new Date(r.expiresDate) > now).length,
      expiringIn30: openRows.filter((r) => r.isExpiringSoon).length,
    },
  };
}

