/**
 * Database Error Mapper & Unwrapper.
 *
 * Provides safe unwrapping of PostgreSQL and Drizzle driver errors:
 * - Unwraps err.cause to access PG error codes, constraints, details, and trigger messages.
 * - Guarantees that NO user-facing error message leaks raw SQL queries or parameters.
 * - Maps database constraints and trigger exceptions to human-readable domain messages.
 */

export interface DatabaseErrorDetails {
  /** PostgreSQL error code (e.g. '23505', 'P0001', '57014', '42501') */
  code?: string;
  /** Raw message from the underlying driver cause, or error.message if no cause */
  message: string;
  /** Name of the violated constraint, if applicable */
  constraint?: string;
  /** Additional detail provided by PostgreSQL, if applicable */
  detail?: string;
  /** Table name where the error occurred, if provided */
  table?: string;
  /** Schema name where the error occurred */
  schema?: string;
  /** True if this error originated from a database or query failure */
  isDatabaseError: boolean;
  /** Sanitized, user-safe error message guaranteed free of SQL text or parameter dumps */
  safeUserMessage: string;
}

const SQL_LEAK_PATTERNS = [
  /failed query:/i,
  /params:\s*\[/i,
  /params:\s*\{/i,
  /select\s+.*from/i,
  /insert\s+into/i,
  /update\s+.*set/i,
  /delete\s+from/i,
  /create\s+table/i,
  /alter\s+table/i,
  /drop\s+table/i,
];

/**
 * Checks whether a given string contains leaked SQL syntax or parameter dumps.
 */
export function containsSqlLeak(text: string): boolean {
  if (!text) return false;
  return SQL_LEAK_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Sanitizes an error message so that no SQL text or parameter dump is ever exposed.
 */
export function sanitizeErrorMessage(message: string, fallback = 'Database operation failed'): string {
  if (!message || containsSqlLeak(message)) {
    return fallback;
  }
  return message;
}

/**
 * Maps known PostgreSQL constraint names to clean, user-friendly messages.
 */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  // Payments & Idempotency
  payments_idempotency_key_unique: 'A payment with this idempotency key has already been recorded.',
  payment_attempts_provider_tx_idx: 'A payment attempt with this transaction ID already exists.',
  payment_links_token_unique: 'A payment link with this token already exists.',
  
  // Customers & Accounts
  customers_account_number_unique: 'A customer with this account number already exists.',
  customers_phone_unique: 'A customer with this phone number already exists.',
  customers_email_unique: 'A customer with this email address already exists.',
  
  // Stock & Products
  products_sku_unique: 'A product with this SKU already exists.',
  products_barcode_unique: 'A product with this barcode already exists.',
  serial_numbers_product_serial_idx: 'Duplicate serial number: this serial number already exists for this product.',
  units_of_measure_code_unique: 'A unit of measure with this code already exists.',
  categories_code_unique: 'A category with this code already exists.',
  
  // POS & Shifts
  card_terminals_terminal_id_unique: 'A card terminal with this terminal ID already exists.',
  number_sequences_doc_type_location_id_unique: 'A number sequence for this document type and location already exists.',
  
  // Auth & Users
  users_email_unique: 'A user with this email address already exists.',
  roles_name_unique: 'A role with this name already exists.',
};

/**
 * Unwraps any error (DrizzleQueryError, node-postgres error, or generic Error)
 * and returns structured details plus a sanitized user-facing message.
 */
export function unwrapDatabaseError(error: unknown): DatabaseErrorDetails {
  if (!error || typeof error !== 'object') {
    return {
      message: String(error ?? 'Unknown error'),
      isDatabaseError: false,
      safeUserMessage: 'An unexpected error occurred.',
    };
  }

  const err = error as any;
  // Drizzle wraps driver errors in err.cause
  const cause = err.cause && typeof err.cause === 'object' ? err.cause : null;

  const code: string | undefined = cause?.code ?? err.code ?? undefined;
  const constraint: string | undefined = cause?.constraint ?? err.constraint ?? undefined;
  const detail: string | undefined = cause?.detail ?? err.detail ?? undefined;
  const table: string | undefined = cause?.table ?? err.table ?? undefined;
  const schema: string | undefined = cause?.schema ?? err.schema ?? undefined;

  // The actual database driver message (e.g. from plpgsql RAISE EXCEPTION or constraint)
  const rawDriverMessage: string = cause?.message ?? err.message ?? 'Unknown error';
  const isDatabaseError = Boolean(code || constraint || cause || containsSqlLeak(err.message ?? ''));

  // Determine the safe user-facing message
  let safeUserMessage = 'A database error occurred.';

  if (code === '23505') {
    // Unique violation
    if (constraint && CONSTRAINT_MESSAGES[constraint]) {
      safeUserMessage = CONSTRAINT_MESSAGES[constraint];
    } else if (detail && !containsSqlLeak(detail)) {
      safeUserMessage = `A duplicate record already exists (${detail}).`;
    } else {
      safeUserMessage = 'A duplicate record already exists.';
    }
  } else if (code === '23503') {
    // Foreign key violation
    safeUserMessage = 'Referenced record does not exist or cannot be removed because related records depend on it.';
  } else if (code === '23514') {
    // Check constraint violation
    safeUserMessage = 'The submitted data violates a database validation rule.';
  } else if (code === 'P0001') {
    // PostgreSQL RAISE EXCEPTION from trigger or stored function
    // The message in rawDriverMessage is the developer's trigger exception
    safeUserMessage = sanitizeErrorMessage(rawDriverMessage, 'The requested operation was rejected by business rules.');
  } else if (code === '57014') {
    // Statement timeout
    safeUserMessage = 'The database operation timed out. Please try again.';
  } else if (code === '42501') {
    // Insufficient privilege
    safeUserMessage = 'Permission denied: operation not permitted for this role.';
  } else if (!isDatabaseError && err.message) {
    // Application-level error (not raw SQL)
    safeUserMessage = sanitizeErrorMessage(err.message, 'An error occurred.');
  } else {
    safeUserMessage = sanitizeErrorMessage(rawDriverMessage, 'A database error occurred. Please try again.');
  }

  return {
    code,
    message: rawDriverMessage,
    constraint,
    detail,
    table,
    schema,
    isDatabaseError,
    safeUserMessage,
  };
}

/**
 * Returns a user-safe error message guaranteed never to leak SQL or parameters.
 */
export function getSafeUserErrorMessage(error: unknown, fallback?: string): string {
  const unwrapped = unwrapDatabaseError(error);
  if (fallback && unwrapped.safeUserMessage === 'A database error occurred.') {
    return fallback;
  }
  return unwrapped.safeUserMessage;
}

/**
 * Checks if the error was caused by a specific unique constraint violation.
 */
export function isUniqueConstraintViolation(error: unknown, constraintName?: string): boolean {
  const details = unwrapDatabaseError(error);
  if (details.code !== '23505') return false;
  if (constraintName) {
    return details.constraint === constraintName;
  }
  return true;
}

/**
 * Checks if the error was a PostgreSQL trigger error (code P0001) matching an optional pattern.
 */
export function isTriggerViolation(error: unknown, pattern?: string | RegExp): boolean {
  const details = unwrapDatabaseError(error);
  if (details.code !== 'P0001') return false;
  if (!pattern) return true;
  if (typeof pattern === 'string') {
    return details.message.includes(pattern);
  }
  return pattern.test(details.message);
}

/**
 * Helper to assert on database exceptions in tests without relying on monkey-patched messages.
 * Extracts the unwrapped cause.message or trigger message and checks against expectation.
 */
export async function expectDatabaseRejection(
  promise: Promise<unknown>,
  expected?: string | RegExp | { code?: string; message?: string | RegExp; constraint?: string },
): Promise<DatabaseErrorDetails> {
  try {
    await promise;
    throw new Error('Expected promise to reject with a database error, but it resolved successfully.');
  } catch (err: any) {
    if (err.message === 'Expected promise to reject with a database error, but it resolved successfully.') {
      throw err;
    }
    const details = unwrapDatabaseError(err);
    if (!expected) return details;

    if (typeof expected === 'string') {
      if (!details.message.includes(expected) && !details.safeUserMessage.includes(expected)) {
        throw new Error(
          `Expected database error message to contain "${expected}", but got raw="${details.message}" safe="${details.safeUserMessage}"`,
        );
      }
    } else if (expected instanceof RegExp) {
      if (!expected.test(details.message) && !expected.test(details.safeUserMessage)) {
        throw new Error(
          `Expected database error message to match ${expected}, but got raw="${details.message}" safe="${details.safeUserMessage}"`,
        );
      }
    } else {
      if (expected.code && details.code !== expected.code) {
        throw new Error(`Expected error code "${expected.code}", got "${details.code}"`);
      }
      if (expected.constraint && details.constraint !== expected.constraint) {
        throw new Error(`Expected constraint "${expected.constraint}", got "${details.constraint}"`);
      }
      if (expected.message) {
        if (typeof expected.message === 'string') {
          if (!details.message.includes(expected.message)) {
            throw new Error(`Expected error message to contain "${expected.message}", got "${details.message}"`);
          }
        } else if (!expected.message.test(details.message)) {
          throw new Error(`Expected error message to match ${expected.message}, got "${details.message}"`);
        }
      }
    }
    return details;
  }
}

