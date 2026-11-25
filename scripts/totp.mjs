#!/usr/bin/env node
// Prints the current TOTP code. Usage: node scripts/totp.mjs <BASE32_SECRET | sandbox-staff-email>
import { createHash, createHmac } from 'node:crypto';
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const enc = (buf) => { let b = 0, v = 0, o = ''; for (const x of buf) { v = (v << 8) | x; b += 8; while (b >= 5) { o += B32[(v >>> (b - 5)) & 31]; b -= 5; } } if (b > 0) o += B32[(v << (5 - b)) & 31]; return o; };
const dec = (s) => { let b = 0, v = 0; const o = []; for (const c of s) { v = (v << 5) | B32.indexOf(c); b += 5; if (b >= 8) { o.push((v >>> (b - 8)) & 255); b -= 8; } } return Buffer.from(o); };
let arg = process.argv[2];
if (!arg) { console.error('Usage: node scripts/totp.mjs <secret|staff-email>'); process.exit(1); }
if (arg.includes('@')) arg = enc(Buffer.from(createHash('sha256').update(`araf-sandbox-totp:${arg}`).digest('hex').slice(0, 40), 'hex'));
const step = Math.floor(Date.now() / 30000);
const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(step));
const h = createHmac('sha1', dec(arg)).update(m).digest(); const o = h[h.length - 1] & 0xf;
console.log(String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0'), `(valid ~${30 - (Math.floor(Date.now() / 1000) % 30)}s)`);
