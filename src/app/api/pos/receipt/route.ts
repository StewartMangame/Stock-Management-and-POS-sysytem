import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import { salesDocuments } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import {
  generateReceiptData,
  generateThermalReceiptHtml,
} from '@/server/services/pos/receipt-formatter';

/**
 * GET /api/pos/receipt?invoiceId=...&reprint=true/false&format=html/json
 *
 * Returns 80mm/58mm thermal receipt data or ready-to-print HTML.
 * Supports duplicate reprint watermark.
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await authorize(PERMISSIONS.POS_ACCESS);
    const { searchParams } = new URL(req.url);

    const invoiceId = searchParams.get('invoiceId');
    if (!invoiceId) {
      return NextResponse.json({ error: 'invoiceId query parameter is required' }, { status: 400 });
    }

    const isReprint = searchParams.get('reprint') === 'true';
    const format = searchParams.get('format') || 'json';

    // Verify ownership or reprint_any permission
    const [doc] = await db
      .select({ id: salesDocuments.id, createdBy: salesDocuments.createdBy })
      .from(salesDocuments)
      .where(eq(salesDocuments.id, invoiceId))
      .limit(1);

    if (!doc) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (isReprint) {
      const isOwner = doc.createdBy === actor.id;
      const canReprintAny = actor.role.permissions.includes(PERMISSIONS.POS_REPRINT_ANY);
      if (!isOwner && !canReprintAny) {
        return NextResponse.json(
          { error: 'You do not have permission to reprint receipts created by other cashiers' },
          { status: 403 },
        );
      }
    }

    const receiptData = await generateReceiptData(invoiceId, isReprint);

    if (format === 'html') {
      const html = generateThermalReceiptHtml(receiptData);
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    }

    return NextResponse.json({ receipt: receiptData });
  } catch (err: unknown) {
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : 'Failed to generate receipt';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
