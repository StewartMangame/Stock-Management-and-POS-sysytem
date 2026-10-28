'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  recordPaymentAction,
  refundPaymentAction,
  getCustomerOpenInvoicesAction,
  getCustomerCreditAction,
} from '@/app/(app)/sales/payments/actions';
import { formatTambala } from '@/lib/money';
import { type PaymentMethod, type PaymentKind } from '@/lib/payment-math';
import {
  DollarSign,
  Calendar,
  CreditCard,
  Building,
  User,
  AlertTriangle,
  Info,
  CheckCircle,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';

interface CustomerOption {
  id: string;
  name: string;
  accountNumber: string;
  isWalkIn: boolean;
}

interface LocationOption {
  id: string;
  name: string;
  code: string;
}

interface CardTerminalOption {
  id: string;
  name: string;
  terminalId: string;
  locationId: string;
  isActive: boolean;
}

interface OpenInvoice {
  id: string;
  documentNumber: string | null;
  issueDate: string;
  dueDate: string;
  totalMinor: number;
  creditedMinor: number;
  paidMinor: number;
  balanceMinor: number;
}

export function PaymentForm({
  customersList,
  locationsList,
  terminalsList,
  preselectedCustomerId,
  preselectedInvoiceId,
}: {
  customersList: CustomerOption[];
  locationsList: LocationOption[];
  terminalsList: CardTerminalOption[];
  preselectedCustomerId?: string;
  preselectedInvoiceId?: string;
}) {
  const router = useRouter();

  // Core fields
  const [customerId, setCustomerId] = useState(preselectedCustomerId || '');
  const [locationId, setLocationId] = useState(locationsList[0]?.id || '');
  const [kind, setKind] = useState<PaymentKind>('receipt');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [amountStr, setAmountStr] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');

  // Customer state
  const [customerCredit, setCustomerCredit] = useState<number | null>(null);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([]);
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [isLoadingCustomerData, setIsLoadingCustomerData] = useState(false);

  // Method-specific detail fields
  const [chequeNumber, setChequeNumber] = useState('');
  const [chequeBank, setChequeBank] = useState('');
  const [chequeDate, setChequeDate] = useState(new Date().toISOString().slice(0, 10));

  const [bankReference, setBankReference] = useState('');
  const [bankName, setBankName] = useState('');

  const [terminalId, setTerminalId] = useState('');
  const [approvalCode, setApprovalCode] = useState('');
  const [slipNumber, setSlipNumber] = useState('');

  const [mobileTxnId, setMobileTxnId] = useState('');
  const [senderPhone, setSenderPhone] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Generate idempotency key on mount
  useEffect(() => {
    setIdempotencyKey(crypto.randomUUID());
  }, []);

  // Filter card terminals by selected location
  const availableTerminals = terminalsList.filter(
    (t) => t.locationId === locationId && t.isActive,
  );

  useEffect(() => {
    if (availableTerminals.length > 0 && !terminalId) {
      setTerminalId(availableTerminals[0]?.id ?? '');
    }
  }, [availableTerminals, terminalId]);

  // Load customer credit & open invoices when customerId changes
  useEffect(() => {
    if (!customerId) {
      setCustomerCredit(null);
      setOpenInvoices([]);
      setAllocations({});
      return;
    }

    let isMounted = true;
    setIsLoadingCustomerData(true);

    Promise.all([
      getCustomerCreditAction(customerId),
      getCustomerOpenInvoicesAction(customerId),
    ])
      .then(([creditRes, invoicesRes]) => {
        if (!isMounted) return;
        setCustomerCredit(creditRes.creditMinor);
        setOpenInvoices(invoicesRes);

        // Pre-fill allocation if preselectedInvoiceId is present
        if (preselectedInvoiceId) {
          const inv = invoicesRes.find((i) => i.id === preselectedInvoiceId);
          if (inv) {
            setAllocations({ [inv.id]: (inv.balanceMinor / 100).toFixed(2) });
            setAmountStr((inv.balanceMinor / 100).toFixed(2));
          }
        }
      })
      .catch((err) => {
        console.error('Failed to load customer data:', err);
      })
      .finally(() => {
        if (isMounted) setIsLoadingCustomerData(false);
      });

    return () => {
      isMounted = false;
    };
  }, [customerId, preselectedInvoiceId]);

  const enteredAmountMinor = Math.round((parseFloat(amountStr) || 0) * 100);

  const totalAllocatedMinor = Object.values(allocations).reduce((sum, str) => {
    const val = parseFloat(str);
    return sum + (isNaN(val) ? 0 : Math.round(val * 100));
  }, 0);

  const remainingCreditMinor = enteredAmountMinor - totalAllocatedMinor;

  const handleAllocateFull = (invoice: OpenInvoice) => {
    const currentAlloc = Object.entries(allocations)
      .filter(([id]) => id !== invoice.id)
      .reduce((sum, [_, v]) => sum + Math.round((parseFloat(v) || 0) * 100), 0);

    const availableToAllocate = Math.max(0, enteredAmountMinor - currentAlloc);
    const amountToSet = Math.min(invoice.balanceMinor, availableToAllocate);

    setAllocations((prev) => ({
      ...prev,
      [invoice.id]: (amountToSet / 100).toFixed(2),
    }));
  };

  const handleAllocationChange = (invoiceId: string, val: string) => {
    setAllocations((prev) => ({
      ...prev,
      [invoiceId]: val,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!customerId) {
      toast.error('Please select a customer');
      return;
    }
    if (!locationId) {
      toast.error('Please select a location');
      return;
    }
    if (enteredAmountMinor <= 0) {
      toast.error('Please enter a valid amount greater than zero');
      return;
    }

    // Method-specific details validation
    let methodDetails: Record<string, unknown> = {};

    if (method === 'cheque') {
      if (!chequeNumber.trim() || !chequeBank.trim() || !chequeDate) {
        toast.error('Please provide cheque number, bank, and valid cheque date');
        return;
      }
      methodDetails = {
        cheque_number: chequeNumber.trim(),
        bank: chequeBank.trim(),
        cheque_date: chequeDate,
      };
    } else if (method === 'bank_transfer') {
      if (!bankReference.trim()) {
        toast.error('Please enter the bank reference');
        return;
      }
      methodDetails = {
        bank_reference: bankReference.trim(),
        bank_name: bankName.trim() || undefined,
      };
    } else if (method === 'card') {
      if (!terminalId) {
        toast.error('No card terminal selected or none available for this location');
        return;
      }
      if (!approvalCode.trim() || !slipNumber.trim()) {
        toast.error('Approval code and slip number are required for card transactions');
        return;
      }
      methodDetails = {
        terminal_id: terminalId,
        approval_code: approvalCode.trim(),
        slip_number: slipNumber.trim(),
      };
    } else if (method === 'airtel_money' || method === 'mpamba') {
      if (!mobileTxnId.trim() || !senderPhone.trim()) {
        toast.error('Transaction ID and sender phone number are required');
        return;
      }
      methodDetails = {
        transaction_id: mobileTxnId.trim(),
        sender_phone: senderPhone.trim(),
      };
    }

    // Check allocations total
    if (kind === 'receipt' && totalAllocatedMinor > enteredAmountMinor) {
      toast.error(
        `Total allocated (${formatTambala(totalAllocatedMinor)}) exceeds payment amount (${formatTambala(enteredAmountMinor)})`,
      );
      return;
    }

    const cleanedAllocations = Object.entries(allocations)
      .map(([invoiceId, v]) => ({
        invoiceId,
        amountMinor: Math.round((parseFloat(v) || 0) * 100),
      }))
      .filter((a) => a.amountMinor > 0);

    setIsSubmitting(true);
    try {
      if (kind === 'refund') {
        const res = await refundPaymentAction({
          customerId,
          locationId,
          amountMinor: enteredAmountMinor,
          method,
          methodDetails,
          notes,
          idempotencyKey,
        });
        toast.success(`Refund recorded successfully: ${res.paymentNumber}`);
        router.push(`/sales/payments/${res.id}`);
      } else {
        const res = await recordPaymentAction({
          idempotencyKey,
          customerId,
          locationId,
          kind: 'receipt',
          method,
          amountMinor: enteredAmountMinor,
          paymentDate,
          methodDetails,
          notes,
          allocations: cleanedAllocations,
        });

        if (res.warning) {
          toast.warning(res.warning);
        } else {
          toast.success(`Payment recorded successfully: ${res.payment.paymentNumber}`);
        }
        router.push(`/sales/payments/${res.payment.id}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to record payment';
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
      {/* Top Details Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm space-y-5">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-emerald-600" />
          General Payment Details
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {/* Customer */}
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Customer <span className="text-rose-500">*</span>
            </label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            >
              <option value="">Select customer...</option>
              {customersList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.accountNumber}) {c.isWalkIn ? '— Protected Walk-in' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Location */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Location <span className="text-rose-500">*</span>
            </label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            >
              {locationsList.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name} ({loc.code})
                </option>
              ))}
            </select>
          </div>

          {/* Kind */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Payment Kind
            </label>
            <div className="flex rounded-lg border border-slate-300 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setKind('receipt')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  kind === 'receipt'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Receipt
              </button>
              <button
                type="button"
                onClick={() => setKind('refund')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  kind === 'refund'
                    ? 'bg-white dark:bg-slate-700 text-rose-600 dark:text-rose-400 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Refund
              </button>
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Amount (MWK) <span className="text-rose-500">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              placeholder="0.00"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-semibold"
            />
          </div>

          {/* Payment Date */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Payment Date <span className="text-rose-500">*</span>
            </label>
            <input
              type="date"
              required
              max={todayStr}
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>
        </div>

        {/* Customer Live Balance Info */}
        {customerCredit !== null && (
          <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 flex items-center justify-between text-xs">
            <span className="text-emerald-800 dark:text-emerald-300 font-medium">
              Available Customer Account Credit:
            </span>
            <span className="text-emerald-900 dark:text-emerald-200 font-bold text-sm">
              {formatTambala(customerCredit)}
            </span>
          </div>
        )}
      </div>

      {/* Payment Method Details Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm space-y-4">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-blue-600" />
          Payment Method & Processing
        </h2>

        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
            Select Payment Method
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
            {[
              { id: 'cash', label: 'Cash' },
              { id: 'bank_transfer', label: 'Bank Transfer' },
              { id: 'cheque', label: 'Cheque' },
              { id: 'card', label: 'Card Terminal' },
              { id: 'airtel_money', label: 'Airtel Money' },
              { id: 'mpamba', label: 'TNM Mpamba' },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMethod(m.id as PaymentMethod)}
                className={`py-2 px-3 text-xs font-semibold rounded-lg border transition-all text-center ${
                  method === m.id
                    ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 shadow-sm'
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 text-slate-700 dark:text-slate-300'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Dynamic method detail inputs */}
        <div className="pt-2">
          {method === 'cheque' && (
            <div className="space-y-3 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60 rounded-xl p-4">
              <div className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300 mb-1">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                <span>
                  <strong>Cheque clearing rule:</strong> Cheques remain in <em>pending</em> status until cleared by a manager. Any invoice allocations entered below will be saved as provisional and automatically applied upon clearing.
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Cheque Number <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 001234"
                    value={chequeNumber}
                    onChange={(e) => setChequeNumber(e.target.value)}
                    className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Bank Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Standard Bank"
                    value={chequeBank}
                    onChange={(e) => setChequeBank(e.target.value)}
                    className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Cheque Date <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={chequeDate}
                    onChange={(e) => setChequeDate(e.target.value)}
                    className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5"
                  />
                </div>
              </div>
            </div>
          )}

          {method === 'bank_transfer' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Bank Reference / Txn Ref <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. FT2605159988"
                  value={bankReference}
                  onChange={(e) => setBankReference(e.target.value)}
                  className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Bank Name (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. National Bank of Malawi"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5"
                />
              </div>
            </div>
          )}

          {method === 'card' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Card Terminal <span className="text-rose-500">*</span>
                </label>
                <select
                  value={terminalId}
                  onChange={(e) => setTerminalId(e.target.value)}
                  required
                  className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5"
                >
                  {availableTerminals.length === 0 ? (
                    <option value="">No active terminals at this location</option>
                  ) : (
                    availableTerminals.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.terminalId})
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Approval Code <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 058912"
                  value={approvalCode}
                  onChange={(e) => setApprovalCode(e.target.value)}
                  className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Slip Number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 000412"
                  value={slipNumber}
                  onChange={(e) => setSlipNumber(e.target.value)}
                  className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5"
                />
              </div>
            </div>
          )}

          {(method === 'airtel_money' || method === 'mpamba') && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Transaction ID <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder={method === 'airtel_money' ? 'e.g. CI260515.1234' : 'e.g. MP260515.5678'}
                  value={mobileTxnId}
                  onChange={(e) => setMobileTxnId(e.target.value)}
                  className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Sender Phone Number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. +265991234567"
                  value={senderPhone}
                  onChange={(e) => setSenderPhone(e.target.value)}
                  className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Invoice Allocations Card (Receipts only) */}
      {kind === 'receipt' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-600" />
              Apply Payment to Open Invoices
            </h2>
            <div className="text-xs text-slate-500">
              Allocated: <strong>{formatTambala(totalAllocatedMinor)}</strong> /{' '}
              {formatTambala(enteredAmountMinor)}
            </div>
          </div>

          {openInvoices.length === 0 ? (
            <div className="text-center py-6 border border-dashed border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-500">
              {customerId
                ? 'This customer has no open unpaid invoices. The entire payment will be placed into account credit.'
                : 'Select a customer to view their open invoices.'}
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 font-semibold uppercase">
                  <tr>
                    <th className="py-2.5 px-3">Invoice #</th>
                    <th className="py-2.5 px-3">Issue Date</th>
                    <th className="py-2.5 px-3">Due Date</th>
                    <th className="py-2.5 px-3 text-right">Invoice Total</th>
                    <th className="py-2.5 px-3 text-right">Remaining Balance</th>
                    <th className="py-2.5 px-3 text-right w-40">Allocate (MWK)</th>
                    <th className="py-2.5 px-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {openInvoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50/50">
                      <td className="py-2.5 px-3 font-mono font-medium text-slate-800 dark:text-slate-200">
                        {inv.documentNumber}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500">{inv.issueDate}</td>
                      <td className="py-2.5 px-3 text-slate-500">{inv.dueDate}</td>
                      <td className="py-2.5 px-3 text-right text-slate-600">
                        {formatTambala(inv.totalMinor)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-slate-800 dark:text-slate-200">
                        {formatTambala(inv.balanceMinor)}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max={(inv.balanceMinor / 100).toFixed(2)}
                          placeholder="0.00"
                          value={allocations[inv.id] || ''}
                          onChange={(e) => handleAllocationChange(inv.id, e.target.value)}
                          className="w-full text-right text-xs rounded border border-slate-300 dark:border-slate-700 px-2 py-1"
                        />
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleAllocateFull(inv)}
                          className="px-2 py-1 text-xs font-semibold rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
                        >
                          Full
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Allocation summary message */}
          {remainingCreditMinor > 0 && (
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-xs text-blue-800 dark:text-blue-300 flex items-center justify-between">
              <span>Remainder unallocated will be applied to customer account credit:</span>
              <span className="font-bold">{formatTambala(remainingCreditMinor)}</span>
            </div>
          )}
        </div>
      )}

      {/* Notes & Submit */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            Notes / Remarks (Optional)
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add internal notes about this payment..."
            className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-800"
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => router.back()}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-5 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isSubmitting ? 'Recording...' : kind === 'refund' ? 'Process Refund' : 'Record Payment'}
          </button>
        </div>
      </div>
    </form>
  );
}
