/**
 * GET /api/pay/[token]/status?paymentId=<uuid>
 * Public — no auth. Polls the status of a mobile money payment for the payment link UI.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';
import { payments } from '@/server/db/schema';
import { eq } from 'drizzle-orm';

interface Props {
  params: Promise<{ token: string }>;
}

export async function GET(request: NextRequest, { params }: Props) {
  // token param is present for route matching but we use paymentId for lookup
  await params;

  const paymentId = request.nextUrl.searchParams.get('paymentId');
  if (!paymentId) {
    return NextResponse.json({ error: 'paymentId is required.' }, { status: 400 });
  }

  const [payment] = await db
    .select({
      id: payments.id,
      status: payments.status,
      flagType: payments.flagType,
    })
    .from(payments)
    .where(eq(payments.id, paymentId));

  if (!payment) {
    return NextResponse.json({ error: 'Payment not found.' }, { status: 404 });
  }

  // If payment is flagged, surface a generic message (no internal detail to public)
  if (payment.flagType) {
    return NextResponse.json({
      status: payment.status,
      error: 'Payment requires manual review. Please contact support.',
    });
  }

  return NextResponse.json({ status: payment.status });
}

