import { describe, it, expect } from 'vitest';
import {
  unwrapDatabaseError,
  getSafeUserErrorMessage,
  containsSqlLeak,
  sanitizeErrorMessage,
  expectDatabaseRejection,
} from '@/server/db/errors';

describe('Database Error Mapper & SQL Leak Protection', () => {
  it('detects SQL text and parameter leaks in messages', () => {
    expect(containsSqlLeak('Failed query: select * from users where id = $1\nparams: ["abc"]')).toBe(true);
    expect(containsSqlLeak('Failed query: INSERT INTO audit_log VALUES ($1, $2)')).toBe(true);
    expect(containsSqlLeak('SELECT * FROM accounts')).toBe(true);
    expect(containsSqlLeak('params: ["123", 456]')).toBe(true);
    expect(containsSqlLeak('Customer credit limit exceeded')).toBe(false);
    expect(containsSqlLeak('Audit log is append-only: UPDATE is prohibited')).toBe(false);
  });

  it('sanitizes messages containing SQL leaks and preserves clean messages', () => {
    const leaked = 'Failed query: update users set password = $1\nparams: ["secret"]';
    expect(sanitizeErrorMessage(leaked)).toBe('Database operation failed');
    expect(sanitizeErrorMessage(leaked, 'Custom fallback')).toBe('Custom fallback');

    const clean = 'Cannot confirm cheque with status cancelled';
    expect(sanitizeErrorMessage(clean)).toBe(clean);
  });

  it('unwraps DrizzleQueryError with underlying PostgreSQL cause', () => {
    const mockPgError = {
      code: '23505',
      constraint: 'payments_idempotency_key_unique',
      detail: 'Key (idempotency_key)=(idem-123) already exists.',
      message: 'duplicate key value violates unique constraint "payments_idempotency_key_unique"',
      routine: '_bt_check_unique',
    };

    const mockDrizzleError = {
      name: 'DrizzleQueryError',
      message: 'Failed query: insert into "payments" ("id", "idempotency_key") values ($1, $2)\nparams: ["p-1", "idem-123"]',
      cause: mockPgError,
    };

    const unwrapped = unwrapDatabaseError(mockDrizzleError);

    // Underlying PG error fields are unwrapped
    expect(unwrapped.code).toBe('23505');
    expect(unwrapped.constraint).toBe('payments_idempotency_key_unique');
    expect(unwrapped.message).toBe(mockPgError.message);
    expect(unwrapped.isDatabaseError).toBe(true);

    // Safe user-facing message does NOT contain SQL or parameters
    expect(unwrapped.safeUserMessage).toBe('A payment with this idempotency key has already been recorded.');
    expect(containsSqlLeak(unwrapped.safeUserMessage)).toBe(false);
  });

  it('unwraps PostgreSQL trigger exceptions (code P0001)', () => {
    const mockTriggerError = {
      name: 'DrizzleQueryError',
      message: 'Failed query: update audit_log set action = $1\nparams: ["tampered"]',
      cause: {
        code: 'P0001',
        message: 'Audit log is append-only: UPDATE is prohibited',
        routine: 'prevent_audit_log_mutation',
      },
    };

    const unwrapped = unwrapDatabaseError(mockTriggerError);
    expect(unwrapped.code).toBe('P0001');
    expect(unwrapped.message).toBe('Audit log is append-only: UPDATE is prohibited');
    expect(unwrapped.safeUserMessage).toBe('Audit log is append-only: UPDATE is prohibited');
    expect(containsSqlLeak(unwrapped.safeUserMessage)).toBe(false);
  });

  it('unwraps statement timeout error (code 57014)', () => {
    const mockTimeoutError = {
      name: 'DrizzleQueryError',
      message: 'Failed query: select pg_sleep(5)\nparams: []',
      cause: {
        code: '57014',
        message: 'canceling statement due to statement timeout',
      },
    };

    const unwrapped = unwrapDatabaseError(mockTimeoutError);
    expect(unwrapped.code).toBe('57014');
    expect(unwrapped.safeUserMessage).toBe('The database operation timed out. Please try again.');
    expect(containsSqlLeak(unwrapped.safeUserMessage)).toBe(false);
  });

  it('handles generic non-database application errors gracefully', () => {
    const appError = new Error('Product PC-100 is currently out of stock');
    const unwrapped = unwrapDatabaseError(appError);

    expect(unwrapped.isDatabaseError).toBe(false);
    expect(unwrapped.safeUserMessage).toBe('Product PC-100 is currently out of stock');
  });

  it('expectDatabaseRejection correctly verifies database errors', async () => {
    const failingPromise = Promise.reject({
      name: 'DrizzleQueryError',
      message: 'Failed query: update journal_batches set total = 0',
      cause: {
        code: 'P0001',
        message: 'Journal ledger is append-only: UPDATE and DELETE are prohibited',
      },
    });

    const res = await expectDatabaseRejection(failingPromise, /append-only/i);
    expect(res.code).toBe('P0001');
  });

  it('toThrowCause matcher unwrap cause.message', async () => {
    const mockError = {
      name: 'DrizzleQueryError',
      message: 'Failed query: insert into ...',
      cause: {
        code: 'P0001',
        message: 'Payments cannot be inserted with initial status awaiting_sale',
      },
    };

    expect(() => {
      throw mockError;
    }).toThrowCause(/awaiting_sale/);
  });
});
