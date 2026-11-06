/**
 * CSV Import Services for Products and Opening Stock.
 *
 * Implements:
 *   - All-or-nothing transactional commits.
 *   - Dry-run validation and preview with line-by-line error collection.
 *   - Prevention of duplicate opening stock for the same product and location.
 *   - Serial number capture and duplicate validation for serial-tracked items.
 */

import Papa from 'papaparse';
import { db } from '@/server/db';
import {
  products,
  categories,
  unitsOfMeasure,
  locations,
  stockMovements,
  serialNumbers,
  taxRates,
} from '@/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { parseKwachaToMinor } from '@/lib/money';
import { toDecimalQty } from '@/lib/stock-math';
import { executeStockMovements } from '@/server/services/stock/stock-engine';
import Decimal from 'decimal.js';

// ── Products CSV Import ──────────────────────────────────────────────────────

export interface ProductCsvRow {
  name: string;
  sku: string;
  barcode?: string;
  description?: string;
  category_code?: string;
  uom_code: string;
  product_type?: string;
  selling_price_mwk: string;
  min_stock_alert?: string;
  max_stock?: string;
  serial_tracking?: string;
  warranty_months?: string;
}

export interface ProductValidationRow {
  rowNumber: number;
  data: ProductCsvRow;
  isValid: boolean;
  errors: string[];
}

export async function previewProductsCsv(csvContent: string): Promise<{
  rows: ProductValidationRow[];
  totalRows: number;
  validCount: number;
  errorCount: number;
}> {
  const parsed = Papa.parse<ProductCsvRow>(csvContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  });

  const existingCategories = await db.query.categories.findMany();
  const catMap = new Map(existingCategories.map((c) => [c.code.toUpperCase(), c.id]));

  const existingUoms = await db.query.unitsOfMeasure.findMany();
  const uomMap = new Map(existingUoms.map((u) => [u.code.toUpperCase(), u.id]));

  const existingProducts = await db.query.products.findMany({
    columns: { sku: true, barcode: true },
  });
  const dbSkus = new Set(existingProducts.map((p) => p.sku.toUpperCase()));
  const dbBarcodes = new Set(
    existingProducts.filter((p) => p.barcode).map((p) => p.barcode!.toUpperCase()),
  );

  const seenCsvSkus = new Set<string>();
  const seenCsvBarcodes = new Set<string>();

  const results: ProductValidationRow[] = [];
  let validCount = 0;
  let errorCount = 0;

  for (let i = 0; i < parsed.data.length; i++) {
    const raw = parsed.data[i]!;
    const rowNum = i + 2; // header is row 1
    const errors: string[] = [];

    const name = raw.name?.trim();
    if (!name) errors.push('Product name is required.');

    const sku = raw.sku?.trim().toUpperCase();
    if (!sku) {
      errors.push('SKU is required.');
    } else {
      if (seenCsvSkus.has(sku)) {
        errors.push(`Duplicate SKU "${sku}" within the CSV file.`);
      } else if (dbSkus.has(sku)) {
        errors.push(`SKU "${sku}" already exists in the database.`);
      }
      seenCsvSkus.add(sku);
    }

    const barcode = raw.barcode?.trim();
    if (barcode) {
      const bUpper = barcode.toUpperCase();
      if (seenCsvBarcodes.has(bUpper)) {
        errors.push(`Duplicate barcode "${barcode}" within the CSV file.`);
      } else if (dbBarcodes.has(bUpper)) {
        errors.push(`Barcode "${barcode}" already exists in the database.`);
      }
      seenCsvBarcodes.add(bUpper);
    }

    const uomCode = raw.uom_code?.trim().toUpperCase();
    if (!uomCode) {
      errors.push('UOM code is required.');
    } else if (!uomMap.has(uomCode)) {
      errors.push(`UOM code "${uomCode}" does not exist.`);
    }

    const catCode = raw.category_code?.trim().toUpperCase();
    if (catCode && !catMap.has(catCode)) {
      errors.push(`Category code "${catCode}" does not exist.`);
    }

    const pType = (raw.product_type?.trim().toLowerCase() || 'standard') as string;
    if (!['standard', 'bundle', 'service'].includes(pType)) {
      errors.push(`Invalid product_type "${pType}". Allowed: standard, bundle, service.`);
    }

    try {
      if (raw.selling_price_mwk !== undefined && raw.selling_price_mwk !== '') {
        parseKwachaToMinor(raw.selling_price_mwk);
      }
    } catch {
      errors.push(`Invalid selling price: "${raw.selling_price_mwk}".`);
    }

    const isValid = errors.length === 0;
    if (isValid) validCount++;
    else errorCount++;

    results.push({
      rowNumber: rowNum,
      data: raw,
      isValid,
      errors,
    });
  }

  return {
    rows: results,
    totalRows: parsed.data.length,
    validCount,
    errorCount,
  };
}

export async function commitProductsCsv(csvContent: string, actorId?: string) {
  const preview = await previewProductsCsv(csvContent);
  if (preview.errorCount > 0) {
    throw new Error(
      `Cannot import products: found ${preview.errorCount} row(s) with validation errors. All rows must be valid.`,
    );
  }

  const existingCategories = await db.query.categories.findMany();
  const catMap = new Map(existingCategories.map((c) => [c.code.toUpperCase(), c.id]));

  const existingUoms = await db.query.unitsOfMeasure.findMany();
  const uomMap = new Map(existingUoms.map((u) => [u.code.toUpperCase(), u.id]));

  const [defaultTaxRate] = await db
    .select({ id: taxRates.id })
    .from(taxRates)
    .where(and(eq(taxRates.isDefault, true), eq(taxRates.isActive, true)))
    .limit(1);
  const defaultTaxRateId = defaultTaxRate?.id ?? null;

  return await db.transaction(async (tx) => {
    let imported = 0;
    for (const r of preview.rows) {
      const d = r.data;
      const catId = d.category_code ? catMap.get(d.category_code.trim().toUpperCase()) : null;
      const uomId = uomMap.get(d.uom_code.trim().toUpperCase())!;
      const sellingPriceMinor = d.selling_price_mwk ? parseKwachaToMinor(d.selling_price_mwk) : 0;
      const pType = d.product_type?.trim().toLowerCase() || 'standard';
      const serialTracking =
        pType === 'service' ? false : d.serial_tracking?.trim().toLowerCase() === 'true';
      const warrantyMonths = d.warranty_months ? parseInt(d.warranty_months, 10) || 0 : 0;

      await tx.insert(products).values({
        name: d.name.trim(),
        sku: d.sku.trim().toUpperCase(),
        barcode: d.barcode?.trim() || null,
        description: d.description?.trim() || null,
        categoryId: catId || null,
        uomId,
        taxRateId: defaultTaxRateId,
        productType: pType,
        sellingPriceMinor,
        minStockAlert: d.min_stock_alert ? String(d.min_stock_alert) : '0',
        maxStock: d.max_stock ? String(d.max_stock) : null,
        serialTracking,
        warrantyMonths,
        isActive: true,
        createdBy: actorId ?? null,
      });

      imported++;
    }
    return { importedCount: imported };
  });
}

// ── Opening Stock CSV Import ─────────────────────────────────────────────────

export interface OpeningStockCsvRow {
  sku: string;
  location_code: string;
  quantity: string;
  unit_cost_mwk: string;
  serial_numbers?: string; // separated by comma or semicolon
}

export interface OpeningStockValidationRow {
  rowNumber: number;
  data: OpeningStockCsvRow;
  productId?: string;
  locationId?: string;
  productName?: string;
  locationName?: string;
  serialsList: string[];
  isValid: boolean;
  errors: string[];
}

export async function previewOpeningStockCsv(csvContent: string): Promise<{
  rows: OpeningStockValidationRow[];
  totalRows: number;
  validCount: number;
  errorCount: number;
}> {
  const parsed = Papa.parse<OpeningStockCsvRow>(csvContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  });

  const allProducts = await db.query.products.findMany();
  const prodMap = new Map(allProducts.map((p) => [p.sku.toUpperCase(), p]));

  const allLocations = await db.query.locations.findMany();
  const locMap = new Map(allLocations.map((l) => [l.code.toUpperCase(), l]));

  // Find existing opening movements in the database
  const existingOpenings = await db.query.stockMovements.findMany({
    where: eq(stockMovements.movementType, 'opening'),
    columns: { productId: true, locationId: true },
  });
  const dbOpeningKeys = new Set(existingOpenings.map((m) => `${m.productId}:${m.locationId}`));

  const allDbSerials = await db.query.serialNumbers.findMany({
    columns: { productId: true, serialNumber: true },
  });
  const dbSerialKeys = new Set(
    allDbSerials.map((s) => `${s.productId}:${s.serialNumber.toLowerCase()}`),
  );

  const seenPairsInCsv = new Set<string>();
  const seenSerialsInCsv = new Set<string>();

  const results: OpeningStockValidationRow[] = [];
  let validCount = 0;
  let errorCount = 0;

  for (let i = 0; i < parsed.data.length; i++) {
    const raw = parsed.data[i]!;
    const rowNum = i + 2;
    const errors: string[] = [];

    const sku = raw.sku?.trim().toUpperCase();
    const locCode = raw.location_code?.trim().toUpperCase();

    const prod = sku ? prodMap.get(sku) : undefined;
    const loc = locCode ? locMap.get(locCode) : undefined;

    if (!sku) errors.push('SKU is required.');
    else if (!prod) errors.push(`Product SKU "${sku}" does not exist.`);

    if (!locCode) errors.push('Location code is required.');
    else if (!loc) errors.push(`Location code "${locCode}" does not exist.`);

    if (prod && prod.productType === 'service') {
      errors.push(`Product "${prod.name}" is a service and cannot hold opening stock.`);
    }

    let qty = new Decimal(0);
    try {
      qty = toDecimalQty(raw.quantity);
      if (qty.lte(0)) errors.push('Quantity must be greater than zero.');
    } catch {
      errors.push(`Invalid quantity: "${raw.quantity}".`);
    }

    let costMinor = 0;
    try {
      costMinor = parseKwachaToMinor(raw.unit_cost_mwk || '0');
      if (costMinor < 0) errors.push('Unit cost cannot be negative.');
    } catch {
      errors.push(`Invalid unit cost: "${raw.unit_cost_mwk}".`);
    }

    // Check duplicate opening for the same product and location
    if (prod && loc) {
      const pairKey = `${prod.id}:${loc.id}`;
      if (seenPairsInCsv.has(pairKey)) {
        errors.push(`Duplicate opening stock line for SKU "${sku}" at location "${locCode}" within CSV.`);
      } else if (dbOpeningKeys.has(pairKey)) {
        errors.push(`Opening stock has already been imported for SKU "${sku}" at location "${locCode}".`);
      }
      seenPairsInCsv.add(pairKey);
    }

    // Process serials
    const serialsList: string[] = [];
    if (raw.serial_numbers) {
      const parts = raw.serial_numbers.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
      serialsList.push(...parts);
    }

    if (prod && prod.serialTracking) {
      const intQty = qty.toNumber();
      if (!Number.isInteger(intQty)) {
        errors.push('Serial-tracked products must have an integer quantity.');
      } else if (serialsList.length !== intQty) {
        errors.push(
          `Product "${prod.name}" requires exactly ${intQty} serial number(s), but ${serialsList.length} provided.`,
        );
      }

      for (const s of serialsList) {
        const sKey = `${prod.id}:${s.toLowerCase()}`;
        if (seenSerialsInCsv.has(sKey)) {
          errors.push(`Duplicate serial "${s}" in CSV for SKU "${sku}".`);
        } else if (dbSerialKeys.has(sKey)) {
          errors.push(`Serial "${s}" already exists in the database for SKU "${sku}".`);
        }
        seenSerialsInCsv.add(sKey);
      }
    }

    const isValid = errors.length === 0;
    if (isValid) validCount++;
    else errorCount++;

    results.push({
      rowNumber: rowNum,
      data: raw,
      productId: prod?.id,
      locationId: loc?.id,
      productName: prod?.name,
      locationName: loc?.name,
      serialsList,
      isValid,
      errors,
    });
  }

  return {
    rows: results,
    totalRows: parsed.data.length,
    validCount,
    errorCount,
  };
}

export async function commitOpeningStockCsv(csvContent: string, actorId?: string) {
  const preview = await previewOpeningStockCsv(csvContent);
  if (preview.errorCount > 0) {
    throw new Error(
      `Cannot import opening stock: found ${preview.errorCount} row(s) with errors. All rows must be valid.`,
    );
  }

  return await db.transaction(async (tx) => {
    const movements = preview.rows.map((r) => {
      const qty = toDecimalQty(r.data.quantity);
      const unitCostMinor = parseKwachaToMinor(r.data.unit_cost_mwk || '0');

      return {
        productId: r.productId!,
        locationId: r.locationId!,
        quantity: qty,
        unitCostMinor,
        movementType: 'opening' as const,
        referenceType: 'opening_stock' as const,
        notes: 'Initial Opening Stock CSV Import',
        serialNumbers: r.serialsList,
      };
    });

    await executeStockMovements(tx, movements, actorId);

    return { importedCount: movements.length };
  });
}
