'use client';

import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MapPin, Plus, Edit } from 'lucide-react';
import { LocationDialog } from './LocationDialog';

interface LocationItem {
  id: string;
  name: string;
  code: string;
  type: 'outlet' | 'warehouse' | string;
  address: string | null;
  isActive: boolean;
  createdAt: Date;
}

interface Props {
  locations: LocationItem[];
}

export function LocationsTable({ locations }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<LocationItem | undefined>(undefined);

  const handleCreate = () => {
    setSelectedLocation(undefined);
    setDialogOpen(true);
  };

  const handleEdit = (loc: LocationItem) => {
    setSelectedLocation(loc);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ace-navy">Locations Management</h1>
          <p className="text-sm text-ace-muted">
            Manage physical retail outlets, branches, and distribution warehouses.
          </p>
        </div>
        <Button onClick={handleCreate} id="add-location-btn">
          <Plus className="mr-2 h-4 w-4" />
          Add Location
        </Button>
      </div>

      <div className="rounded-lg border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Location</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {locations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-ace-muted">
                  No locations configured yet.
                </TableCell>
              </TableRow>
            ) : (
              locations.map((loc) => (
                <TableRow key={loc.id}>
                  <TableCell className="font-medium text-ace-navy">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-ace-blue shrink-0" />
                      <span>{loc.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <code className="rounded bg-gray-100 px-2 py-0.5 text-xs font-mono font-semibold">
                      {loc.code}
                    </code>
                  </TableCell>
                  <TableCell>
                    <Badge variant={loc.type === 'outlet' ? 'default' : 'secondary'}>
                      {loc.type === 'outlet' ? 'Retail Outlet' : 'Warehouse'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-ace-muted max-w-xs truncate">
                    {loc.address || '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={loc.isActive ? 'outline' : 'destructive'} className={loc.isActive ? 'border-emerald-500 text-emerald-700 bg-emerald-50' : ''}>
                      {loc.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(loc)}
                      id={`edit-loc-${loc.code.toLowerCase()}`}
                    >
                      <Edit className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <LocationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        location={selectedLocation}
      />
    </div>
  );
}
