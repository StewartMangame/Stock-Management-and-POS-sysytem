import type { Metadata } from 'next';
import { authorize } from '@/server/auth/authorize';
import { getAllSettings } from '@/server/services/settings';
import { PERMISSIONS } from '@/lib/permissions';
import { redirect } from 'next/navigation';
import { SETTING_KEYS, type SettingKey } from '@/server/db/schema';
import { SettingRow } from './SettingRow';

export const metadata: Metadata = { title: 'App Settings' };

const SETTING_META: Record<SettingKey, { label: string; description: string; type: 'text' | 'boolean' | 'number' }> = {
  default_currency:                     { label: 'Default Currency',                     description: 'Currency code used for all transactions (e.g. MWK)',      type: 'text' },
  allow_negative_stock:                 { label: 'Allow Negative Stock',                 description: 'If off, deliveries are blocked when stock runs out',       type: 'boolean' },
  costing_method:                       { label: 'Costing Method',                       description: 'How stock cost is calculated. Currently: average',         type: 'text' },
  max_discount_percent_without_approval:{ label: 'Max Discount Without Approval (%)',     description: 'Discounts above this % require manager approval',          type: 'number' },
  quotation_valid_days:                 { label: 'Quotation Valid Days',                 description: 'Default number of days a quotation remains valid',         type: 'number' },
  prices_include_tax:                   { label: 'Prices Include Tax',                   description: 'If on, entered prices are treated as tax-inclusive',       type: 'boolean' },
  company_name:                         { label: 'Company Name',                         description: 'Printed on all documents',                                 type: 'text' },
  company_address:                      { label: 'Company Address',                      description: 'Printed on all documents',                                 type: 'text' },
  company_phone:                        { label: 'Company Phone',                        description: 'Printed on all documents',                                 type: 'text' },
  company_email:                        { label: 'Company Email',                        description: 'Printed on all documents',                                 type: 'text' },
  company_tax_number:                   { label: 'Tax / TPIN Number',                    description: 'Printed on VAT invoices',                                  type: 'text' },
  eis_enabled:                          { label: 'Enable MRA EIS',                       description: 'Submit invoices to MRA Electronic Invoicing System',       type: 'boolean' },
  invoice_payment_instructions:         { label: 'Invoice Payment Instructions',         description: 'Bank account and payment details printed at the bottom of invoices', type: 'text' },
  reservation_hold_days:                { label: 'Reservation Hold Days',                description: 'Default days stock reservations are held on acceptance',   type: 'number' },
  pos_blind_cash_up:                    { label: 'Blind Cash-Up',                        description: 'Hide expected cash and sales totals from cashiers during shift close', type: 'boolean' },
  pos_return_window_days:               { label: 'POS Return Window (Days)',             description: 'Maximum days allowed for customer returns without manager approval', type: 'number' },
};

export default async function SettingsPage() {
  try {
    await authorize(PERMISSIONS.SETTINGS_VIEW);
  } catch {
    redirect('/dashboard');
  }

  const currentSettings = await getAllSettings();

  const groups = [
    {
      title: 'Company Information',
      keys: ['company_name', 'company_address', 'company_phone', 'company_email', 'company_tax_number'] as SettingKey[],
    },
    {
      title: 'Point of Sale (POS)',
      keys: ['pos_blind_cash_up', 'pos_return_window_days'] as SettingKey[],
    },
    {
      title: 'Sales & Tax',
      keys: ['default_currency', 'prices_include_tax', 'max_discount_percent_without_approval', 'quotation_valid_days', 'invoice_payment_instructions', 'reservation_hold_days'] as SettingKey[],
    },
    {
      title: 'Stock & Costing',
      keys: ['allow_negative_stock', 'costing_method'] as SettingKey[],
    },
    {
      title: 'Integrations',
      keys: ['eis_enabled'] as SettingKey[],
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ace-navy">App Settings</h1>
        <p className="text-sm text-ace-muted">Configure system-wide defaults. Changes take effect immediately.</p>
      </div>

      <div className="space-y-6">
        {groups.map((group) => (
          <div key={group.title} className="rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-ace-band bg-ace-band/40 px-5 py-3">
              <h2 className="text-sm font-semibold text-ace-navy">{group.title}</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {group.keys.map((key) => (
                <SettingRow
                  key={key}
                  settingKey={key}
                  label={SETTING_META[key].label}
                  description={SETTING_META[key].description}
                  type={SETTING_META[key].type}
                  currentValue={currentSettings[key]}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
