import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import {
  fetchSalesDocumentPdfData,
  generateSalesDocumentPdfBuffer,
} from '@/server/services/pdf/sales-document-pdf';
import {
  generatePaymentReceiptPdfBuffer,
  generateCustomerStatementPdfBuffer,
  generateAgedDebtorsPdfBuffer,
} from '@/server/services/pdf/payment-pdf';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  try {
    const { type, id } = await params;
    const url = new URL(req.url);

    // Validate type and check required permission
    if (type === 'quotation') {
      await authorize(PERMISSIONS.QUOTATIONS_VIEW);
    } else if (type === 'invoice' || type === 'credit_note') {
      await authorize(PERMISSIONS.INVOICES_VIEW);
    } else if (type === 'delivery_note') {
      await authorize(PERMISSIONS.STOCK_VIEW);
    } else if (type === 'receipt') {
      await authorize(PERMISSIONS.PAYMENTS_VIEW);
    } else if (type === 'statement' || type === 'aged_debtors') {
      await authorize(PERMISSIONS.REPORTS_VIEW);
    } else {
      return NextResponse.json({ error: 'Invalid document type' }, { status: 400 });
    }

    let pdfBuffer: Buffer;
    let filename = `${type}_${id}.pdf`;

    if (type === 'receipt') {
      pdfBuffer = await generatePaymentReceiptPdfBuffer(id);
      filename = `receipt_${id}.pdf`;
    } else if (type === 'statement') {
      const from = url.searchParams.get('from') || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10);
      pdfBuffer = await generateCustomerStatementPdfBuffer(id, from, to);
      filename = `statement_${id}_${from}_${to}.pdf`;
    } else if (type === 'aged_debtors') {
      const asOf = url.searchParams.get('asOf') || new Date().toISOString().slice(0, 10);
      const locationId = url.searchParams.get('locationId') || undefined;
      pdfBuffer = await generateAgedDebtorsPdfBuffer(asOf, locationId);
      filename = `aged_debtors_${asOf}.pdf`;
    } else {
      const data = await fetchSalesDocumentPdfData(
        type as 'quotation' | 'invoice' | 'credit_note' | 'delivery_note',
        id,
      );
      pdfBuffer = await generateSalesDocumentPdfBuffer(data);
      filename = `${type}_${data.documentNumber || id}.pdf`;
    }

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: unknown) {
    if (err instanceof AuthorizationError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === 'UNAUTHENTICATED' ? 401 : 403 },
      );
    }

    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
