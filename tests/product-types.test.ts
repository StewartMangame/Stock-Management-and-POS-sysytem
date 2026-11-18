/**
 * Product Types Specification & Integration Tests.
 *
 * Verifies Item 4:
 * 1. Definitive behavior table for all 8 product types:
 *    standard, inventory, non_inventory, composite, serialized, batch, bundle, service.
 * 2. Identifies which create stock movements, which are sellable at POS, which count in valuation & reports.
 * 3. Shared helper functions (isStockTrackedProduct, isSellableAtPos, countsInValuation, countsInStockReports).
 * 4. Image URL validation (HTTPS only, CSP compliant).
 * 5. Default product_date uses Africa/Blantyre date.
 * 6. Database and domain integration across stock, delivery, POS, and valuation.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '@/server/db';
import {
  products,
  unitsOfMeasure,
  categories,
  taxRates,
  locations,
  users,
  roles,
} from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import {
  PRODUCT_TYPE_BEHAVIORS,
  ProductType,
  normalizeProductType,
  getProductTypeBehavior,
  isStockTrackedProduct,
  isSellableAtPos,
  countsInValuation,
  countsInStockReports,
  isBundleProduct,
  validateProductImageUrl,
  getDefaultProductDate,
} from '@/lib/product-types';
import { createProduct } from '@/server/services/stock/products';
import { todayInCompanyTz } from '@/lib/timezone';

describe('Item 4: Product Types Specification & Integration', () => {
  let testUomId: string;
  let testUserId: string;

  beforeAll(async () => {
    // Ensure standard UOM exists
    const [uom] = await db
      .select({ id: unitsOfMeasure.id })
      .from(unitsOfMeasure)
      .where(eq(unitsOfMeasure.code, 'EACH'));
    if (uom) {
      testUomId = uom.id;
    } else {
      const [newUom] = await db
        .insert(unitsOfMeasure)
        .values({ name: 'Each', code: 'EACH', symbol: 'ea' })
        .returning();
      testUomId = newUom!.id;
    }

    const [adminRole] = await db.select().from(roles).where(eq(roles.name, 'admin'));
    const [user] = await db
      .insert(users)
      .values({
        name: 'Product Tester',
        email: `prod-tester-${Date.now()}@test.com`,
        passwordHash: 'dummy',
        roleId: adminRole!.id,
      })
      .returning();
    testUserId = user!.id;
  });

  it('1. Behavior Table: All 8 product types defined with unambiguous behaviors', () => {
    const expectedTypes: ProductType[] = [
      'standard',
      'inventory',
      'non_inventory',
      'composite',
      'serialized',
      'batch',
      'bundle',
      'service',
    ];

    expect(Object.keys(PRODUCT_TYPE_BEHAVIORS).sort()).toEqual(expectedTypes.sort());

    for (const type of expectedTypes) {
      const behavior = PRODUCT_TYPE_BEHAVIORS[type];
      expect(behavior.type).toBe(type);
      expect(typeof behavior.displayName).toBe('string');
      expect(typeof behavior.description).toBe('string');
      expect(typeof behavior.createsStockMovements).toBe('boolean');
      expect(typeof behavior.sellableAtPos).toBe('boolean');
      expect(typeof behavior.countsInValuation).toBe('boolean');
      expect(typeof behavior.countsInStockReports).toBe('boolean');
      expect(typeof behavior.isKitOrBundle).toBe('boolean');
    }
  });

  it('2. Stock Movement Rules: Only physical inventory types create stock movements', () => {
    // Physical tracked types:
    expect(isStockTrackedProduct('standard')).toBe(true);
    expect(isStockTrackedProduct('inventory')).toBe(true);
    expect(isStockTrackedProduct('composite')).toBe(true);
    expect(isStockTrackedProduct('serialized')).toBe(true);
    expect(isStockTrackedProduct('batch')).toBe(true);

    // Untracked / virtual / service types:
    expect(isStockTrackedProduct('non_inventory')).toBe(false);
    expect(isStockTrackedProduct('non-inventory')).toBe(false);
    expect(isStockTrackedProduct('bundle')).toBe(false);
    expect(isStockTrackedProduct('service')).toBe(false);
  });

  it('3. POS Sellability: All 8 types can be sold directly at the POS', () => {
    const allTypes: ProductType[] = [
      'standard',
      'inventory',
      'non_inventory',
      'composite',
      'serialized',
      'batch',
      'bundle',
      'service',
    ];
    for (const t of allTypes) {
      expect(isSellableAtPos(t)).toBe(true);
    }
  });

  it('4. Valuation & Stock Reporting: Only physical stock types count towards inventory value', () => {
    // Count in valuation
    expect(countsInValuation('standard')).toBe(true);
    expect(countsInValuation('inventory')).toBe(true);
    expect(countsInValuation('composite')).toBe(true);
    expect(countsInValuation('serialized')).toBe(true);
    expect(countsInValuation('batch')).toBe(true);

    // Excluded from valuation
    expect(countsInValuation('non_inventory')).toBe(false);
    expect(countsInValuation('bundle')).toBe(false);
    expect(countsInValuation('service')).toBe(false);

    // Count in stock reports
    expect(countsInStockReports('inventory')).toBe(true);
    expect(countsInStockReports('service')).toBe(false);
    expect(countsInStockReports('bundle')).toBe(false);
  });

  it('5. Bundle / Kit Identification: Only bundle is flagged as kit/bundle', () => {
    expect(isBundleProduct('bundle')).toBe(true);
    expect(isBundleProduct('standard')).toBe(false);
    expect(isBundleProduct('inventory')).toBe(false);
    expect(isBundleProduct('service')).toBe(false);
  });

  it('6. Image URL Validation: Enforces HTTPS and CSP compliance', () => {
    // Valid HTTPS URLs
    expect(validateProductImageUrl('https://cdn.example.com/products/item1.jpg').isValid).toBe(true);
    expect(validateProductImageUrl('https://storage.googleapis.com/ace-pos/item2.png').isValid).toBe(true);
    expect(validateProductImageUrl('').isValid).toBe(true);
    expect(validateProductImageUrl(null).isValid).toBe(true);

    // Rejected non-HTTPS / dangerous URLs
    expect(validateProductImageUrl('http://insecure.com/pic.jpg').isValid).toBe(false);
    expect(validateProductImageUrl('javascript:alert(1)').isValid).toBe(false);
    expect(validateProductImageUrl('data:image/png;base64,iVBORw0KGgo...').isValid).toBe(false);
    expect(validateProductImageUrl('blob:https://example.com/uuid').isValid).toBe(false);
    expect(validateProductImageUrl('not-a-url').isValid).toBe(false);
  });

  it('7. Default product_date: Uses Africa/Blantyre date', () => {
    const blantyreToday = todayInCompanyTz();
    expect(getDefaultProductDate()).toBe(blantyreToday);
  });

  it('8. Database Persistence: Creates products with various types and verifies Blantyre product_date default', async () => {
    const TS = Date.now();
    const blantyreToday = todayInCompanyTz();

    // 8.1 Create inventory product without explicit productDate
    const prodInv = await createProduct(
      {
        name: `Test Inv ${TS}`,
        sku: `SKU-INV-${TS}`,
        uomId: testUomId,
        productType: 'inventory',
        sellingPriceMinor: 150000,
        imageUrl: 'https://images.example.com/inv.png',
      },
      testUserId,
    );

    expect(prodInv.productType).toBe('inventory');
    expect(prodInv.productDate).toBe(blantyreToday);
    expect(prodInv.imageUrl).toBe('https://images.example.com/inv.png');

    // 8.2 Create service product
    const prodSvc = await createProduct(
      {
        name: `Consulting Service ${TS}`,
        sku: `SKU-SVC-${TS}`,
        uomId: testUomId,
        productType: 'service',
        sellingPriceMinor: 500000,
      },
      testUserId,
    );
    expect(prodSvc.productType).toBe('service');
    expect(prodSvc.serialTracking).toBe(false);

    // 8.3 Insecure HTTP image_url rejected
    await expect(
      createProduct(
        {
          name: `Insecure Image ${TS}`,
          sku: `SKU-INSEC-${TS}`,
          uomId: testUomId,
          productType: 'standard',
          imageUrl: 'http://insecure.example.com/pic.png',
          sellingPriceMinor: 10000,
        },
        testUserId,
      ),
    ).rejects.toThrow(/Product image URL must use HTTPS/);
  });
});
