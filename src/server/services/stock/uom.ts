import { db } from '@/server/db';
import { unitsOfMeasure } from '@/server/db/schema';
import { eq, asc } from 'drizzle-orm';

export interface UomInput {
  name: string;
  code: string;
  symbol: string;
  allowDecimal?: boolean;
  isActive?: boolean;
}

export async function listUnitsOfMeasure() {
  return await db.query.unitsOfMeasure.findMany({
    orderBy: [asc(unitsOfMeasure.name)],
  });
}

export async function getUnitOfMeasureById(id: string) {
  return await db.query.unitsOfMeasure.findFirst({
    where: eq(unitsOfMeasure.id, id),
  });
}

export async function createUnitOfMeasure(input: UomInput) {
  const code = input.code.trim().toUpperCase();
  const [created] = await db
    .insert(unitsOfMeasure)
    .values({
      name: input.name.trim(),
      code,
      symbol: input.symbol.trim(),
      allowDecimal: input.allowDecimal ?? false,
      isActive: input.isActive ?? true,
    })
    .returning();

  return created!;
}

export async function updateUnitOfMeasure(id: string, input: Partial<UomInput>) {
  const updateData: Record<string, any> = {};
  if (input.name !== undefined) updateData['name'] = input.name.trim();
  if (input.code !== undefined) updateData['code'] = input.code.trim().toUpperCase();
  if (input.symbol !== undefined) updateData['symbol'] = input.symbol.trim();
  if (input.allowDecimal !== undefined) updateData['allowDecimal'] = input.allowDecimal;
  if (input.isActive !== undefined) updateData['isActive'] = input.isActive;

  const [updated] = await db
    .update(unitsOfMeasure)
    .set(updateData)
    .where(eq(unitsOfMeasure.id, id))
    .returning();

  return updated!;
}
