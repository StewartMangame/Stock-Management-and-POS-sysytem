/**
 * OneKhusa Webhook Ingestion API Route.
 *
 * Verifies HMAC-SHA512 signature on raw payload, deduplicates via webhook_inbox,
 * returns 200 OK instantly, and delegates asynchronous processing via after().
 */

import { NextRequest, NextResponse, after } from 'next/server';
import { db } from '@/server/db';
import { webhookInbox } from '@/server/db/schema';
import { getPaymentProvider } from '@/server/services/integrations/onekhusa';
import { processWebhookInboxItem } from '@/server/services/integrations/webhook-processor';
import { checkDbRateLimit } from '@/server/services/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    // 0. DB-backed rate limit check on caller IP
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown_ip';
    const rateCheck = await checkDbRateLimit(`webhook_ip:${ip}`, 120, 60);
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
    }

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

    // 4. Return 200 OK immediately and execute processing using Next.js after()
    after(async () => {
      try {
        await processWebhookInboxItem(inserted.id);
      } catch (err) {
        console.error('[OneKhusa Webhook] after() processing error:', err);
      }
    });

    return NextResponse.json({ status: 'acknowledged' }, { status: 200 });
  } catch (err: any) {
    console.error('[OneKhusa Webhook] Fatal error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
