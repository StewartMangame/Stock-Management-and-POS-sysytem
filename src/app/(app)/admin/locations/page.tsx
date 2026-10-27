import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { listLocations } from '@/server/services/stock/locations';
import { LocationsTable } from './LocationsTable';

export const metadata: Metadata = {
  title: 'Locations | Ace Holdings POS',
};

export default async function LocationsPage() {
  try {
    await authorize(PERMISSIONS.LOCATIONS_MANAGE);
  } catch {
    redirect('/dashboard');
  }

  const locationsList = await listLocations();

  return <LocationsTable locations={locationsList} />;
}
