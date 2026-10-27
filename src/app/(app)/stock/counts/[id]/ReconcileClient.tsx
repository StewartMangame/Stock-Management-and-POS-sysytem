'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { reconcileStockCountAction } from '../actions';
import { formatMwk } from '@/lib/money';
import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';

interface ProductItem {
  id: string;
  name: string;
  sku: string;
  serialTracking: boolean;
  avgCostMinor: number;
}

interface CountItemRow {
  productId: string;
  product: ProductItem;
  systemQty: number;
  initialCountedQty: number;
}

interface SerialItem {
  id: string;
  productId: string;
  serialNumber: string;
}

interface Props {
  countId: string;
  countNumber: string;
  items: CountItemRow[];
  activeSerials: SerialItem[];
}

export function ReconcileClient({
  countId,
  countNumber,
  items,
  activeSerials,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [countedQuantities, setCountedQuantities] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const it of items) {
      initial[it.productId] = it.initialCountedQty.toString();
    }
    return initial;
  });

  const [missingSerials, setMissingSerials] = useState<Record<string, string[]>>({});
  const [interveningWarning, setInterveningWarning] = useState<string | null>(null);

  const handleQtyChange = (productId: string, val: string) => {
    setCountedQuantities((prev) => ({ ...prev, [productId]: val }));
  };

  const handleSerialToggle = (productId: string, serialId: string) => {
    setMissingSerials((prev) => {
      const current = prev[productId] ?? [];
      const next = current.includes(serialId)
        ? current.filter((id) => id !== serialId)
        : [...current, serialId];
      return { ...prev, [productId]: next };
    });
  };

  const serialsByProduct = new Map<string, SerialItem[]>();
  for (const s of activeSerials) {
    const list = serialsByProduct.get(s.productId) ?? [];
    list.push(s);
    serialsByProduct.set(s.productId, list);
  }

  // Calculate totals
  let totalVarianceValueMinor = 0;
  const evaluatedRows = items.map((it) => {
    const counted = Number(countedQuantities[it.productId] ?? it.systemQty);
    const varianceQty = counted - it.systemQty;
    const varianceValMinor = Math.round(varianceQty * it.product.avgCostMinor);
    totalVarianceValueMinor += varianceValMinor;

    const isShortage = varianceQty < 0;
    const missingCountRequired = isShortage && it.product.serialTracking ? Math.abs(Math.round(varianceQty)) : 0;
    const selectedMissing = missingSerials[it.productId] ?? [];

    return {
      ...it,
      counted,
      varianceQty,
      varianceValMinor,
      isShortage,
      missingCountRequired,
      selectedMissing,
    };
  });

  const handleReconcile = () => {
    // Check serial tracking shortage requirements
    for (const row of evaluatedRows) {
      if (row.missingCountRequired > 0) {
        if (row.selectedMissing.length !== row.missingCountRequired) {
          toast.error(
            `Serial tracked shortage for ${row.product.name}: Please select exactly ${row.missingCountRequired} missing serial numbers (selected: ${row.selectedMissing.length}).`
          );
          return;
        }
      }
    }

    if (!confirm(`Are you sure you want to reconcile count ${countNumber}? This will adjust stock ledger balances immediately.`)) {
      return;
    }

    startTransition(async () => {
      try {
        const payload = evaluatedRows.map((r) => ({
          productId: r.productId,
          countedQty: r.counted,
          missingSerialIds: r.selectedMissing.length > 0 ? r.selectedMissing : undefined,
        }));

        const res = await reconcileStockCountAction(countId, payload);
        if (res.success) {
          if (res.result.hasInterveningMovements) {
            setInterveningWarning(res.result.warningMessage || 'Intervening movements occurred.');
            toast.warning(
              'Stock count reconciled, but movements occurred during the count. Calculated against live inventory.'
            );
          } else {
            toast.success(`Stock count ${countNumber} reconciled successfully!`);
          }
          router.refresh();
        }
      } catch (err: any) {
        toast.error(err.message || 'Failed to reconcile stock count');
      }
    });
  };

  return (
    <div className="space-y-6">
      {interveningWarning && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold block">Notice: Movement During Count</span>
            <p>{interveningWarning}</p>
          </div>
        </div>
      )}

      <div className="rounded-lg border bg-white shadow-sm overflow-hidden space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ace-navy">Count Line Items</h2>
            <p className="text-xs text-ace-muted">
              Enter the verified physical count. System calculates variance and adjusts inventory ledger.
            </p>
          </div>
          <Button
            onClick={handleReconcile}
            disabled={isPending}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            id="reconcile-count-btn"
          >
            <CheckCircle2 className="h-4 w-4 mr-1.5" />
            {isPending ? 'Reconciling Ledger...' : 'Reconcile Stock Count'}
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-xs font-semibold text-gray-600">
                <th className="py-2.5 px-3">Product</th>
                <th className="py-2.5 px-3 w-32 text-right">System Qty</th>
                <th className="py-2.5 px-3 w-36">Physical Count</th>
                <th className="py-2.5 px-3 w-32 text-right">Variance Qty</th>
                <th className="py-2.5 px-3 w-36 text-right">Variance Value</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {evaluatedRows.map((row) => {
                const availableSerials = serialsByProduct.get(row.productId) ?? [];

                return (
                  <tr key={row.productId} className="hover:bg-gray-50/50">
                    <td className="py-3 px-3">
                      <div className="font-medium text-ace-navy">{row.product.name}</div>
                      <div className="text-xs text-ace-muted font-mono">{row.product.sku}</div>

                      {/* Missing Serial Selector if serial-tracked and shortage */}
                      {row.missingCountRequired > 0 && (
                        <div className="mt-2 p-2 bg-amber-50 rounded border border-amber-200 text-xs">
                          <div className="flex items-center justify-between mb-1 text-amber-900 font-semibold">
                            <span className="flex items-center gap-1">
                              <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
                              Select {row.missingCountRequired} missing serial number(s) to write off:
                            </span>
                            <span>
                              {row.selectedMissing.length} / {row.missingCountRequired} selected
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2 mt-1">
                            {availableSerials.length === 0 ? (
                              <span className="text-gray-500 italic">No in-stock serial records found.</span>
                            ) : (
                              availableSerials.map((sn) => {
                                const isSelected = row.selectedMissing.includes(sn.id);
                                return (
                                  <button
                                    key={sn.id}
                                    type="button"
                                    onClick={() => handleSerialToggle(row.productId, sn.id)}
                                    className={`px-2 py-1 rounded text-xs font-mono border transition-colors ${
                                      isSelected
                                        ? 'bg-red-600 text-white border-red-700'
                                        : 'bg-white text-gray-700 border-gray-300 hover:border-red-400'
                                    }`}
                                  >
                                    {sn.serialNumber}
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-sm text-gray-700">
                      {row.systemQty}
                    </td>
                    <td className="py-3 px-3">
                      <Input
                        type="number"
                        step="0.001"
                        min="0"
                        value={countedQuantities[row.productId] ?? ''}
                        onChange={(e) => handleQtyChange(row.productId, e.target.value)}
                        className="w-32 font-mono text-right"
                      />
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-sm font-semibold">
                      <span
                        className={
                          row.varianceQty > 0
                            ? 'text-emerald-600'
                            : row.varianceQty < 0
                            ? 'text-red-600'
                            : 'text-gray-400'
                        }
                      >
                        {row.varianceQty > 0 ? `+${row.varianceQty}` : row.varianceQty}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-sm font-semibold">
                      <span
                        className={
                          row.varianceValMinor > 0
                            ? 'text-emerald-600'
                            : row.varianceValMinor < 0
                            ? 'text-red-600'
                            : 'text-gray-400'
                        }
                      >
                        {formatMwk(row.varianceValMinor)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 font-semibold bg-gray-50">
                <td colSpan={4} className="py-3 px-3 text-right text-gray-700">
                  Total Net Variance Impact:
                </td>
                <td className="py-3 px-3 text-right font-mono text-base font-bold text-ace-navy">
                  {formatMwk(totalVarianceValueMinor)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
