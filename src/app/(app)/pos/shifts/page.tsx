import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import { posShifts, locations, users } from '@/server/db/schema';
import { eq, desc } from 'drizzle-orm';
import { getCurrentShiftAction } from '../actions';
import { ShiftsClient } from '@/components/pos/ShiftsClient';

export const metadata = {
  title: 'POS Shifts | Ace Holdings',
  description: 'Point of sale shifts and cash drawer management',
};

export default async function POSShiftsPage() {
  const actor = await authorize(PERMISSIONS.POS_ACCESS);
  const currentShift = await getCurrentShiftAction();
  const canReview = actor.role.permissions.includes(PERMISSIONS.SHIFTS_MANAGE);

  // Fetch shift history (ordered by openedAt desc)
  const rows = await db
    .select({
      id: posShifts.id,
      shiftNumber: posShifts.shiftNumber,
      cashierId: posShifts.cashierId,
      cashierName: users.name,
      locationId: posShifts.locationId,
      locationName: locations.name,
      status: posShifts.status,
      openedAt: posShifts.openedAt,
      closedAt: posShifts.closedAt,
      reviewedAt: posShifts.reviewedAt,
      reviewNote: posShifts.reviewNote,
      openingFloatMinor: posShifts.openingFloatMinor,
      countedCashMinor: posShifts.countedCashMinor,
      expectedCashMinor: posShifts.expectedCashMinor,
      cashVarianceMinor: posShifts.cashVarianceMinor,
    })
    .from(posShifts)
    .innerJoin(locations, eq(posShifts.locationId, locations.id))
    .innerJoin(users, eq(posShifts.cashierId, users.id))
    .orderBy(desc(posShifts.openedAt))
    .limit(50);

  return (
    <ShiftsClient
      currentShift={currentShift}
      shiftHistory={rows}
      canReview={canReview}
      currentUser={{
        id: actor.id,
        name: actor.name,
      }}
    />
  );
}
