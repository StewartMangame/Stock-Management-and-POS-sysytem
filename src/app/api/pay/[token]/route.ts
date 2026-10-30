/**
 * POST /api/pay/[token]
 * Public — no auth. Initiates a mobile money push for an invoice payment link.
 */
import { NextRequest, NextResponse } from 'next/server';
import { initiatePaymentLinkPush } from '@/server/services/integrations/payment-links';

interface Props {
  params: Promise<{ token: string }>;
}

export async function POST(request: NextRequest, { params }: Props) {
  const { token } = await params;

  let body: { phone?: string; amountMinor?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (!body.phone) {
    return NextResponse.json({ error: 'Phone number is required.' }, { status: 400 });
  }

  // Extract real client IP (Vercel/Nginx forward header, fall back to socket)
  const forwardedFor = request.headers.get('x-forwarded-for');
  const clientIp = forwardedFor ? forwardedFor.split(',')[0]!.trim() : '127.0.0.1';

  try {
    const result = await initiatePaymentLinkPush(token, {
      phone: body.phone,
      amountMinor: body.amountMinor,
      clientIp,
    });

    return NextResponse.json({ paymentId: result.paymentId });
  } catch (err: any) {
    const message = err?.message ?? 'Failed to initiate payment.';
    // Rate limit / validation errors → 422, server errors → 500
    const isUserError =
      message.includes('Too many') ||
      message.includes('Invalid') ||
      message.includes('already') ||
      message.includes('exceeded') ||
      message.includes('Partial');
    return NextResponse.json({ error: message }, { status: isUserError ? 422 : 500 });
  }
}

