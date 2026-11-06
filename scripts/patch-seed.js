const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '../src/server/db/seed.ts');
let content = fs.readFileSync(targetPath, 'utf8');

// Replace pool.end() and main().catch(...)
const oldSection = `  console.warn('[seed] Done.');
  await pool.end();
}

main().catch((err) => {
  console.error('[seed] Fatal error:', err);
  process.exit(1);
});`;

const newSection = `  console.warn('[seed] Done.');
}

if (process.env.NODE_ENV !== 'test') {
  main()
    .then(async () => {
      await pool.end();
    })
    .catch((err) => {
      console.error('[seed] Fatal error:', err);
      process.exit(1);
    });
}`;

if (content.includes(oldSection)) {
  content = content.replace(oldSection, newSection);
  fs.writeFileSync(targetPath, content, 'utf8');
  console.log('Successfully patched seed.ts');
} else {
  // If line endings differ
  const normalized = content.replace(/\r\n/g, '\n');
  const normalizedOld = oldSection.replace(/\r\n/g, '\n');
  const normalizedNew = newSection.replace(/\r\n/g, '\n');
  if (normalized.includes(normalizedOld)) {
    fs.writeFileSync(targetPath, normalized.replace(normalizedOld, normalizedNew), 'utf8');
    console.log('Successfully patched seed.ts (normalized)');
  } else {
    console.error('Target not found in seed.ts');
  }
}

