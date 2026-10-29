'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clock, Trash2, ArrowUpRight, AlertTriangle, Loader2 } from 'lucide-react';
import { listHeldSalesAction, recallHeldSaleAction, discardHeldSaleAction } from '@/app/(app)/pos/actions';
import { toast } from 'sonner';

interface HeldSalesModalProps {
  isOpen: boolean;
  onClose: () => void;
  shiftId: string;
  onRecallCart: (recalledData: any) => void;
}

export function HeldSalesModal({
  isOpen,
  onClose,
  shiftId,
  onRecallCart,
}: HeldSalesModalProps) {
  const [heldList, setHeldList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  const loadHeldSales = async () => {
    if (!shiftId) return;
    setLoading(true);
    try {
      const data = await listHeldSalesAction(shiftId);
      setHeldList(data);
    } catch (err: unknown) {
      toast.error('Failed to load held sales');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadHeldSales();
    }
  }, [isOpen, shiftId]);

  const handleRecall = async (heldSaleId: string) => {
    setActionId(heldSaleId);
    try {
      const result = await recallHeldSaleAction(heldSaleId);
      const priceChanges = result.lines.filter((l: any) => l.priceChanged);
      const stockShortages = result.lines.filter((l: any) => l.stockInsufficient);

      if (priceChanges.length > 0) {
        toast.warning(
          `Notice: ${priceChanges.length} item(s) have updated prices since being held.`,
        );
      }
      if (stockShortages.length > 0) {
        toast.error(
          `Warning: ${stockShortages.length} item(s) have low or insufficient stock!`,
        );
      }
      onRecallCart(result);
      toast.success('Sale resumed from hold');
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to recall held sale');
    } finally {
      setActionId(null);
    }
  };

  const handleDiscard = async (heldSaleId: string) => {
    if (!confirm('Are you sure you want to discard this held sale?')) return;
    setActionId(heldSaleId);
    try {
      await discardHeldSaleAction(heldSaleId);
      toast.success('Held sale discarded');
      setHeldList((prev) => prev.filter((h) => h.id !== heldSaleId));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to discard held sale');
    } finally {
      setActionId(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-lg font-bold text-ace-navy">Held Sales</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Recall a suspended cart or discard abandoned holds
              </DialogDescription>
            </div>
            <Badge variant="outline" className="border-ace-sky text-ace-sky font-semibold">
              {heldList.length} Held
            </Badge>
          </div>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto space-y-3 py-2 pr-1">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading held sales...
            </div>
          ) : heldList.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-8 text-center text-muted-foreground text-sm">
              No sales currently on hold for this shift.
            </div>
          ) : (
            heldList.map((hold) => {
              const lines = (hold.cartPayload?.lines as any[]) || [];
              const itemCount = lines.reduce((acc, l) => acc + Number(l.quantity || 1), 0);
              const isBusy = actionId === hold.id;

              return (
                <div
                  key={hold.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-border p-3.5 transition-colors hover:border-ace-sky/50 bg-card"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-foreground">
                        {hold.holdReference}
                      </span>
                      {hold.customerName && (
                        <Badge variant="secondary" className="text-xs">
                          {hold.customerName}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {new Date(hold.heldAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span>•</span>
                      <span>
                        {itemCount} {itemCount === 1 ? 'item' : 'items'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isBusy}
                      onClick={() => handleDiscard(hold.id)}
                      className="text-destructive hover:bg-destructive/10 h-8 px-2.5"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      disabled={isBusy}
                      onClick={() => handleRecall(hold.id)}
                      className="bg-ace-blue hover:bg-ace-navy text-white h-8 text-xs font-semibold px-3"
                    >
                      {isBusy ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ArrowUpRight className="mr-1 h-3.5 w-3.5" />
                      )}
                      Resume Sale
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
