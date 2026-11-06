'use client';

import React from 'react';
import Image from 'next/image';

export interface QuotationDocumentViewProps {
  quotation: {
    quotationNumber: string | null;
    status: string;
    quotationDate: string;
    validUntil: string;
    currency?: string;
    subtotalMinor: number;
    discountMinor: number;
    taxMinor: number;
    totalMinor: number;
    notes?: string | null;
    terms?: string | null;
    customer: {
      name: string;
      accountNumber?: string;
      address?: string | null;
      taxNumber?: string | null;
      phone?: string | null;
      email?: string | null;
    };
    lines: Array<{
      id?: string;
      sku?: string;
      productName?: string;
      description?: string | null;
      quantity: string | number;
      unitPriceMinor: number;
      discountMinor?: number;
      lineTotalMinor: number;
      notes?: string | null;
    }>;
  };
  company?: {
    name?: string;
    addressLines?: string[];
    phone?: string;
    email?: string;
  };
  className?: string;
}

function formatAmount(minor: number): string {
  return (minor / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDisplayDate(dateStr?: string | Date): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

export function QuotationDocumentView({
  quotation: q,
  company,
  className = '',
}: QuotationDocumentViewProps) {
  const isDraft = q.status === 'draft';
  const isCancelled = q.status === 'cancelled';
  const isExpired = q.status === 'expired';

  const companyName = company?.name || 'ACE HOLDINGS LTD';
  const companyLines = company?.addressLines || [
    'First House',
    '53 Livingstone Avenue',
    'BLANTYRE 3000',
    '+265999257356',
    'ace@ace.co.mw',
  ];

  const taxRatePercent =
    q.subtotalMinor > 0 ? ((q.taxMinor / q.subtotalMinor) * 100).toFixed(1) : '17.5';
  const taxRateLabel = `MRA VAT Agency @ ${taxRatePercent}%`;

  return (
    <div
      className={`relative mx-auto w-full max-w-4xl bg-white p-8 sm:p-14 text-slate-800 shadow-md border border-slate-200/90 rounded-sm font-sans print:shadow-none print:border-none print:p-0 print:m-0 print:max-w-none ${className}`}
      id="printable-quotation"
    >
      {/* Subtle Ace Holdings Logo Background Watermark */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.03] select-none"
        aria-hidden="true"
      >
        <div className="relative w-80 h-48">
          <Image
            src="/brand/ace-logo.png"
            alt="Ace Holdings Watermark"
            fill
            className="object-contain"
            priority
          />
        </div>
      </div>

      {/* Prominent Diagonal Status Watermarks */}
      {isDraft && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center select-none"
          aria-hidden="true"
        >
          <span className="-rotate-45 text-7xl sm:text-8xl font-black tracking-widest text-slate-300/40 uppercase">
            DRAFT
          </span>
        </div>
      )}
      {isCancelled && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center select-none"
          aria-hidden="true"
        >
          <span className="-rotate-45 text-6xl sm:text-7xl font-black tracking-widest text-rose-300/35 uppercase">
            CANCELLED
          </span>
        </div>
      )}
      {isExpired && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center select-none"
          aria-hidden="true"
        >
          <span className="-rotate-45 text-6xl sm:text-7xl font-black tracking-widest text-amber-300/35 uppercase">
            EXPIRED
          </span>
        </div>
      )}

      {/* Top Header: Company details on left, Official Logo on right */}
      <div className="flex flex-row items-start justify-between gap-6 pb-6 border-b border-transparent">
        <div className="text-left text-xs leading-relaxed space-y-0.5">
          <h2 className="text-sm font-bold text-slate-900 tracking-wide uppercase">
            {companyName}
          </h2>
          {companyLines.map((line, idx) => (
            <p key={idx} className="text-slate-600">
              {line}
            </p>
          ))}
        </div>

        <div className="relative w-40 sm:w-48 h-20 sm:h-24 shrink-0 flex items-center justify-end">
          <Image
            src="/brand/ace-logo.png"
            alt="Ace Holdings Logo"
            width={180}
            height={108}
            className="object-contain max-h-24 w-auto"
            priority
          />
        </div>
      </div>

      {/* Subheader: Quotation Title & ADDRESS on left, Quotation details on right */}
      <div className="mt-6 flex flex-col sm:flex-row sm:items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-normal text-[#556885] tracking-tight">
            Quotation
          </h1>

          <div className="mt-5 space-y-1">
            <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
              ADDRESS
            </p>
            <p className="text-sm font-semibold text-slate-900">{q.customer.name}</p>
            {q.customer.address && (
              <p className="text-xs text-slate-600 whitespace-pre-line">{q.customer.address}</p>
            )}
          </div>
        </div>

        <div className="sm:text-right pt-2 space-y-1 text-xs">
          <div className="flex justify-between sm:justify-end gap-6 sm:gap-10">
            <span className="font-bold text-slate-400 tracking-wider uppercase text-[11px]">
              QUOTATION
            </span>
            <span className="font-mono font-medium text-slate-900 min-w-24 text-right">
              {q.quotationNumber || 'DRAFT'}
            </span>
          </div>
          <div className="flex justify-between sm:justify-end gap-6 sm:gap-10">
            <span className="font-bold text-slate-400 tracking-wider uppercase text-[11px]">
              DATE
            </span>
            <span className="font-mono font-medium text-slate-900 min-w-24 text-right">
              {formatDisplayDate(q.quotationDate)}
            </span>
          </div>
          <div className="flex justify-between sm:justify-end gap-6 sm:gap-10">
            <span className="font-bold text-slate-400 tracking-wider uppercase text-[11px]">
              EXPIRATION DATE
            </span>
            <span className="font-mono font-medium text-slate-900 min-w-24 text-right">
              {formatDisplayDate(q.validUntil)}
            </span>
          </div>
        </div>
      </div>

      {/* Line Items Table */}
      <div className="mt-8 overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-[#EAEFF5] text-slate-700 font-bold uppercase text-[11px] tracking-wider rounded-sm">
              <th className="py-2.5 px-3 w-[24%]">PRODUCT/SERVICE</th>
              <th className="py-2.5 px-3 w-[42%]">DESCRIPTION</th>
              <th className="py-2.5 px-3 w-[8%] text-right">QTY</th>
              <th className="py-2.5 px-3 w-[13%] text-right">RATE</th>
              <th className="py-2.5 px-3 w-[13%] text-right">AMOUNT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-transparent">
            {q.lines.map((line, idx) => {
              const prodTitle = line.productName || line.sku || 'Item';
              const desc =
                line.description && line.description !== prodTitle
                  ? line.description
                  : line.description || line.notes || '';

              return (
                <tr key={line.id || idx} className="align-top hover:bg-slate-50/50 transition-colors">
                  <td className="py-3 px-3">
                    <p className="font-bold text-slate-900">{prodTitle}</p>
                    {line.sku && line.sku !== prodTitle && (
                      <p className="text-[10px] font-mono text-slate-500 mt-0.5">SKU: {line.sku}</p>
                    )}
                  </td>
                  <td className="py-3 px-3 text-slate-600 leading-relaxed whitespace-pre-line">
                    {desc}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-slate-900">
                    {parseFloat(String(line.quantity)).toLocaleString()}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-slate-900">
                    {formatAmount(line.unitPriceMinor)}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-slate-900">
                    {formatAmount(line.lineTotalMinor)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Dotted table bottom divider */}
      <div className="border-b border-dotted border-slate-300 mt-2 mb-4" />

      {/* Totals Section */}
      <div className="flex justify-end">
        <div className="w-full sm:w-72 space-y-2 text-xs">
          <div className="flex justify-between items-center text-slate-400 font-bold uppercase text-[11px]">
            <span>SUBTOTAL</span>
            <span className="font-mono text-slate-900 font-normal text-xs">
              {formatAmount(q.subtotalMinor)}
            </span>
          </div>

          {q.discountMinor > 0 && (
            <div className="flex justify-between items-center text-slate-400 font-bold uppercase text-[11px]">
              <span>DISCOUNT</span>
              <span className="font-mono text-slate-900 font-normal text-xs">
                -{formatAmount(q.discountMinor)}
              </span>
            </div>
          )}

          <div className="flex justify-between items-center text-slate-400 font-bold uppercase text-[11px]">
            <span>TAX</span>
            <span className="font-mono text-slate-900 font-normal text-xs">
              {formatAmount(q.taxMinor)}
            </span>
          </div>

          <div className="border-t border-slate-300 pt-2.5 mt-1 flex justify-between items-baseline">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              TOTAL
            </span>
            <span className="text-lg sm:text-xl font-black text-slate-900 font-mono tracking-tight">
              {q.currency || 'MWK'} {formatAmount(q.totalMinor)}
            </span>
          </div>
        </div>
      </div>

      {/* TAX SUMMARY Section */}
      <div className="mt-8 w-full">
        <p className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-2">
          TAX SUMMARY
        </p>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-[#EAEFF5] text-slate-700 font-bold uppercase text-[11px] tracking-wider rounded-sm">
              <th className="py-2 px-3 w-[40%] text-left">RATE</th>
              <th className="py-2 px-3 w-[30%] text-center">TAX</th>
              <th className="py-2 px-3 w-[30%] text-right">NET</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="py-2.5 px-3 text-slate-800">{taxRateLabel}</td>
              <td className="py-2.5 px-3 text-center font-mono text-slate-800">
                {formatAmount(q.taxMinor)}
              </td>
              <td className="py-2.5 px-3 text-right font-mono text-slate-800">
                {formatAmount(q.subtotalMinor)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Acceptance Section */}
      <div className="mt-10 max-w-xs space-y-6 text-xs text-slate-600">
        <div>
          <p className="mb-8">Accepted By</p>
          <div className="border-b border-slate-300 w-48" />
        </div>
        <div>
          <p className="mb-8">Accepted Date</p>
          <div className="border-b border-slate-300 w-48" />
        </div>
      </div>

      {/* Optional Client Notes & Terms */}
      {(q.notes || q.terms) && (
        <div className="mt-8 pt-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-500">
          {q.notes && (
            <div>
              <p className="font-bold text-slate-700 uppercase text-[10px] tracking-wider mb-1">
                Notes
              </p>
              <p className="whitespace-pre-line leading-relaxed">{q.notes}</p>
            </div>
          )}
          {q.terms && (
            <div>
              <p className="font-bold text-slate-700 uppercase text-[10px] tracking-wider mb-1">
                Terms & Conditions
              </p>
              <p className="whitespace-pre-line leading-relaxed">{q.terms}</p>
            </div>
          )}
        </div>
      )}

      {/* Centered Page Footer */}
      <div className="mt-14 pt-4 text-center text-xs text-slate-400">
        Page 1 of 1
      </div>
    </div>
  );
}
