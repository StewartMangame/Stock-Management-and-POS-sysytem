import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import { products, stockBalances, taxRates, categories, posShifts } from '@/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';

/**
 * GET /api/pos/products
 *
 * Returns catalog of sellable products for the POS counter.
 * Crucial Security Rule: Strictly excludes all cost fields
 * (costPriceMinor, averageCostMinor, fifoCostMinor).
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await authorize(PERMISSIONS.POS_ACCESS);
    const { searchParams } = new URL(req.url);

    let locationId = searchParams.get('locationId');

    // If locationId not provided, default to actor's currently open shift location
    if (!locationId) {
      const [openShift] = await db
        .select({ locationId: posShifts.locationId })
        .from(posShifts)
        .where(and(eq(posShifts.cashierId, actor.id), eq(posShifts.status, 'open')))
        .limit(1);

      if (openShift) {
        locationId = openShift.locationId;
      }
    }

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId query parameter is required when no open shift exists' },
        { status: 400 },
      );
    }

    // Select ONLY customer-facing product information and available stock for the location.
    // Cost fields are strictly excluded.
    const rows = await db
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        barcode: products.barcode,
        description: products.description,
        categoryId: products.categoryId,
        categoryName: categories.name,
        sellingPriceMinor: products.sellingPriceMinor,
        isSerialTracked: products.serialTracking,
        isBundle: sql<boolean>`${products.productType} = 'bundle'`,
        taxRateId: products.taxRateId,
        taxRateName: taxRates.name,
        taxRateBasisPoints: taxRates.rateBasisPoints,
        availableQty: sql<string>`COALESCE(${stockBalances.available}, 0)::text`,
        onHandQty: sql<string>`COALESCE(${stockBalances.onHand}, 0)::text`,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(taxRates, eq(products.taxRateId, taxRates.id))
      .leftJoin(
        stockBalances,
        and(
          eq(stockBalances.productId, products.id),
          eq(stockBalances.locationId, locationId),
        ),
      )
      .where(eq(products.isActive, true));

    return NextResponse.json({
      locationId,
      products: rows.map((r) => ({
        id: r.id,
        name: r.name,
        sku: r.sku,
        barcode: r.barcode,
        description: r.description,
        categoryId: r.categoryId,
        categoryName: r.categoryName,
        sellingPriceMinor: r.sellingPriceMinor.toString(),
        isSerialTracked: r.isSerialTracked,
        isBundle: r.isBundle,
        taxRateId: r.taxRateId,
        taxRateName: r.taxRateName ?? 'Zero Rated',
        taxRateBasisPoints: r.taxRateBasisPoints ?? 0,
        availableQty: Number(r.availableQty || 0),
        onHandQty: Number(r.onHandQty || 0),
      })),
    });
  } catch (err: unknown) {
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : 'Failed to fetch POS products';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
