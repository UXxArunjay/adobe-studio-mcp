// Dev helper: run an ExtendScript body inside Audition through the hub. node scripts/au-probe.mjs <file.jsx|-e code> [out.json]
import { readFileSync, writeFileSync } from 'node:fs';
process.env.ADOBE_MCP_NO_START = '1';
const { runJsxResult } = await import('../dist/transport/runner.js');
const [, , a, b, c] = process.argv;
const body = a === '-e' ? b : readFileSync(a, 'utf8');
const out = a === '-e' ? c : b;
const r = await runJsxResult('au', body, {}, { timeoutMs: 120000 });
const s = JSON.stringify(r, null, 1);
if (out) { writeFileSync(out, s); console.log('written', out, s.length); } else console.log(s.slice(0, 20000));
process.exit(0);
