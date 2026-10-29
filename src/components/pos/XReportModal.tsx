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
import { Separator } from '@/components/ui/separator';
import { Printer, EyeOff, Loader2 } from 'lucide-react';
import { getXReportAction } from '@/app/(app)/pos/actions';
import { formatMwk } from '@/lib/money';
import { toast } from 'sonner';

interface XReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  shiftId: string;
}

export function XReportModal({ isOpen, onClose, shiftId }: XReportModalProps) {
  const [report, setReport] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && shiftId) {
      setLoading(true);
      getXReportAction(shiftId)
        .then((data) => setReport(data))
        .catch((err: unknown) => {
          toast.error(err instanceof Error ? err.message : 'Failed to generate X-Report');
        })
        .finally(() => setLoading(false));
    }
  }, [isOpen, shiftId]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md print:p-0 print:border-none">
        <DialogHeader className="print:hidden">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-lg font-bold text-ace-navy">X-Report (Interim)</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Mid-shift snapshot. Shift remains open.
              </DialogDescription>
            </div>
            <Button size="sm" variant="outline" onClick={handlePrint} className="h-8">
              <Printer className="mr-1.5 h-3.5 w-3.5" />
              Print
            </Button>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Generating live X-Report...
          </div>
        ) : !report ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No report data available.
          </div>
        ) : (
          <div className="space-y-3 font-mono text-xs">
            {/* Header */}
            <div className="text-center space-y-0.5 border-b border-border pb-2">
              <div className="font-bold text-sm text-foreground">ACE HOLDINGS</div>
              <div className="text-muted-foreground">X-REPORT — MID-SHIFT SUMMARY</div>
              <div className="text-[11px] text-muted-foreground">
                Shift: {report.shiftNumber} | Till: {report.locationName}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Cashier: {report.cashierName}
              </div>
              <div className="text-[10px] text-muted-foreground">
                Generated: {new Date(report.generatedAt).toLocaleString()}
              </div>
            </div>

            {/* Figures */}
            <div className="space-y-1.5 py-1">
              {report.blindCashUp ? (
                <div className="rounded-md bg-muted/60 p-2.5 text-center text-muted-foreground space-y-1">
                  <div className="flex items-center justify-center gap-1.5 font-sans font-semibold text-xs text-foreground">
                    <EyeOff className="h-3.5 w-3.5 text-ace-navy" />
                    Blind Cash-Up Policy Active
                  </div>
                  <p className="text-[11px] font-sans">
                    System cash totals are hidden until you close shift and submit counted cash.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span>Opening Float:</span>
                    <span className="font-bold">{formatMwk(report.openingFloatMinor)}</span>
                  </div>
                  <div className="flex justify-between text-ace-success">
                    <span>Cash Sales:</span>
                    <span>+{formatMwk(report.cashReceiptsMinor ?? 0)}</span>
                  </div>
                  <div className="flex justify-between text-destructive">
                    <span>Cash Refunds:</span>
                    <span>-{formatMwk(report.cashRefundsMinor ?? 0)}</span>
                  </div>
                  <div className="flex justify-between text-ace-blue">
                    <span>Cash In (Float/Top-up):</span>
                    <span>+{formatMwk(report.cashPaidInMinor ?? 0)}</span>
                  </div>
                  <div className="flex justify-between text-destructive">
                    <span>Cash Out (Drop/Expense):</span>
                    <span>-{formatMwk(report.cashPaidOutMinor ?? 0)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between font-bold text-sm text-foreground pt-1">
                    <span>Expected Cash in Drawer:</span>
                    <span className="text-ace-navy">{formatMwk(report.expectedCashMinor ?? 0)}</span>
                  </div>
                </>
              )}
            </div>

            {/* Non-cash tender totals (always shown) */}
            <div className="border-t border-border pt-2 space-y-1">
              <div className="font-bold text-[11px] text-muted-foreground uppercase">
                Electronic Tender Totals
              </div>
              <div className="flex justify-between">
                <span>Card Receipts:</span>
                <span className="font-semibold">{formatMwk(report.cardReceiptsMinor ?? 0)}</span>
              </div>
              <div className="flex justify-between">
                <span>Mobile Money (Airtel/Mpamba):</span>
                <span className="font-semibold">{formatMwk(report.mobileMoneyReceiptsMinor ?? 0)}</span>
              </div>
            </div>

            {/* Transaction counts */}
            <div className="border-t border-border pt-2 space-y-1 text-muted-foreground">
              <div className="flex justify-between">
                <span>Sale Transactions:</span>
                <span>{report.salesCount ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span>Refund Transactions:</span>
                <span>{report.refundsCount ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span>Cash Movements:</span>
                <span>{report.movementsCount ?? 0}</span>
              </div>
            </div>

            <div className="text-center text-[10px] text-muted-foreground pt-2 border-t border-dashed border-border">
              *** END OF X-REPORT (TILL REMAINS OPEN) ***
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
