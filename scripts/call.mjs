// Dev helper: node scripts/call.mjs <tool> '<json args>'  — calls one tool through a real MCP connection.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const [, , name, json] = process.argv;
const c = new Client({ name: 'call', version: '1' });
await c.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))] }));
const t0 = Date.now();
const raw = json && json.startsWith('@') ? (await import('node:fs')).readFileSync(json.slice(1), 'utf8') : json;
const r = await c.callTool({ name, arguments: raw ? JSON.parse(raw) : {} }, undefined, { timeout: 30 * 60 * 1000 });
for (const p of r.content) {
  if (p.type === 'image') { const f = `call-${Date.now()}.${p.mimeType.split('/')[1]}`; writeFileSync(f, Buffer.from(p.data, 'base64')); console.log('[image saved]', f); }
  else console.log(p.text.length > 3000 ? p.text.slice(0, 3000) + '…' : p.text);
}
console.log(r.isError ? 'ERROR' : 'OK', `${Date.now() - t0}ms`);
await c.close(); process.exit(0);
