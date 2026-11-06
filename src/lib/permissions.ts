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
  AUDIT_LOG_VIEW: 'audit_log:view',           // Manager: business events at own locations
  AUDIT_LOG_VIEW_ALL: 'audit_log:view_all',   // Admin only: includes security events
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
  PAYMENTS_EXCEPTIONS: 'payments:exceptions',    // Exceptions tab in Payments Hub
  STATEMENTS_MATCH: 'statements:match',          // Required with payments:record to record from statement line
  PAYMENT_LINKS_MANAGE: 'payment_links:manage',  // Payment links tab in Payments Hub

  // ── POS / shifts ──────────────────────────────────────────────────────
  POS_ACCESS: 'pos:access',
  SHIFTS_MANAGE: 'shifts:manage',
  POS_OVERRIDE: 'pos:override',
  POS_REPRINT_ANY: 'pos:reprint_any',

  // ── Reports ───────────────────────────────────────────────────────────
  REPORTS_VIEW: 'reports:view',
  REPORTS_COST: 'reports:cost', // Cost, margin, profit columns — manager and admin only

  // ── Accounting export ─────────────────────────────────────────────────
  ACCOUNTING_VIEW: 'accounting:view',
  ACCOUNTING_EXPORT: 'accounting:export',
  ACCOUNTING_REEXPORT: 'accounting:reexport', // Manager override for second export
  EIS_MANAGE: 'eis:manage',

  // ── System checks ─────────────────────────────────────────────────────
  SYSTEM_CHECKS_RUN: 'system_checks:run',

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
    PERMISSIONS.PAYMENTS_EXCEPTIONS,
    PERMISSIONS.STATEMENTS_MATCH,
    PERMISSIONS.PAYMENT_LINKS_MANAGE,
    // POS
    PERMISSIONS.POS_ACCESS, PERMISSIONS.SHIFTS_MANAGE,
    PERMISSIONS.POS_OVERRIDE, PERMISSIONS.POS_REPRINT_ANY,
    // Reports (manager sees cost)
    PERMISSIONS.REPORTS_VIEW, PERMISSIONS.REPORTS_COST,
    // Accounting
    PERMISSIONS.ACCOUNTING_VIEW, PERMISSIONS.ACCOUNTING_EXPORT, PERMISSIONS.ACCOUNTING_REEXPORT,
    PERMISSIONS.EIS_MANAGE,
    // System checks
    PERMISSIONS.SYSTEM_CHECKS_RUN,
    // Approvals
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
    // No REPORTS_COST — cost columns stripped server-side
  ],

  storekeeper: [
    PERMISSIONS.PRODUCTS_VIEW, PERMISSIONS.PRODUCTS_MANAGE,
    PERMISSIONS.STOCK_VIEW, PERMISSIONS.STOCK_ADJUST, PERMISSIONS.STOCK_COUNT,
    PERMISSIONS.SERIALS_VIEW,
    PERMISSIONS.SUPPLIERS_VIEW, PERMISSIONS.SUPPLIERS_MANAGE,
    PERMISSIONS.PURCHASE_ORDERS_VIEW, PERMISSIONS.PURCHASE_ORDERS_MANAGE,
    PERMISSIONS.GOODS_RECEIPTS_MANAGE,
    PERMISSIONS.REPORTS_VIEW,
    // No REPORTS_COST — cost columns stripped server-side
  ],

  cashier: [
    PERMISSIONS.POS_ACCESS,
    PERMISSIONS.SHIFTS_MANAGE,
    PERMISSIONS.PAYMENTS_RECORD,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.CUSTOMERS_VIEW,
    PERMISSIONS.STOCK_VIEW,
    // No dashboard sales targets, no cash figure visibility (blind cash-up)
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
    // No REPORTS_COST — viewer never sees cost/margin
  ],
};
