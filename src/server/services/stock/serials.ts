import { db } from '@/server/db';
import { serialNumbers, products, locations, stockMovements } from '@/server/db/schema';
import { eq, and, sql, desc, asc, ilike } from 'drizzle-orm';

export async function listSerialNumbers(filters?: {
  productId?: string;
  locationId?: string;
  status?: string;
  search?: string;
}) {
  const conditions = [];

  if (filters?.productId) conditions.push(eq(serialNumbers.productId, filters.productId));
  if (filters?.locationId) conditions.push(eq(serialNumbers.locationId, filters.locationId));
  if (filters?.status) conditions.push(eq(serialNumbers.status, filters.status));
  if (filters?.search) {
    const term = `%${filters.search.trim()}%`;
    conditions.push(ilike(serialNumbers.serialNumber, term));
  }

  return await db.query.serialNumbers.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(serialNumbers.createdAt)],
    with: {
      product: true,
      location: true,
    },
  });
}

export async function getSerialNumberById(id: string) {
  return await db.query.serialNumbers.findFirst({
    where: eq(serialNumbers.id, id),
    with: {
      product: true,
      location: true,
    },
  });
}

export async function lookupSerialByNumber(productId: string, serialNumber: string) {
  return await db.query.serialNumbers.findFirst({
    where: and(
      eq(serialNumbers.productId, productId),
      sql`lower(${serialNumbers.serialNumber}) = lower(${serialNumber.trim()})`,
    ),
    with: {
      product: true,
      location: true,
    },
  });
}
