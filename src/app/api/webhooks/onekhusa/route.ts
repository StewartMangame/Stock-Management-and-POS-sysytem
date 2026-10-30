/**
 * OneKhusa Webhook Ingestion API Route.
 *
 * Verifies HMAC-SHA512 signature on raw payload, deduplicates via webhook_inbox,
 * returns 200 OK instantly, and delegates asynchronous processing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';
import { webhookInbox } from '@/server/db/schema';
import { getPaymentProvider } from '@/server/services/integrations/onekhusa';
import { processWebhookInboxItem } from '@/server/services/integrations/webhook-processor';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const rawPayload = await req.text();

    // Collect headers
    const headersObj: Record<string, string> = {};
    req.headers.forEach((val, key) => {
      headersObj[key.toLowerCase()] = val;
    });

    // 1. Verify cryptographic HMAC-SHA512 signature on raw body in constant time
    const provider = getPaymentProvider();
    const verified = provider.verifyWebhook(rawPayload, headersObj);

    if (!verified.isValid) {
      console.warn('[OneKhusa Webhook] Rejected invalid signature:', verified.error);
      return NextResponse.json({ error: verified.error || 'Invalid signature' }, { status: 401 });
    }

    const txRef = verified.transactionReference || verified.sourceReferenceNumber || `UNKNOWN-${Date.now()}`;
    const eventType = verified.eventType || 'pushpayment.success';

    // 2. Insert into webhook_inbox with transaction_reference + event_type deduplication
    const [inserted] = await db
      .insert(webhookInbox)
      .values({
        provider: 'onekhusa',
        eventType,
        transactionReference: txRef,
        rawPayload,
        headers: headersObj,
        status: 'received',
      })
      .onConflictDoNothing({
        target: [webhookInbox.transactionReference, webhookInbox.eventType],
      })
      .returning();

    // 3. If duplicate event, acknowledge with 200 OK immediately
    if (!inserted) {
      return NextResponse.json({ status: 'already_received' }, { status: 200 });
    }

    // 4. Return 200 OK immediately and process asynchronously
    const response = NextResponse.json({ status: 'acknowledged' }, { status: 200 });

    // Process using microtask/async without blocking HTTP response
    processWebhookInboxItem(inserted.id).catch((err) => {
      console.error('[OneKhusa Webhook] Async processor error:', err);
    });

    return response;
  } catch (err: any) {
    console.error('[OneKhusa Webhook] Fatal error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

