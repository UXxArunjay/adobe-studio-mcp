/**
 * ae_templates — iArunjay After Effects Template Library (IATL).
 * One template = one self-contained 4K .aep + manifest.json + thumb.png in <LIB>/<NN_Category>/<ID>/.
 * Instances are customised through Essential Properties (text/colour/slider/checkbox/point) and Media Replacement.
 * list/info/search run in Node (no AE needed); everything else runs the ExtendScript engine
 * <LIB>/_system/iA_TemplateLib.jsx inside After Effects, so the engine can be upgraded without rebuilding the MCP.
 */
import { z } from 'zod';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tool } from './define.js';
import { runJsx } from '../transport/runner.js';

export const TEMPLATE_LIB = process.env.ADOBE_STUDIO_TEMPLATE_LIB || 'D:\\You Tube\\Templates';
const ENGINE = () => join(TEMPLATE_LIB, '_system', 'iA_TemplateLib.jsx').replace(/\\/g, '/');

function readJson(p: string): any { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }
function index(): any[] {
  const ix = readJson(join(TEMPLATE_LIB, 'index.json'));
  if (ix?.templates) return ix.templates;
  // fallback: scan manifests
  const out: any[] = [];
  if (!existsSync(TEMPLATE_LIB)) return out;
  for (const cat of readdirSync(TEMPLATE_LIB)) {
    if (!/^\d\d_/.test(cat)) continue;
    for (const id of readdirSync(join(TEMPLATE_LIB, cat))) { const m = readJson(join(TEMPLATE_LIB, cat, id, 'manifest.json')); if (m) out.push({ ...m, category: cat }); }
  }
  return out;
}
function findManifest(id: string): any {
  for (const t of index()) if (t.id === id) { const m = readJson(join(TEMPLATE_LIB, t.category, id, 'manifest.json')); return m ? { ...m, folder: join(TEMPLATE_LIB, t.category, id) } : t; }
  return null;
}

const zVal = z.union([z.string(), z.number(), z.boolean(), z.array(z.number())]);

tool({
  name: 'ae_templates', toolset: 'ae',
  description: [
    'After Effects TEMPLATE LIBRARY (iArunjay). Reuse instead of rebuilding: cards, photo cards, memos, stamps, newspapers, titles, lower thirds, maps (pins/routes/arcs/legal India plate), charts, timelines, people/org charts, boards, transitions, overlays, brand/CTA, reel elements, rigs.',
    'Actions: list {category?, search?} | info {id} | import {id, version?} | place {id, comp?, time?, duration?, layerName?, overrides?, media?, position?, fit?, above?} (imports once, adds a layer, auto-fits 4K master to the comp, sets Essential Properties, auto Out Time) |',
    'override {comp, layer, overrides?, media?} | controls {comp, layer} | status (imported templates + outdated?) | update {id} (swap all instances in the open project to the latest version, keeping overrides) |',
    'save {comp, id, title?, description?, tags?, usage?, change?, mogrt?} (promote a comp to the library as new template or NEW VERSION: reduce+collect into the library, archive old version, thumb, manifest, index; reopens your project) | thumb {id} | mogrt {id} | reindex.',
    'IDs look like TYP_KickerHeadline, DOC_Polaroid, MAP_Pin (prefixes TYP DOC HIL MAP DAT PPL BRD TRN FX BRN REL RIG). overrides keys = Essential Property names (case-insensitive), colours as "#RRGGBB"; media = {"Photo":"D:/path.jpg"}.',
  ].join(' '),
  input: {
    action: z.enum(['list', 'info', 'import', 'place', 'override', 'controls', 'status', 'update', 'save', 'thumb', 'mogrt', 'reindex']),
    id: z.string().optional(), version: z.number().int().optional(), category: z.string().optional(), search: z.string().optional(),
    comp: z.string().optional().describe('target comp (place/override/controls) or the comp to promote (save); omit = active comp'),
    layer: z.union([z.string(), z.number().int()]).optional(), layerName: z.string().optional(),
    time: z.number().optional(), duration: z.number().optional(), position: z.array(z.number()).optional(),
    fit: z.enum(['width', 'height', 'contain', 'cover', 'none']).optional(), above: z.union([z.string(), z.number().int()]).optional(),
    overrides: z.record(zVal).optional(), media: z.record(z.string()).optional(),
    title: z.string().optional(), description: z.string().optional(), tags: z.array(z.string()).optional(), usage: z.string().optional(),
    change: z.string().optional().describe('save: what changed in this version (goes into the version history)'),
    mogrt: z.boolean().optional(), cleanup: z.boolean().optional(),
  },
  handler: async (a: any) => {
    if (a.action === 'list') {
      const q = (a.search || '').toLowerCase(), cat = (a.category || '').toLowerCase();
      return index().filter((t) => (!cat || t.category?.toLowerCase().includes(cat) || t.id.toLowerCase().startsWith(cat + '_'))
        && (!q || `${t.id} ${t.title} ${t.description} ${(t.tags || []).join(' ')}`.toLowerCase().includes(q)))
        .map((t) => ({ id: t.id, title: t.title, v: t.version, category: t.category, controls: t.controls, media: t.media, what: t.description }));
    }
    if (a.action === 'info') { const m = findManifest(a.id); if (!m) throw new Error(`Template not found: ${a.id} (try action:list)`); return m; }
    if (!existsSync(ENGINE().replace(/\//g, '\\')) && !existsSync(ENGINE())) throw new Error(`Template engine missing: ${ENGINE()}`);
    const body = `$.global.IATL_ROOT = ${JSON.stringify(TEMPLATE_LIB.replace(/\\/g, '/'))}; $.evalFile(new File(${JSON.stringify(ENGINE())})); return IATL.run(ARGS);`;
    return runJsx('ae', body, a, { undo: ['place', 'override', 'update'].includes(a.action) ? 'ae_templates ' + a.action : undefined, timeoutMs: 15 * 60 * 1000 });
  },
});
