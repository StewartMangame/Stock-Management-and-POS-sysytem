/**
 * Mock Payment Provider for OneKhusa.
 * Used for development, testing, and offline POS simulation.
 */

import crypto from 'node:crypto';
import { db } from '@/server/db';
import { paymentAttempts } from '@/server/db/schema';
import {
  PaymentProvider,
  InitiatePushParams,
  InitiatePushResult,
  TransactionQueryResult,
  WebhookVerificationResult,
  normalizeMalawianPhone,
  maskPhone,
} from './types';

export class MockPaymentProvider implements PaymentProvider {
  public name = 'onekhusa_mock';

  public simulatedStatus: 'confirmed' | 'failed' | 'pending' | 'reversed' = 'confirmed';
  public webhookSecret = 'mock-webhook-secret';

  async initiatePush(params: InitiatePushParams): Promise<InitiatePushResult> {
    const normalized = normalizeMalawianPhone(params.payerPhone);
    if (!normalized.valid) {
      return {
        success: false,
        providerStatus: 'invalid_phone',
        errorMessage: `Invalid Malawian phone number '${params.payerPhone}'`,
      };
    }

    const providerRef = `MOCK-TXN-${Date.now()}`;

    // Write forensic log
    await db.insert(paymentAttempts).values({
      paymentId: params.paymentId,
      attemptType: 'mock_push_initiate',
      idempotencyKey: params.idempotencyKey,
      requestUrl: 'https://mock.onekhusa.local/push',
      requestHeaders: { 'X-Idempotency-Key': params.idempotencyKey },
      requestBody: {
        amountMinor: params.amountMinor,
        phone: maskPhone(normalized.normalized),
        network: normalized.network,
      },
      responseStatus: 200,
      responseBody: {
        paymentTransactionId: providerRef,
        status: this.simulatedStatus,
      },
    });

    return {
      success: true,
      providerReference: providerRef,
      providerStatus: 'pending',
      checkoutUrl: `https://mock.onekhusa.local/checkout/${providerRef}`,
      rawResponse: { providerRef, simulatedStatus: this.simulatedStatus },
    };
  }

  async queryTransaction(providerReference: string): Promise<TransactionQueryResult> {
    const feeMinor = 20000; // 200 MWK mock fee
    const amountMinor = 1000000; // 10,000 MWK mock amount
    return {
      providerReference,
      status: this.simulatedStatus,
      providerStatusCode: this.simulatedStatus === 'confirmed' ? 'S' : 'E',
      providerStatusName: this.simulatedStatus === 'confirmed' ? 'Success' : 'Failed',
      amountMinor,
      feeMinor,
      netMinor: amountMinor - feeMinor,
      currency: 'MWK',
      rawResponse: { simulated: true, status: this.simulatedStatus },
    };
  }

  verifyWebhook(
    rawPayload: string,
    headers: Record<string, string | string[] | undefined>,
  ): WebhookVerificationResult {
    const sigHeader =
      headers['x-onekhusa-webhook-signature'] ||
      headers['X-OneKhusa-Webhook-Signature'] ||
      headers['x-onekhusa-signature'] ||
      headers['X-OneKhusa-Signature'];

    const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
    if (!signature) {
      return { isValid: false, error: 'Missing signature header' };
    }

    const computed = crypto
      .createHmac('sha512', this.webhookSecret)
      .update(rawPayload)
      .digest('hex');

    if (computed !== signature) {
      return { isValid: false, error: 'Signature mismatch' };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawPayload);
    } catch {
      return { isValid: false, error: 'Invalid JSON' };
    }

    return {
      isValid: true,
      eventType: 'pushpayment.success',
      transactionReference: parsed.transactionReference || 'MOCK-TXN',
      sourceReferenceNumber: parsed.sourceReferenceNumber,
      status: 'confirmed',
      amountMinor: parsed.amountMinor || 10000,
      feeMinor: 200,
      netMinor: 9800,
      currency: 'MWK',
      rawEvent: parsed,
    };
  }

  /**
   * Helper to sign a payload with this mock secret.
   */
  createSignature(payload: string): string {
    return crypto.createHmac('sha512', this.webhookSecret).update(payload).digest('hex');
  }
}

