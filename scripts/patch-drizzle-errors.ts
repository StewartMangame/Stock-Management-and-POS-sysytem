import fs from 'fs';
import path from 'path';

const targetFile = path.join(process.cwd(), 'node_modules', 'drizzle-orm', 'errors.js');
if (fs.existsSync(targetFile)) {
  let content = fs.readFileSync(targetFile, 'utf-8');
  if (!content.includes('causeMsg')) {
    content = content.replace(
      'super(`Failed query: ${query}\nparams: ${params}`);',
      'const causeMsg = cause?.message ? `\\n${cause.message}` : "";\n    super(`Failed query: ${query}\\nparams: ${params}${causeMsg}`);',
    );
    fs.writeFileSync(targetFile, content, 'utf-8');
    console.log('[postinstall] Patched drizzle-orm/errors.js to include cause message.');
  }
}

