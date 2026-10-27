import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import { suppliers, locations, products, purchaseOrders } from '@/server/db/schema';
import { eq, desc, inArray } from 'drizzle-orm';
import { getPurchaseOrderById } from '@/server/services/purchasing/purchase-orders';
import { ReceiptForm } from '../ReceiptForm';

interface Props {
  searchParams: Promise<{ poId?: string }>;
}

export const metadata: Metadata = { title: 'New Goods Receipt | Ace Holdings POS' };

export default async function NewGoodsReceiptPage({ searchParams }: Props) {
  const { poId } = await searchParams;

  try {
    await authorize(PERMISSIONS.GOODS_RECEIPTS_MANAGE);
  } catch {
    redirect('/dashboard');
  }

  const [allSuppliers, allLocations, allProducts, allPOs, initialPO] = await Promise.all([
    db.query.suppliers.findMany({
      where: eq(suppliers.isActive, true),
      orderBy: [suppliers.name],
    }),
    db.query.locations.findMany({
      where: eq(locations.isActive, true),
      orderBy: [locations.name],
    }),
    db.query.products.findMany({
      where: eq(products.isActive, true),
      orderBy: [products.name],
    }),
    db.query.purchaseOrders.findMany({
      where: inArray(purchaseOrders.status, ['submitted', 'partially_received']),
      orderBy: [desc(purchaseOrders.createdAt)],
    }),
    poId ? getPurchaseOrderById(poId) : Promise.resolve(null),
  ]);

  return (
    <div className="max-w-6xl mx-auto">
      <ReceiptForm
        suppliers={allSuppliers.map((s) => ({
          id: s.id,
          name: s.name,
          code: s.code,
          defaultCurrency: s.defaultCurrency,
        }))}
        locations={allLocations.map((l) => ({
          id: l.id,
          name: l.name,
          type: l.type,
        }))}
        products={allProducts
          .filter((p) => p.productType !== 'service')
          .map((p) => ({
            id: p.id,
            name: p.name,
            sku: p.sku,
            serialTracking: p.serialTracking,
            lastCostMinor: Number(p.lastCostMinor),
          }))}
        purchaseOrders={allPOs.map((po) => ({
          id: po.id,
          poNumber: po.poNumber,
          supplierId: po.supplierId,
        }))}
        initialPO={
          initialPO
            ? {
                id: initialPO.id,
                poNumber: initialPO.poNumber,
                supplierId: initialPO.supplierId,
                locationId: initialPO.locationId,
                currency: initialPO.currency,
                exchangeRate: initialPO.exchangeRate,
                items: initialPO.items.map((pi) => ({
                  id: pi.id,
                  productId: pi.productId,
                  orderedQty: pi.orderedQty,
                  receivedQty: pi.receivedQty,
                  unitCostSupplier: pi.unitCostSupplier,
                })),
              }
            : null
        }
      />
    </div>
  );
}
