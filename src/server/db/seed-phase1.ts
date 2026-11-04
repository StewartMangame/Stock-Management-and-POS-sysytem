/**
 * Phase 1 Demo Seed script.
 *
 * Populates sample categories, units of measure, suppliers, products
 * (standard, serial-tracked, service, bundle), and one USD purchase order.
 *
 * Rule: Refuses to run if NODE_ENV === 'production'.
 */

import 'dotenv/config';
import { db, pool } from '@/server/db';
import {
  categories,
  unitsOfMeasure,
  suppliers,
  products,
  productBundles,
  locations,
  purchaseOrders,
  purchaseOrderItems,
  stockMovements,
} from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { executeStockMovements } from '@/server/services/stock/stock-engine';
import { getNextDocNumber } from '@/server/services/sequences';

async function main() {
  // ── PRODUCTION GUARD ───────────────────────────────────────────────────
  if ((process.env.NODE_ENV as string) === 'production') {
    console.error('[seed-phase1] ✗ Refusing to run demo seed in production environment!');
    throw new Error('[seed-phase1] REFUSED: Demo seed must not run in production.');
  }

  console.log('[seed-phase1] Starting Phase 1 demo seed...');

  // 1. Get Main Outlet location
  const mainLoc = await db.query.locations.findFirst({
    where: eq(locations.code, 'MAIN'),
  });
  if (!mainLoc) {
    throw new Error('Main Outlet location (code: MAIN) not found. Run "npm run db:seed" first.');
  }

  // 2. Units of Measure
  console.log('[seed-phase1] Ensuring units of measure...');
  const uomList = [
    { name: 'Each', code: 'EA', symbol: 'ea', allowDecimal: false },
    { name: 'Kilogram', code: 'KG', symbol: 'kg', allowDecimal: true },
    { name: 'Box', code: 'BOX', symbol: 'bx', allowDecimal: false },
    { name: 'Hour', code: 'HR', symbol: 'hr', allowDecimal: true },
  ];
  for (const u of uomList) {
    await db.insert(unitsOfMeasure).values(u).onConflictDoNothing();
  }
  const eachUom = await db.query.unitsOfMeasure.findFirst({
    where: eq(unitsOfMeasure.code, 'EA'),
  });
  const hrUom = await db.query.unitsOfMeasure.findFirst({
    where: eq(unitsOfMeasure.code, 'HR'),
  });

  // 3. Categories
  console.log('[seed-phase1] Ensuring categories...');
  const catList = [
    { name: 'Computers & Laptops', code: 'COMP', description: 'Business laptops and desktops' },
    { name: 'Accessories & Peripherals', code: 'ACC', description: 'Mice, keyboards, cables' },
    { name: 'Services & Labor', code: 'SERV', description: 'Repair, support, setup services' },
    { name: 'Bundles & Packages', code: 'BDL', description: 'Pre-configured equipment packages' },
  ];
  for (const c of catList) {
    await db.insert(categories).values(c).onConflictDoNothing();
  }
  const compCat = await db.query.categories.findFirst({ where: eq(categories.code, 'COMP') });
  const accCat = await db.query.categories.findFirst({ where: eq(categories.code, 'ACC') });
  const servCat = await db.query.categories.findFirst({ where: eq(categories.code, 'SERV') });
  const bdlCat = await db.query.categories.findFirst({ where: eq(categories.code, 'BDL') });

  // 4. Supplier
  console.log('[seed-phase1] Ensuring supplier...');
  const [supplier] = await db
    .insert(suppliers)
    .values({
      name: 'Ace Global Imports Inc.',
      code: 'SUP-AGI',
      contactName: 'David Banda',
      email: 'orders@aceglobalimports.com',
      phone: '+265 888 123 456',
      address: 'Plot 14, Light Industrial Area, Blantyre',
      taxNumber: 'TPIN-98765432',
      defaultCurrency: 'USD',
      paymentTermsDays: 30,
      isActive: true,
    })
    .onConflictDoNothing()
    .returning();

  const activeSupplier = supplier ?? (await db.query.suppliers.findFirst({ where: eq(suppliers.code, 'SUP-AGI') }))!;

  // 5. Products
  console.log('[seed-phase1] Ensuring products...');

  // Standard Item: Wireless Mouse
  await db
    .insert(products)
    .values({
      name: 'Logitech Wireless Mouse M185',
      sku: 'MOU-LOG-M185',
      barcode: '097855079634',
      description: 'Compact wireless optical mouse with USB nano receiver',
      categoryId: accCat?.id,
      uomId: eachUom!.id,
      productType: 'standard',
      avgCostMinor: 0,
      lastCostMinor: 0,
      sellingPriceMinor: 2500000, // MWK 25,000.00
      minStockAlert: '5',
      maxStock: '50',
      serialTracking: false,
      warrantyMonths: 6,
      isActive: true,
    })
    .onConflictDoNothing();

  // Serial-tracked Item: Dell Latitude 5440 Laptop
  await db
    .insert(products)
    .values({
      name: 'Dell Latitude 5440 14" Laptop',
      sku: 'LAP-DEL-5440',
      barcode: '884116428909',
      description: 'Intel Core i5-1335U, 16GB RAM, 512GB SSD, Windows 11 Pro',
      categoryId: compCat?.id,
      uomId: eachUom!.id,
      productType: 'standard',
      avgCostMinor: 0,
      lastCostMinor: 0,
      sellingPriceMinor: 145000000, // MWK 1,450,000.00
      minStockAlert: '2',
      maxStock: '15',
      serialTracking: true,
      warrantyMonths: 12,
      isActive: true,
    })
    .onConflictDoNothing();

  // Service Item: PC Setup & Diagnostics
  await db
    .insert(products)
    .values({
      name: 'PC Setup & System Diagnostics',
      sku: 'SRV-PC-SETUP',
      barcode: null,
      description: 'Full OS installation, security updates and hardware diagnostic test',
      categoryId: servCat?.id,
      uomId: hrUom!.id,
      productType: 'service',
      avgCostMinor: 0,
      lastCostMinor: 0,
      sellingPriceMinor: 3500000, // MWK 35,000.00
      serialTracking: false,
      warrantyMonths: 0,
      isActive: true,
    })
    .onConflictDoNothing();

  // Bundle Item: Executive Desk Package
  const mouse = (await db.query.products.findFirst({ where: eq(products.sku, 'MOU-LOG-M185') }))!;
  const laptop = (await db.query.products.findFirst({ where: eq(products.sku, 'LAP-DEL-5440') }))!;

  await db
    .insert(products)
    .values({
      name: 'Executive Workstation Bundle',
      sku: 'BDL-EXEC-01',
      description: 'Complete productivity bundle: Dell Latitude Laptop + Logitech Mouse',
      categoryId: bdlCat?.id,
      uomId: eachUom!.id,
      productType: 'bundle',
      avgCostMinor: 0,
      lastCostMinor: 0,
      sellingPriceMinor: 146500000, // MWK 1,465,000.00
      serialTracking: false,
      warrantyMonths: 12,
      isActive: true,
    })
    .onConflictDoNothing();

  const bundle = (await db.query.products.findFirst({ where: eq(products.sku, 'BDL-EXEC-01') }))!;

  // Add bundle components
  await db
    .insert(productBundles)
    .values([
      { bundleProductId: bundle.id, componentProductId: laptop.id, quantity: '1' },
      { bundleProductId: bundle.id, componentProductId: mouse.id, quantity: '1' },
    ])
    .onConflictDoNothing();

  // 6. Initial Opening Stock for Mouse
  console.log('[seed-phase1] Checking opening stock...');
  const existingMouseMovement = await db.query.stockMovements.findFirst({
    where: eq(stockMovements.productId, mouse.id),
  });

  if (!existingMouseMovement) {
    console.log('[seed-phase1] Recording initial opening stock for mouse...');
    await db.transaction(async (tx) => {
      await executeStockMovements(tx, [
        {
          productId: mouse.id,
          locationId: mainLoc.id,
          quantity: '10',
          unitCostMinor: 1500000, // MWK 15,000.00
          movementType: 'opening',
          referenceType: 'opening_stock',
          notes: 'Phase 1 Demo Opening Stock',
        },
      ]);
    });
  }

  // 7. Sample Purchase Order (USD)
  console.log('[seed-phase1] Checking demo purchase order...');
  const existingPo = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.poNumber, 'MAIN-PO-0001'),
  });

  if (!existingPo) {
    console.log('[seed-phase1] Creating sample USD purchase order (MAIN-PO-0001)...');
    await db.transaction(async (tx) => {
      const exchangeRate = '1750.000000'; // 1 USD = 1750 MWK
      const orderedQty = '5';
      const unitCostUsd = '650.0000';
      const lineTotalUsd = '3250.0000'; // 5 * 650
      const unitCostMwk = 650 * 1750 * 100; // 113,750,000 tambala = MWK 1,137,500
      const totalMwk = unitCostMwk * 5;

      const [newPo] = await tx
        .insert(purchaseOrders)
        .values({
          poNumber: 'MAIN-PO-0001',
          supplierId: activeSupplier.id,
          locationId: mainLoc.id,
          status: 'submitted',
          orderDate: new Date().toISOString().split('T')[0]!,
          currency: 'USD',
          exchangeRate,
          totalMinor: totalMwk,
          totalSupplierCurrency: lineTotalUsd,
          notes: 'Phase 1 Sample Order — Dell Laptops from international distributor',
        })
        .returning();

      await tx.insert(purchaseOrderItems).values({
        purchaseOrderId: newPo!.id,
        productId: laptop.id,
        orderedQty,
        receivedQty: '0',
        unitCostSupplier: unitCostUsd,
        lineTotalSupplier: lineTotalUsd,
        unitCostMwkMinor: unitCostMwk,
      });
    });
  }

  console.log('[seed-phase1] ✓ Phase 1 demo seed completed successfully.');
  await pool.end();
}

main().catch(async (err) => {
  console.error('[seed-phase1] ✗ Seed failed:', err);
  await pool.end();
  process.exit(1);
});
