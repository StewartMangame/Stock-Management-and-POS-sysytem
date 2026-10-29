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
import { Badge } from '@/components/ui/badge';
import { Printer, Loader2 } from 'lucide-react';
import { getZReportAction } from '@/app/(app)/pos/actions';
import { formatMwk } from '@/lib/money';
import { toast } from 'sonner';

interface ZReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  shiftId: string;
}

export function ZReportModal({ isOpen, onClose, shiftId }: ZReportModalProps) {
  const [report, setReport] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && shiftId) {
      setLoading(true);
      getZReportAction(shiftId)
        .then((data) => setReport(data))
        .catch((err: unknown) => {
          toast.error(err instanceof Error ? err.message : 'Failed to load Z-Report');
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
              <DialogTitle className="text-lg font-bold text-ace-navy">Z-Report (End of Shift)</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Final reconciliation after shift closing
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
            Loading Z-Report...
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
              <div className="text-muted-foreground font-semibold">Z-REPORT — END OF SHIFT</div>
              <div className="text-[11px] text-muted-foreground">
                Shift #{report.shiftNumber} | {report.locationName}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Cashier: {report.cashierName}
              </div>
              <div className="text-[10px] text-muted-foreground">
                Opened: {new Date(report.openedAt).toLocaleString()}
                <br />
                Closed: {report.closedAt ? new Date(report.closedAt).toLocaleString() : 'N/A'}
              </div>
            </div>

            {/* Reconciliation summary */}
            <div className="space-y-1.5 py-1">
              <div className="flex justify-between">
                <span>Opening Float:</span>
                <span>{formatMwk(report.openingFloatMinor)}</span>
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
                <span>Cash Paid In:</span>
                <span>+{formatMwk(report.cashPaidInMinor ?? 0)}</span>
              </div>
              <div className="flex justify-between text-destructive">
                <span>Cash Paid Out:</span>
                <span>-{formatMwk(report.cashPaidOutMinor ?? 0)}</span>
              </div>

              <Separator className="my-1.5" />

              <div className="flex justify-between font-semibold">
                <span>Expected Cash:</span>
                <span>{formatMwk(report.expectedCashMinor ?? 0)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Counted Cash:</span>
                <span>{formatMwk(report.countedCashMinor ?? 0)}</span>
              </div>

              {/* Cash Variance */}
              <div className="flex items-center justify-between font-bold text-sm pt-1">
                <span>Cash Variance:</span>
                <span
                  className={
                    report.cashVarianceMinor === 0
                      ? 'text-ace-success'
                      : report.cashVarianceMinor > 0
                        ? 'text-ace-blue'
                        : 'text-destructive'
                  }
                >
                  {report.cashVarianceMinor > 0 ? '+' : ''}
                  {formatMwk(report.cashVarianceMinor ?? 0)}
                  {report.cashVarianceMinor === 0 && ' (Exact)'}
                  {report.cashVarianceMinor > 0 && ' (Over)'}
                  {report.cashVarianceMinor < 0 && ' (Short)'}
                </span>
              </div>
            </div>

            {/* Non-cash totals */}
            <div className="border-t border-border pt-2 space-y-1">
              <div className="font-bold text-[11px] text-muted-foreground uppercase">
                Electronic Tender Totals
              </div>
              <div className="flex justify-between">
                <span>Card Receipts:</span>
                <span className="font-semibold">{formatMwk(report.cardReceiptsMinor ?? 0)}</span>
              </div>
              <div className="flex justify-between">
                <span>Mobile Money:</span>
                <span className="font-semibold">{formatMwk(report.mobileMoneyReceiptsMinor ?? 0)}</span>
              </div>
            </div>

            {/* Total Net Sales */}
            <div className="border-t border-border pt-2 flex justify-between font-bold text-sm text-ace-navy">
              <span>Total Shift Sales:</span>
              <span>{formatMwk(report.netSalesMinor ?? 0)}</span>
            </div>

            {report.reviewNote && (
              <div className="rounded-md bg-muted p-2 mt-2 space-y-0.5">
                <div className="font-bold text-[10px] text-muted-foreground uppercase">Manager Review</div>
                <div className="text-xs">{report.reviewNote}</div>
                {report.reviewedBy && (
                  <div className="text-[10px] text-muted-foreground">Reviewed by manager</div>
                )}
              </div>
            )}

            <div className="text-center text-[10px] text-muted-foreground pt-2 border-t border-dashed border-border">
              *** END OF Z-REPORT (SHIFT CLOSED) ***
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
