import React from 'react';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { getCardTerminals } from '@/server/services/setup/card-terminals';
import { getLocations } from '@/server/services/locations';
import { CardTerminalsClient } from './CardTerminalsClient';

export default async function CardTerminalsPage() {
  await authorize(PERMISSIONS.SETTINGS_VIEW);

  const terminals = await getCardTerminals();
  const rawLocations = await getLocations();

  const locations = rawLocations.map((l) => ({
    id: l.id,
    name: l.name,
    code: l.code,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Card Terminals Management
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Configure physical merchant acquiring card terminals associated with specific business locations.
        </p>
      </div>

      <CardTerminalsClient terminals={terminals} locations={locations} />
    </div>
  );
}
