/**
 * Phase 4 database schema — POS shifts, cash movements, and held sales.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  bigint,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { users, locations } from './setup';
import { customers } from './sales';

// ── POS Shifts ───────────────────────────────────────────────────────────────

export const posShifts = pgTable(
  'pos_shifts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** Gap-free sequential shift number per location, e.g. MAIN-SHF-0001 */
    shiftNumber: text('shift_number').notNull().unique(),
    cashierId: uuid('cashier_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    /** 'open' | 'closed' | 'reviewed' */
    status: text('status').notNull().default('open'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewNote: text('review_note'),
    openingFloatMinor: bigint('opening_float_minor', { mode: 'number' }).notNull().default(0),
    /** Entered blind at close by cashier */
    countedCashMinor: bigint('counted_cash_minor', { mode: 'number' }),
    /** [{ terminalId, batchTotalMinor }] */
    cardTerminalTotals: jsonb('card_terminal_totals'),
    /** Computed at close: float + cash receipts - cash refunds + paid in - paid out */
    expectedCashMinor: bigint('expected_cash_minor', { mode: 'number' }),
    /** counted - expected */
    cashVarianceMinor: bigint('cash_variance_minor', { mode: 'number' }),
    /** Optional breakdown: { '5000': 10, '2000': 5, ... } */
    denominationCount: jsonb('denomination_count'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    // Exactly one open shift per cashier
    uniqueIndex('pos_shifts_one_open_per_cashier_idx')
      .on(t.cashierId)
      .where(sql`status = 'open'`),
    index('pos_shifts_location_idx').on(t.locationId),
    index('pos_shifts_status_idx').on(t.status),
    index('pos_shifts_opened_at_idx').on(t.openedAt),
  ],
);

export const posShiftsRelations = relations(posShifts, ({ one, many }) => ({
  cashier: one(users, { fields: [posShifts.cashierId], references: [users.id] }),
  location: one(locations, { fields: [posShifts.locationId], references: [locations.id] }),
  reviewedByUser: one(users, { fields: [posShifts.reviewedBy], references: [users.id] }),
  cashMovements: many(cashMovements),
  heldSales: many(heldSales),
}));

// ── Cash Movements ───────────────────────────────────────────────────────────

export const cashMovements = pgTable(
  'cash_movements',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => posShifts.id, { onDelete: 'restrict' }),
    /** 'paid_in' | 'paid_out' */
    kind: text('kind').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    reason: text('reason').notNull(),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    requiresOverride: boolean('requires_override').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [index('cash_movements_shift_idx').on(t.shiftId)],
);

export const cashMovementsRelations = relations(cashMovements, ({ one }) => ({
  shift: one(posShifts, { fields: [cashMovements.shiftId], references: [posShifts.id] }),
  approvedByUser: one(users, { fields: [cashMovements.approvedBy], references: [users.id] }),
  createdByUser: one(users, { fields: [cashMovements.createdBy], references: [users.id] }),
}));

// ── Held Sales ───────────────────────────────────────────────────────────────

export const heldSales = pgTable(
  'held_sales',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => posShifts.id, { onDelete: 'cascade' }),
    holdReference: text('hold_reference').notNull(),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    /** Serialized cart payload: product IDs, quantities, discount metadata */
    cartPayload: jsonb('cart_payload').notNull(),
    heldAt: timestamp('held_at', { withTimezone: true }).notNull().defaultNow(),
    heldBy: uuid('held_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [index('held_sales_shift_idx').on(t.shiftId)],
);

export const heldSalesRelations = relations(heldSales, ({ one }) => ({
  shift: one(posShifts, { fields: [heldSales.shiftId], references: [posShifts.id] }),
  customer: one(customers, { fields: [heldSales.customerId], references: [customers.id] }),
  heldByUser: one(users, { fields: [heldSales.heldBy], references: [users.id] }),
}));
