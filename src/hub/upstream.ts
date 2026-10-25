/**
 * Hub: runs the best community Adobe MCP servers (MIT) as child processes and re-exposes ALL their tools
 * through this single server — either through a searchable catalog (compact, default) or flat (full mode).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNTIME_DIR } from '../config.js';

export const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const UPSTREAM_DIR = process.env.ADOBE_MCP_UPSTREAM_DIR || join(PKG_ROOT, 'upstream');

export interface Library { id: string; app: string; name: string; repo: string; dir: string; entry: string; env?: Record<string, string>; notes: string }

export const LIBRARIES: Library[] = [
  { id: 'ae1', app: 'ae', name: 'after-effects-mcp (Dakkshin)', repo: 'https://github.com/Dakkshin/after-effects-mcp', dir: 'after-effects-mcp', entry: 'build/index.js',
    notes: 'Needs its bridge panel open in AE: Window > mcp-bridge-auto.jsx (installed by setup).' },
  { id: 'ae2', app: 'ae', name: 'mcp-aftereffects (kumo.productions)', repo: 'https://github.com/kumoproductions/mcp-aftereffects', dir: 'mcp-aftereffects', entry: 'dist/index.js',
    notes: 'Atomic undo-grouped ops, JSON project export/import, frame rendering — no panel needed.' },
  { id: 'pr1', app: 'pr', name: 'Adobe_Premiere_Pro_MCP (hetpatel-11)', repo: 'https://github.com/hetpatel-11/Adobe_Premiere_Pro_MCP', dir: 'Adobe_Premiere_Pro_MCP', entry: 'dist/cli.js',
    env: { PREMIERE_MCP_TELEMETRY: '0', PREMIERE_MCP_UPDATE_CHECK: '0', PREMIERE_MCP_TOOLSET: 'full' }, notes: '280 Premiere tools. Needs its "MCP Bridge (CEP)" panel started in Premiere (Window > Extensions).' },
  { id: 'ps1', app: 'ps', name: 'photoshop-mcp (alisaitteke)', repo: 'https://github.com/alisaitteke/photoshop-mcp', dir: 'photoshop-mcp', entry: 'dist/index.js',
    env: { LOG_LEVEL: '1' }, notes: '128 Photoshop tools incl. Firefly generative fill/expand/remove, recipes, neural filters.' },
  { id: 'ai1', app: 'ai', name: 'illustrator-mcp-server (ie3jp)', repo: 'https://github.com/ie3jp/illustrator-mcp-server', dir: 'illustrator-mcp-server', entry: 'dist/index.js',
    notes: '66 Illustrator tools: read/structure, design tokens, preflight, print, datasets, export.' },
];

export interface CatalogTool { lib: string; name: string; full: string; description: string; inputSchema: any; annotations?: any }

const CACHE = join(RUNTIME_DIR, 'catalog.json');
const clients = new Map<string, Promise<Client>>();

function libPath(l: Library) { return join(UPSTREAM_DIR, l.dir, l.entry); }
export function libInstalled(l: Library) { return existsSync(libPath(l)); }

async function connect(l: Library): Promise<Client> {
  if (!libInstalled(l)) throw new Error(`Library ${l.id} is not built. Run: npm run setup:upstream  (expected ${libPath(l)})`);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v;
  Object.assign(env, { DO_NOT_TRACK: '1' }, l.env || {});
  const transport = new StdioClientTransport({ command: process.execPath, args: [libPath(l)], cwd: join(UPSTREAM_DIR, l.dir), env, stderr: 'ignore' });
  const c = new Client({ name: 'adobe-studio-mcp-hub', version: '1.0.0' });
  await c.connect(transport);
  transport.onclose = () => clients.delete(l.id);
  return c;
}

export function client(id: string): Promise<Client> {
  const l = LIBRARIES.find((x) => x.id === id);
  if (!l) throw new Error('Unknown library ' + id);
  let p = clients.get(id);
  if (!p) { p = connect(l); clients.set(id, p); p.catch(() => clients.delete(id)); }
  return p;
}

let catalog: CatalogTool[] | null = null;

function loadCache(): CatalogTool[] | null {
  try { const j = JSON.parse(readFileSync(CACHE, 'utf8')); return Array.isArray(j.tools) ? j.tools : null; } catch { return null; }
}

/** Lists every upstream tool (connecting to each built library once; result cached on disk). */
export async function getCatalog(refresh = false): Promise<CatalogTool[]> {
  if (catalog && !refresh) return catalog;
  if (!refresh) { const c = loadCache(); if (c && c.length) { catalog = c; return c; } }
  const out: CatalogTool[] = [];
  await Promise.all(LIBRARIES.filter(libInstalled).map(async (l) => {
    try {
      const c = await client(l.id);
      let cursor: string | undefined;
      do {
        const r = await c.listTools(cursor ? { cursor } : {});
        for (const t of r.tools) out.push({ lib: l.id, name: t.name, full: `${l.id}__${t.name}`, description: t.description || '', inputSchema: t.inputSchema, annotations: t.annotations });
        cursor = r.nextCursor;
      } while (cursor);
    } catch (e) { /* library failed to start — reported by adobe_catalog_libraries */ }
  }));
  out.sort((a, b) => a.full.localeCompare(b.full));
  catalog = out;
  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(CACHE, JSON.stringify({ built: new Date().toISOString(), tools: out }));
  return out;
}

export async function callUpstream(full: string, args: Record<string, unknown>) {
  const i = full.indexOf('__');
  if (i < 0) throw new Error('Catalog tool names look like ps1__photoshop_get_layers');
  const lib = full.slice(0, i), name = full.slice(i + 2);
  const c = await client(lib);
  return c.callTool({ name, arguments: args }, undefined, { timeout: 30 * 60 * 1000 });
}

export function searchCatalog(tools: CatalogTool[], query: string, lib?: string, app?: string, limit = 25) {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const scored = tools
    .filter((t) => (!lib || t.lib === lib) && (!app || LIBRARIES.find((l) => l.id === t.lib)?.app === app))
    .map((t) => {
      const n = t.name.toLowerCase(), d = t.description.toLowerCase();
      let s = 0; for (const w of words) { if (n.includes(w)) s += 3; if (d.includes(w)) s += 1; }
      return { t, s };
    })
    .filter((x) => !words.length || x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit);
  return scored.map(({ t }) => ({ tool: t.full, library: t.lib, description: t.description.length > 260 ? t.description.slice(0, 257) + '…' : t.description }));
}

export async function closeAll() { for (const p of clients.values()) { try { (await p).close(); } catch { /* ignore */ } } }
