import { db } from '@/server/db';
import { categories } from '@/server/db/schema';
import { eq, desc, asc } from 'drizzle-orm';
import { writeAuditLog } from '@/server/services/audit';

export interface CategoryInput {
  name: string;
  code: string;
  description?: string;
  parentId?: string | null;
  isActive?: boolean;
}

export async function listCategories() {
  return await db.query.categories.findMany({
    orderBy: [asc(categories.name)],
    with: {
      parent: true,
      children: true,
    },
  });
}

export async function getCategoryById(id: string) {
  return await db.query.categories.findFirst({
    where: eq(categories.id, id),
    with: { parent: true, children: true },
  });
}

export async function createCategory(input: CategoryInput, actorId?: string) {
  const code = input.code.trim().toUpperCase();
  const [created] = await db
    .insert(categories)
    .values({
      name: input.name.trim(),
      code,
      description: input.description?.trim() || null,
      parentId: input.parentId || null,
      isActive: input.isActive ?? true,
      createdBy: actorId ?? null,
    })
    .returning();

  await writeAuditLog(db, {
    userId: actorId,
    action: 'category.create',
    entityType: 'category',
    entityId: created!.id,
    after: created,
  });

  return created!;
}

export async function updateCategory(id: string, input: Partial<CategoryInput>, actorId?: string) {
  const existing = await getCategoryById(id);
  if (!existing) throw new Error('Category not found');

  const updateData: Record<string, any> = { updatedAt: new Date() };
  if (input.name !== undefined) updateData['name'] = input.name.trim();
  if (input.code !== undefined) updateData['code'] = input.code.trim().toUpperCase();
  if (input.description !== undefined) updateData['description'] = input.description?.trim() || null;
  if (input.parentId !== undefined) updateData['parentId'] = input.parentId || null;
  if (input.isActive !== undefined) updateData['isActive'] = input.isActive;

  const [updated] = await db
    .update(categories)
    .set(updateData)
    .where(eq(categories.id, id))
    .returning();

  await writeAuditLog(db, {
    userId: actorId,
    action: 'category.update',
    entityType: 'category',
    entityId: id,
    before: existing,
    after: updated,
  });

  return updated!;
}
