/**
 * Phase 0 database schema — setup and security tables.
 *
 * Covers:
 *   locations, roles, users, settings, tax_rates, exchange_rates,
 *   number_sequences, audit_log, attachments, login_attempts
 *
 * Money is stored as bigint (tambala = 1/100 MWK).
 * All timestamps are timestamptz.
 * Primary keys are UUID v4 via gen_random_uuid().
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
  jsonb,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ── Custom column types ──────────────────────────────────────────────────────

import { customType } from 'drizzle-orm/pg-core';

/** Case-insensitive text — emails stored in citext for case-insensitive unique checks. */
export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

/** PostgreSQL inet type for IP addresses. */
export const inet = customType<{ data: string }>({
  dataType() {
    return 'inet';
  },
});

// ── Locations ────────────────────────────────────────────────────────────────

export const locations = pgTable('locations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  type: text('type').notNull(), // 'outlet' | 'warehouse'  (CHECK added in migration)
  address: text('address'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  createdBy: uuid('created_by'), // self-ref added after users table; FK in migration
});

// ── Roles ────────────────────────────────────────────────────────────────────

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull().unique(),
  permissions: text('permissions').array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  createdBy: uuid('created_by'),
});

// ── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  email: citext('email').notNull(), // unique enforced by index
  passwordHash: text('password_hash').notNull(),
  roleId: uuid('role_id').references(() => roles.id, { onDelete: 'restrict' }),
  defaultLocationId: uuid('default_location_id').references(() => locations.id, {
    onDelete: 'set null',
  }),
  isActive: boolean('is_active').notNull().default(true),
  /** Force a password change on the next login (set true for seeded admin). */
  forcePasswordChange: boolean('force_password_change').notNull().default(false),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  /** 6-digit PIN hash for POS manager overrides */
  pinHash: text('pin_hash'),
  pinFailedAttempts: integer('pin_failed_attempts').notNull().default(0),
  pinLockedUntil: timestamp('pin_locked_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  createdBy: uuid('created_by').references((): AnyPgColumn => users.id, {
    onDelete: 'set null',
  }),
});

// ── Settings ─────────────────────────────────────────────────────────────────

/**
 * Simple key/value store for application settings.
 * Keys are defined in SETTING_KEYS; values are JSON so any scalar or object can be stored.
 */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

/** All valid setting keys — used for validation and type narrowing. */
export const SETTING_KEYS = [
  'default_currency',
  'allow_negative_stock',
  'costing_method',
  'max_discount_percent_without_approval',
  'quotation_valid_days',
  'prices_include_tax',
  'company_name',
  'company_address',
  'company_phone',
  'company_email',
  'company_tax_number',
  'eis_enabled',
  'invoice_payment_instructions',
  'reservation_hold_days',
  'pos_blind_cash_up',
  'pos_return_window_days',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

// ── Tax rates ────────────────────────────────────────────────────────────────

export const taxRates = pgTable('tax_rates', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  /** Rate stored as basis points: 17.5% = 1750. */
  rateBasisPoints: integer('rate_basis_points').notNull(),
  isDefault: boolean('is_default').default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
});

// ── Exchange rates ────────────────────────────────────────────────────────────

export const exchangeRates = pgTable(
  'exchange_rates',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    currency: char('currency', { length: 3 }).notNull(),
    rateToMwk: numeric('rate_to_mwk', { precision: 18, scale: 6 }).notNull(),
    effectiveDate: date('effective_date').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('exchange_rates_currency_date_idx').on(t.currency, t.effectiveDate)],
);

// ── Number sequences ─────────────────────────────────────────────────────────

/**
 * Gap-free sequence per document type per location.
 * The next_number is locked with SELECT ... FOR UPDATE during document creation.
 * Prefix is location-specific, e.g. 'MAIN-INV'.
 */
export const numberSequences = pgTable(
  'number_sequences',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    docType: text('doc_type').notNull(),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'cascade' }),
    prefix: text('prefix').notNull(),
    nextNumber: bigint('next_number', { mode: 'number' }).notNull().default(1),
    padding: integer('padding').notNull().default(4),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('number_sequences_doc_location_idx').on(t.docType, t.locationId)],
);

// ── Audit log ─────────────────────────────────────────────────────────────────

/**
 * Append-only audit trail for every create, update, void, adjustment and payment.
 * No updated_at because this table is never updated.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: inet('ip'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Phase 6: composite indexes for keyset pagination and entity history tab
    index('audit_log_entity_at_idx').on(t.entityType, t.entityId, t.at),
    index('audit_log_at_id_idx').on(t.at, t.id),
    index('audit_log_user_idx').on(t.userId),
  ],
);

// ── Attachments ───────────────────────────────────────────────────────────────

export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  fileUrl: text('file_url').notNull(),
  /** 'slip_photo' | 'supplier_invoice' | 'signed_delivery_note' | 'other' */
  kind: text('kind').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
});

// ── Login attempts (DB-backed rate limiting) ──────────────────────────────────

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    ip: text('ip').notNull(),
    email: text('email').notNull(),
    success: boolean('success').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('login_attempts_ip_at_idx').on(t.ip, t.at),
    index('login_attempts_email_at_idx').on(t.email, t.at),
  ],
);

// ── Relations ─────────────────────────────────────────────────────────────────

export const rolesRelations = relations(roles, ({ many }) => ({
  users: many(users),
}));

export const usersRelations = relations(users, ({ one }) => ({
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
  defaultLocation: one(locations, {
    fields: [users.defaultLocationId],
    references: [locations.id],
  }),
}));

export const locationsRelations = relations(locations, ({ many }) => ({
  users: many(users),
  numberSequences: many(numberSequences),
}));

export const numberSequencesRelations = relations(numberSequences, ({ one }) => ({
  location: one(locations, { fields: [numberSequences.locationId], references: [locations.id] }),
}));

export const taxRatesRelations = relations(taxRates, ({ one }) => ({
  createdByUser: one(users, { fields: [taxRates.createdBy], references: [users.id] }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(users, { fields: [auditLog.userId], references: [users.id] }),
}));
