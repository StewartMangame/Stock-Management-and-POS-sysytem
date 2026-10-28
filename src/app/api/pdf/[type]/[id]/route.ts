import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import {
  fetchSalesDocumentPdfData,
  generateSalesDocumentPdfBuffer,
} from '@/server/services/pdf/sales-document-pdf';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  try {
    const { type, id } = await params;

    // Validate type and check required permission
    if (type === 'quotation') {
      await authorize(PERMISSIONS.QUOTATIONS_VIEW);
    } else if (type === 'invoice') {
      await authorize(PERMISSIONS.INVOICES_VIEW);
    } else if (type === 'credit_note') {
      await authorize(PERMISSIONS.INVOICES_VIEW);
    } else if (type === 'delivery_note') {
      await authorize(PERMISSIONS.STOCK_VIEW);
    } else {
      return NextResponse.json({ error: 'Invalid document type' }, { status: 400 });
    }

    const data = await fetchSalesDocumentPdfData(
      type as 'quotation' | 'invoice' | 'credit_note' | 'delivery_note',
      id,
    );

    const pdfBuffer = await generateSalesDocumentPdfBuffer(data);

    const filename = `${type}_${data.documentNumber || id}.pdf`;

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
