import { readFileSync } from 'node:fs';

const trackedFiles = readFileSync(0, 'utf8').split('\0').filter(Boolean);
const forbiddenNames = [
  /(^|\/)(\.env|google-services\.json|GoogleService-Info\.plist|key\.properties)$/i,
  /\.(jks|keystore|p8|p12|pem|mobileprovision)$/i,
  /(^|\/)release-secrets\//i,
];
const secretPatterns = [
  { name: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |AGE )?PRIVATE KEY-----/ },
  { name: 'PostgreSQL credentials', pattern: /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/i },
  { name: 'GitHub token', pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
];
const allowlistedFiles = new Set(['scripts/check-secrets.mjs']);
const postgresExampleFiles = new Set([
  '.env.example',
  '.github/workflows/ci.yml',
  '.github/workflows/database-backup.yml',
]);
const findings = [];

for (const file of trackedFiles) {
  if (forbiddenNames.some((pattern) => pattern.test(file))) {
    findings.push(`${file}: forbidden sensitive filename`);
    continue;
  }
  if (allowlistedFiles.has(file)) continue;
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const { name, pattern } of secretPatterns) {
    if (name === 'PostgreSQL credentials' && postgresExampleFiles.has(file)) continue;
    if (pattern.test(content)) findings.push(`${file}: possible ${name}`);
  }
}

if (findings.length) {
  console.error('Potential secrets found in tracked files:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}
console.log(`Secret scan passed (${trackedFiles.length} tracked files).`);
