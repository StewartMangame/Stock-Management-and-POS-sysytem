import { db } from '@/server/db';
import { purchaseOrders, purchaseOrderItems, products, suppliers, locations } from '@/server/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { getNextDocNumber } from '@/server/services/sequences';
import { convertSupplierToMwkMinor, roundHalfUp, toDecimalQty } from '@/lib/stock-math';
import { writeAuditLog } from '@/server/services/audit';
import Decimal from 'decimal.js';

export interface PurchaseOrderItemInput {
  productId: string;
  orderedQty: string | number;
  unitCostSupplier: string | number;
}

export interface PurchaseOrderInput {
  supplierId: string;
  locationId: string;
  orderDate?: string;
  expectedDeliveryDate?: string | null;
  currency?: string;
  exchangeRate?: string | number;
  notes?: string | null;
  items: PurchaseOrderItemInput[];
}

export async function listPurchaseOrders(filters?: {
  status?: string;
  supplierId?: string;
  locationId?: string;
}) {
  const conditions = [];
  if (filters?.status) conditions.push(eq(purchaseOrders.status, filters.status));
  if (filters?.supplierId) conditions.push(eq(purchaseOrders.supplierId, filters.supplierId));
  if (filters?.locationId) conditions.push(eq(purchaseOrders.locationId, filters.locationId));

  return await db.query.purchaseOrders.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(purchaseOrders.createdAt)],
    with: {
      supplier: true,
      location: true,
      items: {
        with: { product: true },
      },
    },
  });
}

export async function getPurchaseOrderById(id: string) {
  return await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, id),
    with: {
      supplier: true,
      location: true,
      items: {
        with: { product: true },
      },
      goodsReceipts: {
        with: {
          items: true,
          landedCosts: true,
        },
      },
    },
  });
}

export async function createPurchaseOrder(input: PurchaseOrderInput, actorId?: string) {
  if (!input.items || input.items.length === 0) {
    throw new Error('A purchase order must contain at least one line item.');
  }

  const supplier = await db.query.suppliers.findFirst({
    where: eq(suppliers.id, input.supplierId),
  });
  if (!supplier) throw new Error('Supplier not found');

  const currency = (input.currency || supplier.defaultCurrency || 'MWK').toUpperCase();
  const exchangeRate = new Decimal(input.exchangeRate || 1);

  if (exchangeRate.lte(0)) {
    throw new Error('Exchange rate must be greater than zero.');
  }

  const [po] = await db.transaction(async (tx) => {
    const poNumber = await getNextDocNumber(tx, 'purchase_order', input.locationId);

    let totalSupplierCurrency = new Decimal(0);
    let totalMwkMinor = 0;

    const preparedItems = [];
    for (const it of input.items) {
      const qty = toDecimalQty(it.orderedQty);
      if (qty.lte(0)) throw new Error('Ordered quantity must be greater than zero.');

      const costSupplier = new Decimal(it.unitCostSupplier);
      if (costSupplier.isNegative()) throw new Error('Unit cost cannot be negative.');

      const lineTotalSupplier = qty.times(costSupplier);
      const unitCostMwk = convertSupplierToMwkMinor(costSupplier, exchangeRate);
      const lineTotalMwk = roundHalfUp(qty.times(unitCostMwk));

      totalSupplierCurrency = totalSupplierCurrency.plus(lineTotalSupplier);
      totalMwkMinor += lineTotalMwk;

      preparedItems.push({
        productId: it.productId,
        orderedQty: qty.toFixed(3),
        unitCostSupplier: costSupplier.toFixed(4),
        lineTotalSupplier: lineTotalSupplier.toFixed(4),
        unitCostMwkMinor: unitCostMwk,
      });
    }

    const [createdPo] = await tx
      .insert(purchaseOrders)
      .values({
        poNumber,
        supplierId: input.supplierId,
        locationId: input.locationId,
        status: 'draft',
        orderDate: input.orderDate || new Date().toISOString().split('T')[0]!,
        expectedDeliveryDate: input.expectedDeliveryDate || null,
        currency,
        exchangeRate: exchangeRate.toFixed(6),
        totalMinor: totalMwkMinor,
        totalSupplierCurrency: totalSupplierCurrency.toFixed(4),
        notes: input.notes?.trim() || null,
        createdBy: actorId ?? null,
      })
      .returning();

    for (const it of preparedItems) {
      await tx.insert(purchaseOrderItems).values({
        purchaseOrderId: createdPo!.id,
        productId: it.productId,
        orderedQty: it.orderedQty,
        receivedQty: '0',
        unitCostSupplier: it.unitCostSupplier,
        lineTotalSupplier: it.lineTotalSupplier,
        unitCostMwkMinor: it.unitCostMwkMinor,
      });
    }

    return [createdPo];
  });

  await writeAuditLog(db, {
    userId: actorId,
    action: 'purchase_order.create',
    entityType: 'purchase_order',
    entityId: po!.id,
    after: po,
  });

  return po!;
}

export async function submitPurchaseOrder(id: string, actorId?: string) {
  const po = await getPurchaseOrderById(id);
  if (!po) throw new Error('Purchase order not found');
  if (po.status !== 'draft') throw new Error(`Cannot submit purchase order in '${po.status}' status`);

  const [updated] = await db
    .update(purchaseOrders)
    .set({
      status: 'submitted',
      approvedBy: actorId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(purchaseOrders.id, id))
    .returning();

  await writeAuditLog(db, {
    userId: actorId,
    action: 'purchase_order.submit',
    entityType: 'purchase_order',
    entityId: id,
    before: { status: po.status },
    after: { status: updated!.status },
  });

  return updated!;
}

export async function cancelPurchaseOrder(id: string, reason?: string, actorId?: string) {
  const po = await getPurchaseOrderById(id);
  if (!po) throw new Error('Purchase order not found');
  if (po.status === 'received' || po.status === 'cancelled') {
    throw new Error(`Cannot cancel purchase order in '${po.status}' status`);
  }

  const [updated] = await db
    .update(purchaseOrders)
    .set({
      status: 'cancelled',
      notes: reason ? `${po.notes ? po.notes + ' | ' : ''}Cancelled: ${reason}` : po.notes,
      updatedAt: new Date(),
    })
    .where(eq(purchaseOrders.id, id))
    .returning();

  await writeAuditLog(db, {
    userId: actorId,
    action: 'purchase_order.cancel',
    entityType: 'purchase_order',
    entityId: id,
    before: { status: po.status },
    after: { status: updated!.status },
  });

  return updated!;
}
