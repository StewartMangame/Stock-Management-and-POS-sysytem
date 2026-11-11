/**
 * Phase 1 database schema — Stock Management, Catalog, Purchasing, and Inventory Ledger.
 *
 * All money stored in MWK tambala (1/100 MWK) as bigint / integer (`_minor`).
 * Foreign currency unit costs stored as NUMERIC(18,4) with exchange rates as NUMERIC(18,6).
 * Quantities stored as NUMERIC(14,3).
 *
 * Implements:
 *   - Company-wide average cost on products.avg_cost_minor
 *   - Immutable stock_movements ledger with seq identity
 *   - stock_balances with reserved and generated available
 *   - serial_numbers with case-insensitive unique (product_id, lower(serial_number))
 *   - Multi-currency purchase_orders and landed_costs table
 *   - stock_adjustments and stock_counts with shortage serial capture
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
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { locations, users, taxRates, citext } from './setup';
import { customers } from './sales';

// ── Categories ───────────────────────────────────────────────────────────────

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  description: text('description'),
  parentId: uuid('parent_id'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
});

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: 'categoryHierarchy',
  }),
  children: many(categories, { relationName: 'categoryHierarchy' }),
  products: many(products),
}));

// ── Units of Measure (UOM) ──────────────────────────────────────────────────

export const unitsOfMeasure = pgTable('units_of_measure', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  code: text('code').notNull().unique(), // 'EA', 'KG', 'M', 'BOX', 'L', etc.
  symbol: text('symbol').notNull(), // 'ea', 'kg', 'm', 'bx', 'L'
  allowDecimal: boolean('allow_decimal').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const unitsOfMeasureRelations = relations(unitsOfMeasure, ({ many }) => ({
  products: many(products),
}));

// ── Products ─────────────────────────────────────────────────────────────────

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    sku: citext('sku').notNull().unique(),
    barcode: text('barcode').unique(),
    description: text('description'),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    uomId: uuid('uom_id')
      .notNull()
      .references(() => unitsOfMeasure.id, { onDelete: 'restrict' }),
    /** 'standard' | 'inventory' | 'non-inventory' | 'bundle' | 'service' */
    productType: text('product_type').notNull().default('standard'),
    /** Product registration / creation date (user-set). Stored as DATE. */
    productDate: date('product_date').notNull().defaultNow(),
    /** Optional image URL for product display */
    imageUrl: text('image_url'),
    /**
     * Company-wide weighted average cost in tambala (1/100 MWK).
     * System maintained across all locations — read only, never directly edited by users.
     */
    avgCostMinor: bigint('avg_cost_minor', { mode: 'number' }).notNull().default(0),
    /** Read-only latest landed unit cost in tambala */
    lastCostMinor: bigint('last_cost_minor', { mode: 'number' }).notNull().default(0),
    /** Standard selling price in tambala */
    sellingPriceMinor: bigint('selling_price_minor', { mode: 'number' }).notNull().default(0),
    taxRateId: uuid('tax_rate_id').references(() => taxRates.id, { onDelete: 'set null' }),
    minStockAlert: numeric('min_stock_alert', { precision: 14, scale: 3 }).default('0'),
    maxStock: numeric('max_stock', { precision: 14, scale: 3 }),
    serialTracking: boolean('serial_tracking').notNull().default(false),
    warrantyMonths: integer('warranty_months').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('products_category_idx').on(t.categoryId),
    index('products_type_idx').on(t.productType),
    index('products_active_idx').on(t.isActive),
    // Trigram index on name is created via raw SQL in migration
  ],
);

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  uom: one(unitsOfMeasure, { fields: [products.uomId], references: [unitsOfMeasure.id] }),
  taxRate: one(taxRates, { fields: [products.taxRateId], references: [taxRates.id] }),
  bundleComponents: many(productBundles, { relationName: 'bundleParent' }),
  containedInBundles: many(productBundles, { relationName: 'bundleComponent' }),
  stockBalances: many(stockBalances),
  stockMovements: many(stockMovements),
  serialNumbers: many(serialNumbers),
}));

// ── Product Bundles (BOM components) ─────────────────────────────────────────

export const productBundles = pgTable(
  'product_bundles',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    bundleProductId: uuid('bundle_product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    componentProductId: uuid('component_product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
  },
  (t) => [
    uniqueIndex('product_bundles_pair_idx').on(t.bundleProductId, t.componentProductId),
  ],
);

export const productBundlesRelations = relations(productBundles, ({ one }) => ({
  bundleProduct: one(products, {
    fields: [productBundles.bundleProductId],
    references: [products.id],
    relationName: 'bundleParent',
  }),
  componentProduct: one(products, {
    fields: [productBundles.componentProductId],
    references: [products.id],
    relationName: 'bundleComponent',
  }),
}));

// ── Stock Balances (Per Location Snapshot) ───────────────────────────────────

export const stockBalances = pgTable(
  'stock_balances',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    onHand: numeric('on_hand', { precision: 14, scale: 3 }).notNull().default('0'),
    reserved: numeric('reserved', { precision: 14, scale: 3 }).notNull().default('0'),
    available: numeric('available', { precision: 14, scale: 3 }).generatedAlwaysAs(
      sql`on_hand - reserved`,
    ),
    lastCountedAt: timestamp('last_counted_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('stock_balances_product_location_idx').on(t.productId, t.locationId),
    check('stock_balances_reserved_non_negative', sql`reserved >= 0`),
    check('stock_balances_reserved_lte_on_hand', sql`reserved <= on_hand`),
  ],
);

export const stockBalancesRelations = relations(stockBalances, ({ one }) => ({
  product: one(products, { fields: [stockBalances.productId], references: [products.id] }),
  location: one(locations, { fields: [stockBalances.locationId], references: [locations.id] }),
}));

// ── Stock Movements (Immutable Ledger) ───────────────────────────────────────

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    /**
     * 'opening' | 'purchase_receipt' | 'sale_delivery' | 'customer_return' |
     * 'supplier_return' | 'adjustment' | 'count_variance' | 'transfer_in' | 'transfer_out'
     */
    movementType: text('movement_type').notNull(),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    unitCostMinor: bigint('unit_cost_minor', { mode: 'number' }).notNull().default(0),
    totalCostMinor: bigint('total_cost_minor', { mode: 'number' }).notNull().default(0),
    /** 'goods_receipt' | 'stock_adjustment' | 'stock_count' | 'opening_stock' */
    referenceType: text('reference_type').notNull(),
    referenceId: uuid('reference_id'),
    notes: text('notes'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    // Phase 6: compound index includes seq for deterministic ledger replay order
    index('stock_movements_prod_loc_occ_seq_idx').on(t.productId, t.locationId, t.occurredAt, t.seq),
    index('stock_movements_ref_idx').on(t.referenceType, t.referenceId),
    index('stock_movements_seq_idx').on(t.seq),
  ],
);

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  product: one(products, { fields: [stockMovements.productId], references: [products.id] }),
  location: one(locations, { fields: [stockMovements.locationId], references: [locations.id] }),
  user: one(users, { fields: [stockMovements.createdBy], references: [users.id] }),
}));

// ── Serial Numbers ───────────────────────────────────────────────────────────

export const serialNumbers = pgTable(
  'serial_numbers',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    serialNumber: text('serial_number').notNull(),
    /** 'in_stock' | 'reserved' | 'sold' | 'returned' | 'written_off' | 'adjusted_out' */
    status: text('status').notNull().default('in_stock'),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }),
    goodsReceiptItemId: uuid('goods_receipt_item_id'),
    lastMovementId: uuid('last_movement_id').references(() => stockMovements.id, {
      onDelete: 'set null',
    }),
    warrantyStart: date('warranty_start'),
    warrantyEnd: date('warranty_end'),
    /** Customer who purchased this serial item */
    customerId: uuid('customer_id').references((): AnyPgColumn => customers.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('serial_numbers_prod_lower_idx').on(t.productId, sql`lower(${t.serialNumber})`),
    index('serial_numbers_status_idx').on(t.status),
    index('serial_numbers_location_idx').on(t.locationId),
    index('serial_numbers_customer_idx').on(t.customerId),
  ],
);

export const serialNumbersRelations = relations(serialNumbers, ({ one }) => ({
  product: one(products, { fields: [serialNumbers.productId], references: [products.id] }),
  location: one(locations, { fields: [serialNumbers.locationId], references: [locations.id] }),
  customer: one(customers, { fields: [serialNumbers.customerId], references: [customers.id] }),
}));

// ── Suppliers ────────────────────────────────────────────────────────────────

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  contactName: text('contact_name'),
  email: citext('email'),
  phone: text('phone'),
  address: text('address'),
  taxNumber: text('tax_number'),
  defaultCurrency: char('default_currency', { length: 3 }).notNull().default('MWK'),
  paymentTermsDays: integer('payment_terms_days').notNull().default(30),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
});

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  purchaseOrders: many(purchaseOrders),
  goodsReceipts: many(goodsReceipts),
}));

// ── Purchase Orders & Items ──────────────────────────────────────────────────

export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    poNumber: text('po_number').notNull().unique(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    /** 'draft' | 'submitted' | 'partially_received' | 'received' | 'cancelled' */
    status: text('status').notNull().default('draft'),
    orderDate: date('order_date').notNull(),
    expectedDeliveryDate: date('expected_delivery_date'),
    currency: char('currency', { length: 3 }).notNull().default('MWK'),
    exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6 }).notNull().default('1.000000'),
    /** Total in MWK tambala */
    totalMinor: bigint('total_minor', { mode: 'number' }).notNull().default(0),
    /** Total in supplier currency */
    totalSupplierCurrency: numeric('total_supplier_currency', { precision: 18, scale: 4 })
      .notNull()
      .default('0'),
    notes: text('notes'),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('purchase_orders_supplier_idx').on(t.supplierId),
    index('purchase_orders_status_idx').on(t.status),
  ],
);

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [purchaseOrders.supplierId], references: [suppliers.id] }),
  location: one(locations, { fields: [purchaseOrders.locationId], references: [locations.id] }),
  items: many(purchaseOrderItems),
  goodsReceipts: many(goodsReceipts),
}));

export const purchaseOrderItems = pgTable('purchase_order_items', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  purchaseOrderId: uuid('purchase_order_id')
    .notNull()
    .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'restrict' }),
  orderedQty: numeric('ordered_qty', { precision: 14, scale: 3 }).notNull(),
  receivedQty: numeric('received_qty', { precision: 14, scale: 3 }).notNull().default('0'),
  unitCostSupplier: numeric('unit_cost_supplier', { precision: 18, scale: 4 }).notNull(),
  lineTotalSupplier: numeric('line_total_supplier', { precision: 18, scale: 4 }).notNull(),
  unitCostMwkMinor: bigint('unit_cost_mwk_minor', { mode: 'number' }).notNull(),
});

export const purchaseOrderItemsRelations = relations(purchaseOrderItems, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [purchaseOrderItems.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  product: one(products, { fields: [purchaseOrderItems.productId], references: [products.id] }),
}));

// ── Goods Receipts, Items & Landed Costs ────────────────────────────────────

export const goodsReceipts = pgTable(
  'goods_receipts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    grnNumber: text('grn_number').notNull().unique(),
    purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id, {
      onDelete: 'set null',
    }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    /** 'completed' | 'void' */
    status: text('status').notNull().default('completed'),
    supplierInvoiceNumber: text('supplier_invoice_number'),
    receivedDate: date('received_date').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('MWK'),
    exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6 }).notNull().default('1.000000'),
    totalItemsMwkMinor: bigint('total_items_mwk_minor', { mode: 'number' }).notNull().default(0),
    totalLandedMwkMinor: bigint('total_landed_mwk_minor', { mode: 'number' }).notNull().default(0),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('goods_receipts_po_idx').on(t.purchaseOrderId),
    index('goods_receipts_supplier_idx').on(t.supplierId),
  ],
);

export const goodsReceiptsRelations = relations(goodsReceipts, ({ one, many }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [goodsReceipts.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  supplier: one(suppliers, { fields: [goodsReceipts.supplierId], references: [suppliers.id] }),
  location: one(locations, { fields: [goodsReceipts.locationId], references: [locations.id] }),
  items: many(goodsReceiptItems),
  landedCosts: many(landedCosts),
}));

export const landedCosts = pgTable('landed_costs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  goodsReceiptId: uuid('goods_receipt_id')
    .notNull()
    .references(() => goodsReceipts.id, { onDelete: 'cascade' }),
  /** 'freight' | 'duty' | 'clearing' | 'other' */
  costType: text('cost_type').notNull(),
  amount: numeric('amount', { precision: 18, scale: 4 }).notNull(),
  currency: char('currency', { length: 3 }).notNull().default('MWK'),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6 }).notNull().default('1.000000'),
  amountMwkMinor: bigint('amount_mwk_minor', { mode: 'number' }).notNull(),
});

export const landedCostsRelations = relations(landedCosts, ({ one }) => ({
  goodsReceipt: one(goodsReceipts, {
    fields: [landedCosts.goodsReceiptId],
    references: [goodsReceipts.id],
  }),
}));

export const goodsReceiptItems = pgTable('goods_receipt_items', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  goodsReceiptId: uuid('goods_receipt_id')
    .notNull()
    .references(() => goodsReceipts.id, { onDelete: 'cascade' }),
  poItemId: uuid('po_item_id').references(() => purchaseOrderItems.id, { onDelete: 'set null' }),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'restrict' }),
  receivedQty: numeric('received_qty', { precision: 14, scale: 3 }).notNull(),
  unitCostSupplier: numeric('unit_cost_supplier', { precision: 18, scale: 4 }).notNull(),
  unitCostMwkMinor: bigint('unit_cost_mwk_minor', { mode: 'number' }).notNull(),
  landedCostShareMinor: bigint('landed_cost_share_minor', { mode: 'number' }).notNull().default(0),
  landedUnitCostMinor: bigint('landed_unit_cost_minor', { mode: 'number' }).notNull(),
  lineTotalMwkMinor: bigint('line_total_mwk_minor', { mode: 'number' }).notNull(),
});

export const goodsReceiptItemsRelations = relations(goodsReceiptItems, ({ one }) => ({
  goodsReceipt: one(goodsReceipts, {
    fields: [goodsReceiptItems.goodsReceiptId],
    references: [goodsReceipts.id],
  }),
  product: one(products, { fields: [goodsReceiptItems.productId], references: [products.id] }),
  poItem: one(purchaseOrderItems, {
    fields: [goodsReceiptItems.poItemId],
    references: [purchaseOrderItems.id],
  }),
}));

// ── Stock Adjustments ────────────────────────────────────────────────────────

export const stockAdjustments = pgTable('stock_adjustments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  adjNumber: text('adj_number').notNull().unique(),
  locationId: uuid('location_id')
    .notNull()
    .references(() => locations.id, { onDelete: 'restrict' }),
  /** 'in' | 'out' */
  type: text('type').notNull(),
  /** 'damaged' | 'expired' | 'internal_use' | 'found' | 'correction' */
  reason: text('reason').notNull(),
  /** 'completed' | 'void' */
  status: text('status').notNull().default('completed'),
  notes: text('notes'),
  approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
});

export const stockAdjustmentsRelations = relations(stockAdjustments, ({ one, many }) => ({
  location: one(locations, { fields: [stockAdjustments.locationId], references: [locations.id] }),
  items: many(stockAdjustmentItems),
  approvedByUser: one(users, { fields: [stockAdjustments.approvedBy], references: [users.id] }),
  createdByUser: one(users, { fields: [stockAdjustments.createdBy], references: [users.id] }),
}));

export const stockAdjustmentItems = pgTable('stock_adjustment_items', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  adjustmentId: uuid('adjustment_id')
    .notNull()
    .references(() => stockAdjustments.id, { onDelete: 'cascade' }),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'restrict' }),
  quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
  unitCostMinor: bigint('unit_cost_minor', { mode: 'number' }).notNull(),
  totalCostMinor: bigint('total_cost_minor', { mode: 'number' }).notNull(),
  serialNumbers: text('serial_numbers').array(),
});

export const stockAdjustmentItemsRelations = relations(stockAdjustmentItems, ({ one }) => ({
  adjustment: one(stockAdjustments, {
    fields: [stockAdjustmentItems.adjustmentId],
    references: [stockAdjustments.id],
  }),
  product: one(products, { fields: [stockAdjustmentItems.productId], references: [products.id] }),
}));

// ── Stock Counts (Physical Stocktaking) ──────────────────────────────────────

export const stockCounts = pgTable('stock_counts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  countNumber: text('count_number').notNull().unique(),
  locationId: uuid('location_id')
    .notNull()
    .references(() => locations.id, { onDelete: 'restrict' }),
  /** 'in_progress' | 'reconciled' | 'cancelled' */
  status: text('status').notNull().default('in_progress'),
  countedAt: timestamp('counted_at', { withTimezone: true }).notNull().defaultNow(),
  reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
  reconciledBy: uuid('reconciled_by').references(() => users.id, { onDelete: 'set null' }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
});

export const stockCountsRelations = relations(stockCounts, ({ one, many }) => ({
  location: one(locations, { fields: [stockCounts.locationId], references: [locations.id] }),
  items: many(stockCountItems),
  reconciledByUser: one(users, { fields: [stockCounts.reconciledBy], references: [users.id] }),
  createdByUser: one(users, { fields: [stockCounts.createdBy], references: [users.id] }),
}));

export const stockCountItems = pgTable('stock_count_items', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  countId: uuid('count_id')
    .notNull()
    .references(() => stockCounts.id, { onDelete: 'cascade' }),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'restrict' }),
  systemQty: numeric('system_qty', { precision: 14, scale: 3 }).notNull(),
  countedQty: numeric('counted_qty', { precision: 14, scale: 3 }).notNull(),
  varianceQty: numeric('variance_qty', { precision: 14, scale: 3 }).notNull(),
  unitCostMinor: bigint('unit_cost_minor', { mode: 'number' }).notNull(),
  varianceValueMinor: bigint('variance_value_minor', { mode: 'number' }).notNull(),
  missingSerialIds: uuid('missing_serial_ids').array(),
});

export const stockCountItemsRelations = relations(stockCountItems, ({ one }) => ({
  count: one(stockCounts, { fields: [stockCountItems.countId], references: [stockCounts.id] }),
  product: one(products, { fields: [stockCountItems.productId], references: [products.id] }),
}));
