import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import { cardTerminals, posShifts } from '@/server/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * GET /api/pos/terminals
 *
 * Returns active card terminals configured for the current location.
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await authorize(PERMISSIONS.POS_ACCESS);
    const { searchParams } = new URL(req.url);

    let locationId = searchParams.get('locationId');

    if (!locationId) {
      const [openShift] = await db
        .select({ locationId: posShifts.locationId })
        .from(posShifts)
        .where(and(eq(posShifts.cashierId, actor.id), eq(posShifts.status, 'open')))
        .limit(1);

      if (openShift) {
        locationId = openShift.locationId;
      }
    }

    const whereConditions = [eq(cardTerminals.isActive, true)];
    if (locationId) {
      whereConditions.push(eq(cardTerminals.locationId, locationId));
    }

    const rows = await db
      .select({
        id: cardTerminals.id,
        name: cardTerminals.name,
        terminalId: cardTerminals.terminalId,
        locationId: cardTerminals.locationId,
      })
      .from(cardTerminals)
      .where(and(...whereConditions));

    return NextResponse.json({ terminals: rows });
  } catch (err: unknown) {
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : 'Failed to fetch card terminals';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
