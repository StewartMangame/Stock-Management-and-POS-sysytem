'use client';

import { useState, useTransition, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { createUomAction } from './actions';

export interface UOMItem {
  id: string;
  name: string;
  code: string;
  symbol: string;
  allowDecimal: boolean;
  isActive: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  uom?: UOMItem | null;
  onSuccess?: (uom: UOMItem) => void;
}

export function UomDialog({ open, onOpenChange, uom, onSuccess }: Props) {
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [symbol, setSymbol] = useState('');
  const [allowDecimal, setAllowDecimal] = useState(false);
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (uom) {
      setName(uom.name);
      setCode(uom.code);
      setSymbol(uom.symbol);
      setAllowDecimal(uom.allowDecimal);
      setIsActive(uom.isActive);
    } else {
      setName('');
      setCode('');
      setSymbol('');
      setAllowDecimal(false);
      setIsActive(true);
    }
  }, [uom, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !code.trim() || !symbol.trim()) {
      toast.error('Name, code, and symbol are required.');
      return;
    }

    startTransition(async () => {
      try {
        const payload = {
          name: name.trim(),
          code: code.trim().toUpperCase(),
          symbol: symbol.trim(),
          allowDecimal,
          isActive,
        };

        const res = await createUomAction(payload);
        toast.success('Unit of measure created successfully');
        if (res?.uom && onSuccess) {
          onSuccess(res.uom as UOMItem);
        }
        onOpenChange(false);
      } catch (err: any) {
        toast.error(err.message || 'Operation failed');
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{uom ? 'Edit Unit of Measure' : 'New Unit of Measure'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="uom-name">Name *</Label>
            <Input
              id="uom-name"
              placeholder="e.g. Kilogram, Piece, Box, Roll"
              value={name}
              onChange={(e) => {
                const val = e.target.value;
                setName(val);
                if (!code && val.length <= 4) {
                  setCode(val.toUpperCase());
                }
              }}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="uom-code">Code *</Label>
              <Input
                id="uom-code"
                placeholder="e.g. KG, PCS, ROL"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="uom-symbol">Symbol *</Label>
              <Input
                id="uom-symbol"
                placeholder="e.g. kg, pcs, rl"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="space-y-0.5">
              <Label htmlFor="uom-decimal" className="cursor-pointer">
                Allow Fractional Quantities
              </Label>
              <p className="text-xs text-ace-muted">
                Enable for bulk items sold in decimals (e.g. 1.250 kg)
              </p>
            </div>
            <Switch
              id="uom-decimal"
              checked={allowDecimal}
              onCheckedChange={setAllowDecimal}
            />
          </div>

          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving...' : 'Create Unit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

