'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { submitPurchaseOrderAction, cancelPurchaseOrderAction } from '../actions';
import { CheckCircle2, XCircle, PackageCheck, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

interface Props {
  poId: string;
  poNumber: string;
  status: string;
}

export function PODetailActions({ poId, poNumber, status }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleSubmit = () => {
    if (!confirm(`Are you sure you want to submit purchase order ${poNumber}? This marks it as an active procurement request.`)) {
      return;
    }

    startTransition(async () => {
      try {
        const res = await submitPurchaseOrderAction(poId);
        if (res.success) {
          toast.success(`Purchase order ${poNumber} submitted!`);
          router.refresh();
        }
      } catch (err: any) {
        toast.error(err.message || 'Failed to submit PO');
      }
    });
  };

  const handleCancel = () => {
    const reason = prompt('Please enter a cancellation reason:');
    if (reason === null) return;

    startTransition(async () => {
      try {
        const res = await cancelPurchaseOrderAction(poId, reason);
        if (res.success) {
          toast.success(`Purchase order ${poNumber} cancelled.`);
          router.refresh();
        }
      } catch (err: any) {
        toast.error(err.message || 'Failed to cancel PO');
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      {status === 'draft' && (
        <Button
          onClick={handleSubmit}
          disabled={isPending}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
          id="submit-po-btn"
        >
          <CheckCircle2 className="h-4 w-4 mr-1.5" />
          Submit Order
        </Button>
      )}

      {(status === 'submitted' || status === 'partially_received') && (
        <Link href={`/purchasing/receipts/new?poId=${poId}`}>
          <Button className="bg-ace-blue hover:bg-ace-blue-dark text-white" id="receive-goods-btn">
            <PackageCheck className="h-4 w-4 mr-1.5" />
            Receive Goods (GRN)
          </Button>
        </Link>
      )}

      {status !== 'received' && status !== 'cancelled' && (
        <Button
          variant="outline"
          onClick={handleCancel}
          disabled={isPending}
          className="text-red-600 border-red-200 hover:bg-red-50"
          id="cancel-po-btn"
        >
          <XCircle className="h-4 w-4 mr-1.5" />
          Cancel PO
        </Button>
      )}
    </div>
  );
}
