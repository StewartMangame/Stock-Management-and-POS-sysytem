/**
 * Phase 5 database schema — Payment Attempts, Webhooks, Payment Links,
 * Bank Statement Reconciliation, and Electronic Invoicing System (EIS) Outbox.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  bigint,
  integer,
  timestamp,
  date,
  jsonb,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { users } from './setup';
import { salesDocuments } from './sales';
import { payments } from './payments';

// ── 1. Forensic Payment Attempts (Append-Only Log) ───────────────────────────

export const paymentAttempts = pgTable(
  'payment_attempts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'restrict' }),
    attemptType: text('attempt_type').notNull(),
    idempotencyKey: text('idempotency_key'),
    requestUrl: text('request_url'),
    requestHeaders: jsonb('request_headers'),
    requestBody: jsonb('request_body'),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_payment_attempts_payment_id').on(t.paymentId),
    index('idx_payment_attempts_created_at').on(t.createdAt),
  ],
);

export const paymentAttemptsRelations = relations(paymentAttempts, ({ one }) => ({
  payment: one(payments, { fields: [paymentAttempts.paymentId], references: [payments.id] }),
}));

// ── 2. Webhook Inbox (Asynchronous Ingestion) ────────────────────────────────

export const webhookInbox = pgTable(
  'webhook_inbox',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    provider: text('provider').notNull(),
    eventType: text('event_type').notNull(),
    transactionReference: text('transaction_reference').notNull(),
    rawPayload: text('raw_payload').notNull(),
    headers: jsonb('headers').notNull(),
    status: text('status').notNull().default('received'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    errorMessage: text('error_message'),
  },
  (t) => [
    unique('uq_webhook_inbox_ref_event').on(t.transactionReference, t.eventType),
    index('idx_webhook_inbox_status_received').on(t.status, t.receivedAt),
  ],
);

// ── 3. Payment Links ─────────────────────────────────────────────────────────

export const paymentLinks = pgTable(
  'payment_links',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => salesDocuments.id, { onDelete: 'restrict' }),
    tokenHash: text('token_hash').notNull().unique(),
    status: text('status').notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    allowPartial: boolean('allow_partial').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_payment_links_invoice_id').on(t.invoiceId)],
);

export const paymentLinksRelations = relations(paymentLinks, ({ one }) => ({
  invoice: one(salesDocuments, { fields: [paymentLinks.invoiceId], references: [salesDocuments.id] }),
  createdByUser: one(users, { fields: [paymentLinks.createdBy], references: [users.id] }),
}));

// ── 4. Payment Link Rate Limits (Persistent DB) ──────────────────────────────

export const paymentLinkRateLimits = pgTable(
  'payment_link_rate_limits',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    key: text('key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    requestCount: integer('request_count').notNull().default(1),
  },
  (t) => [
    unique('uq_payment_link_rate_limits').on(t.key, t.windowStart),
    index('idx_payment_link_rate_limits_key').on(t.key),
  ],
);

// ── 5. Statement Mapping Profiles (Custom Bank Formats) ──────────────────────

export const statementMappingProfiles = pgTable(
  'statement_mapping_profiles',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull().unique(),
    columnMapping: jsonb('column_mapping').notNull(),
    dateFormat: text('date_format').notNull().default('YYYY-MM-DD'),
    amountMode: text('amount_mode').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const statementMappingProfilesRelations = relations(statementMappingProfiles, ({ one, many }) => ({
  createdByUser: one(users, { fields: [statementMappingProfiles.createdBy], references: [users.id] }),
  imports: many(statementImports),
}));

// ── 6. Statement Imports ─────────────────────────────────────────────────────

export const statementImports = pgTable(
  'statement_imports',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    fileHash: text('file_hash').notNull().unique(),
    filename: text('filename').notNull(),
    rowCount: integer('row_count').notNull(),
    totalAmountMinor: bigint('total_amount_minor', { mode: 'number' }).notNull(),
    profileId: uuid('profile_id').references(() => statementMappingProfiles.id, { onDelete: 'set null' }),
    importedBy: uuid('imported_by').references(() => users.id, { onDelete: 'set null' }),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const statementImportsRelations = relations(statementImports, ({ one, many }) => ({
  profile: one(statementMappingProfiles, { fields: [statementImports.profileId], references: [statementMappingProfiles.id] }),
  importedByUser: one(users, { fields: [statementImports.importedBy], references: [users.id] }),
  lines: many(statementLines),
}));

// ── 7. Statement Lines ───────────────────────────────────────────────────────

export const statementLines = pgTable(
  'statement_lines',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    importId: uuid('import_id')
      .notNull()
      .references(() => statementImports.id, { onDelete: 'cascade' }),
    lineNumber: integer('line_number').notNull(),
    transactionDate: date('transaction_date').notNull(),
    reference: text('reference'),
    description: text('description'),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    feeMinor: bigint('fee_minor', { mode: 'number' }).notNull().default(0),
    rawData: jsonb('raw_data'),
    matchStatus: text('match_status').notNull().default('unmatched'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_statement_lines_import_line').on(t.importId, t.lineNumber),
    index('idx_statement_lines_match_status').on(t.matchStatus),
  ],
);

export const statementLinesRelations = relations(statementLines, ({ one, many }) => ({
  importDoc: one(statementImports, { fields: [statementLines.importId], references: [statementImports.id] }),
  matches: many(reconciliationMatches),
}));

// ── 8. Reconciliation Matches ────────────────────────────────────────────────

export const reconciliationMatches = pgTable(
  'reconciliation_matches',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    statementLineId: uuid('statement_line_id')
      .notNull()
      .references(() => statementLines.id, { onDelete: 'cascade' }),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    matchedAmountMinor: bigint('matched_amount_minor', { mode: 'number' }).notNull(),
    matchedBy: uuid('matched_by').references(() => users.id, { onDelete: 'set null' }),
    matchedAt: timestamp('matched_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
  },
  (t) => [
    unique('uq_reconciliation_matches_payment').on(t.paymentId),
    index('idx_reconciliation_matches_line').on(t.statementLineId),
  ],
);

export const reconciliationMatchesRelations = relations(reconciliationMatches, ({ one }) => ({
  statementLine: one(statementLines, { fields: [reconciliationMatches.statementLineId], references: [statementLines.id] }),
  payment: one(payments, { fields: [reconciliationMatches.paymentId], references: [payments.id] }),
  matchedByUser: one(users, { fields: [reconciliationMatches.matchedBy], references: [users.id] }),
}));

// ── 9. EIS Submissions (Transactional Outbox) ────────────────────────────────

export const eisSubmissions = pgTable(
  'eis_submissions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    documentId: uuid('document_id')
      .notNull()
      .references(() => salesDocuments.id, { onDelete: 'restrict' }),
    documentType: text('document_type').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    payload: jsonb('payload').notNull(),
    responsePayload: jsonb('response_payload'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_eis_submissions_status_next_retry').on(t.status, t.nextRetryAt),
    index('idx_eis_submissions_document_id').on(t.documentId),
  ],
);

export const eisSubmissionsRelations = relations(eisSubmissions, ({ one }) => ({
  document: one(salesDocuments, { fields: [eisSubmissions.documentId], references: [salesDocuments.id] }),
}));

