/**
 * Tests for the settings service.
 * Uses a mocked Drizzle DB — no database required.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/server/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    query: {
      settings: {
        findFirst: vi.fn(),
      },
    },
  },
}));

vi.mock('@/server/services/audit', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { db } from '@/server/db';
import { getAllSettings, getSetting, updateSetting } from '@/server/services/settings';
import { writeAuditLog } from '@/server/services/audit';

const mockSelect = db.select as Mock;
const mockInsert = db.insert as Mock;
const mockFindFirst = db.query.settings.findFirst as Mock;
const mockAudit = writeAuditLog as Mock;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getAllSettings()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns all settings as a key/value map', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockResolvedValue([
        { key: 'company_name', value: 'Ace Holdings Limited' },
        { key: 'allow_negative_stock', value: false },
        { key: 'quotation_valid_days', value: 14 },
      ]),
    });

    const result = await getAllSettings();

    expect(result['company_name']).toBe('Ace Holdings Limited');
    expect(result['allow_negative_stock']).toBe(false);
    expect(result['quotation_valid_days']).toBe(14);
  });

  it('returns an empty map when no settings exist', async () => {
    mockSelect.mockReturnValue({ from: vi.fn().mockResolvedValue([]) });
    const result = await getAllSettings();
    expect(Object.keys(result)).toHaveLength(0);
  });
});

describe('getSetting()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the value for an existing key', async () => {
    mockFindFirst.mockResolvedValue({ key: 'company_name', value: 'Ace Holdings Limited' });
    const value = await getSetting('company_name');
    expect(value).toBe('Ace Holdings Limited');
  });

  it('returns undefined for a key that does not exist', async () => {
    mockFindFirst.mockResolvedValue(null);
    const value = await getSetting('company_name');
    expect(value).toBeUndefined();
  });
});

describe('updateSetting()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts the setting value', async () => {
    mockFindFirst.mockResolvedValue({ key: 'company_name', value: 'Old Name' });

    const onConflictDoUpdateMock = vi.fn().mockResolvedValue([]);
    const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });
    mockInsert.mockReturnValue({ values: valuesMock });

    await updateSetting('company_name', 'New Name', 'actor-id', '127.0.0.1');

    expect(mockInsert).toHaveBeenCalled();
    expect(onConflictDoUpdateMock).toHaveBeenCalled();
  });

  it('writes to the audit log on update', async () => {
    mockFindFirst.mockResolvedValue({ key: 'company_name', value: 'Old Name' });

    const onConflictDoUpdateMock = vi.fn().mockResolvedValue([]);
    const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });
    mockInsert.mockReturnValue({ values: valuesMock });

    await updateSetting('company_name', 'New Name', 'actor-id', '10.0.0.1');

    expect(mockAudit).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        action: 'setting.update',
        entityType: 'setting',
        before: { company_name: 'Old Name' },
        after: { company_name: 'New Name' },
        ip: '10.0.0.1',
      }),
    );
  });

  it('passes null as before when the setting did not previously exist', async () => {
    mockFindFirst.mockResolvedValue(null);

    const onConflictDoUpdateMock = vi.fn().mockResolvedValue([]);
    const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });
    mockInsert.mockReturnValue({ values: valuesMock });

    await updateSetting('eis_enabled', true, 'actor-id');

    expect(mockAudit).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ before: null }),
    );
  });
});
