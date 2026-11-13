/**
 * Invoice Payment Links Service.
 * Generates secure public payment URLs with rate limiting and mobile money prompts.
 */

import crypto from 'node:crypto';
import { db } from '@/server/db';
import {
  paymentLinks,
  paymentLinkRateLimits,
  salesDocuments,
  salesDocumentLines,
  customers,
  payments,
} from '@/server/db/schema';
import { eq, and, sql, gte } from 'drizzle-orm';
import { getPaymentProvider, normalizeMalawianPhone } from './onekhusa';
import { nextSequenceNumber } from '@/server/services/sequences';
import { todayInCompanyTz, getNow } from '@/lib/timezone';
import { checkDbRateLimit } from '@/server/services/rate-limit';

export interface CreatePaymentLinkOptions {
  allowPartial?: boolean;
  expiresInHours?: number;
  createdBy?: string;
}

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Creates a public payment link for an issued invoice with an outstanding balance.
 */
export async function createPaymentLink(
  invoiceId: string,
  options?: CreatePaymentLinkOptions,
) {
  const [inv] = await db
    .select()
    .from(salesDocuments)
    .where(eq(salesDocuments.id, invoiceId));

  if (!inv) throw new Error(`Invoice '${invoiceId}' not found.`);
  if (inv.status !== 'issued') {
    throw new Error(`Cannot create payment link: invoice status is '${inv.status}' (expected 'issued').`);
  }
  if (inv.balanceMinor <= 0) {
    throw new Error('Cannot create payment link: invoice is already fully paid.');
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);

  const hours = options?.expiresInHours ?? 72;
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

  const [link] = await db
    .insert(paymentLinks)
    .values({
      invoiceId: inv.id,
      tokenHash,
      status: 'active',
      expiresAt,
      allowPartial: options?.allowPartial ?? true,
      createdBy: options?.createdBy,
    })
    .returning();

  return {
    paymentLink: link!,
    rawToken,
    url: `/pay/${rawToken}`,
  };
}

/**
 * Fetches public invoice summary for a valid, non-expired payment link token.
 */
export async function getPaymentLinkPublicData(rawToken: string) {
  const tokenHash = hashToken(rawToken);

  const [link] = await db
    .select()
    .from(paymentLinks)
    .where(eq(paymentLinks.tokenHash, tokenHash));

  if (!link) {
    return { valid: false, error: 'Payment link not found or invalid.' };
  }

  const now = new Date();
  if (link.expiresAt < now || link.status === 'expired') {
    return { valid: false, error: 'This payment link has expired.' };
  }
  if (link.status === 'revoked') {
    return { valid: false, error: 'This payment link has been revoked.' };
  }

  const [inv] = await db
    .select()
    .from(salesDocuments)
    .where(eq(salesDocuments.id, link.invoiceId));

  if (!inv) {
    return { valid: false, error: 'Associated invoice not found.' };
  }

  if (inv.balanceMinor <= 0 || inv.paymentStatus === 'paid') {
    return {
      valid: true,
      isPaid: true,
      invoice: {
        documentNumber: inv.documentNumber,
        totalMinor: inv.totalMinor,
        balanceMinor: 0,
      },
    };
  }

  const [cust] = await db
    .select({ name: customers.name, accountNumber: customers.accountNumber })
    .from(customers)
    .where(eq(customers.id, inv.customerId));

  const lines = await db
    .select({
      id: salesDocumentLines.id,
      description: salesDocumentLines.description,
      quantity: salesDocumentLines.quantity,
      unitPriceMinor: salesDocumentLines.unitPriceMinor,
      lineTotalMinor: salesDocumentLines.lineTotalMinor,
    })
    .from(salesDocumentLines)
    .where(eq(salesDocumentLines.documentId, inv.id));

  return {
    valid: true,
    isPaid: false,
    linkId: link.id,
    allowPartial: link.allowPartial,
    expiresAt: link.expiresAt.toISOString(),
    invoice: {
      id: inv.id,
      documentNumber: inv.documentNumber,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      currency: inv.currency,
      totalMinor: inv.totalMinor,
      paidMinor: inv.paidMinor,
      balanceMinor: inv.balanceMinor,
      customerName: cust?.name ?? 'Customer',
      lines,
    },
  };
}

/**
 * Checks persistent rate limits in PostgreSQL.
 * Max 5 requests per key per 10-minute window.
 */
async function checkRateLimit(key: string, limit = 5, windowMs = 10 * 60 * 1000): Promise<boolean> {
  const { allowed } = await checkDbRateLimit(key, limit, Math.floor(windowMs / 1000));
  return allowed;
}

/**
 * Initiates an online mobile money push prompt for an invoice payment link.
 */
export async function initiatePaymentLinkPush(
  rawToken: string,
  input: {
    phone: string;
    amountMinor?: number;
    clientIp: string;
  },
) {
  // 1. Rate Limiting: IP, Token, and Phone
  const ipAllowed = await checkRateLimit(`ip:${input.clientIp}`, 10);
  if (!ipAllowed) {
    throw new Error('Too many requests from your IP address. Please wait a few minutes.');
  }

  const tokenHash = hashToken(rawToken);
  const tokenAllowed = await checkRateLimit(`token:${tokenHash.slice(0, 16)}`, 5);
  if (!tokenAllowed) {
    throw new Error('Too many payment attempts for this invoice. Please wait a few minutes.');
  }

  const phoneVal = normalizeMalawianPhone(input.phone);
  if (!phoneVal.valid) {
    throw new Error(`Invalid Malawian phone number '${input.phone}'.`);
  }

  const phoneAllowed = await checkRateLimit(`phone:${phoneVal.normalized}`, 5);
  if (!phoneAllowed) {
    throw new Error('Too many payment attempts for this phone number. Please wait a few minutes.');
  }

  // 2. Validate Link & Invoice
  const linkData = await getPaymentLinkPublicData(rawToken);
  if (!linkData.valid || !linkData.invoice) {
    throw new Error(linkData.error || 'Payment link is invalid or expired.');
  }
  if (linkData.isPaid || linkData.invoice.balanceMinor <= 0) {
    throw new Error('This invoice is already fully paid.');
  }

  const requestedAmount = input.amountMinor ?? linkData.invoice.balanceMinor;
  if (requestedAmount <= 0) {
    throw new Error('Payment amount must be greater than zero.');
  }
  if (!linkData.allowPartial && requestedAmount < linkData.invoice.balanceMinor) {
    throw new Error('Partial payments are not enabled for this invoice.');
  }
  if (requestedAmount > linkData.invoice.balanceMinor) {
    throw new Error(
      `Payment amount exceeds outstanding invoice balance (${(linkData.invoice.balanceMinor / 100).toLocaleString()} MWK).`,
    );
  }

  // 3. Create Pending Payment
  const invoiceId = linkData.invoice.id as string;
  const [inv] = await db
    .select()
    .from(salesDocuments)
    .where(eq(salesDocuments.id, invoiceId));

  const today = todayInCompanyTz();
  const paymentNumber = await nextSequenceNumber(db, 'payment', inv!.locationId);
  const idempotencyKey = `link-pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const [payment] = await db
    .insert(payments)
    .values({
      paymentNumber,
      idempotencyKey,
      customerId: inv!.customerId,
      locationId: inv!.locationId,
      kind: 'receipt',
      method: phoneVal.network === 'airtel' ? 'airtel_money' : 'mpamba',
      amountMinor: requestedAmount,
      status: 'pending',
      provider: 'onekhusa',
      paymentDate: today,
      intendedAllocations: [{ invoiceId: inv!.id, amountMinor: requestedAmount }],
      methodDetails: {
        phone: phoneVal.normalized,
        network: phoneVal.network,
        payment_link_id: linkData.linkId,
      },
    })
    .returning();

  // 4. Trigger Provider STK Push
  const provider = getPaymentProvider();
  const pushRes = await provider.initiatePush({
    paymentId: payment!.id,
    amountMinor: requestedAmount,
    currency: 'MWK',
    payerPhone: phoneVal.normalized,
    description: `Online Invoice ${inv!.documentNumber}`,
    idempotencyKey,
    sourceReferenceNumber: payment!.id,
  });

  if (!pushRes.success) {
    await db
      .update(payments)
      .set({
        status: 'failed',
        reversalReason: pushRes.errorMessage || 'Provider push prompt rejected',
        updatedAt: getNow(),
      })
      .where(eq(payments.id, payment!.id));

    return {
      success: false,
      paymentId: payment!.id,
      errorMessage: pushRes.errorMessage || 'Failed to initiate mobile money prompt.',
    };
  }

  await db
    .update(payments)
    .set({
      providerReference: pushRes.providerReference,
      providerStatus: pushRes.providerStatus,
      updatedAt: getNow(),
    })
    .where(eq(payments.id, payment!.id));

  return {
    success: true,
    paymentId: payment!.id,
    providerReference: pushRes.providerReference,
    status: 'pending',
  };
}

