'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Lock,
  DollarSign,
  FileText,
  CheckCircle2,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Eye,
  Loader2,
  Clock,
} from 'lucide-react';
import { formatMwk } from '@/lib/money';
import { reviewShiftAction } from '@/app/(app)/pos/actions';
import { ZReportModal } from './ZReportModal';
import { XReportModal } from './XReportModal';
import { CashMovementModal } from './CashMovementModal';
import { CloseShiftModal } from './CloseShiftModal';
import { toast } from 'sonner';
import { EntityHistoryTab } from '@/components/shared/EntityHistoryTab';

interface ShiftsClientProps {
  currentShift: any | null;
  shiftHistory: any[];
  canReview: boolean;
  currentUser: { id: string; name: string };
}

export function ShiftsClient({
  currentShift,
  shiftHistory,
  canReview,
  currentUser,
}: ShiftsClientProps) {
  // Modals state
  const [activeShift, setActiveShift] = useState(currentShift);
  const [selectedZReportId, setSelectedZReportId] = useState<string | null>(null);
  const [isXReportOpen, setIsXReportOpen] = useState(false);
  const [isCashMovementOpen, setIsCashMovementOpen] = useState(false);
  const [isCloseShiftOpen, setIsCloseShiftOpen] = useState(false);

  // Review modal state
  const [reviewingShift, setReviewingShift] = useState<any | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const handleOpenReview = (s: any) => {
    setReviewingShift(s);
    setReviewNote(s.reviewNote || '');
    setReviewError(null);
  };

  const handleSubmitReview = async () => {
    if (!reviewingShift) return;
    const hasVariance = Number(reviewingShift.cashVarianceMinor || 0) !== 0;
    if (hasVariance && !reviewNote.trim()) {
      setReviewError('A review note is strictly required when there is a cash variance.');
      return;
    }

    setSubmittingReview(true);
    try {
      await reviewShiftAction({
        shiftId: reviewingShift.id,
        reviewNote: reviewNote.trim() || undefined,
      });
      toast.success(`Shift #${reviewingShift.shiftNumber} marked as reviewed.`);
      setReviewingShift(null);
      window.location.reload();
    } catch (err: unknown) {
      setReviewError(err instanceof Error ? err.message : 'Failed to review shift');
    } finally {
      setSubmittingReview(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ace-navy">POS Shifts & Cash-Up</h1>
          <p className="text-xs text-muted-foreground">
            Monitor active registers, reconcile cash drawers, and review shift variances
          </p>
        </div>
      </div>

      {/* ACTIVE SHIFT CARD */}
      {activeShift ? (
        <Card className="border-ace-sky/40 bg-gradient-to-r from-ace-band/20 to-card shadow-sm">
          <CardHeader className="pb-3 border-b border-border/60">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-ace-navy text-white">
                  <Clock className="h-5 w-5 text-ace-cyan" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-bold text-ace-navy">
                      Shift #{activeShift.shiftNumber}
                    </CardTitle>
                    <Badge variant="outline" className="border-emerald-600 bg-emerald-50 text-emerald-800 text-[10px] font-bold uppercase">
                      Active (Open)
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Register: <strong className="text-foreground">{activeShift.locationName}</strong> | Cashier:{' '}
                    <strong className="text-foreground">{currentUser.name}</strong>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsCashMovementOpen(true)}
                  className="h-8 text-xs font-semibold"
                >
                  <DollarSign className="mr-1.5 h-3.5 w-3.5 text-ace-blue" />
                  Cash In/Out
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsXReportOpen(true)}
                  className="h-8 text-xs font-semibold"
                >
                  <FileText className="mr-1.5 h-3.5 w-3.5" />
                  X-Report
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setIsCloseShiftOpen(true)}
                  className="h-8 text-xs font-bold"
                >
                  <Lock className="mr-1.5 h-3.5 w-3.5" />
                  Close Shift
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-muted-foreground block text-[11px]">Opening Float</span>
              <span className="font-bold text-sm text-foreground">
                {formatMwk(activeShift.openingFloatMinor)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[11px]">Opened At</span>
              <span className="font-semibold text-foreground">
                {new Date(activeShift.openedAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[11px]">Status</span>
              <span className="font-bold text-emerald-700">TILL OPEN & ACTIVE</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[11px]">Register Code</span>
              <span className="font-mono font-bold text-ace-navy">{activeShift.locationCode}</span>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed border-border bg-muted/10">
          <CardContent className="py-6 text-center space-y-2">
            <p className="text-sm font-semibold text-muted-foreground">
              You do not have an active open shift on this terminal.
            </p>
            <Button
              size="sm"
              onClick={() => (window.location.href = '/pos')}
              className="bg-ace-navy hover:bg-ace-navy-deep text-white text-xs font-bold"
            >
              Go to POS Register to Open Shift
            </Button>
          </CardContent>
        </Card>
      )}

      {/* SHIFTS RECONCILIATION & REVIEW TABLE */}
      <Card>
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-base font-bold text-ace-navy">Shift Reconciliation History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 border-b border-border text-muted-foreground font-semibold">
                <tr>
                  <th className="py-2.5 px-3 text-left">Shift #</th>
                  <th className="py-2.5 px-3 text-left">Location</th>
                  <th className="py-2.5 px-3 text-left">Cashier</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3 text-left">Opened / Closed</th>
                  <th className="py-2.5 px-3 text-right">Counted Cash</th>
                  <th className="py-2.5 px-3 text-right">Variance</th>
                  <th className="py-2.5 px-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shiftHistory.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted-foreground">
                      No shift records found.
                    </td>
                  </tr>
                ) : (
                  shiftHistory.map((s) => {
                    const variance = Number(s.cashVarianceMinor ?? 0);
                    const isClosed = s.status === 'closed';
                    const isReviewed = s.status === 'reviewed';

                    return (
                      <tr key={s.id} className="hover:bg-muted/20">
                        <td className="py-2.5 px-3 font-bold font-mono text-ace-navy">
                          {s.shiftNumber}
                        </td>
                        <td className="py-2.5 px-3">{s.locationName}</td>
                        <td className="py-2.5 px-3 font-medium">{s.cashierName}</td>
                        <td className="py-2.5 px-3 text-center">
                          <Badge
                            variant="outline"
                            className={`text-[10px] capitalize font-bold ${
                              s.status === 'open'
                                ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                                : s.status === 'reviewed'
                                  ? 'border-ace-navy bg-ace-band/40 text-ace-navy'
                                  : 'border-muted-foreground/30 bg-muted/40 text-muted-foreground'
                            }`}
                          >
                            {s.status}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3 text-muted-foreground">
                          <div>{new Date(s.openedAt).toLocaleDateString()}</div>
                          <div className="text-[10px]">
                            {new Date(s.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} -{' '}
                            {s.closedAt
                              ? new Date(s.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                              : 'Open'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-medium">
                          {s.countedCashMinor !== null ? formatMwk(s.countedCashMinor) : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold">
                          {s.cashVarianceMinor !== null ? (
                            <span
                              className={
                                variance === 0
                                  ? 'text-ace-success'
                                  : variance > 0
                                    ? 'text-ace-blue'
                                    : 'text-destructive'
                              }
                            >
                              {variance > 0 ? '+' : ''}
                              {formatMwk(variance)}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {s.closedAt && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setSelectedZReportId(s.id)}
                                className="h-7 text-[11px] px-2 font-semibold"
                              >
                                <Eye className="mr-1 h-3 w-3" />
                                Z-Report
                              </Button>
                            )}

                            {canReview && isClosed && (
                              <Button
                                size="sm"
                                onClick={() => handleOpenReview(s)}
                                className="h-7 text-[11px] px-2 bg-ace-navy hover:bg-ace-navy-deep text-white font-semibold"
                              >
                                <CheckCircle2 className="mr-1 h-3 w-3" />
                                Review
                              </Button>
                            )}

                            {isReviewed && (
                              <Badge variant="secondary" className="text-[10px] text-muted-foreground">
                                Reviewed
                              </Badge>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Historical Audit Log Timeline — visible only to reviewers (managers/admins) */}
      {canReview && (activeShift || shiftHistory[0]) && (
        <EntityHistoryTab
          entityType="pos_shift"
          entityId={(activeShift?.id || shiftHistory[0]?.id) as string}
        />
      )}

      {/* Review Dialog */}
      {reviewingShift && (
        <Dialog open={Boolean(reviewingShift)} onOpenChange={(open) => !open && setReviewingShift(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-ace-navy">
                Review Shift #{reviewingShift.shiftNumber}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Cashier: {reviewingShift.cashierName} | Cash Variance:{' '}
                <strong
                  className={
                    Number(reviewingShift.cashVarianceMinor || 0) === 0
                      ? 'text-ace-success'
                      : 'text-destructive'
                  }
                >
                  {formatMwk(reviewingShift.cashVarianceMinor || 0)}
                </strong>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2 text-xs">
              {reviewError && (
                <div className="rounded-md bg-destructive/15 p-2.5 font-medium text-destructive">
                  {reviewError}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="review-note" className="text-xs font-semibold">
                  Reviewer Audit Note {Number(reviewingShift.cashVarianceMinor || 0) !== 0 && '(Strictly Required)'}
                </Label>
                <Textarea
                  id="review-note"
                  placeholder="Explain variance findings or confirm satisfactory drawer audit..."
                  rows={3}
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  className="text-xs resize-none"
                />
              </div>
            </div>

            <DialogFooter className="pt-2 sm:justify-between">
              <Button
                type="button"
                variant="outline"
                disabled={submittingReview}
                onClick={() => setReviewingShift(null)}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={submittingReview}
                onClick={handleSubmitReview}
                className="w-full bg-ace-navy hover:bg-ace-navy-deep text-white font-bold sm:w-auto text-xs"
              >
                {submittingReview ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Approve & Mark Reviewed
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Modals */}
      {selectedZReportId && (
        <ZReportModal
          isOpen={Boolean(selectedZReportId)}
          onClose={() => setSelectedZReportId(null)}
          shiftId={selectedZReportId}
        />
      )}

      {activeShift && (
        <>
          <XReportModal
            isOpen={isXReportOpen}
            onClose={() => setIsXReportOpen(false)}
            shiftId={activeShift.id}
          />
          <CashMovementModal
            isOpen={isCashMovementOpen}
            onClose={() => setIsCashMovementOpen(false)}
            shiftId={activeShift.id}
          />
          <CloseShiftModal
            isOpen={isCloseShiftOpen}
            onClose={() => setIsCloseShiftOpen(false)}
            shiftId={activeShift.id}
            onShiftClosed={(sId) => {
              setActiveShift(null);
              setSelectedZReportId(sId);
            }}
          />
        </>
      )}
    </div>
  );
}
