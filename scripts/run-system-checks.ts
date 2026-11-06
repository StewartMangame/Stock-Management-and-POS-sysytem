import 'dotenv/config';

// Force connection to test database ONLY
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

async function main() {
  const { runSystemChecks } = await import('../src/server/services/system-checks');
  console.log('Running all 12 system checks on TEST database (testdb)...');
  const result = await runSystemChecks();
  console.log('Status:', result.status);
  console.log('Total checks:', result.totalChecks);
  console.log('Passed:', result.passedCount);
  console.log('Warnings:', result.warningCount);
  console.log('Failed:', result.failedCount);
  console.log('Duration:', result.durationMs, 'ms');
  console.log('Checks summary:');
  for (const c of result.checks) {
    console.log(`- [${c.status.toUpperCase()}] ${c.code}: ${c.summary}`);
  }
}

main().catch(err => {
  console.error('System checks execution failed:', err);
  process.exit(1);
});
