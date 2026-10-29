/**
 * All permission tokens used throughout the application.
 * Permissions are stored as text[] on each role row and checked
 * server-side via authorize() on every sensitive action.
 */
export const PERMISSIONS = {
  // ── Admin / setup ────────────────────────────────────────────────────
  USERS_VIEW: 'users:view',
  USERS_MANAGE: 'users:manage',
  ROLES_VIEW: 'roles:view',
  ROLES_MANAGE: 'roles:manage',
  SETTINGS_VIEW: 'settings:view',
  SETTINGS_MANAGE: 'settings:manage',
  AUDIT_LOG_VIEW: 'audit_log:view',
  LOCATIONS_MANAGE: 'locations:manage',

  // ── Sales ─────────────────────────────────────────────────────────────
  CUSTOMERS_VIEW: 'customers:view',
  CUSTOMERS_MANAGE: 'customers:manage',
  QUOTATIONS_VIEW: 'quotations:view',
  QUOTATIONS_MANAGE: 'quotations:manage',
  INVOICES_VIEW: 'invoices:view',
  INVOICES_MANAGE: 'invoices:manage',
  INVOICES_VOID: 'invoices:void',
  DELIVERY_NOTES_MANAGE: 'delivery_notes:manage',
  CREDIT_NOTES_MANAGE: 'credit_notes:manage',

  // ── Stock ─────────────────────────────────────────────────────────────
  PRODUCTS_VIEW: 'products:view',
  PRODUCTS_MANAGE: 'products:manage',
  STOCK_VIEW: 'stock:view',
  STOCK_ADJUST: 'stock:adjust',
  STOCK_COUNT: 'stock:count',
  SERIALS_VIEW: 'serials:view',

  // ── Purchasing ────────────────────────────────────────────────────────
  SUPPLIERS_VIEW: 'suppliers:view',
  SUPPLIERS_MANAGE: 'suppliers:manage',
  PURCHASE_ORDERS_VIEW: 'purchase_orders:view',
  PURCHASE_ORDERS_MANAGE: 'purchase_orders:manage',
  GOODS_RECEIPTS_MANAGE: 'goods_receipts:manage',

  // ── Payments ──────────────────────────────────────────────────────────
  PAYMENTS_VIEW: 'payments:view',
  PAYMENTS_RECORD: 'payments:record',
  PAYMENTS_REFUND: 'payments:refund',
  PAYMENTS_RECONCILE: 'payments:reconcile',
  PAYMENTS_REVERSE: 'payments:reverse',
  PAYMENTS_CHEQUE_CLEAR: 'payments:cheque_clear',

  // ── POS / shifts ──────────────────────────────────────────────────────
  POS_ACCESS: 'pos:access',
  SHIFTS_MANAGE: 'shifts:manage',
  POS_OVERRIDE: 'pos:override',
  POS_REPRINT_ANY: 'pos:reprint_any',

  // ── Reports ───────────────────────────────────────────────────────────
  REPORTS_VIEW: 'reports:view',

  // ── Approval gates ────────────────────────────────────────────────────
  DISCOUNTS_APPROVE: 'discounts:approve',
  REFUNDS_APPROVE: 'refunds:approve',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// ── Role permission sets ──────────────────────────────────────────────────

const ALL = Object.values(PERMISSIONS) as Permission[];

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  admin: ALL,

  manager: [
    PERMISSIONS.USERS_VIEW,
    PERMISSIONS.ROLES_VIEW,
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.AUDIT_LOG_VIEW,
    // Sales
    PERMISSIONS.CUSTOMERS_VIEW, PERMISSIONS.CUSTOMERS_MANAGE,
    PERMISSIONS.QUOTATIONS_VIEW, PERMISSIONS.QUOTATIONS_MANAGE,
    PERMISSIONS.INVOICES_VIEW, PERMISSIONS.INVOICES_MANAGE, PERMISSIONS.INVOICES_VOID,
    PERMISSIONS.DELIVERY_NOTES_MANAGE,
    PERMISSIONS.CREDIT_NOTES_MANAGE,
    // Stock
    PERMISSIONS.PRODUCTS_VIEW, PERMISSIONS.PRODUCTS_MANAGE,
    PERMISSIONS.STOCK_VIEW, PERMISSIONS.STOCK_ADJUST, PERMISSIONS.STOCK_COUNT,
    PERMISSIONS.SERIALS_VIEW,
    // Purchasing
    PERMISSIONS.SUPPLIERS_VIEW, PERMISSIONS.SUPPLIERS_MANAGE,
    PERMISSIONS.PURCHASE_ORDERS_VIEW, PERMISSIONS.PURCHASE_ORDERS_MANAGE,
    PERMISSIONS.GOODS_RECEIPTS_MANAGE,
    // Payments
    PERMISSIONS.PAYMENTS_VIEW, PERMISSIONS.PAYMENTS_RECORD,
    PERMISSIONS.PAYMENTS_REFUND, PERMISSIONS.PAYMENTS_RECONCILE,
    PERMISSIONS.PAYMENTS_REVERSE, PERMISSIONS.PAYMENTS_CHEQUE_CLEAR,
    // POS
    PERMISSIONS.POS_ACCESS, PERMISSIONS.SHIFTS_MANAGE,
    PERMISSIONS.POS_OVERRIDE, PERMISSIONS.POS_REPRINT_ANY,
    // Reports + approvals
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.DISCOUNTS_APPROVE, PERMISSIONS.REFUNDS_APPROVE,
  ],

  sales: [
    PERMISSIONS.CUSTOMERS_VIEW, PERMISSIONS.CUSTOMERS_MANAGE,
    PERMISSIONS.QUOTATIONS_VIEW, PERMISSIONS.QUOTATIONS_MANAGE,
    PERMISSIONS.INVOICES_VIEW, PERMISSIONS.INVOICES_MANAGE,
    PERMISSIONS.DELIVERY_NOTES_MANAGE,
    PERMISSIONS.PAYMENTS_VIEW, PERMISSIONS.PAYMENTS_RECORD,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.REPORTS_VIEW,
  ],

  storekeeper: [
    PERMISSIONS.PRODUCTS_VIEW, PERMISSIONS.PRODUCTS_MANAGE,
    PERMISSIONS.STOCK_VIEW, PERMISSIONS.STOCK_ADJUST, PERMISSIONS.STOCK_COUNT,
    PERMISSIONS.SERIALS_VIEW,
    PERMISSIONS.SUPPLIERS_VIEW, PERMISSIONS.SUPPLIERS_MANAGE,
    PERMISSIONS.PURCHASE_ORDERS_VIEW, PERMISSIONS.PURCHASE_ORDERS_MANAGE,
    PERMISSIONS.GOODS_RECEIPTS_MANAGE,
    PERMISSIONS.REPORTS_VIEW,
  ],

  cashier: [
    PERMISSIONS.POS_ACCESS,
    PERMISSIONS.SHIFTS_MANAGE,
    PERMISSIONS.PAYMENTS_RECORD,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.CUSTOMERS_VIEW,
    PERMISSIONS.STOCK_VIEW,
  ],

  viewer: [
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.SERIALS_VIEW,
    PERMISSIONS.CUSTOMERS_VIEW,
    PERMISSIONS.INVOICES_VIEW,
    PERMISSIONS.QUOTATIONS_VIEW,
    PERMISSIONS.PAYMENTS_VIEW,
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.SUPPLIERS_VIEW,
    PERMISSIONS.PURCHASE_ORDERS_VIEW,
  ],
};
