/**
 * Phase 2 database schema — Customers, Quotations, Sales Documents (Invoices & Credit Notes),
 * Stock Reservations, and Delivery Notes.
 *
 * Money is stored as bigint (tambala = 1/100 MWK).
 * Quantities are stored as numeric(14,3).
 * Sequential numbers are gap-free per document type per location.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  bigint,
  integer,
  numeric,
  timestamp,
  date,
  char,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { locations, users, taxRates, citext } from './setup';
import { products, serialNumbers } from './stock';

// ── Customers ────────────────────────────────────────────────────────────────

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    accountNumber: text('account_number').notNull().unique(),
    name: text('name').notNull(),
    /** 'individual' | 'business' | 'walk_in' */
    customerType: text('customer_type').notNull().default('individual'),
    /** Exactly one walk-in customer row exists in the system */
    isWalkIn: boolean('is_walk_in').notNull().default(false),
    email: citext('email'),
    phone: text('phone'),
    address: text('address'),
    taxNumber: text('tax_number'), // TPIN
    creditLimitMinor: bigint('credit_limit_minor', { mode: 'number' }).notNull().default(0),
    paymentTermsDays: integer('payment_terms_days').notNull().default(30),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('customers_walk_in_unique_idx')
      .on(t.isWalkIn)
      .where(sql`is_walk_in = true`),
    index('customers_name_idx').on(t.name),
    index('customers_type_idx').on(t.customerType),
    index('customers_active_idx').on(t.isActive),
  ],
);

export const customersRelations = relations(customers, ({ many }) => ({
  quotations: many(quotations),
  salesDocuments: many(salesDocuments),
  deliveryNotes: many(deliveryNotes),
  serialNumbers: many(serialNumbers),
}));

// ── Stock Reservations ───────────────────────────────────────────────────────

/**
 * Tracks active, released, or fulfilled stock reservations.
 * Reservation rows are NEVER deleted.
 * When quotation expires/cancels, or invoice is voided/credited, status becomes 'released'.
 * When delivery note dispatches, fulfilled_qty increases, status becomes 'fulfilled' when complete.
 */
export const stockReservations = pgTable(
  'stock_reservations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    /** 'quotation' | 'sales_document' */
    sourceDocumentType: text('source_document_type').notNull(),
    sourceDocumentId: uuid('source_document_id').notNull(),
    sourceLineId: uuid('source_line_id').notNull(),
    reservedQty: numeric('reserved_qty', { precision: 14, scale: 3 }).notNull(),
    fulfilledQty: numeric('fulfilled_qty', { precision: 14, scale: 3 }).notNull().default('0'),
    /** 'active' | 'released' | 'fulfilled' */
    status: text('status').notNull().default('active'),
    reservedAt: timestamp('reserved_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [
    index('stock_reservations_prod_loc_idx').on(t.productId, t.locationId),
    index('stock_reservations_source_idx').on(t.sourceDocumentType, t.sourceDocumentId),
    index('stock_reservations_status_idx').on(t.status),
    index('stock_reservations_expires_idx').on(t.expiresAt),
  ],
);

export const stockReservationsRelations = relations(stockReservations, ({ one }) => ({
  product: one(products, { fields: [stockReservations.productId], references: [products.id] }),
  location: one(locations, { fields: [stockReservations.locationId], references: [locations.id] }),
}));

// ── Quotations & Quotation Lines ─────────────────────────────────────────────

export const quotations = pgTable(
  'quotations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    quotationNumber: text('quotation_number').unique(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    /** 'draft' | 'sent' | 'accepted' | 'converted' | 'expired' | 'cancelled' */
    status: text('status').notNull().default('draft'),
    quotationDate: date('quotation_date').notNull(),
    validUntil: date('valid_until').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('MWK'),
    exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6 }).notNull().default('1.000000'),
    subtotalMinor: bigint('subtotal_minor', { mode: 'number' }).notNull().default(0),
    discountMinor: bigint('discount_minor', { mode: 'number' }).notNull().default(0),
    taxMinor: bigint('tax_minor', { mode: 'number' }).notNull().default(0),
    totalMinor: bigint('total_minor', { mode: 'number' }).notNull().default(0),
    requiresApproval: boolean('requires_approval').notNull().default(false),
    approvalReason: text('approval_reason'),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    notes: text('notes'),
    terms: text('terms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('quotations_customer_idx').on(t.customerId),
    index('quotations_status_idx').on(t.status),
    index('quotations_date_idx').on(t.quotationDate),
  ],
);

export const quotationLines = pgTable(
  'quotation_lines',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    quotationId: uuid('quotation_id')
      .notNull()
      .references(() => quotations.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    sku: text('sku').notNull(),
    description: text('description'),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'number' }).notNull(),
    discountMinor: bigint('discount_minor', { mode: 'number' }).notNull().default(0),
    taxRateId: uuid('tax_rate_id')
      .notNull()
      .references(() => taxRates.id, { onDelete: 'restrict' }),
    taxRateBasisPoints: integer('tax_rate_basis_points').notNull(),
    taxMinor: bigint('tax_minor', { mode: 'number' }).notNull(),
    lineTotalMinor: bigint('line_total_minor', { mode: 'number' }).notNull(),
    notes: text('notes'),
  },
  (t) => [index('quotation_lines_quotation_idx').on(t.quotationId)],
);

export const quotationsRelations = relations(quotations, ({ one, many }) => ({
  customer: one(customers, { fields: [quotations.customerId], references: [customers.id] }),
  location: one(locations, { fields: [quotations.locationId], references: [locations.id] }),
  approvedByUser: one(users, { fields: [quotations.approvedBy], references: [users.id] }),
  createdByUser: one(users, { fields: [quotations.createdBy], references: [users.id] }),
  lines: many(quotationLines),
}));

export const quotationLinesRelations = relations(quotationLines, ({ one }) => ({
  quotation: one(quotations, { fields: [quotationLines.quotationId], references: [quotations.id] }),
  product: one(products, { fields: [quotationLines.productId], references: [products.id] }),
  taxRate: one(taxRates, { fields: [quotationLines.taxRateId], references: [taxRates.id] }),
}));

// ── Sales Documents (Invoices & Credit Notes) ────────────────────────────────

export const salesDocuments = pgTable(
  'sales_documents',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** 'invoice' | 'credit_note' */
    documentType: text('document_type').notNull(),
    documentNumber: text('document_number').unique(),
    /** For credit notes referencing the parent invoice */
    sourceDocumentId: uuid('source_document_id').references(
      (): AnyPgColumn => salesDocuments.id,
      { onDelete: 'restrict' },
    ),
    /** For invoices converted from quotations */
    sourceQuotationId: uuid('source_quotation_id').references(() => quotations.id, {
      onDelete: 'set null',
    }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    /** Strictly 'draft' | 'issued' | 'void' */
    status: text('status').notNull().default('draft'),
    /** 'not_delivered' | 'partly_delivered' | 'delivered' */
    deliveryStatus: text('delivery_status').notNull().default('not_delivered'),
    /** 'unpaid' | 'partly_paid' | 'paid' | 'credited' */
    paymentStatus: text('payment_status').notNull().default('unpaid'),
    issueDate: date('issue_date').notNull(),
    dueDate: date('due_date').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('MWK'),
    exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6 }).notNull().default('1.000000'),
    subtotalMinor: bigint('subtotal_minor', { mode: 'number' }).notNull().default(0),
    discountMinor: bigint('discount_minor', { mode: 'number' }).notNull().default(0),
    taxMinor: bigint('tax_minor', { mode: 'number' }).notNull().default(0),
    totalMinor: bigint('total_minor', { mode: 'number' }).notNull().default(0),
    creditedMinor: bigint('credited_minor', { mode: 'number' }).notNull().default(0),
    paidMinor: bigint('paid_minor', { mode: 'number' }).notNull().default(0),
    balanceMinor: bigint('balance_minor', { mode: 'number' }).notNull().default(0),
    isImmutable: boolean('is_immutable').notNull().default(false),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => users.id, { onDelete: 'set null' }),
    voidReason: text('void_reason'),
    requiresApproval: boolean('requires_approval').notNull().default(false),
    approvalReason: text('approval_reason'),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    notes: text('notes'),
    terms: text('terms'),
    /** 'office' | 'counter' */
    channel: text('channel').notNull().default('office'),
    /** POS Shift ID for counter sales */
    shiftId: uuid('shift_id'),
    /** Unique client idempotency key for counter sales */
    idempotencyKey: text('idempotency_key').unique(),
    /** Offline / client timestamp when the sale was finalized at the terminal */
    clientCreatedAt: timestamp('client_created_at', { withTimezone: true }),
    /** EIS integration fields (Phase 5 will enforce; status defaults to 'not_required') */
    eisStatus: text('eis_status').notNull().default('not_required'),
    eisReference: text('eis_reference'),
    eisQrCode: text('eis_qr_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('sales_docs_customer_idx').on(t.customerId),
    index('sales_docs_type_status_idx').on(t.documentType, t.status),
    index('sales_docs_issue_date_idx').on(t.issueDate),
    index('sales_docs_source_doc_idx').on(t.sourceDocumentId),
    index('sales_docs_delivery_status_idx').on(t.deliveryStatus),
    index('sales_docs_payment_status_idx').on(t.paymentStatus),
    index('sales_docs_shift_idx').on(t.shiftId),
  ],
);

export const salesDocumentLines = pgTable(
  'sales_document_lines',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    documentId: uuid('document_id')
      .notNull()
      .references(() => salesDocuments.id, { onDelete: 'cascade' }),
    /** For credit note lines: points to the invoice line being credited */
    sourceLineId: uuid('source_line_id').references(
      (): AnyPgColumn => salesDocumentLines.id,
      { onDelete: 'restrict' },
    ),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    sku: text('sku').notNull(),
    description: text('description'),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'number' }).notNull(),
    discountMinor: bigint('discount_minor', { mode: 'number' }).notNull().default(0),
    taxRateId: uuid('tax_rate_id')
      .notNull()
      .references(() => taxRates.id, { onDelete: 'restrict' }),
    taxRateBasisPoints: integer('tax_rate_basis_points').notNull(),
    taxMinor: bigint('tax_minor', { mode: 'number' }).notNull(),
    lineTotalMinor: bigint('line_total_minor', { mode: 'number' }).notNull(),
    /** Quantity delivered via delivery notes */
    deliveredQty: numeric('delivered_qty', { precision: 14, scale: 3 }).notNull().default('0'),
    /** Quantity credited via credit notes */
    creditedQty: numeric('credited_qty', { precision: 14, scale: 3 }).notNull().default('0'),
    /** Weighted average cost of goods delivered in tambala */
    unitCostMinor: bigint('unit_cost_minor', { mode: 'number' }).notNull().default(0),
    /** Credit note line flag: true if physical goods are returned to stock */
    returnGoods: boolean('return_goods').notNull().default(false),
    notes: text('notes'),
  },
  (t) => [
    index('sales_doc_lines_document_idx').on(t.documentId),
    index('sales_doc_lines_product_idx').on(t.productId),
    index('sales_doc_lines_source_line_idx').on(t.sourceLineId),
  ],
);

export const salesDocumentsRelations = relations(salesDocuments, ({ one, many }) => ({
  customer: one(customers, { fields: [salesDocuments.customerId], references: [customers.id] }),
  location: one(locations, { fields: [salesDocuments.locationId], references: [locations.id] }),
  sourceDocument: one(salesDocuments, {
    fields: [salesDocuments.sourceDocumentId],
    references: [salesDocuments.id],
    relationName: 'creditNoteSourceInvoice',
  }),
  creditNotes: many(salesDocuments, { relationName: 'creditNoteSourceInvoice' }),
  sourceQuotation: one(quotations, {
    fields: [salesDocuments.sourceQuotationId],
    references: [quotations.id],
  }),
  lines: many(salesDocumentLines),
  deliveryNotes: many(deliveryNotes),
  createdByUser: one(users, { fields: [salesDocuments.createdBy], references: [users.id] }),
  approvedByUser: one(users, { fields: [salesDocuments.approvedBy], references: [users.id] }),
  voidedByUser: one(users, { fields: [salesDocuments.voidedBy], references: [users.id] }),
}));

export const salesDocumentLinesRelations = relations(salesDocumentLines, ({ one, many }) => ({
  document: one(salesDocuments, {
    fields: [salesDocumentLines.documentId],
    references: [salesDocuments.id],
  }),
  sourceLine: one(salesDocumentLines, {
    fields: [salesDocumentLines.sourceLineId],
    references: [salesDocumentLines.id],
    relationName: 'creditNoteSourceLine',
  }),
  creditLines: many(salesDocumentLines, { relationName: 'creditNoteSourceLine' }),
  product: one(products, { fields: [salesDocumentLines.productId], references: [products.id] }),
  taxRate: one(taxRates, { fields: [salesDocumentLines.taxRateId], references: [taxRates.id] }),
  deliveryNoteLines: many(deliveryNoteLines),
}));

// ── Delivery Notes & Delivery Note Lines ─────────────────────────────────────

export const deliveryNotes = pgTable(
  'delivery_notes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    deliveryNumber: text('delivery_number').notNull().unique(),
    salesDocumentId: uuid('sales_document_id')
      .notNull()
      .references(() => salesDocuments.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    deliveryDate: date('delivery_date').notNull(),
    /** Status is strictly 'dispatched' (no cancellation in Phase 2) */
    status: text('status').notNull().default('dispatched'),
    notes: text('notes'),
    receivedByCustomer: text('received_by_customer'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('delivery_notes_doc_idx').on(t.salesDocumentId),
    index('delivery_notes_customer_idx').on(t.customerId),
    index('delivery_notes_date_idx').on(t.deliveryDate),
  ],
);

export const deliveryNoteLines = pgTable(
  'delivery_note_lines',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    deliveryNoteId: uuid('delivery_note_id')
      .notNull()
      .references(() => deliveryNotes.id, { onDelete: 'cascade' }),
    salesDocumentLineId: uuid('sales_document_line_id')
      .notNull()
      .references(() => salesDocumentLines.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    /** Captured avg_cost_minor at dispatch in tambala */
    unitCostMinor: bigint('unit_cost_minor', { mode: 'number' }).notNull(),
    totalCostMinor: bigint('total_cost_minor', { mode: 'number' }).notNull(),
    isBundleComponent: boolean('is_bundle_component').notNull().default(false),
    bundleProductId: uuid('bundle_product_id').references(() => products.id, {
      onDelete: 'set null',
    }),
    /** Captured serial numbers dispatched */
    serialNumbers: text('serial_numbers').array(),
  },
  (t) => [
    index('delivery_note_lines_note_idx').on(t.deliveryNoteId),
    index('delivery_note_lines_doc_line_idx').on(t.salesDocumentLineId),
    index('delivery_note_lines_product_idx').on(t.productId),
  ],
);

export const deliveryNotesRelations = relations(deliveryNotes, ({ one, many }) => ({
  salesDocument: one(salesDocuments, {
    fields: [deliveryNotes.salesDocumentId],
    references: [salesDocuments.id],
  }),
  location: one(locations, { fields: [deliveryNotes.locationId], references: [locations.id] }),
  customer: one(customers, { fields: [deliveryNotes.customerId], references: [customers.id] }),
  lines: many(deliveryNoteLines),
  createdByUser: one(users, { fields: [deliveryNotes.createdBy], references: [users.id] }),
}));

export const deliveryNoteLinesRelations = relations(deliveryNoteLines, ({ one }) => ({
  deliveryNote: one(deliveryNotes, {
    fields: [deliveryNoteLines.deliveryNoteId],
    references: [deliveryNotes.id],
  }),
  salesDocumentLine: one(salesDocumentLines, {
    fields: [deliveryNoteLines.salesDocumentLineId],
    references: [salesDocumentLines.id],
  }),
  product: one(products, { fields: [deliveryNoteLines.productId], references: [products.id] }),
  bundleProduct: one(products, {
    fields: [deliveryNoteLines.bundleProductId],
    references: [products.id],
  }),
}));
