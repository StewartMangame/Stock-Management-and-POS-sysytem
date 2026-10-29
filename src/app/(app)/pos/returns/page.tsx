import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { getCurrentShiftAction } from '../actions';
import { ReturnsClient } from '@/components/pos/ReturnsClient';

export const metadata = {
  title: 'Counter Returns | Ace Holdings POS',
  description: 'Process customer returns and cash refunds',
};

export default async function POSReturnsPage() {
  const actor = await authorize(PERMISSIONS.POS_ACCESS);
  const currentShift = await getCurrentShiftAction();

  return (
    <ReturnsClient
      currentShift={currentShift}
      currentUser={{
        id: actor.id,
        name: actor.name,
      }}
    />
  );
}
