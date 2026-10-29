import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';
import { db } from '@/server/db';
import { customers } from '@/server/db/schema';
import { eq, desc } from 'drizzle-orm';

/**
 * GET /api/pos/customers
 *
 * Returns list of active customers for POS, highlighting the Walk-in customer.
 */
export async function GET(_req: NextRequest) {
  try {
    await authorize(PERMISSIONS.POS_ACCESS);

    const rows = await db
      .select({
        id: customers.id,
        accountNumber: customers.accountNumber,
        name: customers.name,
        customerType: customers.customerType,
        isWalkIn: customers.isWalkIn,
        phone: customers.phone,
        email: customers.email,
        address: customers.address,
        taxNumber: customers.taxNumber,
        creditLimitMinor: customers.creditLimitMinor,
        paymentTermsDays: customers.paymentTermsDays,
      })
      .from(customers)
      .where(eq(customers.isActive, true))
      .orderBy(desc(customers.isWalkIn), customers.name);

    return NextResponse.json({
      customers: rows.map((c) => ({
        ...c,
        creditLimitMinor: c.creditLimitMinor.toString(),
      })),
      defaultCustomerId: rows.find((c) => c.isWalkIn)?.id ?? rows[0]?.id ?? null,
    });
  } catch (err: unknown) {
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : 'Failed to fetch POS customers';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
