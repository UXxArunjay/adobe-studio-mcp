/**
 * Audition user library on disk: Favorites, effect presets, effects-rack presets, installed plug-ins (VST/VST3/AU),
 * plus the built-in effect catalog. Everything is read from %APPDATA%\Adobe\Audition\<version> (macOS: ~/Library/Preferences/Adobe/Audition/<version>).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { IS_WIN, HOME } from '../config.js';
import { AU_BUILTIN_EFFECTS, AU_EFFECT_ALIASES, AuEffectDef } from './effects-data.js';

/* ---------- prop.map (Audition's settings XML) ---------- */

function el(n: any): any[] { const o: any[] = []; for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) o.push(c); return o; }

function propVal(e: any): any {
  const t = e.tagName;
  if (t === 'prop.list') {
    const o: Record<string, any> = {};
    for (const p of el(e)) { if (p.tagName !== 'prop.pair') continue; const kids = el(p); const k = kids.find((x) => x.tagName === 'key'); const v = kids.find((x) => x.tagName !== 'key'); if (k && v) o[k.textContent] = propVal(v); }
    return o;
  }
  if (t === 'array') return el(e).filter((x) => x.tagName !== 'array.type').map(propVal); // <array.type> declares the element type, it is not a value
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'int' || t === 'float' || t === 'double') return Number(e.textContent || 0);
  if (t === 'null') return null;
  return e.textContent;
}

export function readPropMap(file: string): any {
  if (!existsSync(file)) return {};
  const doc = new DOMParser().parseFromString(readFileSync(file, 'utf8'), 'text/xml');
  const root = doc.documentElement;
  const list = el(root).find((x) => x.tagName === 'prop.list');
  return list ? propVal(list) : {};
}

/* ---------- folders ---------- */

export function auPrefsDir(): string | null {
  const base = IS_WIN ? join(process.env.APPDATA || join(HOME, 'AppData', 'Roaming'), 'Adobe', 'Audition') : join(HOME, 'Library', 'Preferences', 'Adobe', 'Audition');
  let vers: string[] = [];
  try { vers = readdirSync(base).filter((v) => /^\d+(\.\d+)*$/.test(v) && statSync(join(base, v)).isDirectory()); } catch { return null; }
  if (!vers.length) return null;
  vers.sort((a, b) => parseFloat(b) - parseFloat(a));
  return join(base, vers[0]);
}

function prefsFile(name: string) { const d = auPrefsDir(); return d ? join(d, name) : ''; }

/* ---------- cache (files change rarely; re-read when mtime changes) ---------- */
const cache = new Map<string, { m: number; v: any }>();
function cached(file: string): any {
  if (!file || !existsSync(file)) return {};
  const m = statSync(file).mtimeMs;
  const c = cache.get(file);
  if (c && c.m === m) return c.v;
  const v = readPropMap(file);
  cache.set(file, { m, v });
  return v;
}

/* ---------- favorites ---------- */
export interface AuFavorite { name: string; action: string; effectId?: string; effectName?: string }
export function readFavorites(): AuFavorite[] {
  const fav = cached(prefsFile('Favorites.xml')).Favorites || {};
  return Object.keys(fav).map((k) => {
    const s = fav[k].Settings || {};
    const o: AuFavorite = { name: fav[k].Name || k, action: s.ActionID || '?' };
    if (s.ActionID === 'AudioComponent' && s.ActionSettings) { o.effectId = s.ActionSettings.ID; o.effectName = effectName(o.effectId!); }
    return o;
  });
}

/* ---------- effect presets & rack presets ---------- */
export interface RackSlot { slot: number; name: string; effectId: string; powered: boolean; settings: any }
export interface RackPreset { name: string; slots: RackSlot[]; inputGain?: number; outputGain?: number; wetDry?: number; power?: boolean }

function effectPresetsXml() { return cached(prefsFile('EffectPresets.xml')); }

export function readRackPresets(): RackPreset[] {
  const p = (effectPresetsXml().EffectsRackPresetID || {}).Presets || {};
  return Object.keys(p).filter((n) => n !== '(Default)').map((n) => {
    const cd = (p[n] || {}).CustomData || {};
    const list = cd.EffectsList || {};
    const slots: RackSlot[] = [];
    for (const k of Object.keys(list)) {
      const s = list[k]; if (!s || !s.EffectID) continue;
      slots.push({ slot: Number(k.split('_')[1]) - 1, name: s.DisplayName || effectName(s.EffectID), effectId: s.EffectID, powered: s.EffectPower !== false, settings: s.EffectSettings || {} });
    }
    slots.sort((a, b) => a.slot - b.slot);
    return { name: n, slots, inputGain: cd.RackInputGain, outputGain: cd.RackOutputGain, wetDry: cd.RackWetDryMix, power: cd.RackPower };
  });
}

/** factory + user preset names stored for one effect id */
export function effectPresetNames(effectId: string): { name: string; factory: boolean; settings: any }[] {
  const all = effectPresetsXml();
  const ids = [effectId, ...Object.entries(AU_EFFECT_ALIASES).filter(([, v]) => v === effectId).map(([k]) => k), AU_EFFECT_ALIASES[effectId]].filter(Boolean);
  const out: { name: string; factory: boolean; settings: any }[] = [];
  for (const id of ids) {
    const p = (all[id] || {}).Presets || {};
    for (const n of Object.keys(p)) if (!out.some((x) => x.name === n)) out.push({ name: n, factory: !!(p[n] && p[n].FactoryPreset), settings: p[n] });
  }
  return out;
}

/* ---------- installed plug-ins (Audition's plug-in manager scan) ---------- */
export interface AuPlugin { id: string; name: string; vendor: string; format: string; enabled: boolean; path: string }
export function readPlugins(): AuPlugin[] {
  const d = cached(prefsFile('AudioPluginManagerSettings.xml'));
  const out: AuPlugin[] = [];
  for (const k of Object.keys(d)) {
    if (!k.startsWith('descriptor')) continue;
    const v = d[k]; if (!v || !v.id) continue;
    const loc = String(v.locator || '');
    const fmt = /\.vst3/i.test(loc) || String(v.id).startsWith('3:') ? 'VST3' : /\.component/i.test(loc) ? 'AU' : 'VST';
    if (/Host Checker|Virtual Audio Filter/i.test(v.name)) continue;
    out.push({ id: String(v.id), name: String(v.name), vendor: String(v.vendor || ''), format: fmt, enabled: v.enabled !== false, path: loc.replace(/^\d+:/, '') });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------- unified catalog ---------- */
export interface CatalogEffect { id: string; name: string; source: 'builtin' | 'plugin'; vendor?: string; format?: string; params?: [number, string, number][] }

export function effectCatalog(): CatalogEffect[] {
  const out: CatalogEffect[] = AU_BUILTIN_EFFECTS.map((e: AuEffectDef) => ({ id: e.id, name: e.name, source: 'builtin', params: e.params }));
  for (const p of readPlugins()) if (p.enabled) out.push({ id: p.id, name: p.name, source: 'plugin', vendor: p.vendor, format: p.format });
  return out;
}

export function effectName(id: string): string {
  const real = AU_EFFECT_ALIASES[id] || id;
  const b = AU_BUILTIN_EFFECTS.find((e) => e.id === real);
  if (b) return b.name;
  const p = readPlugins().find((x) => x.id === id);
  return p ? p.name : id;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** id or (fuzzy) name → catalog entry. Prefers exact name, then plug-ins named exactly (Pro-Q 4), then prefix, then contains. */
export function resolveEffect(ref: string): CatalogEffect {
  const cat = effectCatalog();
  const id = AU_EFFECT_ALIASES[ref] || ref;
  const byId = cat.find((e) => e.id.toLowerCase() === id.toLowerCase());
  if (byId) return byId;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(ref) || /^3:/.test(ref)) return { id: ref, name: ref, source: 'plugin' };
  const n = norm(ref);
  const hit = cat.find((e) => norm(e.name) === n) || cat.find((e) => norm(e.name).startsWith(n)) || cat.find((e) => norm(e.name).includes(n));
  if (!hit) throw new Error(`Effect not found: "${ref}". Use au_effects {"action":"list"} to see names/ids (built-in + installed VST/VST3 plug-ins).`);
  return hit;
}
