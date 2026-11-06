/**
 * Accounting & Journal Engine (Milestone 7).
 *
 * Implements double-entry general ledger journal generation, event deduplication,
 * and journal batch creation.
 *
 * Principles:
 *   1. Strict double-entry: Total Debits === Total Credits for every entry.
 *   2. Deduplication: journal_source_events ensures each event is batched exactly once.
 *   3. Append-only: Journal batches and lines cannot be edited or deleted once written.
 *   4. Invoice basis for revenue recognition (IFRS 15 / MRA VAT compliant).
 *   5. All initial account codes are placeholders (is_placeholder = true).
 */

import { db, DbTransaction } from '@/server/db';
import {
  journalBatches,
  journalLines,
  journalSourceEvents,
  accountMappings,
  salesDocuments,
  salesDocumentLines,
  deliveryNotes,
  deliveryNoteLines,
  goodsReceipts,
  goodsReceiptItems,
  payments,
  stockMovements,
  stockAdjustments,
} from '@/server/db/schema';
import { eq, and, sql, gte, lte, inArray } from 'drizzle-orm';
import { getNextDocNumber } from '@/server/services/sequences';

export interface DefaultAccountMapping {
  eventType: string;
  role: string;
  accountCode: string;
  accountName: string;
  description: string;
}

export const DEFAULT_ACCOUNT_MAPPINGS: DefaultAccountMapping[] = [
  // 1. Invoice Issued (Revenue recognition on invoice basis)
  { eventType: 'invoice.issued', role: 'debit', accountCode: '1200', accountName: 'Accounts Receivable', description: 'Customer trade receivables' },
  { eventType: 'invoice.issued', role: 'credit', accountCode: '4000', accountName: 'Sales Revenue', description: 'Standard sales income' },
  { eventType: 'invoice.issued', role: 'tax', accountCode: '2200', accountName: 'Output VAT Payable', description: 'MRA VAT liability (17.5%)' },

  // 2. Invoice Void
  { eventType: 'invoice.void', role: 'credit', accountCode: '1200', accountName: 'Accounts Receivable', description: 'Reversal of trade receivables' },
  { eventType: 'invoice.void', role: 'debit', accountCode: '4000', accountName: 'Sales Revenue', description: 'Reversal of sales income' },
  { eventType: 'invoice.void', role: 'tax', accountCode: '2200', accountName: 'Output VAT Payable', description: 'Reversal of output VAT' },

  // 3. Delivery Completed (Cost of sales recognition)
  { eventType: 'delivery.completed', role: 'debit', accountCode: '5000', accountName: 'Cost of Goods Sold', description: 'Inventory cost of items delivered' },
  { eventType: 'delivery.completed', role: 'credit', accountCode: '1300', accountName: 'Inventory Asset', description: 'Warehouse / outlet inventory reduction' },

  // 4. Goods Receipt Completed (Purchasing inventory recognition)
  { eventType: 'goods_receipt.completed', role: 'debit', accountCode: '1300', accountName: 'Inventory Asset', description: 'Receipt of stock into inventory' },
  { eventType: 'goods_receipt.completed', role: 'credit', accountCode: '2100', accountName: 'Accounts Payable', description: 'Supplier liability / clearing' },

  // 5. Payment Confirmed (Receipt against receivables)
  { eventType: 'payment.confirmed', role: 'debit', accountCode: '1000', accountName: 'Bank / Cash', description: 'Cash / Bank receipt' },
  { eventType: 'payment.confirmed', role: 'credit', accountCode: '1200', accountName: 'Accounts Receivable', description: 'Clear trade receivables' },

  // 6. Payment Reversed
  { eventType: 'payment.reversed', role: 'debit', accountCode: '1200', accountName: 'Accounts Receivable', description: 'Reinstate trade receivables' },
  { eventType: 'payment.reversed', role: 'credit', accountCode: '1000', accountName: 'Bank / Cash', description: 'Reverse cash / bank entry' },

  // 7. Cheque Bounced
  { eventType: 'cheque.bounced', role: 'debit', accountCode: '1200', accountName: 'Accounts Receivable', description: 'Reinstate receivables after bounce' },
  { eventType: 'cheque.bounced', role: 'credit', accountCode: '1000', accountName: 'Bank / Cash', description: 'Reverse bank entry for dishonoured cheque' },

  // 8. Payment Customer Credit / Deposit
  { eventType: 'payment.customer_credit', role: 'debit', accountCode: '1000', accountName: 'Bank / Cash', description: 'Receipt of customer funds' },
  { eventType: 'payment.customer_credit', role: 'credit', accountCode: '2300', accountName: 'Customer Deposits', description: 'Unallocated customer credit / deposit liability' },

  // 9. Payment Awaiting Sale (Suspense)
  { eventType: 'payment.awaiting_sale', role: 'debit', accountCode: '1000', accountName: 'Bank / Cash', description: 'Mobile money push confirmed before sale complete' },
  { eventType: 'payment.awaiting_sale', role: 'credit', accountCode: '2900', accountName: 'Suspense Clearing', description: 'Temporary holding account awaiting counter sale' },

  // 10. OneKhusa Payment Fee
  { eventType: 'onekhusa.fee', role: 'debit', accountCode: '6100', accountName: 'Bank & Gateway Charges', description: 'Transaction processing fee' },
  { eventType: 'onekhusa.fee', role: 'credit', accountCode: '1000', accountName: 'Bank / Cash', description: 'Fee deducted from settlement' },

  // 11. OneKhusa Settlement
  { eventType: 'onekhusa.settlement', role: 'debit', accountCode: '1000', accountName: 'Bank Account', description: 'Net payout to commercial bank' },
  { eventType: 'onekhusa.settlement', role: 'credit', accountCode: '2900', accountName: 'Suspense Clearing', description: 'Clear gateway holding balance' },

  // 12. Credit Note Issued
  { eventType: 'credit_note.issued', role: 'debit', accountCode: '4100', accountName: 'Sales Returns & Allowances', description: 'Contra revenue for returns' },
  { eventType: 'credit_note.issued', role: 'tax', accountCode: '2200', accountName: 'Output VAT Payable', description: 'VAT relief on credit note' },
  { eventType: 'credit_note.issued', role: 'credit', accountCode: '1200', accountName: 'Accounts Receivable', description: 'Credit to customer account' },

  // 13. Credit Note Refund (Cash / Bank payout)
  { eventType: 'credit_note.refund', role: 'debit', accountCode: '1200', accountName: 'Accounts Receivable', description: 'Debit customer balance to clear credit' },
  { eventType: 'credit_note.refund', role: 'credit', accountCode: '1000', accountName: 'Bank / Cash', description: 'Disbursement of refund' },

  // 14. Stock Adjustment Gain
  { eventType: 'stock_adjustment.gain', role: 'debit', accountCode: '1300', accountName: 'Inventory Asset', description: 'Increase inventory for physical count gain' },
  { eventType: 'stock_adjustment.gain', role: 'credit', accountCode: '5100', accountName: 'Inventory Variance Gain', description: 'Inventory overage gain' },

  // 15. Stock Adjustment Loss
  { eventType: 'stock_adjustment.loss', role: 'debit', accountCode: '5100', accountName: 'Inventory Variance Loss', description: 'Inventory shrinkage / damage' },
  { eventType: 'stock_adjustment.loss', role: 'credit', accountCode: '1300', accountName: 'Inventory Asset', description: 'Decrease inventory for loss' },

  // 16. Landed Cost Applied
  { eventType: 'landed_cost.applied', role: 'debit', accountCode: '1300', accountName: 'Inventory Asset', description: 'Capitalise freight/clearing into inventory' },
  { eventType: 'landed_cost.applied', role: 'credit', accountCode: '2150', accountName: 'Landed Cost Accruals', description: 'Freight / duty clearing payable' },
];

/**
 * Ensures all default placeholder account mappings exist in the database.
 */
export async function seedDefaultAccountMappings(client: typeof db | DbTransaction = db): Promise<void> {
  for (const m of DEFAULT_ACCOUNT_MAPPINGS) {
    await client
      .insert(accountMappings)
      .values({
        eventType: m.eventType,
        role: m.role,
        accountCode: m.accountCode,
        accountName: m.accountName,
        description: m.description,
        isPlaceholder: true,
      })
      .onConflictDoNothing();
  }
}

export interface PreparedJournalLine {
  entryNumber: string;
  entryDate: Date;
  eventType: string;
  sourceEntityType: string;
  sourceEntityId: string;
  accountCode: string;
  accountName: string;
  debitMinor: number;
  creditMinor: number;
  description: string;
  locationId?: string | null;
}

/**
 * Creates a new balanced Journal Batch for the given period.
 * Identifies all unbatched source events, generates balanced journal lines,
 * records deduplication in journal_source_events, and marks batch as DRAFT.
 */
export async function createJournalBatch(
  periodStart: Date,
  periodEnd: Date,
  actorId?: string,
): Promise<{
  batchId: string;
  batchNumber: string;
  lineCount: number;
  totalDebitMinor: number;
  totalCreditMinor: number;
  isBalanced: boolean;
}> {
  await seedDefaultAccountMappings(db);

  // Load account mappings lookup: `eventType:role` -> mapping
  const mappings = await db.select().from(accountMappings);
  const mapLookup = new Map<string, typeof mappings[0]>();
  for (const m of mappings) {
    mapLookup.set(`${m.eventType}:${m.role}`, m);
  }

  const getMapping = (eventType: string, role: string) => {
    const found = mapLookup.get(`${eventType}:${role}`);
    if (found) return { code: found.accountCode, name: found.accountName };
    // Fallback to default in-memory definition
    const def = DEFAULT_ACCOUNT_MAPPINGS.find((d) => d.eventType === eventType && d.role === role);
    return { code: def?.accountCode ?? '9999', name: def?.accountName ?? 'Suspense Account' };
  };

  return await db.transaction(async (tx) => {
    // Generate sequential batch number and UUID
    const year = periodEnd.getFullYear();
    const countRes = await tx
      .select({ count: sql<string>`count(*)::text` })
      .from(journalBatches);
    const seq = Number(countRes[0]?.count ?? 0) + 1;
    const batchNumber = `JB-${year}-${String(seq).padStart(4, '0')}`;
    const batchId = crypto.randomUUID();

    const linesToInsert: PreparedJournalLine[] = [];
    const sourceEventsToInsert: { eventType: string; sourceId: string; batchId: string }[] = [];

    let entrySeq = 1;
    const nextEntryNumber = (prefix: string) => `${prefix}-${String(entrySeq++).padStart(4, '0')}`;

    // ── 1. Invoices Issued (Invoice basis revenue) ───────────────────────────
    const unbatchedInvoices = await tx.execute<{
      id: string;
      document_number: string;
      issue_date: string;
      location_id: string;
      subtotal_minor: string;
      tax_minor: string;
      total_minor: string;
    }>(sql`
      SELECT sd.id, sd.document_number, sd.issue_date, sd.location_id,
             sd.subtotal_minor::text, sd.tax_minor::text, sd.total_minor::text
      FROM sales_documents sd
      LEFT JOIN journal_source_events jse ON jse.event_type = 'invoice.issued' AND jse.source_id = sd.id
      WHERE sd.document_type = 'invoice'
        AND sd.status NOT IN ('draft', 'void')
        AND sd.issue_date >= ${periodStart.toISOString().split('T')[0]}
        AND sd.issue_date <= ${periodEnd.toISOString().split('T')[0]}
        AND jse.id IS NULL
    `);

    for (const inv of unbatchedInvoices.rows) {
      const entryNum = nextEntryNumber('JE-INV');
      const entryDate = new Date(inv.issue_date);
      const totalMinor = Number(inv.total_minor);
      const subtotalMinor = Number(inv.subtotal_minor);
      const taxMinor = Number(inv.tax_minor);

      const ar = getMapping('invoice.issued', 'debit');
      const rev = getMapping('invoice.issued', 'credit');
      const tax = getMapping('invoice.issued', 'tax');

      // Debit AR for total invoice value
      linesToInsert.push({
        entryNumber: entryNum,
        entryDate,
        eventType: 'invoice.issued',
        sourceEntityType: 'sales_document',
        sourceEntityId: inv.id,
        accountCode: ar.code,
        accountName: ar.name,
        debitMinor: totalMinor,
        creditMinor: 0,
        description: `Invoice ${inv.document_number} receivable`,
        locationId: inv.location_id,
      });

      // Credit Revenue for net amount
      linesToInsert.push({
        entryNumber: entryNum,
        entryDate,
        eventType: 'invoice.issued',
        sourceEntityType: 'sales_document',
        sourceEntityId: inv.id,
        accountCode: rev.code,
        accountName: rev.name,
        debitMinor: 0,
        creditMinor: subtotalMinor,
        description: `Sales revenue for ${inv.document_number}`,
        locationId: inv.location_id,
      });

      // Credit Tax for Output VAT
      if (taxMinor > 0) {
        linesToInsert.push({
          entryNumber: entryNum,
          entryDate,
          eventType: 'invoice.issued',
          sourceEntityType: 'sales_document',
          sourceEntityId: inv.id,
          accountCode: tax.code,
          accountName: tax.name,
          debitMinor: 0,
          creditMinor: taxMinor,
          description: `Output VAT for ${inv.document_number}`,
          locationId: inv.location_id,
        });
      }

      sourceEventsToInsert.push({
        eventType: 'invoice.issued',
        sourceId: inv.id,
        batchId,
      });
    }

    // ── 2. Delivery Notes Completed (COGS and Inventory) ────────────────────
    const unbatchedDeliveries = await tx.execute<{
      id: string;
      delivery_number: string;
      delivery_date: string;
      location_id: string;
      total_cost_minor: string;
    }>(sql`
      SELECT dn.id, dn.delivery_number, dn.delivery_date, dn.location_id,
             COALESCE(SUM(dnl.total_cost_minor), 0)::text AS total_cost_minor
      FROM delivery_notes dn
      JOIN delivery_note_lines dnl ON dnl.delivery_note_id = dn.id
      LEFT JOIN journal_source_events jse ON jse.event_type = 'delivery.completed' AND jse.source_id = dn.id
      WHERE dn.delivery_date >= ${periodStart.toISOString().split('T')[0]}
        AND dn.delivery_date <= ${periodEnd.toISOString().split('T')[0]}
        AND jse.id IS NULL
      GROUP BY dn.id, dn.delivery_number, dn.delivery_date, dn.location_id
      HAVING COALESCE(SUM(dnl.total_cost_minor), 0) > 0
    `);

    for (const del of unbatchedDeliveries.rows) {
      const entryNum = nextEntryNumber('JE-DEL');
      const entryDate = new Date(del.delivery_date);
      const costMinor = Number(del.total_cost_minor);

      const cogs = getMapping('delivery.completed', 'debit');
      const invAsset = getMapping('delivery.completed', 'credit');

      linesToInsert.push({
        entryNumber: entryNum,
        entryDate,
        eventType: 'delivery.completed',
        sourceEntityType: 'delivery_note',
        sourceEntityId: del.id,
        accountCode: cogs.code,
        accountName: cogs.name,
        debitMinor: costMinor,
        creditMinor: 0,
        description: `COGS dispatch on ${del.delivery_number}`,
        locationId: del.location_id,
      });

      linesToInsert.push({
        entryNumber: entryNum,
        entryDate,
        eventType: 'delivery.completed',
        sourceEntityType: 'delivery_note',
        sourceEntityId: del.id,
        accountCode: invAsset.code,
        accountName: invAsset.name,
        debitMinor: 0,
        creditMinor: costMinor,
        description: `Inventory relief on ${del.delivery_number}`,
        locationId: del.location_id,
      });

      sourceEventsToInsert.push({
        eventType: 'delivery.completed',
        sourceId: del.id,
        batchId,
      });
    }

    // ── 3. Goods Receipts Completed (Inventory & Accounts Payable) ───────────
    const unbatchedGRNs = await tx.execute<{
      id: string;
      grn_number: string;
      received_date: string;
      location_id: string;
      total_items_mwk_minor: string;
    }>(sql`
      SELECT gr.id, gr.grn_number, gr.received_date, gr.location_id,
             gr.total_items_mwk_minor::text
      FROM goods_receipts gr
      LEFT JOIN journal_source_events jse ON jse.event_type = 'goods_receipt.completed' AND jse.source_id = gr.id
      WHERE gr.status = 'completed'
        AND gr.received_date >= ${periodStart.toISOString().split('T')[0]}
        AND gr.received_date <= ${periodEnd.toISOString().split('T')[0]}
        AND jse.id IS NULL
    `);

    for (const gr of unbatchedGRNs.rows) {
      const entryNum = nextEntryNumber('JE-GRN');
      const entryDate = new Date(gr.received_date);
      const valMinor = Number(gr.total_items_mwk_minor);

      const invAsset = getMapping('goods_receipt.completed', 'debit');
      const ap = getMapping('goods_receipt.completed', 'credit');

      linesToInsert.push({
        entryNumber: entryNum,
        entryDate,
        eventType: 'goods_receipt.completed',
        sourceEntityType: 'goods_receipt',
        sourceEntityId: gr.id,
        accountCode: invAsset.code,
        accountName: invAsset.name,
        debitMinor: valMinor,
        creditMinor: 0,
        description: `Goods receipt ${gr.grn_number} stock addition`,
        locationId: gr.location_id,
      });

      linesToInsert.push({
        entryNumber: entryNum,
        entryDate,
        eventType: 'goods_receipt.completed',
        sourceEntityType: 'goods_receipt',
        sourceEntityId: gr.id,
        accountCode: ap.code,
        accountName: ap.name,
        debitMinor: 0,
        creditMinor: valMinor,
        description: `Accounts payable liability on ${gr.grn_number}`,
        locationId: gr.location_id,
      });

      sourceEventsToInsert.push({
        eventType: 'goods_receipt.completed',
        sourceId: gr.id,
        batchId,
      });
    }

    // ── 4. Payments Confirmed (Bank & A/R) ───────────────────────────────────
    const unbatchedPayments = await tx.execute<{
      id: string;
      payment_number: string;
      payment_date: string;
      location_id: string | null;
      amount_minor: string;
    }>(sql`
      SELECT p.id, p.payment_number, p.payment_date, p.location_id,
             p.amount_minor::text
      FROM payments p
      LEFT JOIN journal_source_events jse ON jse.event_type = 'payment.confirmed' AND jse.source_id = p.id
      WHERE p.status = 'confirmed'
        AND p.payment_date >= ${periodStart.toISOString().split('T')[0]}
        AND p.payment_date <= ${periodEnd.toISOString().split('T')[0]}
        AND jse.id IS NULL
    `);

    for (const pmt of unbatchedPayments.rows) {
      const entryNum = nextEntryNumber('JE-PMT');
      const entryDate = new Date(pmt.payment_date);
      const amtMinor = Number(pmt.amount_minor);

      const bank = getMapping('payment.confirmed', 'debit');
      const ar = getMapping('payment.confirmed', 'credit');

      linesToInsert.push({
        entryNumber: entryNum,
        entryDate,
        eventType: 'payment.confirmed',
        sourceEntityType: 'payment',
        sourceEntityId: pmt.id,
        accountCode: bank.code,
        accountName: bank.name,
        debitMinor: amtMinor,
        creditMinor: 0,
        description: `Payment receipt ${pmt.payment_number}`,
        locationId: pmt.location_id,
      });

      linesToInsert.push({
        entryNumber: entryNum,
        entryDate,
        eventType: 'payment.confirmed',
        sourceEntityType: 'payment',
        sourceEntityId: pmt.id,
        accountCode: ar.code,
        accountName: ar.name,
        debitMinor: 0,
        creditMinor: amtMinor,
        description: `Clear receivable on ${pmt.payment_number}`,
        locationId: pmt.location_id,
      });

      sourceEventsToInsert.push({
        eventType: 'payment.confirmed',
        sourceId: pmt.id,
        batchId,
      });
    }

    // ── 5. Credit Notes Issued (Contra Revenue & A/R) ────────────────────────
    const unbatchedCreditNotes = await tx.execute<{
      id: string;
      document_number: string;
      issue_date: string;
      location_id: string;
      subtotal_minor: string;
      tax_minor: string;
      total_minor: string;
    }>(sql`
      SELECT sd.id, sd.document_number, sd.issue_date, sd.location_id,
             sd.subtotal_minor::text, sd.tax_minor::text, sd.total_minor::text
      FROM sales_documents sd
      LEFT JOIN journal_source_events jse ON jse.event_type = 'credit_note.issued' AND jse.source_id = sd.id
      WHERE sd.document_type = 'credit_note'
        AND sd.status NOT IN ('draft', 'void')
        AND sd.issue_date >= ${periodStart.toISOString().split('T')[0]}
        AND sd.issue_date <= ${periodEnd.toISOString().split('T')[0]}
        AND jse.id IS NULL
    `);

    for (const cn of unbatchedCreditNotes.rows) {
      const entryNum = nextEntryNumber('JE-CRN');
      const entryDate = new Date(cn.issue_date);
      const totalMinor = Number(cn.total_minor);
      const subtotalMinor = Number(cn.subtotal_minor);
      const taxMinor = Number(cn.tax_minor);

      const ret = getMapping('credit_note.issued', 'debit');
      const tax = getMapping('credit_note.issued', 'tax');
      const ar = getMapping('credit_note.issued', 'credit');

      linesToInsert.push({
        entryNumber: entryNum,
        entryDate,
        eventType: 'credit_note.issued',
        sourceEntityType: 'sales_document',
        sourceEntityId: cn.id,
        accountCode: ret.code,
        accountName: ret.name,
        debitMinor: subtotalMinor,
        creditMinor: 0,
        description: `Sales returns on Credit Note ${cn.document_number}`,
        locationId: cn.location_id,
      });

      if (taxMinor > 0) {
        linesToInsert.push({
          entryNumber: entryNum,
          entryDate,
          eventType: 'credit_note.issued',
          sourceEntityType: 'sales_document',
          sourceEntityId: cn.id,
          accountCode: tax.code,
          accountName: tax.name,
          debitMinor: taxMinor,
          creditMinor: 0,
          description: `Output VAT reduction on ${cn.document_number}`,
          locationId: cn.location_id,
        });
      }

      linesToInsert.push({
        entryNumber: entryNum,
        entryDate,
        eventType: 'credit_note.issued',
        sourceEntityType: 'sales_document',
        sourceEntityId: cn.id,
        accountCode: ar.code,
        accountName: ar.name,
        debitMinor: 0,
        creditMinor: totalMinor,
        description: `Customer credit on ${cn.document_number}`,
        locationId: cn.location_id,
      });

      sourceEventsToInsert.push({
        eventType: 'credit_note.issued',
        sourceId: cn.id,
        batchId,
      });
    }

    // ── Calculate Totals and Verify Double-Entry Balance ────────────────────
    let totalDebitMinor = 0;
    let totalCreditMinor = 0;

    for (const line of linesToInsert) {
      totalDebitMinor += line.debitMinor;
      totalCreditMinor += line.creditMinor;
    }

    const isBalanced = totalDebitMinor === totalCreditMinor;
    if (!isBalanced) {
      throw new Error(`Double-entry balance check failed! Total Debits (${totalDebitMinor}) != Total Credits (${totalCreditMinor})`);
    }

    // Insert Journal Batch with final totals already populated (append-only)
    await tx.insert(journalBatches).values({
      id: batchId,
      batchNumber,
      periodStart,
      periodEnd,
      isDraft: true,
      status: 'unexported',
      totalDebitMinor,
      totalCreditMinor,
      lineCount: linesToInsert.length,
      notes: 'Generated accounting journal export (DRAFT)',
    });

    // Insert all Lines
    for (const line of linesToInsert) {
      await tx.insert(journalLines).values({
        batchId,
        entryNumber: line.entryNumber,
        entryDate: line.entryDate,
        eventType: line.eventType,
        sourceEntityType: line.sourceEntityType,
        sourceEntityId: line.sourceEntityId,
        accountCode: line.accountCode,
        accountName: line.accountName,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
        description: line.description,
        locationId: line.locationId ?? null,
      });
    }

    // Insert all Source Events for deduplication
    for (const evt of sourceEventsToInsert) {
      await tx.insert(journalSourceEvents).values({
        eventType: evt.eventType,
        sourceId: evt.sourceId,
        batchId: evt.batchId,
      });
    }

    return {
      batchId,
      batchNumber,
      lineCount: linesToInsert.length,
      totalDebitMinor,
      totalCreditMinor,
      isBalanced,
    };
  });
}
