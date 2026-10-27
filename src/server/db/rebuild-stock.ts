import 'dotenv/config';
import { db, pool } from '@/server/db';
import { rebuildStockBalances, checkStockLedgerConsistency } from '@/server/services/stock/stock-engine';

async function main() {
  console.log('[stock:rebuild] Rebuilding stock balances from historical ledger...');

  const result = await db.transaction(async (tx) => {
    return await rebuildStockBalances(tx);
  });

  console.log(
    `[stock:rebuild] ✓ Rebuild complete: updated ${result.balancesUpdated} balance row(s) and ${result.productsUpdated} product cost(s).`,
  );

  console.log('[stock:rebuild] Running post-rebuild verification check...');
  const verify = await checkStockLedgerConsistency(db);

  if (verify.isConsistent) {
    console.log('[stock:rebuild] ✓ Verification passed: all balances match the ledger perfectly.');
    await pool.end();
    process.exit(0);
  } else {
    console.error('[stock:rebuild] ✗ Verification failed after rebuild:');
    console.table(verify.discrepancies);
    await pool.end();
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error('[stock:rebuild] Error during rebuild:', err);
  await pool.end();
  process.exit(1);
});
