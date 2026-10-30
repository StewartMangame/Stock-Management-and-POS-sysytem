/**
 * OneKhusa Payment Provider Types & Interfaces.
 */

export interface InitiatePushParams {
  paymentId: string;
  amountMinor: number;
  currency: string;
  payerPhone: string;
  description: string;
  idempotencyKey: string;
  capturedBy?: string;
  sourceReferenceNumber?: string;
}

export interface InitiatePushResult {
  success: boolean;
  providerReference?: string;
  providerStatus: string;
  checkoutUrl?: string;
  rawResponse?: any;
  errorMessage?: string;
}

export interface TransactionQueryResult {
  providerReference: string;
  sourceReferenceNumber?: string;
  status: 'confirmed' | 'failed' | 'pending' | 'reversed';
  providerStatusCode: string;
  providerStatusName: string;
  amountMinor: number;
  feeMinor: number;
  netMinor: number;
  currency: string;
  rawResponse?: any;
}

export interface WebhookVerificationResult {
  isValid: boolean;
  eventType?: string;
  transactionReference?: string;
  sourceReferenceNumber?: string;
  status?: 'confirmed' | 'failed' | 'pending' | 'reversed';
  amountMinor?: number;
  feeMinor?: number;
  netMinor?: number;
  currency?: string;
  rawEvent?: any;
  error?: string;
}

export interface PaymentProvider {
  name: string;
  initiatePush(params: InitiatePushParams): Promise<InitiatePushResult>;
  queryTransaction(providerReference: string): Promise<TransactionQueryResult>;
  verifyWebhook(
    rawPayload: string,
    headers: Record<string, string | string[] | undefined>,
  ): WebhookVerificationResult;
}

/**
 * Normalizes Malawian phone numbers to E.164 (+265...)
 * Validates prefixes for Airtel Money (8) and TNM Mpamba (9).
 */
export function normalizeMalawianPhone(phone: string): {
  valid: boolean;
  normalized: string;
  network: 'airtel' | 'tnm' | 'unknown';
} {
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');
  let standard = cleaned;

  if (standard.startsWith('+265')) {
    standard = standard.slice(4);
  } else if (standard.startsWith('265')) {
    standard = standard.slice(3);
  } else if (standard.startsWith('0')) {
    standard = standard.slice(1);
  }

  // Must be 9 digits in Malawi
  if (!/^\d{9}$/.test(standard)) {
    return { valid: false, normalized: phone, network: 'unknown' };
  }

  const prefix = standard.charAt(0);
  let network: 'airtel' | 'tnm' | 'unknown' = 'unknown';

  // In Malawi:
  // Airtel starts with 8 (088xxxxxxx)
  // TNM Mpamba starts with 9 (099xxxxxxx)
  if (prefix === '8') {
    network = 'airtel';
  } else if (prefix === '9') {
    network = 'tnm';
  }

  return {
    valid: network !== 'unknown',
    normalized: `+265${standard}`,
    network,
  };
}

export function maskPhone(phone: string): string {
  if (!phone || phone.length <= 6) return '***';
  return `${phone.slice(0, 6)}***${phone.slice(-3)}`;
}

