#!/usr/bin/env node
// Generates a local .env with fresh random secrets. Usage: node scripts/generate-env.mjs > .env
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
const tpl = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
const r = () => randomBytes(32).toString('base64url');
process.stdout.write(
  tpl
    .replace('{"k1":"<base64-32-bytes>"}', JSON.stringify({ k1: randomBytes(32).toString('base64') }))
    .replace(/<random>/g, () => r()),
);
