'use client';

import { useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, ArrowRight, CheckCircle } from 'lucide-react';
import { formatMwk } from '@/lib/money';

interface PostSaleModalProps {
  isOpen: boolean;
  onClose: () => void;
  saleResult: {
    invoiceId: string;
    invoiceNumber: string;
    totalMinor: number;
    changeMinor: number;
  } | null;
  onNextCustomer: () => void;
}

export function PostSaleModal({
  isOpen,
  onClose,
  saleResult,
  onNextCustomer,
}: PostSaleModalProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Auto-focus Next Customer on Enter
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onNextCustomer();
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        handlePrint();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onNextCustomer]);

  const handlePrint = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.focus();
      iframeRef.current.contentWindow.print();
    }
  };

  if (!saleResult) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center sm:text-center pb-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 mb-2">
            <CheckCircle className="h-7 w-7" />
          </div>
          <DialogTitle className="text-xl font-bold text-foreground">
            Sale Completed!
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Invoice #{saleResult.invoiceNumber}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Change Display */}
          {saleResult.changeMinor > 0 ? (
            <div className="rounded-xl bg-emerald-50 border-2 border-emerald-400 p-4 text-center shadow-sm">
              <span className="text-xs font-bold text-emerald-800 uppercase tracking-widest">
                Change Due to Customer
              </span>
              <div className="text-3xl font-black text-emerald-700 mt-1">
                {formatMwk(saleResult.changeMinor)}
              </div>
            </div>
          ) : (
            <div className="rounded-lg bg-muted/60 p-3 text-center text-xs text-muted-foreground font-medium">
              Exact payment received. No change due.
            </div>
          )}

          {/* Hidden print iframe */}
          <iframe
            ref={iframeRef}
            src={`/api/pos/receipt?invoiceId=${saleResult.invoiceId}&format=html`}
            className="w-full h-48 border border-border rounded-lg bg-white"
            title="Thermal Receipt Preview"
          />
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2 border-t border-border">
          <Button
            type="button"
            variant="outline"
            onClick={handlePrint}
            className="w-full sm:w-1/2 font-semibold text-xs h-10"
          >
            <Printer className="mr-2 h-4 w-4" />
            Print Receipt (P)
          </Button>
          <Button
            type="button"
            onClick={onNextCustomer}
            autoFocus
            className="w-full sm:w-1/2 bg-ace-navy hover:bg-ace-navy-deep text-white font-bold text-xs h-10 shadow-sm"
          >
            Next Customer (Enter)
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
