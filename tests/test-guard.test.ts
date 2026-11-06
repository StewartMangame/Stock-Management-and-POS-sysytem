import { describe, it, expect } from 'vitest';
import { assertSafeTestDatabase } from '../src/lib/test-guard';

describe('Global Database Safety Guard', () => {
  const prodUrl =
    'postgresql://neondb_owner:password@ep-muddy-brook.us-east-2.aws.neon.tech/neondb?sslmode=require';
  const testUrl =
    'postgresql://neondb_owner:password@ep-muddy-brook.us-east-2.aws.neon.tech/testdb?sslmode=require';

  it('allows distinct test database on same host', () => {
    expect(() => assertSafeTestDatabase(testUrl, prodUrl)).not.toThrow();
  });

  it('refuses when TEST_DATABASE_URL is missing or empty', () => {
    expect(() => assertSafeTestDatabase('', prodUrl)).toThrow(
      /TEST_DATABASE_URL is missing/i,
    );
    expect(() => assertSafeTestDatabase(undefined, prodUrl)).toThrow(
      /TEST_DATABASE_URL is missing/i,
    );
  });

  it('refuses when TEST_DATABASE_URL equals DATABASE_URL', () => {
    expect(() => assertSafeTestDatabase(prodUrl, prodUrl)).toThrow(
      /TEST_DATABASE_URL equals DATABASE_URL/i,
    );
  });

  it('refuses when TEST_DATABASE_URL points to the same host and database', () => {
    const sameHostAndDb =
      'postgresql://other_user:diffpass@ep-muddy-brook.us-east-2.aws.neon.tech/neondb?sslmode=require';
    expect(() => assertSafeTestDatabase(sameHostAndDb, prodUrl)).toThrow(
      /same host .* and database .* as DATABASE_URL/i,
    );
  });
});

