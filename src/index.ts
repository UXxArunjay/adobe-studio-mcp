#!/usr/bin/env node
/**
 * Adobe Studio MCP — one MCP server for After Effects, Premiere Pro, Photoshop and Illustrator.
 * MIT licensed. See README.md.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { TOOLS, NativeTool, ToolCtx } from './tools/define.js';
import { enabledToolsets, HUB_MODE } from './config.js';
import { AdobeError } from './transport/runner.js';
import { getCatalog, callUpstream, closeAll, CatalogTool } from './hub/upstream.js';

import './tools/adobe.js';
import './tools/ae-core.js';
import './tools/ae-advanced.js';
import './tools/pr.js';
import './tools/ps.js';
import './tools/ai.js';
import './tools/xapp.js';
import './tools/plugins.js';
import './tools/media.js';
import './tools/hub.js';

export const VERSION = '1.0.0';

const INSTRUCTIONS = `Adobe Studio MCP controls After Effects (ae_*), Premiere Pro (pr_*), Photoshop (ps_*), Illustrator (ai_*), cross-app workflows (xapp_*), media download (media_*, pixabay_*), plugins/extensions (adobe_*Plugin*, adobe_extensions) and ~550 more community tools via adobe_catalog_search/call.
Work like a careful assistant editor:
1. Start with adobe_status. Launch apps with adobe_launchApp (no UI automation needed).
2. Read state before editing: ae_getCompState / pr_getSequenceState / ps_getState / ai_getState. Clip/layer indexes change after edits — re-read.
3. Before big destructive Premiere edits, pr_duplicateSequence and work on the copy unless told otherwise. Never delete media from projects.
4. Batch many steps with ae_setKeyframes, adobe_batch or pr_applyEditPlan. After visual changes, check with ae_exportFrame / pr_exportFrame / ps_preview / xapp_preview.
5. Every AE tool call is one undo group (Ctrl+Z). Save with ae_saveProject / pr_saveProject (backup:true keeps a copy).
6. Anything not covered by a dedicated tool: adobe_runScript (raw ExtendScript), ae_executeCommand, ps_actionManager, ai_executeMenuCommand, or the catalog.
7. Render via Adobe Media Encoder: ae_queueInAME, pr_export.`;

const sets = enabledToolsets();
const native = new Map<string, NativeTool>();
for (const t of TOOLS) if (sets.has(t.toolset)) native.set(t.name, t);
if (HUB_MODE === 'off') for (const n of [...native.keys()]) if (n.startsWith('adobe_catalog_')) native.delete(n);

const schemaCache = new Map<string, any>();
function jsonSchema(t: NativeTool) {
  let s = schemaCache.get(t.name);
  if (!s) {
    s = zodToJsonSchema(z.object(t.input), { target: 'jsonSchema7', $refStrategy: 'none' }) as any;
    delete s.$schema;
    schemaCache.set(t.name, s);
  }
  return s;
}

let flat: CatalogTool[] = [];

const ctx: ToolCtx = { call: (name, args) => invoke(name, args).then(unwrap) };

/** results that carry images or raw MCP content are only unwrapped at the protocol boundary */
function unwrap(r: any) { if (r && r.__image) return r.info; if (r && r.__raw) return r.__raw; return r; }

async function invoke(name: string, args: Record<string, unknown>): Promise<any> {
  const t = native.get(name) || TOOLS.find((x) => x.name === name);
  if (t) {
    const parsed = z.object(t.input).safeParse(args ?? {});
    if (!parsed.success) throw new AdobeError(`Invalid arguments for ${name}: ` + parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '));
    return t.handler(parsed.data, ctx);
  }
  if (name.includes('__')) return { __raw: await callUpstream(name, args) };
  throw new AdobeError(`Unknown tool: ${name}`);
}

function toContent(r: any) {
  if (r && r.__raw) return r.__raw;
  if (r && r.__image) return { content: [{ type: 'image', data: r.__image.data, mimeType: r.__image.mimeType }, { type: 'text', text: JSON.stringify(r.info) }] };
  const text = r === undefined ? 'ok' : typeof r === 'string' ? r : JSON.stringify(r);
  return { content: [{ type: 'text', text: text.length > 400000 ? text.slice(0, 400000) + '…[truncated]' : text }] };
}

async function main() {
  if (HUB_MODE === 'full') flat = await getCatalog().catch(() => []);
  const server = new Server({ name: 'adobe-studio-mcp', version: VERSION }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...[...native.values()].map((t) => ({ name: t.name, description: t.description, inputSchema: jsonSchema(t),
        annotations: { readOnlyHint: !!t.readOnly, destructiveHint: !!t.destructive, openWorldHint: t.name.startsWith('media_') || t.name.startsWith('pixabay_') } })),
      ...flat.map((t) => ({ name: t.full, description: `[${t.lib}] ${t.description}`, inputSchema: t.inputSchema, annotations: t.annotations })),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      return toContent(await invoke(req.params.name, (req.params.arguments || {}) as Record<string, unknown>)) as any;
    } catch (e: any) {
      const hint = e instanceof AdobeError && e.hint ? `\nHint: ${e.hint}` : '';
      return { isError: true, content: [{ type: 'text', text: `${e?.message || e}${hint}` }] };
    }
  });

  await server.connect(new StdioServerTransport());
  const bye = async () => { await closeAll(); process.exit(0); };
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
  process.stdin.on('close', bye);
}

if (!process.argv[1]?.endsWith('check-jsx.mjs') && !process.env.ADOBE_MCP_NO_START) main().catch((e) => { console.error(e); process.exit(1); });
