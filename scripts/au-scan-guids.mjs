// Dev helper: scan Audition binaries for GUID strings (effect component ids). node scripts/au-scan-guids.mjs > out.json
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2] || 'C:\\Program Files\\Adobe\\Adobe Audition 2026';
const rx = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const found = new Map();
function walk(d, depth = 0) {
  if (depth > 3) return;
  for (const n of readdirSync(d)) {
    const f = join(d, n); let st; try { st = statSync(f); } catch { continue; }
    if (st.isDirectory()) { walk(f, depth + 1); continue; }
    if (!/\.(dll|aex|prm|exe)$/i.test(n) || st.size > 200e6) continue;
    const s = readFileSync(f).toString('latin1');
    const hits = new Set(s.match(rx) || []);
    for (const h of hits) { if (!found.has(h)) found.set(h, []); found.get(h).push(n); }
  }
}
walk(root);
const out = {};
for (const [g, files] of found) out[g] = files.slice(0, 3);
console.log(JSON.stringify(out));
console.error('guids', found.size);
