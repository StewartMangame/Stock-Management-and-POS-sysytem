import 'dotenv/config';
import { db, pool } from '@/server/db';
import { checkStockLedgerConsistency } from '@/server/services/stock/stock-engine';

async function main() {
  console.log('[stock:check] Verifying stock balances against immutable ledger...');
  const result = await checkStockLedgerConsistency(db);

  if (result.isConsistent) {
    console.log('[stock:check] ✓ All stock balances match the ledger sums exactly.');
    await pool.end();
    process.exit(0);
  } else {
    console.error(`[stock:check] ✗ Found ${result.discrepancies.length} discrepancy(ies):`);
    console.table(result.discrepancies);
    await pool.end();
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error('[stock:check] Error running consistency check:', err);
  await pool.end();
  process.exit(1);
});
