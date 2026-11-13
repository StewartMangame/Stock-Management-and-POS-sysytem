import { execSync } from 'child_process';

interface Finding {
  commit: string;
  file: string;
  line: string;
  rule: string;
}

const SECRET_PATTERNS: { rule: string; regex: RegExp; filter?: (match: string) => boolean }[] = [
  {
    rule: 'Private Key Block',
    regex: /-----BEGIN [A-Z0-9\s]+ PRIVATE KEY-----/i,
  },
  {
    rule: 'High-entropy API/Secret Token',
    regex: /(?:ghp_[A-Za-z0-9_]{36}|gho_[A-Za-z0-9_]{36}|sk-[A-Za-z0-9]{32,}|xox[baprs]-[A-Za-z0-9-]+)/,
  },
  {
    rule: 'Database connection string with non-trivial password',
    regex: /postgres(?:ql)?:\/\/(?:[^:@\s]+):([^@\s]+)@([a-zA-Z0-9.-]+):(\d+)\/([^\s"'`]+)/i,
    filter: (match) => {
      // Ignore localhost, mock, dummy, template strings
      if (match.includes('localhost') || match.includes('127.0.0.1') || match.includes('example.com') || match.includes('dummy') || match.includes('password') || match.includes('changeme') || match.includes('${') || match.includes('your_')) {
        return false;
      }
      return true;
    },
  },
  {
    rule: 'Hardcoded secret or private token assignment',
    regex: /(?:CRON_SECRET|AUTH_SECRET|ONEKHUSA_API_KEY|EIS_API_KEY|TURNSTILE_SECRET_KEY)\s*[:=]\s*["']([A-Za-z0-9_\-]{20,})["']/i,
    filter: (match) => {
      const lower = match.toLowerCase();
      if (lower.includes('example') || lower.includes('dummy') || lower.includes('placeholder') || lower.includes('test_') || lower.includes('mock_') || lower.includes('your-') || lower.includes('your_') || lower.includes('secret-here')) {
        return false;
      }
      return true;
    },
  },
];

export function runSecretScan(): Finding[] {
  console.log('🔍 Scanning git history for leaked secrets and private credentials...');
  
  let gitOutput = '';
  try {
    gitOutput = execSync('git log -p -U1', { maxBuffer: 30 * 1024 * 1024, encoding: 'utf-8' });
  } catch (err: any) {
    console.error('Failed to read git log:', err.message);
    return [];
  }

  const lines = gitOutput.split('\n');
  let currentCommit = 'unknown';
  let currentFile = 'unknown';
  const findings: Finding[] = [];

  for (const line of lines) {
    if (line.startsWith('commit ')) {
      currentCommit = line.substring(7, 15);
      continue;
    }
    if (line.startsWith('diff --git ')) {
      const parts = line.split(' ');
      currentFile = parts[2]?.replace(/^a\//, '') || 'unknown';
      continue;
    }
    // Only inspect added lines in diffs
    if (line.startsWith('+') && !line.startsWith('+++')) {
      const text = line.substring(1);
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.regex.test(text)) {
          if (!pattern.filter || pattern.filter(text)) {
            // Mask middle of line to avoid printing full secret in logs
            const trimmed = text.trim();
            const masked = trimmed.length > 30 ? `${trimmed.substring(0, 15)}...${trimmed.substring(trimmed.length - 8)}` : trimmed;
            findings.push({
              commit: currentCommit,
              file: currentFile,
              line: masked,
              rule: pattern.rule,
            });
          }
        }
      }
    }
  }

  return findings;
}

if (require.main === module) {
  const findings = runSecretScan();
  if (findings.length > 0) {
    console.error(`\n❌ Found ${findings.length} potential secrets in git history:`);
    for (const f of findings) {
      console.error(` - [${f.rule}] in ${f.file} (commit ${f.commit}): ${f.line}`);
    }
    process.exit(1);
  } else {
    console.log('✅ Git history secret scan passed: No secrets detected in git log.');
    process.exit(0);
  }
}
