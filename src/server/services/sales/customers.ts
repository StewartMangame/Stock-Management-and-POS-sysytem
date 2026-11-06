/**
 * Customer Management Service.
 *
 * Implements:
 *   - CRUD for business and individual customers
 *   - Protected single Walk-in Customer (account 'WALK-IN', cannot be deleted or mutated)
 *   - Credit limit tracking and available credit calculations
 *   - Foreign key integrity guards
 */

import { randomBytes } from 'node:crypto';
import { db, type DbTransaction } from '@/server/db';
import { customers, salesDocuments, serialNumbers } from '@/server/db/schema';
import { eq, and, sql, ilike, desc, or } from 'drizzle-orm';
import { writeAuditLog } from '@/server/services/audit';

export type Customer = typeof customers.$inferSelect;

export interface CustomerFilter {
  query?: string;
  customerType?: 'individual' | 'business' | 'walk_in';
  isActive?: boolean;
  limit?: number;
  offset?: number;
}

export interface CustomerCreditStatus {
  customerId: string;
  creditLimitMinor: number;
  outstandingBalanceMinor: number;
  availableCreditMinor: number;
  isOverLimit: boolean;
}

export async function getCustomers(filter: CustomerFilter = {}) {
  const conditions = [];

  if (filter.isActive !== undefined) {
    conditions.push(eq(customers.isActive, filter.isActive));
  }
  if (filter.customerType) {
    conditions.push(eq(customers.customerType, filter.customerType));
  }
  if (filter.query) {
    const q = `%${filter.query}%`;
    conditions.push(
      or(
        ilike(customers.name, q),
        ilike(customers.accountNumber, q),
        ilike(customers.phone, q),
        ilike(customers.email, q),
      ),
    );
  }

  const query = db
    .select()
    .from(customers)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(customers.createdAt));

  if (filter.limit) {
    query.limit(filter.limit);
  }
  if (filter.offset) {
    query.offset(filter.offset);
  }

  return await query;
}

export async function getCustomerById(id: string) {
  const [customer] = await db.select().from(customers).where(eq(customers.id, id));
  return customer || null;
}

export async function getWalkInCustomer() {
  const [walkIn] = await db.select().from(customers).where(eq(customers.isWalkIn, true));
  if (!walkIn) {
    throw new Error('Walk-in customer not found in database');
  }
  return walkIn;
}

export async function getCustomerCreditStatus(
  customerId: string,
  tx?: DbTransaction,
): Promise<CustomerCreditStatus> {
  const executor = tx ?? db;

  const [customer] = await executor.select().from(customers).where(eq(customers.id, customerId));
  if (!customer) {
    throw new Error(`Customer ${customerId} not found`);
  }

  if (customer.isWalkIn) {
    return {
      customerId,
      creditLimitMinor: 0,
      outstandingBalanceMinor: 0,
      availableCreditMinor: 0,
      isOverLimit: false,
    };
  }

  // Calculate outstanding balance as sum of balance_minor of all issued invoices
  const [balanceRes] = await executor
    .select({
      totalOutstanding: sql<string>`COALESCE(SUM(${salesDocuments.balanceMinor}), 0)`,
    })
    .from(salesDocuments)
    .where(
      and(
        eq(salesDocuments.customerId, customerId),
        eq(salesDocuments.documentType, 'invoice'),
        eq(salesDocuments.status, 'issued'),
      ),
    );

  const outstanding = parseInt(balanceRes?.totalOutstanding ?? '0', 10);
  const creditLimit = Number(customer.creditLimitMinor);
  const available = Math.max(0, creditLimit - outstanding);

  return {
    customerId,
    creditLimitMinor: creditLimit,
    outstandingBalanceMinor: outstanding,
    availableCreditMinor: available,
    isOverLimit: outstanding > creditLimit,
  };
}

export async function createCustomer(
  data: {
    name: string;
    customerType?: 'individual' | 'business';
    email?: string;
    phone?: string;
    address?: string;
    taxNumber?: string;
    creditLimitMinor?: number;
    paymentTermsDays?: number;
  },
  userId?: string,
) {
  const accountNumber = `CUST-${new Date().toISOString().slice(0, 7).replace('-', '')}-${randomBytes(6)
    .toString('hex')
    .toUpperCase()}`;

  const [created] = await db
    .insert(customers)
    .values({
      accountNumber,
      name: data.name,
      customerType: data.customerType ?? 'individual',
      isWalkIn: false,
      email: data.email,
      phone: data.phone,
      address: data.address,
      taxNumber: data.taxNumber,
      creditLimitMinor: data.creditLimitMinor ?? 0,
      paymentTermsDays: data.paymentTermsDays ?? 30,
      isActive: true,
      createdBy: userId,
    })
    .returning();

  if (userId) {
    await writeAuditLog(db, {
      userId,
      action: 'customer_created',
      entityType: 'customer',
      entityId: created!.id,
      after: created,
    });
  }

  return created!;
}

export async function updateCustomer(
  id: string,
  data: {
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
    taxNumber?: string;
    creditLimitMinor?: number;
    paymentTermsDays?: number;
    isActive?: boolean;
  },
  userId?: string,
) {
  const current = await getCustomerById(id);
  if (!current) {
    throw new Error('Customer not found');
  }

  if (current.isWalkIn) {
    // Walk-in customer core fields cannot be altered
    if (data.creditLimitMinor && data.creditLimitMinor > 0) {
      throw new Error('Walk-in customer cannot have a credit limit');
    }
  }

  const [updated] = await db
    .update(customers)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, id))
    .returning();

  if (userId) {
    await writeAuditLog(db, {
      userId,
      action: 'customer_updated',
      entityType: 'customer',
      entityId: id,
      before: current,
      after: updated,
    });
  }

  return updated!;
}

export async function deleteCustomer(id: string, userId?: string) {
  const current = await getCustomerById(id);
  if (!current) {
    throw new Error('Customer not found');
  }

  if (current.isWalkIn) {
    throw new Error('Walk-in customer cannot be deleted');
  }

  // Check if customer has any sales documents or owned serial numbers
  const [docCount] = await db
    .select({ count: sql<string>`count(*)` })
    .from(salesDocuments)
    .where(eq(salesDocuments.customerId, id));

  if (parseInt(docCount?.count ?? '0', 10) > 0) {
    throw new Error('Cannot delete customer with existing sales documents');
  }

  const [serialCount] = await db
    .select({ count: sql<string>`count(*)` })
    .from(serialNumbers)
    .where(eq(serialNumbers.customerId, id));

  if (parseInt(serialCount?.count ?? '0', 10) > 0) {
    throw new Error('Cannot delete customer with assigned serial numbers');
  }

  const [deleted] = await db.delete(customers).where(eq(customers.id, id)).returning();

  if (userId) {
    await writeAuditLog(db, {
      userId,
      action: 'customer_deleted',
      entityType: 'customer',
      entityId: id,
      before: current,
    });
  }

  return deleted!;
}
