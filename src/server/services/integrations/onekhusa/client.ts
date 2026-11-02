/**
 * OneKhusa Live API Client.
 * Implements the PaymentProvider interface against the real OneKhusa REST API.
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

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

export class OneKhusaClient implements PaymentProvider {
  public name = 'onekhusa';

  private baseUrl: string;
  private apiKey: string;
  private apiSecret: string;
  private organisationId: string;
  private merchantAccountNumber: number;
  private webhookSecret: string;

  private cachedToken: CachedToken | null = null;

  constructor(options?: {
    baseUrl?: string;
    apiKey?: string;
    apiSecret?: string;
    organisationId?: string;
    merchantAccountNumber?: number;
    webhookSecret?: string;
  }) {
    this.baseUrl = (options?.baseUrl || process.env.ONEKHUSA_BASE_URL || 'https://api.onekhusa.com/sandbox/v1').replace(/\/$/, '');
    this.apiKey = options?.apiKey || process.env.ONEKHUSA_API_KEY || '';
    this.apiSecret = options?.apiSecret || process.env.ONEKHUSA_API_SECRET || '';
    this.organisationId = options?.organisationId || process.env.ONEKHUSA_ORGANISATION_ID || '';
    this.merchantAccountNumber = options?.merchantAccountNumber || Number(process.env.ONEKHUSA_MERCHANT_ACCOUNT_NUMBER || 0);
    this.webhookSecret = options?.webhookSecret || process.env.ONEKHUSA_WEBHOOK_SECRET || '';
  }

  /**
   * Retrieves or refreshes OAuth 2.0 Access Token (valid for 5 minutes).
   * Caches token in memory and refreshes 30 seconds before expiry.
   * NEVER logs credentials or token requests in forensic payment_attempts.
   */
  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now + 30000) {
      return this.cachedToken.token;
    }

    const tokenUrl = `${this.baseUrl}/account/getAccessToken`;
    const payload = {
      apiKey: this.apiKey,
      apiSecret: this.apiSecret,
      organisationId: this.organisationId,
      merchantAccountNumber: this.merchantAccountNumber,
    };

    const res = await this.fetchWithRetry(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OneKhusa token acquisition failed [HTTP ${res.status}]: ${errText}`);
    }

    const data = await res.json();
    const token = data.accessToken || data.token;
    if (!token) {
      throw new Error('OneKhusa token response did not contain an accessToken');
    }

    // 5 minutes expiry minus safety buffer
    this.cachedToken = {
      token,
      expiresAt: now + 5 * 60 * 1000,
    };

    return token;
  }

  /**
   * Fetch with exponential backoff and jitter on HTTP 429 Too Many Requests.
   */
  private async fetchWithRetry(url: string, init: RequestInit, retries = 3): Promise<Response> {
    let lastError: any = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, init);
        if (res.status === 429 && attempt < retries) {
          const delay = Math.pow(2, attempt) * 500 + Math.random() * 200;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        return res;
      } catch (err: any) {
        lastError = err;
        if (attempt < retries) {
          const delay = Math.pow(2, attempt) * 500 + Math.random() * 200;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastError || new Error(`Network request failed after ${retries} retries`);
  }

  /**
   * Initiates a Mobile Money direct push payment prompt (STK Push).
   * Logs attempt in append-only payment_attempts table with masked phone & redacted secrets.
   */
  async initiatePush(params: InitiatePushParams): Promise<InitiatePushResult> {
    const normalized = normalizeMalawianPhone(params.payerPhone);
    if (!normalized.valid) {
      return {
        success: false,
        providerStatus: 'invalid_phone',
        errorMessage: `Invalid Malawian phone number '${params.payerPhone}'. Must start with 8 (Airtel) or 9 (TNM).`,
      };
    }

    const token = await this.getAccessToken();
    const pushUrl = `${this.baseUrl}/checkout/push/initiate`;
    const amountFloat = Number((params.amountMinor / 100).toFixed(2));
    const srn = params.sourceReferenceNumber || params.paymentId;

    const requestPayload = {
      payment: {
        merchantAccountNumber: this.merchantAccountNumber,
        amount: amountFloat,
        description: params.description,
        sourceReferenceNumber: srn,
        capturedBy: params.capturedBy || 'system',
        payerAccountNumber: normalized.normalized,
      },
      route: {
        successRedirectionUrl: 'https://sm-pos-system.local/payments/success',
        failureRedirectionUrl: 'https://sm-pos-system.local/payments/failure',
      },
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Idempotency-Key': params.idempotencyKey,
    };

    // Forensic masked body for payment_attempts log
    const maskedLogBody = {
      ...requestPayload,
      payment: {
        ...requestPayload.payment,
        payerAccountNumber: maskPhone(normalized.normalized),
      },
    };

    let responseStatus: number | undefined;
    let responseBody: any = null;
    let errorMessage: string | undefined;

    try {
      const res = await this.fetchWithRetry(pushUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
      });

      responseStatus = res.status;
      const text = await res.text();
      try {
        responseBody = JSON.parse(text);
      } catch {
        responseBody = { raw: text };
      }

      if (!res.ok) {
        errorMessage = responseBody.detail || responseBody.title || `Push failed with HTTP ${res.status}`;
      }
    } catch (err: any) {
      errorMessage = err.message || 'Push request network exception';
    }

    // Write append-only forensic audit log in payment_attempts
    await db.insert(paymentAttempts).values({
      paymentId: params.paymentId,
      attemptType: 'push_initiate',
      idempotencyKey: params.idempotencyKey,
      requestUrl: pushUrl,
      requestHeaders: { 'X-Idempotency-Key': params.idempotencyKey, 'Content-Type': 'application/json' },
      requestBody: maskedLogBody,
      responseStatus: responseStatus ?? 0,
      responseBody: responseBody ?? null,
      errorMessage: errorMessage ?? null,
    });

    if (errorMessage || !responseBody) {
      return {
        success: false,
        providerStatus: 'failed',
        errorMessage: errorMessage || 'Failed to initiate push prompt',
        rawResponse: responseBody,
      };
    }

    const providerRef =
      responseBody.paymentTransactionId ||
      responseBody.transactionReferenceNumber ||
      responseBody.sourceReferenceNumber ||
      srn;

    return {
      success: true,
      providerReference: providerRef,
      providerStatus: 'pending',
      checkoutUrl: responseBody.checkoutUrl,
      rawResponse: responseBody,
    };
  }

  /**
   * Queries status of a transaction from OneKhusa gateway.
   */
  async queryTransaction(providerReference: string): Promise<TransactionQueryResult> {
    const token = await this.getAccessToken();
    const queryUrl = `${this.baseUrl}/collections/getTransaction`;

    const payload = {
      merchantAccountNumber: this.merchantAccountNumber,
      transactionReferenceNumber: providerReference,
    };

    const res = await this.fetchWithRetry(queryUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const resText = await res.text();
    let data: any = {};
    try {
      data = JSON.parse(resText);
    } catch {
      data = { raw: resText };
    }

    if (!res.ok) {
      return {
        providerReference,
        status: 'pending',
        providerStatusCode: 'UNKNOWN',
        providerStatusName: 'QueryFailed',
        amountMinor: 0,
        feeMinor: 0,
        netMinor: 0,
        currency: 'MWK',
        rawResponse: data,
      };
    }

    const tx = data.transaction || {};
    const src = data.source || {};
    const ben = data.beneficiary || {};

    const statusCode = tx.transactionStatusCode || 'P';
    const statusName = tx.transactionStatusName || 'Pending';

    let status: 'confirmed' | 'failed' | 'pending' | 'reversed' = 'pending';
    if (statusCode === 'S' || statusCode === 'SUCCESS') {
      status = 'confirmed';
    } else if (statusCode === 'E' || statusCode === 'FAILED') {
      status = 'failed';
    } else if (statusCode === 'R' || statusCode === 'REVERSED') {
      status = 'reversed';
    }

    const amountFloat = Number(src.amountSent || ben.amountReceived || 0);
    const feeFloat = Number(tx.transactionFee || 0);
    const netFloat = Number(ben.amountReceived || amountFloat - feeFloat);

    return {
      providerReference: tx.transactionReferenceNumber || providerReference,
      sourceReferenceNumber: src.sourceReferenceNumber,
      status,
      providerStatusCode: statusCode,
      providerStatusName: statusName,
      amountMinor: Math.round(amountFloat * 100),
      feeMinor: Math.round(feeFloat * 100),
      netMinor: Math.round(netFloat * 100),
      currency: src.currencyCode || ben.currencyCode || 'MWK',
      rawResponse: data,
    };
  }

  /**
   * Verifies the cryptographic HMAC-SHA512 signature on incoming raw webhook bytes.
   * Compares signatures in constant time.
   */
  verifyWebhook(
    rawPayload: string,
    headers: Record<string, string | string[] | undefined>,
  ): WebhookVerificationResult {
    // Check both standard header names
    const sigHeader =
      headers['x-onekhusa-webhook-signature'] ||
      headers['X-OneKhusa-Webhook-Signature'] ||
      headers['x-onekhusa-signature'] ||
      headers['X-OneKhusa-Signature'];

    const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
    if (!signature) {
      return { isValid: false, error: 'Missing OneKhusa signature header' };
    }

    const computed = crypto
      .createHmac('sha512', this.webhookSecret)
      .update(rawPayload)
      .digest('hex');

    const sigBuf = Buffer.from(signature, 'utf8');
    const compBuf = Buffer.from(computed, 'utf8');

    if (sigBuf.length !== compBuf.length || !crypto.timingSafeEqual(sigBuf, compBuf)) {
      return { isValid: false, error: 'Cryptographic signature mismatch' };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawPayload);
    } catch (err: any) {
      return { isValid: false, error: `Invalid JSON payload: ${err.message}` };
    }

    const eventHeader =
      headers['x-onekhusa-webhook-event'] ||
      headers['X-OneKhusa-Webhook-Event'] ||
      headers['x-webhook-event'];
    const eventType = (Array.isArray(eventHeader) ? eventHeader[0] : eventHeader) || 'pushpayment.success';

    const tx = parsed.transaction || {};
    const src = parsed.source || {};
    const ben = parsed.beneficiary || {};

    const txRef = tx.transactionReferenceNumber || parsed.transactionReferenceNumber;
    const srn = src.sourceReferenceNumber || parsed.sourceReferenceNumber;

    let status: 'confirmed' | 'failed' | 'pending' | 'reversed' = 'pending';
    if (eventType.includes('success') || tx.transactionStatusCode === 'S') {
      status = 'confirmed';
    } else if (eventType.includes('fail') || tx.transactionStatusCode === 'E') {
      status = 'failed';
    } else if (eventType.includes('reverse') || tx.transactionStatusCode === 'R') {
      status = 'reversed';
    }

    const amountFloat = Number(src.amountSent || parsed.amount || 0);
    const feeFloat = Number(tx.transactionFee || 0);
    const netFloat = Number(ben.amountReceived || amountFloat - feeFloat);

    return {
      isValid: true,
      eventType,
      transactionReference: txRef,
      sourceReferenceNumber: srn,
      status,
      amountMinor: Math.round(amountFloat * 100),
      feeMinor: Math.round(feeFloat * 100),
      netMinor: Math.round(netFloat * 100),
      currency: src.currencyCode || parsed.currency || 'MWK',
      rawEvent: parsed,
    };
  }
}

