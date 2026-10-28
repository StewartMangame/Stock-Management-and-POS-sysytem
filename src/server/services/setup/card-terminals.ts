/**
 * Card Terminal Management Service.
 *
 * Implements CRUD for standalone acquirer card payment terminals per location.
 */

import { db } from '@/server/db';
import { cardTerminals, locations } from '@/server/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { writeAuditLog } from '@/server/services/audit';

export interface CardTerminalFilter {
  locationId?: string;
  isActive?: boolean;
}

export async function getCardTerminals(filter: CardTerminalFilter = {}) {
  const conditions = [];

  if (filter.locationId) {
    conditions.push(eq(cardTerminals.locationId, filter.locationId));
  }
  if (filter.isActive !== undefined) {
    conditions.push(eq(cardTerminals.isActive, filter.isActive));
  }

  return await db
    .select({
      terminal: cardTerminals,
      locationName: locations.name,
      locationCode: locations.code,
    })
    .from(cardTerminals)
    .innerJoin(locations, eq(cardTerminals.locationId, locations.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(cardTerminals.createdAt));
}

export async function getCardTerminalById(id: string) {
  const [terminal] = await db
    .select()
    .from(cardTerminals)
    .where(eq(cardTerminals.id, id));

  return terminal || null;
}

export async function createCardTerminal(
  data: {
    name: string;
    terminalId: string;
    locationId: string;
    isActive?: boolean;
  },
  userId?: string,
) {
  const [created] = await db
    .insert(cardTerminals)
    .values({
      name: data.name,
      terminalId: data.terminalId,
      locationId: data.locationId,
      isActive: data.isActive ?? true,
      createdBy: userId ?? null,
    })
    .returning();

  if (!created) {
    throw new Error('Failed to create card terminal');
  }

  await writeAuditLog(db, {
    userId,
    action: 'card_terminal.create',
    entityType: 'card_terminal',
    entityId: created.id,
    after: created,
  });

  return created;
}

export async function updateCardTerminal(
  id: string,
  data: {
    name?: string;
    terminalId?: string;
    locationId?: string;
    isActive?: boolean;
  },
  userId?: string,
) {
  const [existing] = await db
    .select()
    .from(cardTerminals)
    .where(eq(cardTerminals.id, id));

  if (!existing) {
    throw new Error(`Card terminal ${id} not found`);
  }

  const [updated] = await db
    .update(cardTerminals)
    .set({
      ...data,
    })
    .where(eq(cardTerminals.id, id))
    .returning();

  if (!updated) {
    throw new Error(`Failed to update card terminal ${id}`);
  }

  await writeAuditLog(db, {
    userId,
    action: 'card_terminal.update',
    entityType: 'card_terminal',
    entityId: id,
    before: existing,
    after: updated,
  });

  return updated;
}
