/**
 * Phase 3 Payment Service.
 *
 * Implements:
 *   - Recording payments across 6 methods (cash, bank transfer, cheque, card, airtel_money, mpamba)
 *   - Idempotent recording (ON CONFLICT DO NOTHING with conflict mismatch detection)
 *   - Pending cheque flow: hold intended allocations, clear & apply atomically, bounce without balance change
 *   - Payment allocations to open invoices with DB trigger & application validation
 *   - Customer credit tracking & applying credit to invoices (spanning multiple receipts)
 *   - Payment reversals with negative allocation rows & credit deficit prevention
 *   - Refund recording against available customer credit
 *   - Overpayment release to credit when credit note is applied
 *   - Reconciliation tracking
 *   - Gap-free sequential numbering (e.g. MAIN-PAY-0001)
 *   - Atomic audit logging on every action
 */

import { db, type DbTransaction } from '@/server/db';
import {
  payments,
  paymentAllocations,
  salesDocuments,
  customers,
  cardTerminals,
} from '@/server/db/schema';
import { eq, and, sql, desc, asc, inArray, gte, lte } from 'drizzle-orm';
import {
  validateMethodDetails,
  computePaymentStatus,
  computeCustomerCreditLive,
  type PaymentMethod,
  type PaymentKind,
} from '@/lib/payment-math';
import { nextSequenceNumber } from '@/server/services/sequences';
import { todayInCompanyTz } from '@/lib/timezone';
import { writeAuditLog } from '@/server/services/audit';

export type Payment = typeof payments.$inferSelect;
export type PaymentAllocation = typeof paymentAllocations.$inferSelect;

export interface RecordPaymentInput {
  idempotencyKey: string;
  customerId: string;
  locationId: string;
  shiftId?: string | null;
  kind?: PaymentKind;
  method: PaymentMethod;
  amountMinor: number;
  paymentDate: string | Date;
  methodDetails?: unknown;
  providerReference?: string | null;
  notes?: string | null;
  allocations?: Array<{
    invoiceId: string;
    amountMinor: number;
  }>;
}

export interface RecordPaymentResult {
  payment: Payment;
  warning?: string;
  isDuplicate?: boolean;
}

export interface PaymentFilter {
  customerId?: string;
  locationId?: string;
  method?: PaymentMethod;
  status?: string;
  reconciliationStatus?: string;
  fromDate?: string | Date;
  toDate?: string | Date;
  limit?: number;
  offset?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseDateToIsoString(d: string | Date): string {
  if (typeof d === 'string') {
    return d.split('T')[0] ?? d;
  }
  return d.toISOString().split('T')[0] ?? '';
}

/**
 * Recomputes invoice paid_minor, balance_minor, and payment_status from its net allocations.
 */
export async function recomputeInvoiceBalances(tx: DbTransaction, invoiceId: string) {
  const [allocRes] = await tx
    .select({
      netAllocated: sql<string>`COALESCE(SUM(${paymentAllocations.amountMinor}), 0)`,
    })
    .from(paymentAllocations)
    .where(eq(paymentAllocations.invoiceId, invoiceId));

  const paidMinor = parseInt(allocRes?.netAllocated ?? '0', 10);

  const [invoice] = await tx
    .select()
    .from(salesDocuments)
    .where(eq(salesDocuments.id, invoiceId))
    .for('update');

  if (!invoice) return null;

  const total = Number(invoice.totalMinor);
  const credited = Number(invoice.creditedMinor);
  const netTotal = total - credited;
  const balanceMinor = Math.max(0, netTotal - paidMinor);
  const paymentStatus = computePaymentStatus(total, credited, paidMinor);

  await tx
    .update(salesDocuments)
    .set({
      paidMinor,
      balanceMinor,
      paymentStatus,
      updatedAt: new Date(),
    })
    .where(eq(salesDocuments.id, invoiceId));

  return { paidMinor, balanceMinor, paymentStatus };
}

/**
 * Live customer credit: confirmed receipts - net allocations - confirmed refunds.
 */
export async function getCustomerCredit(
  customerId: string,
  tx?: DbTransaction,
): Promise<{
  creditMinor: bigint;
  confirmedReceipts: bigint;
  netAllocations: bigint;
  confirmedRefunds: bigint;
}> {
  const executor = tx ?? db;

  const [receiptsRes] = await executor
    .select({
      total: sql<string>`COALESCE(SUM(${payments.amountMinor}), 0)`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.customerId, customerId),
        eq(payments.kind, 'receipt'),
        eq(payments.status, 'confirmed'),
      ),
    );

  const [refundsRes] = await executor
    .select({
      total: sql<string>`COALESCE(SUM(${payments.amountMinor}), 0)`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.customerId, customerId),
        eq(payments.kind, 'refund'),
        eq(payments.status, 'confirmed'),
      ),
    );

  const [allocsRes] = await executor
    .select({
      total: sql<string>`COALESCE(SUM(${paymentAllocations.amountMinor}), 0)`,
    })
    .from(paymentAllocations)
    .innerJoin(payments, eq(paymentAllocations.paymentId, payments.id))
    .where(
      and(
        eq(payments.customerId, customerId),
        eq(payments.kind, 'receipt'),
        eq(payments.status, 'confirmed'),
      ),
    );

  const confirmedReceipts = BigInt(receiptsRes?.total ?? '0');
  const confirmedRefunds = BigInt(refundsRes?.total ?? '0');
  const netAllocations = BigInt(allocsRes?.total ?? '0');

  const creditMinor = computeCustomerCreditLive(
    confirmedReceipts,
    netAllocations,
    confirmedRefunds,
  );

  return {
    creditMinor,
    confirmedReceipts,
    netAllocations,
    confirmedRefunds,
  };
}

// ── 1. Record Payment ────────────────────────────────────────────────────────

export async function recordPaymentWithTx(
  tx: DbTransaction,
  input: RecordPaymentInput,
  userId?: string,
): Promise<RecordPaymentResult> {
  const amountMinor = Number(input.amountMinor);
  if (!amountMinor || amountMinor <= 0) {
    throw new Error('Payment amount must be greater than zero');
  }

  const paymentDateStr = parseDateToIsoString(input.paymentDate);
  const todayStr = todayInCompanyTz();
  if (paymentDateStr > todayStr) {
    throw new Error('Payment date cannot be in the future');
  }

  // Validate method details
  const validatedDetails = validateMethodDetails(input.method, input.methodDetails);

  // Validate tender amounts
  if (input.method !== 'cash') {
    const md = input.methodDetails as Record<string, unknown> | undefined;
    if (md && typeof md === 'object' && 'tendered_minor' in md) {
      const tendered = Number(md.tendered_minor);
      if (tendered > amountMinor) {
        throw new Error('Non-cash payments cannot be over-tendered');
      }
    }
  }

  // Validate card terminal location if card payment
  if (input.method === 'card') {
    const cardData = validatedDetails as { terminal_id: string };
    const [term] = await tx
      .select()
      .from(cardTerminals)
      .where(eq(cardTerminals.id, cardData.terminal_id));

    if (!term || !term.isActive) {
      throw new Error('Selected card terminal is inactive or not found');
    }
    if (term.locationId !== input.locationId) {
      throw new Error('Card terminal does not belong to the selected location');
    }
  }

  // Check duplicate bank transfer reference warning
  let warning: string | undefined;
  if (input.method === 'bank_transfer') {
    const bankRef = (validatedDetails as { bank_reference: string }).bank_reference;
    const [existingBank] = await tx
      .select({ id: payments.id, paymentNumber: payments.paymentNumber })
      .from(payments)
      .where(
        and(
          eq(payments.method, 'bank_transfer'),
          sql`(${payments.methodDetails}->>'bank_reference') = ${bankRef}`,
          sql`${payments.status} != 'failed'`,
        ),
      )
      .limit(1);

    if (existingBank) {
      warning = `Warning: Bank reference '${bankRef}' was already used in payment ${existingBank.paymentNumber}.`;
    }
  }

  const kind = input.kind ?? 'receipt';

  // Determine initial status & reconciliation
  let initialStatus: 'pending' | 'confirmed' = 'confirmed';
  let initialReconciliation: 'not_required' | 'unreconciled' = 'not_required';

  if (input.method === 'cheque') {
    initialStatus = 'pending';
    initialReconciliation = 'not_required';
  } else if (input.method === 'cash') {
    initialStatus = 'confirmed';
    initialReconciliation = 'not_required';
  } else {
    // bank_transfer, card, airtel_money, mpamba
    initialStatus = 'confirmed';
    initialReconciliation = 'unreconciled';
  }

  // 1. Idempotency check with conflict detection
  const [existing] = await tx
    .select()
    .from(payments)
    .where(eq(payments.idempotencyKey, input.idempotencyKey));

  if (existing) {
    if (
      existing.customerId !== input.customerId ||
      Number(existing.amountMinor) !== amountMinor
    ) {
      throw new Error('Idempotency key conflict: customer or amount mismatch');
    }
    return { payment: existing, warning, isDuplicate: true };
  }

  // 2. Lock customer & check walk-in credit block
  const [customer] = await tx
    .select({ id: customers.id, isWalkIn: customers.isWalkIn })
    .from(customers)
    .where(eq(customers.id, input.customerId))
    .for('update');

  if (!customer) throw new Error('Customer not found');

  if (customer.isWalkIn && kind === 'receipt') {
    const allocatedSum = (input.allocations || []).reduce(
      (sum, a) => sum + Number(a.amountMinor),
      0,
    );
    if (allocatedSum < amountMinor) {
      throw new Error('Walk-in customer cannot hold credit');
    }
  }

  // 3. Number assignment under transaction lock
  const paymentNumber = await nextSequenceNumber(tx, 'payment', input.locationId);

  // 4. Cheque handling: store intended allocations
  const intendedAllocations =
    input.method === 'cheque' && input.allocations && input.allocations.length > 0
      ? input.allocations
      : null;

  // 5. Insert payment row with ON CONFLICT DO NOTHING guard
  const [inserted] = await tx
    .insert(payments)
    .values({
      paymentNumber,
      idempotencyKey: input.idempotencyKey,
      customerId: input.customerId,
      locationId: input.locationId,
      shiftId: input.shiftId ?? null,
      kind,
      method: input.method,
      currency: 'MWK',
      amountMinor,
      status: initialStatus,
      reconciliationStatus: initialReconciliation,
      methodDetails: validatedDetails,
      intendedAllocations,
      providerReference: input.providerReference ?? null,
      paymentDate: paymentDateStr,
      notes: input.notes ?? null,
      createdBy: userId ?? null,
    })
    .onConflictDoNothing()
    .returning();

  if (!inserted) {
    // Handled concurrent insert with same key
    const [duplicate] = await tx
      .select()
      .from(payments)
      .where(eq(payments.idempotencyKey, input.idempotencyKey));

    if (!duplicate) {
      throw new Error('Duplicate payment could not be re-selected');
    }

    if (
      duplicate.customerId !== input.customerId ||
      Number(duplicate.amountMinor) !== amountMinor
    ) {
      throw new Error('Idempotency key conflict: customer or amount mismatch');
    }
    return { payment: duplicate, warning, isDuplicate: true };
  }

  // 6. If confirmed receipt and allocations provided, apply them
  if (
    initialStatus === 'confirmed' &&
    kind === 'receipt' &&
    input.allocations &&
    input.allocations.length > 0
  ) {
    const totalToAllocate = input.allocations.reduce(
      (sum, a) => sum + Number(a.amountMinor),
      0,
    );
    if (totalToAllocate > amountMinor) {
      throw new Error(
        `Allocations total (${totalToAllocate}) exceeds payment amount (${amountMinor})`,
      );
    }

    // Sort invoice IDs ASC to lock invoices deterministically
    const invoiceIds = [...new Set(input.allocations.map((a) => a.invoiceId))].sort();

    const invoices = await tx
      .select()
      .from(salesDocuments)
      .where(inArray(salesDocuments.id, invoiceIds))
      .orderBy(asc(salesDocuments.id))
      .for('update');

    const invoiceMap = new Map(invoices.map((inv) => [inv.id, inv]));

    for (const alloc of input.allocations) {
      const inv = invoiceMap.get(alloc.invoiceId);
      if (!inv) {
        throw new Error(`Invoice ${alloc.invoiceId} not found`);
      }
      if (inv.customerId !== input.customerId) {
        throw new Error(`Invoice ${inv.documentNumber} does not belong to this customer`);
      }
      if (inv.documentType !== 'invoice' || inv.status !== 'issued') {
        throw new Error(
          `Invoice ${inv.documentNumber} is not an issued invoice (status: ${inv.status})`,
        );
      }

      const allocMinor = Number(alloc.amountMinor);
      if (allocMinor <= 0) {
        throw new Error('Allocation amount must be greater than zero');
      }

      const netInvoiceBalance =
        Number(inv.totalMinor) - Number(inv.creditedMinor) - Number(inv.paidMinor);
      if (allocMinor > netInvoiceBalance) {
        throw new Error(
          `Allocation ${allocMinor} exceeds remaining balance ${netInvoiceBalance} on invoice ${inv.documentNumber}`,
        );
      }

      await tx.insert(paymentAllocations).values({
        paymentId: inserted.id,
        invoiceId: inv.id,
        amountMinor: allocMinor,
        allocatedBy: userId ?? null,
      });

      await recomputeInvoiceBalances(tx, inv.id);
    }
  }

  // 7. Audit log
  await writeAuditLog(tx, {
    userId,
    action: 'payment.record',
    entityType: 'payment',
    entityId: inserted.id,
    after: {
      paymentNumber: inserted.paymentNumber,
      method: inserted.method,
      amountMinor: inserted.amountMinor,
      status: inserted.status,
    },
  });

  return { payment: inserted, warning };
}

export async function recordPayment(
  input: RecordPaymentInput,
  userId?: string,
): Promise<RecordPaymentResult> {
  return await db.transaction(async (tx) => {
    return await recordPaymentWithTx(tx, input, userId);
  });
}

// ── 2. Confirm Cheque ────────────────────────────────────────────────────────

export async function confirmCheque(paymentId: string, userId?: string) {
  return await db.transaction(async (tx) => {
    const [pmt] = await tx.select().from(payments).where(eq(payments.id, paymentId));
    if (!pmt) throw new Error(`Payment ${paymentId} not found`);
    if (pmt.method !== 'cheque') throw new Error('Payment is not a cheque');
    if (pmt.status !== 'pending') {
      throw new Error(`Cannot confirm cheque with status '${pmt.status}'`);
    }

    // Lock customer
    await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, pmt.customerId))
      .for('update');

    // Parse intended allocations
    const intended = (pmt.intendedAllocations as Array<{
      invoiceId: string;
      amountMinor: number;
    }>) || [];

    const invoiceIds = [...new Set(intended.map((a) => a.invoiceId))].sort();

    let invoices: (typeof salesDocuments.$inferSelect)[] = [];
    if (invoiceIds.length > 0) {
      invoices = await tx
        .select()
        .from(salesDocuments)
        .where(inArray(salesDocuments.id, invoiceIds))
        .orderBy(asc(salesDocuments.id))
        .for('update');
    }

    // Lock payment row
    const [lockedPmt] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for('update');

    if (!lockedPmt) {
      throw new Error(`Payment ${paymentId} not found`);
    }

    // Transition to confirmed
    const [updatedPmt] = await tx
      .update(payments)
      .set({
        status: 'confirmed',
        reconciliationStatus: 'unreconciled',
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId))
      .returning();

    const invoiceMap = new Map(invoices.map((i) => [i.id, i]));
    const failedAllocations: Array<{ invoiceId: string; amountMinor: number; reason: string }> =
      [];

    let remainingChequeAmount = Number(lockedPmt.amountMinor);

    for (const alloc of intended) {
      const inv = invoiceMap.get(alloc.invoiceId);
      const allocAmount = Number(alloc.amountMinor);

      if (!inv || inv.status !== 'issued' || inv.documentType !== 'invoice') {
        failedAllocations.push({
          invoiceId: alloc.invoiceId,
          amountMinor: allocAmount,
          reason: 'Invoice is no longer open or issued',
        });
        continue;
      }

      // Check remaining invoice balance
      const [allocSum] = await tx
        .select({
          net: sql<string>`COALESCE(SUM(${paymentAllocations.amountMinor}), 0)`,
        })
        .from(paymentAllocations)
        .where(eq(paymentAllocations.invoiceId, inv.id));

      const priorAlloc = parseInt(allocSum?.net ?? '0', 10);
      const remainingBalance = Number(inv.totalMinor) - Number(inv.creditedMinor) - priorAlloc;

      if (remainingBalance < allocAmount || remainingChequeAmount < allocAmount) {
        failedAllocations.push({
          invoiceId: alloc.invoiceId,
          amountMinor: allocAmount,
          reason: `Insufficient balance on invoice or cheque (remaining invoice balance: ${remainingBalance})`,
        });
        continue;
      }

      // Apply allocation
      await tx.insert(paymentAllocations).values({
        paymentId: lockedPmt.id,
        invoiceId: inv.id,
        amountMinor: allocAmount,
        allocatedBy: userId ?? null,
      });

      remainingChequeAmount -= allocAmount;
      await recomputeInvoiceBalances(tx, inv.id);
    }

    await writeAuditLog(tx, {
      userId,
      action: 'payment.cheque_clear',
      entityType: 'payment',
      entityId: lockedPmt.id,
      before: { status: 'pending' },
      after: {
        status: 'confirmed',
        appliedAllocationsCount: intended.length - failedAllocations.length,
        failedAllocationsCount: failedAllocations.length,
      },
    });

    return {
      success: true,
      payment: updatedPmt,
      failedAllocations,
      message:
        failedAllocations.length > 0
          ? 'Cheque cleared. Some intended allocations could not be applied and remain as customer credit.'
          : 'Cheque cleared and allocations applied successfully.',
    };
  });
}

// ── 3. Bounce Cheque ─────────────────────────────────────────────────────────

export async function bounceCheque(paymentId: string, reason?: string, userId?: string) {
  return await db.transaction(async (tx) => {
    const [pmt] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for('update');

    if (!pmt) throw new Error(`Payment ${paymentId} not found`);
    if (pmt.method !== 'cheque') throw new Error('Payment is not a cheque');
    if (pmt.status !== 'pending') {
      throw new Error(`Cannot bounce cheque with status '${pmt.status}'`);
    }

    const [bounced] = await tx
      .update(payments)
      .set({
        status: 'failed',
        notes: reason
          ? `${pmt.notes ? pmt.notes + ' | ' : ''}Bounced: ${reason}`
          : pmt.notes,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId))
      .returning();

    await writeAuditLog(tx, {
      userId,
      action: 'payment.cheque_bounce',
      entityType: 'payment',
      entityId: pmt.id,
      before: { status: 'pending' },
      after: { status: 'failed', reason },
    });

    return bounced;
  });
}

// ── 4. Allocate Payment ──────────────────────────────────────────────────────

export async function allocatePayment(
  paymentId: string,
  allocations: Array<{ invoiceId: string; amountMinor: number }>,
  userId?: string,
) {
  if (!allocations || allocations.length === 0) {
    throw new Error('At least one allocation must be provided');
  }

  return await db.transaction(async (tx) => {
    const [pmt] = await tx.select().from(payments).where(eq(payments.id, paymentId));
    if (!pmt) throw new Error(`Payment ${paymentId} not found`);
    if (pmt.status !== 'confirmed') {
      throw new Error(`Cannot allocate payment with status '${pmt.status}'`);
    }
    if (pmt.kind !== 'receipt') {
      throw new Error(`Cannot allocate payment of kind '${pmt.kind}'`);
    }

    // 1. Lock customer
    await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, pmt.customerId))
      .for('update');

    // 2. Lock invoices ASC
    const invoiceIds = [...new Set(allocations.map((a) => a.invoiceId))].sort();
    const invoices = await tx
      .select()
      .from(salesDocuments)
      .where(inArray(salesDocuments.id, invoiceIds))
      .orderBy(asc(salesDocuments.id))
      .for('update');

    // 3. Lock payment row
    const [lockedPmt] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for('update');

    if (!lockedPmt) {
      throw new Error(`Payment ${paymentId} not found`);
    }

    // Check payment unallocated amount
    const [priorAllocs] = await tx
      .select({
        total: sql<string>`COALESCE(SUM(${paymentAllocations.amountMinor}), 0)`,
      })
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, lockedPmt.id));

    const netPriorAllocated = parseInt(priorAllocs?.total ?? '0', 10);
    const unallocatedPayment = Number(lockedPmt.amountMinor) - netPriorAllocated;

    const newAllocTotal = allocations.reduce((sum, a) => sum + Number(a.amountMinor), 0);
    if (newAllocTotal > unallocatedPayment) {
      throw new Error(
        `Allocation total (${newAllocTotal}) exceeds unallocated payment amount (${unallocatedPayment})`,
      );
    }

    const invoiceMap = new Map(invoices.map((i) => [i.id, i]));

    for (const alloc of allocations) {
      const inv = invoiceMap.get(alloc.invoiceId);
      if (!inv) throw new Error(`Invoice ${alloc.invoiceId} not found`);
      if (inv.customerId !== lockedPmt.customerId) {
        throw new Error(`Invoice ${inv.documentNumber} does not belong to this customer`);
      }
      if (inv.documentType !== 'invoice' || inv.status !== 'issued') {
        throw new Error(`Invoice ${inv.documentNumber} is not an issued invoice`);
      }

      const allocMinor = Number(alloc.amountMinor);
      if (allocMinor <= 0) {
        throw new Error('Allocation amount must be greater than zero');
      }

      const netBalance =
        Number(inv.totalMinor) - Number(inv.creditedMinor) - Number(inv.paidMinor);
      if (allocMinor > netBalance) {
        throw new Error(
          `Allocation ${allocMinor} exceeds remaining balance ${netBalance} on invoice ${inv.documentNumber}`,
        );
      }

      await tx.insert(paymentAllocations).values({
        paymentId: lockedPmt.id,
        invoiceId: inv.id,
        amountMinor: allocMinor,
        allocatedBy: userId ?? null,
      });

      await recomputeInvoiceBalances(tx, inv.id);
    }

    await writeAuditLog(tx, {
      userId,
      action: 'payment.allocate',
      entityType: 'payment',
      entityId: lockedPmt.id,
      after: { newAllocationsCount: allocations.length, allocatedMinor: newAllocTotal },
    });

    return { success: true };
  });
}

// ── 5. Apply Customer Credit To Invoice ──────────────────────────────────────

export async function applyCreditToInvoice(
  customerId: string,
  invoiceId: string,
  amountMinor: number,
  userId?: string,
) {
  if (amountMinor <= 0) {
    throw new Error('Credit amount to apply must be greater than zero');
  }

  return await db.transaction(async (tx) => {
    // 1. Lock customer
    await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, customerId))
      .for('update');

    // 2. Lock invoice
    const [inv] = await tx
      .select()
      .from(salesDocuments)
      .where(eq(salesDocuments.id, invoiceId))
      .for('update');

    if (!inv) throw new Error(`Invoice ${invoiceId} not found`);
    if (inv.customerId !== customerId) {
      throw new Error(`Invoice does not belong to customer ${customerId}`);
    }
    if (inv.documentType !== 'invoice' || inv.status !== 'issued') {
      throw new Error(`Invoice is not open/issued (status: ${inv.status})`);
    }

    const netInvoiceBalance =
      Number(inv.totalMinor) - Number(inv.creditedMinor) - Number(inv.paidMinor);
    if (amountMinor > netInvoiceBalance) {
      throw new Error(
        `Amount ${amountMinor} exceeds remaining balance ${netInvoiceBalance} on invoice ${inv.documentNumber}`,
      );
    }

    // 3. Find confirmed receipts for this customer ordered oldest first (payment_date ASC, created_at ASC)
    const confirmedReceipts = await tx
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.customerId, customerId),
          eq(payments.kind, 'receipt'),
          eq(payments.status, 'confirmed'),
        ),
      )
      .orderBy(asc(payments.paymentDate), asc(payments.createdAt))
      .for('update');

    // Find live credit across these receipts
    let remainingToAllocate = amountMinor;

    for (const receipt of confirmedReceipts) {
      if (remainingToAllocate <= 0) break;

      const [allocSum] = await tx
        .select({
          net: sql<string>`COALESCE(SUM(${paymentAllocations.amountMinor}), 0)`,
        })
        .from(paymentAllocations)
        .where(eq(paymentAllocations.paymentId, receipt.id));

      const netAlloc = parseInt(allocSum?.net ?? '0', 10);
      const availableOnReceipt = Number(receipt.amountMinor) - netAlloc;

      if (availableOnReceipt <= 0) continue;

      const allocPart = Math.min(remainingToAllocate, availableOnReceipt);

      await tx.insert(paymentAllocations).values({
        paymentId: receipt.id,
        invoiceId: inv.id,
        amountMinor: allocPart,
        allocatedBy: userId ?? null,
      });

      remainingToAllocate -= allocPart;
    }

    if (remainingToAllocate > 0) {
      throw new Error(
        `Insufficient customer credit. Requested ${amountMinor}, but only ${amountMinor - remainingToAllocate} available across unallocated receipts.`,
      );
    }

    await recomputeInvoiceBalances(tx, inv.id);

    await writeAuditLog(tx, {
      userId,
      action: 'customer.apply_credit',
      entityType: 'sales_document',
      entityId: inv.id,
      after: { amountMinor, invoiceNumber: inv.documentNumber },
    });

    return { success: true, allocatedMinor: amountMinor };
  });
}

// ── 6. Reverse Payment ───────────────────────────────────────────────────────

export async function reversePayment(paymentId: string, reason: string, userId?: string) {
  if (!reason || reason.trim() === '') {
    throw new Error('A reversal reason must be provided');
  }

  return await db.transaction(async (tx) => {
    // 1. Read payment
    const [pmt] = await tx.select().from(payments).where(eq(payments.id, paymentId));
    if (!pmt) throw new Error(`Payment ${paymentId} not found`);
    if (pmt.shiftId) {
      throw new Error(
        'Payments recorded on a POS shift cannot be reversed directly; use the counter return flow',
      );
    }
    if (pmt.status !== 'confirmed') {
      throw new Error(`Cannot reverse payment with status '${pmt.status}'`);
    }

    // 2. Lock customer
    await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, pmt.customerId))
      .for('update');

    // 3. Find positive allocations for this payment
    const positiveAllocs = await tx
      .select()
      .from(paymentAllocations)
      .where(
        and(
          eq(paymentAllocations.paymentId, paymentId),
          sql`${paymentAllocations.amountMinor} > 0`,
        ),
      );

    // 4. Lock affected invoices in ASC order
    const affectedInvoiceIds = [...new Set(positiveAllocs.map((a) => a.invoiceId))].sort();
    if (affectedInvoiceIds.length > 0) {
      await tx
        .select()
        .from(salesDocuments)
        .where(inArray(salesDocuments.id, affectedInvoiceIds))
        .orderBy(asc(salesDocuments.id))
        .for('update');
    }

    // 5. Lock payment row
    const [lockedPmt] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for('update');

    if (!lockedPmt) {
      throw new Error(`Payment ${paymentId} not found`);
    }

    // 6. Verify customer credit would not become negative
    const creditStatus = await getCustomerCredit(lockedPmt.customerId, tx);
    const postReversalCredit = creditStatus.creditMinor - BigInt(lockedPmt.amountMinor);
    if (postReversalCredit < BigInt(0)) {
      throw new Error('Reversal would make customer credit negative');
    }

    // 7. Write negative allocation rows for every positive allocation
    for (const alloc of positiveAllocs) {
      await tx.insert(paymentAllocations).values({
        paymentId: lockedPmt.id,
        invoiceId: alloc.invoiceId,
        amountMinor: -Number(alloc.amountMinor),
        allocatedBy: userId ?? null,
        notes: `Reversal: ${reason}`,
      });

      await recomputeInvoiceBalances(tx, alloc.invoiceId);
    }

    // 8. Update payment status to reversed
    const [reversed] = await tx
      .update(payments)
      .set({
        status: 'reversed',
        reversedAt: new Date(),
        reversedBy: userId ?? null,
        reversalReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId))
      .returning();

    await writeAuditLog(tx, {
      userId,
      action: 'payment.reverse',
      entityType: 'payment',
      entityId: lockedPmt.id,
      before: { status: 'confirmed' },
      after: { status: 'reversed', reason },
    });

    return reversed;
  });
}

// ── 7. Refund Payment ────────────────────────────────────────────────────────

export async function refundPayment(
  input: {
    customerId: string;
    locationId: string;
    amountMinor: number;
    method: PaymentMethod;
    methodDetails?: unknown;
    notes?: string;
    idempotencyKey?: string;
  },
  userId?: string,
) {
  const amountMinor = Number(input.amountMinor);
  if (amountMinor <= 0) {
    throw new Error('Refund amount must be greater than zero');
  }

  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
  const validatedDetails = validateMethodDetails(input.method, input.methodDetails);

  return await db.transaction(async (tx) => {
    // 1. Lock customer
    await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, input.customerId))
      .for('update');

    // 2. Validate live customer credit
    const { creditMinor } = await getCustomerCredit(input.customerId, tx);
    if (BigInt(amountMinor) > creditMinor) {
      throw new Error(
        `Insufficient customer credit for refund (available credit: ${creditMinor}, requested: ${amountMinor})`,
      );
    }

    // 3. Number sequence
    const paymentNumber = await nextSequenceNumber(tx, 'payment', input.locationId);
    const todayStr = todayInCompanyTz();

    const [refund] = await tx
      .insert(payments)
      .values({
        paymentNumber,
        idempotencyKey,
        customerId: input.customerId,
        locationId: input.locationId,
        kind: 'refund',
        method: input.method,
        currency: 'MWK',
        amountMinor,
        status: 'confirmed',
        reconciliationStatus: input.method === 'cash' ? 'not_required' : 'unreconciled',
        methodDetails: validatedDetails,
        paymentDate: todayStr,
        notes: input.notes ?? null,
        createdBy: userId ?? null,
      })
      .returning();

    if (!refund) {
      throw new Error('Failed to record refund');
    }

    await writeAuditLog(tx, {
      userId,
      action: 'payment.refund',
      entityType: 'payment',
      entityId: refund.id,
      after: {
        paymentNumber: refund.paymentNumber,
        amountMinor: refund.amountMinor,
        method: refund.method,
      },
    });

    return refund;
  });
}

// ── 8. Reconcile Payment ─────────────────────────────────────────────────────

export async function markReconciled(paymentId: string, note?: string, userId?: string) {
  return await db.transaction(async (tx) => {
    const [pmt] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for('update');

    if (!pmt) throw new Error(`Payment ${paymentId} not found`);
    if (!['confirmed', 'reversed'].includes(pmt.status)) {
      throw new Error(`Cannot reconcile payment with status '${pmt.status}'`);
    }

    const [reconciled] = await tx
      .update(payments)
      .set({
        reconciliationStatus: 'reconciled',
        reconciledAt: new Date(),
        reconciledBy: userId ?? null,
        reconciliationNote: note ?? null,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId))
      .returning();

    await writeAuditLog(tx, {
      userId,
      action: 'payment.reconcile',
      entityType: 'payment',
      entityId: pmt.id,
      before: { reconciliationStatus: pmt.reconciliationStatus },
      after: { reconciliationStatus: 'reconciled', note },
    });

    return reconciled;
  });
}

// ── 9. Overpayment Release (when credit note makes invoice overpaid) ──────────

export async function releaseOverpaymentToCredit(
  invoiceId: string,
  userId?: string,
  existingTx?: DbTransaction,
) {
  const runner = async (tx: DbTransaction) => {
    const [inv] = await tx
      .select()
      .from(salesDocuments)
      .where(eq(salesDocuments.id, invoiceId))
      .for('update');

    if (!inv || inv.documentType !== 'invoice') return;

    const netTotal = Number(inv.totalMinor) - Number(inv.creditedMinor);
    const paid = Number(inv.paidMinor);

    if (paid > netTotal) {
      const excess = paid - Math.max(0, netTotal);

      // Find the latest positive allocation for this invoice
      const [latestAlloc] = await tx
        .select()
        .from(paymentAllocations)
        .where(
          and(
            eq(paymentAllocations.invoiceId, invoiceId),
            sql`${paymentAllocations.amountMinor} > 0`,
          ),
        )
        .orderBy(desc(paymentAllocations.allocatedAt))
        .limit(1);

      if (latestAlloc) {
        await tx.insert(paymentAllocations).values({
          paymentId: latestAlloc.paymentId,
          invoiceId,
          amountMinor: -excess,
          allocatedBy: userId ?? null,
          notes: 'Excess paid released to customer credit due to credit note',
        });

        await recomputeInvoiceBalances(tx, invoiceId);

        await writeAuditLog(tx, {
          userId,
          action: 'invoice.release_overpayment',
          entityType: 'sales_document',
          entityId: invoiceId,
          after: { excessReleasedMinor: excess },
        });
      }
    }
  };

  if (existingTx) {
    await runner(existingTx);
  } else {
    await db.transaction(runner);
  }
}

// ── 10. Query Operations ─────────────────────────────────────────────────────

export async function getPaymentById(id: string) {
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.id, id))
    .limit(1);

  if (!payment) return null;

  const allocations = await db
    .select({
      id: paymentAllocations.id,
      invoiceId: paymentAllocations.invoiceId,
      amountMinor: paymentAllocations.amountMinor,
      allocatedAt: paymentAllocations.allocatedAt,
      notes: paymentAllocations.notes,
      documentNumber: salesDocuments.documentNumber,
      totalMinor: salesDocuments.totalMinor,
      balanceMinor: salesDocuments.balanceMinor,
    })
    .from(paymentAllocations)
    .innerJoin(salesDocuments, eq(paymentAllocations.invoiceId, salesDocuments.id))
    .where(eq(paymentAllocations.paymentId, id))
    .orderBy(asc(paymentAllocations.allocatedAt));

  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, payment.customerId));

  return {
    ...payment,
    customer,
    allocations,
  };
}

export async function listPayments(filters: PaymentFilter = {}) {
  const conditions = [];

  if (filters.customerId) {
    conditions.push(eq(payments.customerId, filters.customerId));
  }
  if (filters.locationId) {
    conditions.push(eq(payments.locationId, filters.locationId));
  }
  if (filters.method) {
    conditions.push(eq(payments.method, filters.method));
  }
  if (filters.status) {
    conditions.push(eq(payments.status, filters.status));
  }
  if (filters.reconciliationStatus) {
    conditions.push(eq(payments.reconciliationStatus, filters.reconciliationStatus));
  }
  if (filters.fromDate) {
    conditions.push(gte(payments.paymentDate, parseDateToIsoString(filters.fromDate)));
  }
  if (filters.toDate) {
    conditions.push(lte(payments.paymentDate, parseDateToIsoString(filters.toDate)));
  }

  const query = db
    .select({
      payment: payments,
      customerName: customers.name,
      customerAccount: customers.accountNumber,
    })
    .from(payments)
    .innerJoin(customers, eq(payments.customerId, customers.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(payments.paymentDate), desc(payments.createdAt));

  if (filters.limit) query.limit(filters.limit);
  if (filters.offset) query.offset(filters.offset);

  return await query;
}

export async function getUnreconciledPayments(locationId?: string) {
  const conditions = [
    eq(payments.reconciliationStatus, 'unreconciled'),
    inArray(payments.status, ['confirmed', 'reversed']),
  ];

  if (locationId) {
    conditions.push(eq(payments.locationId, locationId));
  }

  return await db
    .select({
      payment: payments,
      customerName: customers.name,
      customerAccount: customers.accountNumber,
    })
    .from(payments)
    .innerJoin(customers, eq(payments.customerId, customers.id))
    .where(and(...conditions))
    .orderBy(asc(payments.paymentDate), asc(payments.createdAt));
}

export async function getCustomerOpenInvoices(customerId: string) {
  return await db
    .select({
      id: salesDocuments.id,
      documentNumber: salesDocuments.documentNumber,
      issueDate: salesDocuments.issueDate,
      dueDate: salesDocuments.dueDate,
      totalMinor: salesDocuments.totalMinor,
      creditedMinor: salesDocuments.creditedMinor,
      paidMinor: salesDocuments.paidMinor,
      balanceMinor: salesDocuments.balanceMinor,
    })
    .from(salesDocuments)
    .where(
      and(
        eq(salesDocuments.customerId, customerId),
        eq(salesDocuments.documentType, 'invoice'),
        eq(salesDocuments.status, 'issued'),
        sql`${salesDocuments.balanceMinor} > 0`,
      ),
    )
    .orderBy(asc(salesDocuments.dueDate), asc(salesDocuments.id));
}
