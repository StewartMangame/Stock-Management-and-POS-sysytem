import { db } from '@/server/db';
import { locations, numberSequences } from '@/server/db/schema';
import { eq, asc } from 'drizzle-orm';
import { writeAuditLog } from '@/server/services/audit';

export interface LocationInput {
  name: string;
  code: string;
  type: 'outlet' | 'warehouse';
  address?: string;
  isActive?: boolean;
}

export async function listLocations() {
  return await db.query.locations.findMany({
    orderBy: [asc(locations.name)],
  });
}

export async function getLocationById(id: string) {
  return await db.query.locations.findFirst({
    where: eq(locations.id, id),
  });
}

export async function createLocation(input: LocationInput, actorId?: string) {
  const code = input.code.trim().toUpperCase();

  const [created] = await db
    .insert(locations)
    .values({
      name: input.name.trim(),
      code,
      type: input.type,
      address: input.address?.trim() || null,
      isActive: input.isActive ?? true,
      createdBy: actorId ?? null,
    })
    .returning();

  // Create standard document number sequences for this new location
  const docTypes = [
    { type: 'invoice', prefix: `${code}-INV` },
    { type: 'quotation', prefix: `${code}-QT` },
    { type: 'delivery_note', prefix: `${code}-DN` },
    { type: 'credit_note', prefix: `${code}-CN` },
    { type: 'purchase_order', prefix: `${code}-PO` },
    { type: 'goods_receipt', prefix: `${code}-GRN` },
    { type: 'stock_adjustment', prefix: `${code}-ADJ` },
    { type: 'stock_count', prefix: `${code}-CNT` },
  ];

  for (const dt of docTypes) {
    await db
      .insert(numberSequences)
      .values({
        docType: dt.type,
        locationId: created!.id,
        prefix: dt.prefix,
        nextNumber: 1,
        padding: 4,
      })
      .onConflictDoNothing();
  }

  await writeAuditLog(db, {
    userId: actorId,
    action: 'location.create',
    entityType: 'location',
    entityId: created!.id,
    after: created,
  });

  return created!;
}

export async function updateLocation(id: string, input: Partial<LocationInput>, actorId?: string) {
  const existing = await getLocationById(id);
  if (!existing) throw new Error('Location not found');

  const updateData: Record<string, any> = { updatedAt: new Date() };
  if (input.name !== undefined) updateData['name'] = input.name.trim();
  if (input.code !== undefined) updateData['code'] = input.code.trim().toUpperCase();
  if (input.type !== undefined) updateData['type'] = input.type;
  if (input.address !== undefined) updateData['address'] = input.address?.trim() || null;
  if (input.isActive !== undefined) updateData['isActive'] = input.isActive;

  const [updated] = await db
    .update(locations)
    .set(updateData)
    .where(eq(locations.id, id))
    .returning();

  await writeAuditLog(db, {
    userId: actorId,
    action: 'location.update',
    entityType: 'location',
    entityId: id,
    before: existing,
    after: updated,
  });

  return updated!;
}
