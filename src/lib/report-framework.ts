/**
 * Unified Report Framework for Phase 6.
 *
 * Every report in the system is defined as a ReportDefinition, which provides:
 *   - filterSchema (zod) — validated URL search params
 *   - runQuery       — SQL-aggregated query returning rows + totals + count
 *   - columns        — column definitions with optional cost flag
 *   - exportCsv      — streaming CSV (UTF-8 BOM, formula injection safe)
 *   - renderPdf      — React-PDF; capped at PDF_ROW_LIMIT with banner warning
 *
 * Server-side cost/margin stripping: columns marked `costColumn: true` are
 * removed from rows and totals before serialisation when the calling user
 * lacks PERMISSIONS.REPORTS_COST. This happens inside stripCostColumns().
 *
 * Timezone: Africa/Blantyre (UTC+2). Date boundaries use >= start AND < nextDayStart.
 * No AT TIME ZONE conversions in WHERE clauses — only in GROUP BY expressions.
 *
 * Report permission matrix (default deny):
 *   profit, vat           → manager, admin
 *   purchasing            → storekeeper, manager, admin
 *   sales, pipeline, warranty, receivables → sales, manager, admin
 *   stock                 → storekeeper, viewer, manager, admin
 *   controls              → manager, admin
 */

import type { z } from 'zod';
import type { Permission } from '@/lib/permissions';
import { PERMISSIONS } from '@/lib/permissions';

// ── PDF row limit ──────────────────────────────────────────────────────────────
export const PDF_ROW_LIMIT = 2000;
export const PDF_ROW_LIMIT_MESSAGE =
  'PDF reports are limited to 2,000 rows for rendering stability. ' +
  'Please use CSV export to download the complete dataset.';

// ── Formula injection characters (CSV) ────────────────────────────────────────
const FORMULA_CHARS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Escapes a CSV cell value to prevent formula injection in Excel/Sheets.
 * Cells whose string values begin with = + - @ tab or carriage-return are
 * prefixed with a single quote.
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (FORMULA_CHARS.some((c) => s.startsWith(c))) return `'${s}`;
  // Wrap in quotes if it contains comma, newline, or double-quote
  if (s.includes(',') || s.includes('\n') || s.includes('"')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Builds a UTF-8 BOM CSV string from column headers and row data.
 * @param headers - Array of column headers
 * @param rows    - Array of row objects (values in same order as headers)
 * @param getCell - Function mapping (row, headerIndex) → cell value
 */
export function buildCsv<TRow>(
  headers: string[],
  rows: TRow[],
  getCell: (row: TRow, i: number) => unknown,
): string {
  const BOM = '\uFEFF';
  const lines: string[] = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((_, i) => escapeCsvCell(getCell(row, i))).join(','));
  }
  return BOM + lines.join('\r\n');
}

// ── Column definition ─────────────────────────────────────────────────────────

export interface ReportColumnDef<TRow> {
  key: string;
  header: string;
  /**
   * If true this column contains cost/margin/profit and is removed server-side
   * for users lacking PERMISSIONS.REPORTS_COST.
   */
  costColumn?: boolean;
  render: (row: TRow) => unknown;
}

// ── Session user stub (enough for permission check) ───────────────────────────

export interface ReportUser {
  id: string;
  name: string;
  permissions: string[];
}

export function hasCostAccess(user: ReportUser): boolean {
  return user.permissions.includes(PERMISSIONS.REPORTS_COST);
}

// ── Report filter base (fields shared by all reports) ─────────────────────────

export interface ReportFilterBase {
  from?: string;       // YYYY-MM-DD
  to?: string;         // YYYY-MM-DD
  asOf?: string;       // YYYY-MM-DD (for point-in-time reports)
  locationId?: string; // optional location filter
  page?: number;
  pageSize?: number;
}

// ── Core report result wrapper ─────────────────────────────────────────────────

export interface ReportResult<TRow, TTotals> {
  rows: TRow[];
  totals: TTotals;
  totalCount: number;
  /** Africa/Blantyre ISO timestamp of when the query was executed */
  generatedAt: string;
  /** Display name of the generating user */
  generatedBy: string;
  /** Applied filter summary for the report header */
  filterSummary: ReportFilterSummary;
  /** True if result was truncated by page limit */
  hasMore?: boolean;
}

export interface ReportFilterSummary {
  period?: string;    // e.g. "01 Jan 2026 – 31 Jan 2026"
  asOf?: string;      // e.g. "31 Jan 2026"
  location?: string;  // e.g. "Main Branch" or "All Locations"
  extra?: Record<string, string>;
}

// ── Unified ReportDefinition ───────────────────────────────────────────────────

export interface ReportDefinition<
  TFilter extends ReportFilterBase,
  TRow extends Record<string, unknown>,
  TTotals extends Record<string, unknown>,
> {
  /** Unique report slug, e.g. 'sales-by-item' */
  id: string;
  title: string;
  description: string;
  category:
    | 'sales'
    | 'profit'
    | 'stock'
    | 'purchasing'
    | 'receivables'
    | 'vat'
    | 'warranty'
    | 'payments'
    | 'controls'
    | 'pipeline';
  /** Minimum permission needed to access this report */
  requiredPermission: Permission;
  /** Additional permissions that must ALL be present (AND logic) */
  requiredPermissions?: Permission[];
  filterSchema: z.ZodType<TFilter>;
  runQuery: (
    params: TFilter,
    user: ReportUser,
  ) => Promise<{ rows: TRow[]; totals: TTotals; totalCount: number }>;
  columns: ReportColumnDef<TRow>[];
  /** Build CSV body rows (without header); cells already escape-safe */
  csvRowMapper: (row: TRow, user: ReportUser) => unknown[];
  csvHeaders: (user: ReportUser) => string[];
}

// ── Server-side cost column stripping ─────────────────────────────────────────

/**
 * Strips cost/margin/profit columns from rows when the user lacks REPORTS_COST.
 * Keys matching columns with costColumn=true are deleted in-place.
 * This must be called BEFORE serialising rows to JSON for the HTTP response.
 */
export function stripCostColumns<TRow extends Record<string, unknown>>(
  rows: TRow[],
  columns: ReportColumnDef<TRow>[],
  user: ReportUser,
): TRow[] {
  if (hasCostAccess(user)) return rows;
  const costKeys = columns.filter((c) => c.costColumn).map((c) => c.key);
  if (costKeys.length === 0) return rows;
  return rows.map((row) => {
    const stripped = { ...row };
    for (const key of costKeys) delete stripped[key];
    return stripped;
  });
}

/**
 * Strips cost keys from a totals object.
 */
export function stripCostTotals<TTotals extends Record<string, unknown>>(
  totals: TTotals,
  columns: ReportColumnDef<Record<string, unknown>>[],
  user: ReportUser,
): TTotals {
  if (hasCostAccess(user)) return totals;
  const costKeys = columns.filter((c) => c.costColumn).map((c) => c.key);
  if (costKeys.length === 0) return totals;
  const stripped = { ...totals };
  for (const key of costKeys) delete stripped[key];
  return stripped;
}

// ── Report catalogue registry ─────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry: Map<string, ReportDefinition<any, any, any>> = new Map();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerReport(def: ReportDefinition<any, any, any>): void {
  registry.set(def.id, def);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getReport(id: string): ReportDefinition<any, any, any> | undefined {
  return registry.get(id);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function allReports(): ReportDefinition<any, any, any>[] {
  return [...registry.values()];
}

/**
 * Returns the subset of reports the given user has access to.
 * Checks requiredPermission and all requiredPermissions (AND).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function reportsForUser(user: ReportUser): ReportDefinition<any, any, any>[] {
  return allReports().filter((def) => {
    if (!user.permissions.includes(def.requiredPermission)) return false;
    if (def.requiredPermissions) {
      return def.requiredPermissions.every((p) => user.permissions.includes(p));
    }
    return true;
  });
}

