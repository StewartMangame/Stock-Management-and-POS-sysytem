const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'app', '(app)', 'payments', 'PaymentsHubClient.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Remove the two orphan lines: "      </div>" and "      )}" that follow the new modal block
// They appear between the new "      )}" and the "\n\n      {/* -- 4. Cheques" comment
const orphan = '\n\n      </div>\n      )}\n\n      {/* \u2500\u2500 4. Cheques';
const fixed  = '\n\n      {/* \u2500\u2500 4. Cheques';

if (content.includes(orphan)) {
  content = content.replace(orphan, fixed);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Orphan lines removed.');
} else {
  // Try with different dash chars
  const orphan2 = '\n\n      </div>\n      )}\n\n      {/* ── 4. Cheques';
  if (content.includes(orphan2)) {
    content = content.replace(orphan2, '\n\n      {/* ── 4. Cheques');
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Orphan lines removed (variant 2).');
  } else {
    // Log what's around line 625 by scanning
    const lines = content.split('\n');
    console.log('Context around line 624:');
    for (let i = 620; i < 630; i++) {
      console.log(`  ${i+1}: ${JSON.stringify(lines[i])}`);
    }
    console.error('Orphan pattern not found!');
  }
}

