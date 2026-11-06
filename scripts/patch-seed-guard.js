const fs = require('fs');
const path = require('path');

// Patch seed.ts
const seedPath = path.join(__dirname, '..', 'src', 'server', 'db', 'seed.ts');
let content = fs.readFileSync(seedPath, 'utf8');

const guard = `async function main() {\r\n  // ── PRODUCTION GUARD ──────────────────────────────────────────────────────\r\n  if (process.env.NODE_ENV === 'production') {\r\n    throw new Error(\r\n      '[seed] REFUSED: Demo seed scripts must not run in NODE_ENV=production. ' +\r\n      'Use a proper migration and secure user-creation process for production environments.',\r\n    );\r\n  }\r\n`;

content = content.replace('async function main() {\r\n', guard);
fs.writeFileSync(seedPath, content, 'utf8');

// Patch seed-phase1.ts
const seed1Path = path.join(__dirname, '..', 'src', 'server', 'db', 'seed-phase1.ts');
if (fs.existsSync(seed1Path)) {
  let c1 = fs.readFileSync(seed1Path, 'utf8');
  const lineEnding = c1.includes('\r\n') ? '\r\n' : '\n';
  const guard1 = `async function main() {${lineEnding}  // ── PRODUCTION GUARD ───────────────────────────────────────────────────${lineEnding}  if (process.env.NODE_ENV === 'production') {${lineEnding}    throw new Error('[seed-phase1] REFUSED: Demo seed must not run in production.');${lineEnding}  }${lineEnding}`;
  if (!c1.includes('PRODUCTION GUARD')) {
    c1 = c1.replace(`async function main() {${lineEnding}`, guard1);
    fs.writeFileSync(seed1Path, c1, 'utf8');
    console.log('seed-phase1.ts patched.');
  } else {
    console.log('seed-phase1.ts already has production guard.');
  }
}

console.log('seed.ts patched.');

