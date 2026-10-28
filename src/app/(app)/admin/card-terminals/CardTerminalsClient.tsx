'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createCardTerminalAction,
  updateCardTerminalAction,
} from '@/app/(app)/admin/card-terminals/actions';
import { Plus, Edit2, CreditCard, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

export function CardTerminalsClient({
  terminals,
  locations,
}: {
  terminals: any[];
  locations: any[];
}) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [terminalId, setTerminalId] = useState('');
  const [locationId, setLocationId] = useState(locations[0]?.id || '');
  const [isActive, setIsActive] = useState(true);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const openCreate = () => {
    setEditingId(null);
    setName('');
    setTerminalId('');
    setLocationId(locations[0]?.id || '');
    setIsActive(true);
    setShowModal(true);
  };

  const openEdit = (t: any) => {
    setEditingId(t.terminal.id);
    setName(t.terminal.name);
    setTerminalId(t.terminal.terminalId);
    setLocationId(t.terminal.locationId);
    setIsActive(t.terminal.isActive);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !terminalId.trim() || !locationId) {
      toast.error('All fields are required');
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingId) {
        await updateCardTerminalAction(editingId, {
          name: name.trim(),
          terminalId: terminalId.trim(),
          locationId,
          isActive,
        });
        toast.success('Card terminal updated successfully');
      } else {
        await createCardTerminalAction({
          name: name.trim(),
          terminalId: terminalId.trim(),
          locationId,
          isActive,
        });
        toast.success('Card terminal registered successfully');
      }
      setShowModal(false);
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Operation failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Card Terminal
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/60 font-semibold uppercase text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">Terminal Name</th>
                <th className="py-3 px-4">Device / Merchant ID</th>
                <th className="py-3 px-4">Assigned Location</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {terminals.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    No card terminals configured yet. Click &apos;Add Card Terminal&apos; to register one.
                  </td>
                </tr>
              ) : (
                terminals.map((t) => (
                  <tr key={t.terminal.id} className="hover:bg-slate-50/50">
                    <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                      {t.terminal.name}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs">{t.terminal.terminalId}</td>
                    <td className="py-3 px-4">
                      {t.locationName} ({t.locationCode})
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                          t.terminal.isActive
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {t.terminal.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(t)}
                        className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-500 hover:text-slate-700 transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmit}
            className="bg-white dark:bg-slate-900 rounded-xl p-6 max-w-md w-full shadow-xl space-y-4"
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-blue-600" />
              {editingId ? 'Edit Card Terminal' : 'Add Card Terminal'}
            </h3>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Terminal Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Counter 1 POS Terminal"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Terminal / Device ID <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. NBM-POS-0012"
                value={terminalId}
                onChange={(e) => setTerminalId(e.target.value)}
                className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Assigned Location <span className="text-rose-500">*</span>
              </label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                required
                className="w-full text-sm rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5"
              >
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name} ({loc.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="isActiveCheck"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="rounded border-slate-300"
              />
              <label htmlFor="isActiveCheck" className="text-xs text-slate-700 dark:text-slate-300">
                Terminal is active for payment processing
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
              >
                {isSubmitting ? 'Saving...' : editingId ? 'Update Terminal' : 'Create Terminal'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
