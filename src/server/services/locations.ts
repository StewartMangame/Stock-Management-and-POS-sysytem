/**
 * Location service — simple helpers for fetching location records.
 */

import { db } from '@/server/db';
import { locations } from '@/server/db/schema';
import { eq, asc } from 'drizzle-orm';

export async function getLocations(activeOnly = true) {
  const query = db.select().from(locations).orderBy(asc(locations.name));
  if (activeOnly) {
    return db
      .select()
      .from(locations)
      .where(eq(locations.isActive, true))
      .orderBy(asc(locations.name));
  }
  return query;
}

export async function getLocationById(id: string) {
  const [location] = await db
    .select()
    .from(locations)
    .where(eq(locations.id, id));
  return location ?? null;
}
