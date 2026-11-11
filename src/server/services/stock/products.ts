import { db } from '@/server/db';
import {
  products,
  productBundles,
  categories,
  unitsOfMeasure,
  taxRates,
  stockBalances,
  locations,
} from '@/server/db/schema';
import { eq, and, sql, desc, asc, ilike } from 'drizzle-orm';
import { writeAuditLog } from '@/server/services/audit';
import { executeStockMovements } from '@/server/services/stock/stock-engine';

export interface ProductInput {
  name: string;
  sku: string;
  barcode?: string | null;
  description?: string | null;
  categoryId?: string | null;
  uomId: string;
  productType?: 'standard' | 'inventory' | 'non-inventory' | 'bundle' | 'service';
  productDate?: string | null;   // 'YYYY-MM-DD'
  imageUrl?: string | null;
  sellingPriceMinor: number;
  taxRateId?: string | null;
  minStockAlert?: string | number | null;
  maxStock?: string | number | null;
  serialTracking?: boolean;
  warrantyMonths?: number;
  isActive?: boolean;
  bundleComponents?: Array<{ componentProductId: string; quantity: string | number }>;
  // Initial stock for new inventory products
  initialQuantity?: string | number | null;
  initialLocationId?: string | null;
  initialUnitCostMinor?: number | null;
  initialSerialNumbers?: string[];
}

export async function listProducts(options?: {
  search?: string;
  categoryId?: string;
  productType?: string;
  isActive?: boolean;
  lowStockOnly?: boolean;
  locationId?: string;
}) {
  const conditions = [];

  if (options?.categoryId) {
    conditions.push(eq(products.categoryId, options.categoryId));
  }
  if (options?.productType) {
    conditions.push(eq(products.productType, options.productType));
  }
  if (options?.isActive !== undefined) {
    conditions.push(eq(products.isActive, options.isActive));
  }
  if (options?.search) {
    const term = `%${options.search.trim()}%`;
    conditions.push(
      sql`(${products.name} ILIKE ${term} OR ${products.sku} ILIKE ${term} OR ${products.barcode} ILIKE ${term})`,
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db.query.products.findMany({
    where: whereClause,
    orderBy: [asc(products.name)],
    with: {
      category: true,
      uom: true,
      taxRate: true,
      stockBalances: {
        with: { location: true },
      },
    },
  });

  if (options?.lowStockOnly) {
    return result.filter((p) => {
      if (p.productType === 'service' || p.productType === 'non-inventory') return false;
      const minAlert = parseFloat(p.minStockAlert ?? '0');
      if (minAlert <= 0) return false;

      let totalOnHand = 0;
      if (options.locationId) {
        const bal = p.stockBalances.find((b) => b.locationId === options.locationId);
        totalOnHand = parseFloat(bal?.onHand ?? '0');
      } else {
        totalOnHand = p.stockBalances.reduce((sum, b) => sum + parseFloat(b.onHand), 0);
      }
      return totalOnHand <= minAlert;
    });
  }

  return result;
}

export async function getProductById(id: string) {
  return await db.query.products.findFirst({
    where: eq(products.id, id),
    with: {
      category: true,
      uom: true,
      taxRate: true,
      stockBalances: {
        with: { location: true },
      },
      bundleComponents: {
        with: { componentProduct: true },
      },
    },
  });
}

export async function createProduct(input: ProductInput, actorId?: string) {
  const sku = input.sku.trim().toUpperCase();

  const productType = input.productType ?? 'standard';
  // Services and non-inventory items cannot have serial tracking
  const noStock = productType === 'service' || productType === 'non-inventory';
  const serialTracking = noStock ? false : (input.serialTracking ?? false);

  const [created] = await db.transaction(async (tx) => {
    const [p] = await tx
      .insert(products)
      .values({
        name: input.name.trim(),
        sku,
        barcode: input.barcode?.trim() || null,
        description: input.description?.trim() || null,
        categoryId: input.categoryId || null,
        uomId: input.uomId,
        productType,
        productDate: input.productDate || undefined,
        imageUrl: input.imageUrl || null,
        avgCostMinor: 0, // system maintained on goods receipts
        lastCostMinor: 0, // system maintained
        sellingPriceMinor: input.sellingPriceMinor ?? 0,
        taxRateId: input.taxRateId || null,
        minStockAlert: input.minStockAlert ? String(input.minStockAlert) : '0',
        maxStock: input.maxStock ? String(input.maxStock) : null,
        serialTracking,
        warrantyMonths: input.warrantyMonths ?? 0,
        isActive: input.isActive ?? true,
        createdBy: actorId ?? null,
      })
      .returning();

    // If bundle, save components
    if (productType === 'bundle' && input.bundleComponents && input.bundleComponents.length > 0) {
      for (const comp of input.bundleComponents) {
        await tx.insert(productBundles).values({
          bundleProductId: p!.id,
          componentProductId: comp.componentProductId,
          quantity: String(comp.quantity),
        });
      }
    }

    // Initial stock recording for inventory products
    const initialQty = input.initialQuantity ? parseFloat(String(input.initialQuantity)) : 0;
    if (initialQty > 0 && (productType === 'inventory' || productType === 'standard')) {
      let locId = input.initialLocationId;
      if (!locId) {
        const [firstLoc] = await tx
          .select({ id: locations.id })
          .from(locations)
          .where(eq(locations.isActive, true))
          .limit(1);
        locId = firstLoc?.id;
      }

      if (locId) {
        await executeStockMovements(
          tx,
          [
            {
              productId: p!.id,
              locationId: locId,
              quantity: initialQty,
              unitCostMinor: input.initialUnitCostMinor ?? 0,
              movementType: 'opening',
              referenceType: 'opening_stock',
              referenceId: p!.id,
              notes: 'Initial opening stock',
              serialNumbers: input.initialSerialNumbers,
            },
          ],
          actorId,
        );
      }
    }

    return [p];
  });

  await writeAuditLog(db, {
    userId: actorId,
    action: 'product.create',
    entityType: 'product',
    entityId: created!.id,
    after: created,
  });

  return created!;
}

export async function updateProduct(
  id: string,
  input: Partial<Omit<ProductInput, 'sku' | 'productType'>>,
  actorId?: string,
) {
  const existing = await getProductById(id);
  if (!existing) throw new Error('Product not found');

  const updateData: Record<string, any> = { updatedAt: new Date() };
  if (input.name !== undefined) updateData['name'] = input.name.trim();
  if (input.barcode !== undefined) updateData['barcode'] = input.barcode?.trim() || null;
  if (input.description !== undefined) updateData['description'] = input.description?.trim() || null;
  if (input.categoryId !== undefined) updateData['categoryId'] = input.categoryId || null;
  if (input.uomId !== undefined) updateData['uomId'] = input.uomId;
  if (input.sellingPriceMinor !== undefined) updateData['sellingPriceMinor'] = input.sellingPriceMinor;
  if (input.taxRateId !== undefined) updateData['taxRateId'] = input.taxRateId || null;
  if (input.minStockAlert !== undefined)
    updateData['minStockAlert'] = input.minStockAlert ? String(input.minStockAlert) : '0';
  if (input.maxStock !== undefined) updateData['maxStock'] = input.maxStock ? String(input.maxStock) : null;
  const noStockExisting = existing.productType === 'service' || existing.productType === 'non-inventory';
  if (input.serialTracking !== undefined && !noStockExisting) {
    updateData['serialTracking'] = input.serialTracking;
  }
  if (input.warrantyMonths !== undefined) updateData['warrantyMonths'] = input.warrantyMonths;
  if (input.isActive !== undefined) updateData['isActive'] = input.isActive;
  if (input.productDate !== undefined) updateData['productDate'] = input.productDate;
  if (input.imageUrl !== undefined) updateData['imageUrl'] = input.imageUrl || null;

  const [updated] = await db.transaction(async (tx) => {
    const [p] = await tx
      .update(products)
      .set(updateData)
      .where(eq(products.id, id))
      .returning();

    if (existing.productType === 'bundle' && input.bundleComponents) {
      await tx.delete(productBundles).where(eq(productBundles.bundleProductId, id));
      for (const comp of input.bundleComponents) {
        await tx.insert(productBundles).values({
          bundleProductId: id,
          componentProductId: comp.componentProductId,
          quantity: String(comp.quantity),
        });
      }
    }

    return [p];
  });

  await writeAuditLog(db, {
    userId: actorId,
    action: 'product.update',
    entityType: 'product',
    entityId: id,
    before: existing,
    after: updated,
  });

  return updated!;
}
