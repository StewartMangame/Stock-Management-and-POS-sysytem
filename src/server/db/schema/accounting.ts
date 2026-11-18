/**
 * Phase 6 Database Schema — Accounting, Journal Batches, Stock Snapshots & System Integrity.
 *
 * Money is stored as bigint (tambala = 1/100 MWK).
 * Strict double-entry accounting: every journal entry must balance (Debits === Credits).
 * Journals are append-only.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  bigint,
  timestamp,
  date,
  jsonb,
  numeric,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { users, locations } from './setup';
import { products } from './stock';

// ── Stock Daily Snapshots (EOD Cache for Valuation & Ledger Replay) ──────────

export const stockDailySnapshots = pgTable(
  'stock_daily_snapshots',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** Date string in YYYY-MM-DD corresponding to Africa/Blantyre end-of-day */
    snapshotDate: date('snapshot_date').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    onHand: numeric('on_hand', { precision: 14, scale: 3 }).notNull().default('0'),
    averageCostMinor: bigint('average_cost_minor', { mode: 'number' }).notNull().default(0),
    valuationMinor: bigint('valuation_minor', { mode: 'number' }).notNull().default(0),
    /** Marked true by trigger when a backdated stock movement is inserted */
    isStale: boolean('is_stale').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('stock_snapshots_date_prod_loc_idx').on(t.snapshotDate, t.productId, t.locationId),
    index('stock_snapshots_date_idx').on(t.snapshotDate),
    index('stock_snapshots_stale_idx').on(t.isStale),
  ],
);

export const stockDailySnapshotsRelations = relations(stockDailySnapshots, ({ one }) => ({
  product: one(products, { fields: [stockDailySnapshots.productId], references: [products.id] }),
  location: one(locations, { fields: [stockDailySnapshots.locationId], references: [locations.id] }),
}));

// ── Journal Source Events (Deduplication & Single-Batch Assignment) ───────────

export const journalSourceEvents = pgTable(
  'journal_source_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    eventType: text('event_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    batchId: uuid('batch_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('journal_source_events_type_source_idx').on(t.eventType, t.sourceId),
    index('journal_source_events_batch_idx').on(t.batchId),
  ],
);

// ── Account Mappings (Configurable Chart of Accounts) ─────────────────────────

export const accountMappings = pgTable(
  'account_mappings',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    eventType: text('event_type').notNull(),
    role: text('role').notNull(), // 'debit' | 'credit' | 'tax' | 'clearing' | 'cogs' | 'inventory' | etc.
    accountCode: text('account_code').notNull(),
    accountName: text('account_name').notNull(),
    description: text('description'),
    isPlaceholder: boolean('is_placeholder').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('account_mappings_event_role_idx').on(t.eventType, t.role),
  ],
);

// ── Journal Batches (Append-Only Batches) ─────────────────────────────────────

export const journalBatches = pgTable(
  'journal_batches',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** e.g. JB-2026-0001 */
    batchNumber: text('batch_number').notNull().unique(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    exportedAt: timestamp('exported_at', { withTimezone: true }),
    exportedBy: uuid('exported_by').references(() => users.id, { onDelete: 'set null' }),
    reExportApprovedBy: uuid('re_export_approved_by').references(() => users.id, { onDelete: 'set null' }),
    reExportApprovedAt: timestamp('re_export_approved_at', { withTimezone: true }),
    reExportReason: text('re_export_reason'),
    isDraft: boolean('is_draft').notNull().default(true),
    /** 'unexported' | 'exported' */
    status: text('status').notNull().default('unexported'),
    totalDebitMinor: bigint('total_debit_minor', { mode: 'number' }).notNull().default(0),
    totalCreditMinor: bigint('total_credit_minor', { mode: 'number' }).notNull().default(0),
    lineCount: bigint('line_count', { mode: 'number' }).notNull().default(0),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('journal_batches_period_idx').on(t.periodStart, t.periodEnd),
    index('journal_batches_status_idx').on(t.status),
  ],
);

export const journalBatchesRelations = relations(journalBatches, ({ one, many }) => ({
  exportedByUser: one(users, { fields: [journalBatches.exportedBy], references: [users.id] }),
  reExportApprovedByUser: one(users, {
    fields: [journalBatches.reExportApprovedBy],
    references: [users.id],
  }),
  lines: many(journalLines),
  exports: many(journalBatchExports),
}));

// ── Journal Batch Exports (Append-Only Export History & Approvals) ───────────

export const journalBatchExports = pgTable(
  'journal_batch_exports',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => journalBatches.id, { onDelete: 'cascade' }),
    /** 'initial' | 're_export' */
    exportType: text('export_type').notNull().default('initial'),
    exportedAt: timestamp('exported_at', { withTimezone: true }).notNull().defaultNow(),
    exportedBy: uuid('exported_by').references(() => users.id, { onDelete: 'set null' }),
    reExportApprovedBy: uuid('re_export_approved_by').references(() => users.id, { onDelete: 'set null' }),
    reExportApprovedAt: timestamp('re_export_approved_at', { withTimezone: true }),
    reExportReason: text('re_export_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('journal_batch_exports_batch_idx').on(t.batchId),
    index('journal_batch_exports_type_idx').on(t.exportType),
  ],
);

export const journalBatchExportsRelations = relations(journalBatchExports, ({ one }) => ({
  batch: one(journalBatches, { fields: [journalBatchExports.batchId], references: [journalBatches.id] }),
  exportedByUser: one(users, { fields: [journalBatchExports.exportedBy], references: [users.id] }),
  reExportApprovedByUser: one(users, {
    fields: [journalBatchExports.reExportApprovedBy],
    references: [users.id],
  }),
}));

// ── Journal Lines (Append-Only Double Entry Rows) ─────────────────────────────

export const journalLines = pgTable(
  'journal_lines',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => journalBatches.id, { onDelete: 'cascade' }),
    /** Entry grouping number within batch (e.g. JE-INV-001) */
    entryNumber: text('entry_number').notNull(),
    entryDate: timestamp('entry_date', { withTimezone: true }).notNull(),
    eventType: text('event_type').notNull(),
    sourceEntityType: text('source_entity_type').notNull(),
    sourceEntityId: uuid('source_entity_id').notNull(),
    accountCode: text('account_code').notNull(),
    accountName: text('account_name').notNull(),
    debitMinor: bigint('debit_minor', { mode: 'number' }).notNull().default(0),
    creditMinor: bigint('credit_minor', { mode: 'number' }).notNull().default(0),
    description: text('description'),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('journal_lines_batch_idx').on(t.batchId),
    index('journal_lines_entry_idx').on(t.entryNumber),
    index('journal_lines_date_idx').on(t.entryDate),
    index('journal_lines_source_idx').on(t.sourceEntityType, t.sourceEntityId),
  ],
);

export const journalLinesRelations = relations(journalLines, ({ one }) => ({
  batch: one(journalBatches, { fields: [journalLines.batchId], references: [journalBatches.id] }),
  location: one(locations, { fields: [journalLines.locationId], references: [locations.id] }),
}));

// ── System Checks History ────────────────────────────────────────────────────

export const systemChecksHistory = pgTable(
  'system_checks_history',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    executedAt: timestamp('executed_at', { withTimezone: true }).notNull().defaultNow(),
    executedBy: uuid('executed_by').references(() => users.id, { onDelete: 'set null' }),
    /** 'pass' | 'warning' | 'fail' */
    status: text('status').notNull(),
    totalChecks: bigint('total_checks', { mode: 'number' }).notNull().default(0),
    passedCount: bigint('passed_count', { mode: 'number' }).notNull().default(0),
    warningCount: bigint('warning_count', { mode: 'number' }).notNull().default(0),
    failedCount: bigint('failed_count', { mode: 'number' }).notNull().default(0),
    durationMs: bigint('duration_ms', { mode: 'number' }).notNull().default(0),
    details: jsonb('details').notNull(),
  },
  (t) => [
    index('system_checks_at_idx').on(t.executedAt),
    index('system_checks_status_idx').on(t.status),
  ],
);

export const systemChecksHistoryRelations = relations(systemChecksHistory, ({ one }) => ({
  executedByUser: one(users, { fields: [systemChecksHistory.executedBy], references: [users.id] }),
}));

