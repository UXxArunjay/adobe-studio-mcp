/** Gateway to every tool of the bundled community MCP servers (ae1, ae2, pr1, ps1, ai1). */
import { z } from 'zod';
import { tool } from './define.js';
import { LIBRARIES, getCatalog, searchCatalog, callUpstream, libInstalled, client } from '../hub/upstream.js';

tool({ name: 'adobe_catalog_search', toolset: 'hub', readOnly: true,
  description: 'Search ~550 extra tools from the bundled community Adobe MCPs (ae1/ae2 After Effects, pr1 Premiere 280 tools, ps1 Photoshop 128 tools incl. Firefly generative AI, ai1 Illustrator 66 tools). Use when no native tool fits; then adobe_catalog_describe → adobe_catalog_call.',
  input: { query: z.string(), library: z.enum(['ae1', 'ae2', 'pr1', 'ps1', 'ai1']).optional(), app: z.enum(['ae', 'pr', 'ps', 'ai']).optional(), limit: z.number().int().optional() },
  handler: async (a) => ({ results: searchCatalog(await getCatalog(), a.query, a.library, a.app, a.limit || 25) }) });

tool({ name: 'adobe_catalog_describe', toolset: 'hub', readOnly: true,
  description: 'Full description and input JSON schema of a catalog tool (name like "ps1__photoshop_generative_fill").',
  input: { tool: z.string() },
  handler: async (a) => { const t = (await getCatalog()).find((x) => x.full === a.tool); if (!t) throw new Error('Not in catalog: ' + a.tool + ' (search first)'); return t; } });

tool({ name: 'adobe_catalog_call', toolset: 'hub',
  description: 'Call a catalog tool from a bundled community MCP with its arguments: {tool:"pr1__add_transition", arguments:{...}}.',
  input: { tool: z.string(), arguments: z.record(z.unknown()).optional() },
  handler: async (a) => ({ __raw: await callUpstream(a.tool, a.arguments || {}) }) });

tool({ name: 'adobe_catalog_libraries', toolset: 'hub', readOnly: true,
  description: 'Status of the bundled community MCP libraries (installed/built, tool counts, setup notes); refresh:true reconnects and rebuilds the catalog.',
  input: { refresh: z.boolean().optional() },
  handler: async (a) => {
    const cat = await getCatalog(!!a.refresh);
    const out = [];
    for (const l of LIBRARIES) {
      let connected = false, error: string | undefined;
      if (libInstalled(l)) { try { await client(l.id); connected = true; } catch (e: any) { error = String(e.message || e); } }
      out.push({ id: l.id, app: l.app, name: l.name, repo: l.repo, installed: libInstalled(l), connected, error, tools: cat.filter((t) => t.lib === l.id).length, notes: l.notes });
    }
    return out;
  } });
