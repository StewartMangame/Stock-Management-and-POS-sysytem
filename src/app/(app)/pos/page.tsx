import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { getCurrentShiftAction, listLocationsAction } from './actions';
import { POSClient } from '@/components/pos/POSClient';

export const metadata = {
  title: 'Counter POS | Ace Holdings',
  description: 'Point of sale checkout register',
};

export default async function POSPage() {
  const actor = await authorize(PERMISSIONS.POS_ACCESS);
  const currentShift = await getCurrentShiftAction();
  const locations = await listLocationsAction();

  return (
    <POSClient
      initialShift={currentShift}
      locations={locations}
      currentUser={{
        id: actor.id,
        name: actor.name,
        roleName: actor.role.name,
      }}
    />
  );
}
