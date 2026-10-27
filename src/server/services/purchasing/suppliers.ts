import { db } from '@/server/db';
import { suppliers } from '@/server/db/schema';
import { eq, asc } from 'drizzle-orm';
import { writeAuditLog } from '@/server/services/audit';

export interface SupplierInput {
  name: string;
  code: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  taxNumber?: string | null;
  defaultCurrency?: string;
  paymentTermsDays?: number;
  isActive?: boolean;
}

export async function listSuppliers() {
  return await db.query.suppliers.findMany({
    orderBy: [asc(suppliers.name)],
  });
}

export async function getSupplierById(id: string) {
  return await db.query.suppliers.findFirst({
    where: eq(suppliers.id, id),
    with: {
      purchaseOrders: {
        limit: 10,
        orderBy: (po, { desc }) => [desc(po.createdAt)],
      },
    },
  });
}

export async function createSupplier(input: SupplierInput, actorId?: string) {
  const code = input.code.trim().toUpperCase();

  const [created] = await db
    .insert(suppliers)
    .values({
      name: input.name.trim(),
      code,
      contactName: input.contactName?.trim() || null,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      address: input.address?.trim() || null,
      taxNumber: input.taxNumber?.trim() || null,
      defaultCurrency: (input.defaultCurrency || 'MWK').toUpperCase(),
      paymentTermsDays: input.paymentTermsDays ?? 30,
      isActive: input.isActive ?? true,
      createdBy: actorId ?? null,
    })
    .returning();

  await writeAuditLog(db, {
    userId: actorId,
    action: 'supplier.create',
    entityType: 'supplier',
    entityId: created!.id,
    after: created,
  });

  return created!;
}

export async function updateSupplier(id: string, input: Partial<SupplierInput>, actorId?: string) {
  const existing = await getSupplierById(id);
  if (!existing) throw new Error('Supplier not found');

  const updateData: Record<string, any> = { updatedAt: new Date() };
  if (input.name !== undefined) updateData['name'] = input.name.trim();
  if (input.code !== undefined) updateData['code'] = input.code.trim().toUpperCase();
  if (input.contactName !== undefined) updateData['contactName'] = input.contactName?.trim() || null;
  if (input.email !== undefined) updateData['email'] = input.email?.trim() || null;
  if (input.phone !== undefined) updateData['phone'] = input.phone?.trim() || null;
  if (input.address !== undefined) updateData['address'] = input.address?.trim() || null;
  if (input.taxNumber !== undefined) updateData['taxNumber'] = input.taxNumber?.trim() || null;
  if (input.defaultCurrency !== undefined) updateData['defaultCurrency'] = input.defaultCurrency.toUpperCase();
  if (input.paymentTermsDays !== undefined) updateData['paymentTermsDays'] = input.paymentTermsDays;
  if (input.isActive !== undefined) updateData['isActive'] = input.isActive;

  const [updated] = await db
    .update(suppliers)
    .set(updateData)
    .where(eq(suppliers.id, id))
    .returning();

  await writeAuditLog(db, {
    userId: actorId,
    action: 'supplier.update',
    entityType: 'supplier',
    entityId: id,
    before: existing,
    after: updated,
  });

  return updated!;
}
