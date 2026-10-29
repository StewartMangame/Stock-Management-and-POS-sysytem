import { z } from 'zod';

export type PaymentMethod =
  | 'cash'
  | 'bank_transfer'
  | 'cheque'
  | 'card'
  | 'airtel_money'
  | 'mpamba';

export type PaymentKind = 'receipt' | 'refund';

export type PaymentStatus = 'pending' | 'confirmed' | 'failed' | 'reversed';

export type ReconciliationStatus = 'not_required' | 'unreconciled' | 'reconciled';

export type DocumentPaymentStatus = 'unpaid' | 'partly_paid' | 'paid' | 'credited';

export type AgedBucketName = 'current' | 'days1_30' | 'days31_60' | 'days61_90' | 'days90plus';

export interface AgedInvoiceBuckets {
  current: bigint;
  days1_30: bigint;
  days31_60: bigint;
  days61_90: bigint;
  days90plus: bigint;
}

// ── Method Details Zod Schemas ───────────────────────────────────────────────

export const CashDetailsSchema = z
  .object({
    tendered_minor: z.number().int().nonnegative().optional(),
    change_minor: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const BankTransferDetailsSchema = z.object({
  bank_reference: z.string().min(1, 'Bank reference is required'),
  bank_name: z.string().optional(),
});

export const ChequeDetailsSchema = z.object({
  cheque_number: z.string().min(1, 'Cheque number is required'),
  bank: z.string().min(1, 'Bank name is required'),
  cheque_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Cheque date must be in YYYY-MM-DD format'),
});

export const CardDetailsSchema = z.object({
  terminal_id: z.string().uuid('Invalid terminal ID format (UUID expected)'),
  approval_code: z.string().min(1, 'Approval code is required'),
  slip_number: z.string().min(1, 'Slip number is required'),
  slip_photo_attachment_id: z.string().optional(),
});

export const MobileMoneyDetailsSchema = z.object({
  transaction_id: z.string().min(1, 'Transaction ID is required'),
  sender_phone: z.string().min(1, 'Sender phone number is required'),
});

export type CashDetails = z.infer<typeof CashDetailsSchema>;
export type BankTransferDetails = z.infer<typeof BankTransferDetailsSchema>;
export type ChequeDetails = z.infer<typeof ChequeDetailsSchema>;
export type CardDetails = z.infer<typeof CardDetailsSchema>;
export type MobileMoneyDetails = z.infer<typeof MobileMoneyDetailsSchema>;

export type ValidatedMethodDetails =
  | { method: 'cash'; details: CashDetails }
  | { method: 'bank_transfer'; details: BankTransferDetails }
  | { method: 'cheque'; details: ChequeDetails }
  | { method: 'card'; details: CardDetails }
  | { method: 'airtel_money'; details: MobileMoneyDetails }
  | { method: 'mpamba'; details: MobileMoneyDetails };

/**
 * Validates the method_details JSONB payload according to the payment method.
 * Throws a ZodError if validation fails.
 */
export function validateMethodDetails(
  method: PaymentMethod,
  details: unknown,
): Record<string, unknown> {
  const safeDetails = details ?? {};
  switch (method) {
    case 'cash':
      return CashDetailsSchema.parse(safeDetails);
    case 'bank_transfer':
      return BankTransferDetailsSchema.parse(safeDetails);
    case 'cheque':
      return ChequeDetailsSchema.parse(safeDetails);
    case 'card':
      return CardDetailsSchema.parse(safeDetails);
    case 'airtel_money':
    case 'mpamba':
      return MobileMoneyDetailsSchema.parse(safeDetails);
    default:
      throw new Error(`Unsupported payment method: ${String(method)}`);
  }
}

/**
 * Recomputes invoice payment status based on total, credited, and paid amounts.
 *
 * Status rules:
 * - 'credited': net total (total - credited) <= 0 and paid == 0 (fully offset by credit note(s)).
 * - 'paid': paid >= net total (and net total > 0, or paid > 0).
 * - 'partly_paid': paid > 0 and paid < net total.
 * - 'unpaid': paid <= 0 and net total > 0.
 */
export function computePaymentStatus(
  totalMinor: bigint | number,
  creditedMinor: bigint | number,
  paidMinor: bigint | number,
): DocumentPaymentStatus {
  const total = BigInt(totalMinor);
  const credited = BigInt(creditedMinor);
  const paid = BigInt(paidMinor);

  const netTotal = total - credited;

  if (netTotal <= BigInt(0)) {
    if (paid > BigInt(0)) {
      return 'paid';
    }
    return 'credited';
  }

  if (paid <= BigInt(0)) {
    return 'unpaid';
  }

  if (paid >= netTotal) {
    return 'paid';
  }

  return 'partly_paid';
}

/**
 * Customer credit as of a specific date (historical point-in-time calculation).
 *
 * Customer credit = confirmed receipts (date <= asOf)
 *                 - net allocations (allocated_at <= asOf, including negative reversal rows)
 *                 - confirmed refunds (date <= asOf)
 *
 * Failed and reversed payments are excluded from confirmed receipts and refunds.
 */
export function computeCustomerCreditAsOf(
  confirmedReceiptsByDate: bigint | number,
  netAllocationsByDate: bigint | number,
  confirmedRefundsByDate: bigint | number,
): bigint {
  const receipts = BigInt(confirmedReceiptsByDate);
  const allocations = BigInt(netAllocationsByDate);
  const refunds = BigInt(confirmedRefundsByDate);

  const credit = receipts - allocations - refunds;
  return credit > BigInt(0) ? credit : BigInt(0);
}

/**
 * Customer credit live (for current operations and validations).
 */
export function computeCustomerCreditLive(
  confirmedReceiptTotal: bigint | number,
  netAllocationTotal: bigint | number,
  confirmedRefundTotal: bigint | number,
): bigint {
  const receipts = BigInt(confirmedReceiptTotal);
  const allocations = BigInt(netAllocationTotal);
  const refunds = BigInt(confirmedRefundTotal);

  const credit = receipts - allocations - refunds;
  return credit > BigInt(0) ? credit : BigInt(0);
}

/**
 * Bucket an invoice's overdue balance into an aged bucket based on due date and asOf date.
 *
 * Bucket definitions relative to due date:
 * - current: due date is today or in future (diff <= 0 days)
 * - 1–30 days: overdue by 1 to 30 days
 * - 31–60 days: overdue by 31 to 60 days
 * - 61–90 days: overdue by 61 to 90 days
 * - 90+ days: overdue by > 90 days
 */
export function ageInvoiceBucket(dueDate: Date | string, asOf: Date | string): AgedBucketName {
  const dDate = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  const aDate = typeof asOf === 'string' ? new Date(asOf) : asOf;

  // Normalize to UTC midnight dates for pure day difference
  const dueUtc = Date.UTC(dDate.getFullYear(), dDate.getMonth(), dDate.getDate());
  const asOfUtc = Date.UTC(aDate.getFullYear(), aDate.getMonth(), aDate.getDate());

  const diffMs = asOfUtc - dueUtc;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return 'current';
  if (diffDays <= 30) return 'days1_30';
  if (diffDays <= 60) return 'days31_60';
  if (diffDays <= 90) return 'days61_90';
  return 'days90plus';
}

/**
 * Distribute a net balance into AgedInvoiceBuckets based on due date.
 */
export function allocateToAgedBuckets(
  netBalanceMinor: bigint | number,
  dueDate: Date | string,
  asOf: Date | string,
): AgedInvoiceBuckets {
  const balance = BigInt(netBalanceMinor);
  const buckets: AgedInvoiceBuckets = {
    current: BigInt(0),
    days1_30: BigInt(0),
    days31_60: BigInt(0),
    days61_90: BigInt(0),
    days90plus: BigInt(0),
  };

  if (balance <= BigInt(0)) {
    return buckets;
  }

  const bucket = ageInvoiceBucket(dueDate, asOf);
  buckets[bucket] = balance;
  return buckets;
}
