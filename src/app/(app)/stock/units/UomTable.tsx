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
import { UomDialog } from './UomDialog';
import { Plus, Edit2, Scale } from 'lucide-react';

interface UOMItem {
  id: string;
  name: string;
  code: string;
  symbol: string;
  allowDecimal: boolean;
  isActive: boolean;
}

interface Props {
  units: UOMItem[];
}

export function UomTable({ units }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedUom, setSelectedUom] = useState<UOMItem | null>(null);

  const handleCreate = () => {
    setSelectedUom(null);
    setDialogOpen(true);
  };

  const handleEdit = (uom: UOMItem) => {
    setSelectedUom(uom);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ace-navy">Units of Measure (UOM)</h1>
          <p className="text-sm text-ace-muted">
            Standard measurement units for inventory, sales pricing, and packaging.
          </p>
        </div>
        <Button onClick={handleCreate} id="new-uom-btn">
          <Plus className="mr-2 h-4 w-4" />
          New Unit
        </Button>
      </div>

      <div className="rounded-lg border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Unit Name</TableHead>
              <TableHead>Symbol</TableHead>
              <TableHead>Decimal Allowed</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {units.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-ace-muted">
                  <div className="flex flex-col items-center justify-center gap-1">
                    <Scale className="h-6 w-6 text-gray-400" />
                    <p>No units of measure found.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              units.map((uom) => (
                <TableRow key={uom.id}>
                  <TableCell className="font-mono text-sm font-semibold text-ace-navy">
                    {uom.code}
                  </TableCell>
                  <TableCell className="font-medium text-ace-navy">
                    {uom.name}
                  </TableCell>
                  <TableCell className="font-mono text-sm font-bold text-ace-blue">
                    {uom.symbol}
                  </TableCell>
                  <TableCell>
                    <Badge variant={uom.allowDecimal ? 'outline' : 'secondary'} className="text-xs">
                      {uom.allowDecimal ? 'Yes (Fractional)' : 'No (Integers only)'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={uom.isActive ? 'default' : 'secondary'} className="text-xs">
                      {uom.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => handleEdit(uom)}>
                      <Edit2 className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <UomDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        uom={selectedUom}
      />
    </div>
  );
}
