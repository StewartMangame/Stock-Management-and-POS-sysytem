/**
 * Phase 3 database schema — Card Terminals, Payments, and Payment Allocations.
 *
 * Money is stored as bigint (tambala = 1/100 MWK).
 * Payment numbering is gap-free per location via number_sequences (doc_type = 'payment').
 * Allocations are append-only; reversals are represented by negative rows.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  bigint,
  timestamp,
  date,
  char,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { locations, users } from './setup';
import { customers, salesDocuments } from './sales';

// ── Card Terminals ───────────────────────────────────────────────────────────

export const cardTerminals = pgTable(
  'card_terminals',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    /** Unique device/merchant ID from acquirer bank */
    terminalId: text('terminal_id').notNull().unique(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [index('card_terminals_location_idx').on(t.locationId)],
);

export const cardTerminalsRelations = relations(cardTerminals, ({ one }) => ({
  location: one(locations, { fields: [cardTerminals.locationId], references: [locations.id] }),
  createdByUser: one(users, { fields: [cardTerminals.createdBy], references: [users.id] }),
}));

// ── Payments ─────────────────────────────────────────────────────────────────

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** e.g. MAIN-PAY-0001 (gap-free per location) */
    paymentNumber: text('payment_number').notNull().unique(),
    /** Client UUID to prevent double-submissions */
    idempotencyKey: text('idempotency_key').notNull().unique(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    /** Nullable in Phase 3; Phase 4 will add foreign key to pos_shifts */
    shiftId: uuid('shift_id'),
    /** 'receipt' | 'refund' */
    kind: text('kind').notNull(),
    /** 'cash' | 'bank_transfer' | 'cheque' | 'card' | 'airtel_money' | 'mpamba' */
    method: text('method').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('MWK'),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    /** 'pending' | 'confirmed' | 'failed' | 'reversed' */
    status: text('status').notNull().default('pending'),
    /** 'not_required' | 'unreconciled' | 'reconciled' */
    reconciliationStatus: text('reconciliation_status').notNull().default('not_required'),
    /** Typed method details JSONB */
    methodDetails: jsonb('method_details').notNull().default(sql`'{}'::jsonb`),
    /** Cheque intended allocations stored while pending: [{ invoiceId, amountMinor }] */
    intendedAllocations: jsonb('intended_allocations'),
    providerReference: text('provider_reference'),
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
    reversedBy: uuid('reversed_by').references(() => users.id, { onDelete: 'set null' }),
    reversalReason: text('reversal_reason'),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
    reconciledBy: uuid('reconciled_by').references(() => users.id, { onDelete: 'set null' }),
    reconciliationNote: text('reconciliation_note'),
    paymentDate: date('payment_date').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('payments_customer_idx').on(t.customerId),
    index('payments_status_idx').on(t.status),
    index('payments_method_idx').on(t.method),
    index('payments_date_idx').on(t.paymentDate),
    index('payments_recon_idx').on(t.reconciliationStatus),
    index('payments_location_idx').on(t.locationId),
  ],
);

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  customer: one(customers, { fields: [payments.customerId], references: [customers.id] }),
  location: one(locations, { fields: [payments.locationId], references: [locations.id] }),
  createdByUser: one(users, { fields: [payments.createdBy], references: [users.id] }),
  reversedByUser: one(users, { fields: [payments.reversedBy], references: [users.id] }),
  reconciledByUser: one(users, { fields: [payments.reconciledBy], references: [users.id] }),
  allocations: many(paymentAllocations),
}));

// ── Payment Allocations ──────────────────────────────────────────────────────

export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => salesDocuments.id, { onDelete: 'restrict' }),
    /** Positive = allocation; negative = reversal or release of overpayment */
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    allocatedAt: timestamp('allocated_at', { withTimezone: true }).notNull().defaultNow(),
    allocatedBy: uuid('allocated_by').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
  },
  (t) => [
    index('payment_alloc_payment_idx').on(t.paymentId),
    index('payment_alloc_invoice_idx').on(t.invoiceId),
  ],
);

export const paymentAllocationsRelations = relations(paymentAllocations, ({ one }) => ({
  payment: one(payments, { fields: [paymentAllocations.paymentId], references: [payments.id] }),
  invoice: one(salesDocuments, {
    fields: [paymentAllocations.invoiceId],
    references: [salesDocuments.id],
  }),
  allocatedByUser: one(users, {
    fields: [paymentAllocations.allocatedBy],
    references: [users.id],
  }),
}));
