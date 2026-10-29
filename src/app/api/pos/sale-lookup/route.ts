import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import { salesDocuments, salesDocumentLines, payments, paymentAllocations, customers, products, posShifts } from '@/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';

/**
 * GET /api/pos/sale-lookup?receiptNumber=...
 *
 * Looks up counter sale by invoice number for returns or receipt reprinting.
 * Security enforcement: Must belong to current cashier unless actor has 'pos:reprint_any'.
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await authorize(PERMISSIONS.POS_ACCESS);
    const { searchParams } = new URL(req.url);

    const receiptNumber = searchParams.get('receiptNumber') || searchParams.get('invoiceNumber');
    if (!receiptNumber) {
      return NextResponse.json({ error: 'receiptNumber query parameter is required' }, { status: 400 });
    }

    // 1. Fetch sales document
    const [doc] = await db
      .select({
        id: salesDocuments.id,
        documentNumber: salesDocuments.documentNumber,
        documentType: salesDocuments.documentType,
        channel: salesDocuments.channel,
        shiftId: salesDocuments.shiftId,
        locationId: salesDocuments.locationId,
        customerId: salesDocuments.customerId,
        customerName: customers.name,
        isWalkIn: customers.isWalkIn,
        status: salesDocuments.status,
        paymentStatus: salesDocuments.paymentStatus,
        deliveryStatus: salesDocuments.deliveryStatus,
        subtotalMinor: salesDocuments.subtotalMinor,
        taxMinor: salesDocuments.taxMinor,
        discountMinor: salesDocuments.discountMinor,
        totalMinor: salesDocuments.totalMinor,
        balanceMinor: salesDocuments.balanceMinor,
        issueDate: salesDocuments.issueDate,
        createdAt: salesDocuments.createdAt,
        createdBy: salesDocuments.createdBy,
      })
      .from(salesDocuments)
      .innerJoin(customers, eq(salesDocuments.customerId, customers.id))
      .where(
        and(
          eq(salesDocuments.documentNumber, receiptNumber.trim()),
          eq(salesDocuments.documentType, 'invoice'),
        ),
      )
      .limit(1);

    if (!doc) {
      return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
    }

    // 2. Permission check:
    // If cashier did not create the sale and it is not on their current shift,
    // they must hold 'pos:reprint_any' permission.
    const isOwnSale = doc.createdBy === actor.id;
    const hasReprintAny = actor.role.permissions.includes(PERMISSIONS.POS_REPRINT_ANY);

    if (!isOwnSale && !hasReprintAny) {
      return NextResponse.json(
        { error: 'You do not have permission to access sales created by other cashiers' },
        { status: 403 },
      );
    }

    // 3. Fetch lines with product details
    const lines = await db
      .select({
        id: salesDocumentLines.id,
        productId: salesDocumentLines.productId,
        productName: products.name,
        sku: products.sku,
        isSerialTracked: products.serialTracking,
        quantity: salesDocumentLines.quantity,
        unitPriceMinor: salesDocumentLines.unitPriceMinor,
        discountMinor: salesDocumentLines.discountMinor,
        taxMinor: salesDocumentLines.taxMinor,
        lineTotalMinor: salesDocumentLines.lineTotalMinor,
      })
      .from(salesDocumentLines)
      .innerJoin(products, eq(salesDocumentLines.productId, products.id))
      .where(eq(salesDocumentLines.documentId, doc.id));

    // 4. Fetch payments associated with this invoice via payment_allocations
    const paymentRows = await db
      .select({
        id: payments.id,
        paymentNumber: payments.paymentNumber,
        method: payments.method,
        amountMinor: paymentAllocations.amountMinor,
        methodDetails: payments.methodDetails,
        paymentDate: payments.paymentDate,
        createdAt: payments.createdAt,
      })
      .from(paymentAllocations)
      .innerJoin(payments, eq(paymentAllocations.paymentId, payments.id))
      .where(eq(paymentAllocations.invoiceId, doc.id));

    return NextResponse.json({
      sale: {
        ...doc,
        subtotalMinor: doc.subtotalMinor.toString(),
        taxMinor: doc.taxMinor.toString(),
        discountMinor: doc.discountMinor.toString(),
        totalMinor: doc.totalMinor.toString(),
        balanceMinor: doc.balanceMinor.toString(),
        lines: lines.map((l) => ({
          ...l,
          quantity: Number(l.quantity),
          unitPriceMinor: l.unitPriceMinor.toString(),
          discountMinor: l.discountMinor.toString(),
          taxMinor: l.taxMinor.toString(),
          lineTotalMinor: l.lineTotalMinor.toString(),
        })),
        payments: paymentRows.map((p) => ({
          ...p,
          amountMinor: p.amountMinor.toString(),
        })),
      },
    });
  } catch (err: unknown) {
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : 'Failed to look up sale';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
