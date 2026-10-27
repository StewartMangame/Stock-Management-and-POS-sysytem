'use client';

import { useState, useActionState, useEffect, useTransition } from 'react';
import { toast } from 'sonner';
import { Check, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { updateSettingAction } from './actions';
import type { SettingKey } from '@/server/db/schema';

interface Props {
  settingKey: SettingKey;
  label: string;
  description: string;
  type: 'text' | 'boolean' | 'number';
  currentValue: unknown;
}

export function SettingRow({ settingKey, label, description, type, currentValue }: Props) {
  const [editing, setEditing] = useState(false);
  const [state, action, isPending] = useActionState(updateSettingAction, {});

  useEffect(() => {
    if (state.success && state.key === settingKey) {
      toast.success(`"${label}" updated.`);
      setEditing(false);
    }
    if (state.error) {
      toast.error(state.error);
    }
  }, [state, settingKey, label]);

  const displayValue =
    currentValue === null || currentValue === undefined
      ? '—'
      : type === 'boolean'
      ? (currentValue as boolean)
        ? 'On'
        : 'Off'
      : String(currentValue);

  // Boolean settings toggle inline without entering edit mode
  if (type === 'boolean') {
    return (
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex-1">
          <p className="text-sm font-medium text-ace-text">{label}</p>
          <p className="text-xs text-ace-muted">{description}</p>
        </div>
        <form action={action} className="flex items-center">
          <input type="hidden" name="key" value={settingKey} />
          <input type="hidden" name="value" value={currentValue ? 'false' : 'true'} />
          <Switch
            id={`setting-${settingKey}`}
            checked={!!currentValue}
            disabled={isPending}
            onCheckedChange={() => {
              const form = document.getElementById(`setting-form-${settingKey}`) as HTMLFormElement;
              form?.requestSubmit();
            }}
          />
        </form>
        {/* Hidden form for requestSubmit */}
        <form id={`setting-form-${settingKey}`} action={action} className="hidden">
          <input type="hidden" name="key" value={settingKey} />
          <input type="hidden" name="value" value={currentValue ? 'false' : 'true'} />
        </form>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <div className="flex-1">
        <p className="text-sm font-medium text-ace-text">{label}</p>
        <p className="text-xs text-ace-muted">{description}</p>
      </div>

      {editing ? (
        <form action={action} className="flex items-center gap-2">
          <input type="hidden" name="key" value={settingKey} />
          <Input
            id={`setting-input-${settingKey}`}
            name="value"
            type={type === 'number' ? 'number' : 'text'}
            defaultValue={currentValue !== null && currentValue !== undefined ? String(currentValue) : ''}
            className="h-8 w-48 text-sm"
            autoFocus
          />
          <Button type="submit" size="icon" className="h-8 w-8" disabled={isPending} aria-label="Save">
            <Check className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditing(false)} aria-label="Cancel">
            <X className="h-4 w-4" />
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-3">
          <span
            id={`setting-value-${settingKey}`}
            className="min-w-[6rem] text-right text-sm font-medium text-ace-navy"
          >
            {displayValue}
          </span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => setEditing(true)}
            id={`edit-setting-${settingKey}`}
            aria-label={`Edit ${label}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
