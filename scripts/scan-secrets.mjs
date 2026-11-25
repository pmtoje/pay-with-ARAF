#!/usr/bin/env node
// Lightweight secret scanner for tracked files (CI gate). Exits 1 on findings.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean).filter((f) => !/(^|\/)(pnpm-lock\.yaml|.*\.(png|jpg|pdf|woff2?))$/.test(f));
const rules = [
  [/sk_live_[0-9A-Za-z]{40}/, 'Live API secret key'],
  [/sk_test_[0-9A-Za-z]{40}/, 'Sandbox API secret key (never commit real keys)'],
  [/whsec_[0-9A-Za-z]{40}/, 'Webhook signing secret'],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'Private key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/"k1":"[A-Za-z0-9+/]{43}="/, 'Encryption key material'],
  [/inv_[0-9A-Za-z]{40}/, 'Invitation token'],
];
let findings = 0;
for (const f of files) {
  if (f === 'scripts/scan-secrets.mjs') continue;
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  text.split('\n').forEach((line, i) => {
    for (const [re, what] of rules) if (re.test(line)) { findings++; console.error(`${f}:${i + 1}: ${what}`); }
  });
}
if (findings) { console.error(`\n${findings} potential secret(s) found.`); process.exit(1); }
console.log(`Secret scan clean (${files.length} files).`);
