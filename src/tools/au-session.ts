/**
 * Adobe Audition â€” mixing & effects through the SESX engine (+ live reload of the open session), effect catalog,
 * new sessions without dialogs, offline effect rendering of files, loudness, and the Audition â†’ Premiere hand-off.
 */
import { z } from 'zod';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tool } from './define.js';
import { availableTransport } from '../transport/runner.js';
import { RUNTIME_DIR } from '../config.js';
import { Sesx, newSessionXml, TrackRef } from '../audition/sesx.js';
import { effectCatalog, resolveEffect, effectPresetNames, readRackPresets, readFavorites, readPlugins } from '../audition/library.js';
import { au, zDocAu, mixdownToDoc, renderDoc, closeDoc, zExportOpts, analyzeLoudness, loudnormFile, probe, saveAndWait } from './au.js';

const fwd = (p: string) => (process.platform === 'win32' ? p.replace(/\//g, '\\') : p); // Audition compares media paths literally: use native separators
const TMP = () => { const d = join(RUNTIME_DIR, 'au-tmp'); mkdirSync(d, { recursive: true }); return d; };
const zTrack = z.union([z.string(), z.number().int()]);
const zClip = z.union([z.string(), z.number().int(), z.object({ at: z.number() })]);
const zFade = z.object({ duration: z.number().describe('seconds'), type: z.enum(['log', 'linear', 'cosine']).optional(), curve: z.number().optional().describe('Audition fade shape value (default 19)') });
const zFx = z.object({ effect: z.string().describe('effect name or id (built-in or installed VST/VST3, e.g. "Parametric Equalizer", "Pro-Q 4")'), preset: z.string().optional().describe('factory/user preset name of that effect'),
  params: z.record(z.number()).optional().describe('normalized 0..1 values by parameter name or index'), powered: z.boolean().optional(), slot: z.number().int().optional() });

async function auUp() { return !!(await availableTransport('au').catch(() => null)); }

/** where the session file is and whether Audition has it open (then it is saved â†’ closed â†’ edited â†’ reopened) */
async function target(a: { document?: string; path?: string }): Promise<{ path: string; live: string | null; dirty?: boolean }> {
  if (a.path && !(await auUp())) return { path: a.path, live: null };
  if (!a.path && !(await auUp())) throw new Error('Audition is not running â€” pass path to a .sesx file to edit it offline, or start Audition (adobe_launchApp {"app":"au"}).');
  const r: any = await au(`var d = null, i;
if (ARGS.path) { for (i = 0; i < app.documents.length; i++) { var x = app.documents[i]; if (__isMT(x) && x.path && __np(x.path) === __np(ARGS.path)) d = x; } if (!d) return null; }
else d = __mt(ARGS.document);
if (!d.path) throw new Error('This session was never saved â€” save it first with au_saveDocument {path:"...sesx"}.');
return { path: d.path, name: d.displayName, dirty: d.dirty };`, { document: a.document, path: a.path ? fwd(a.path) : undefined });
  if (!r) return { path: a.path!, live: null };
  return { path: r.path, live: r.name, dirty: r.dirty };
}

export async function editSession<T>(a: { document?: string; path?: string }, fn: (s: Sesx) => T): Promise<{ result: T; path: string; reopened: boolean; info: any }> {
  const t = await target(a);
  if (t.live) await saveAndWait(t.live);
  if (t.live) await au(`var d = __adoc(ARGS.n); if (!d.closeDocument()) throw new Error('Audition did not close the session (a dialog may be open).'); return true;`, { n: t.live });
  let result: T, s: Sesx;
  try {
    s = Sesx.load(t.path);
    result = fn(s);
    s.save(t.path);
  } finally {
    if (t.live) await au(`var d = app.openDocument(new DocumentOpenParameter(ARGS.p)); try { d.activate(); } catch (e) {} return d.displayName;`, { p: fwd(t.path) }, 300000);
  }
  return { result: result!, path: t.path, reopened: !!t.live, info: s!.info(false) };
}

/* ---------- au_mix: the mixer ---------- */
const OPS = ['setTrack', 'setClip', 'addTrack', 'removeTrack', 'moveTrack', 'removeClip', 'duplicateClip', 'splitClip', 'addEffect', 'setEffect', 'removeEffect', 'clearEffects', 'applyRackPreset',
  'volumeAutomation', 'panAutomation', 'setSession'] as const;

const zOp = z.object({
  op: z.enum(OPS),
  track: zTrack.optional().describe('index (1-based, top to bottom), name, "id:N", or "master"/"mix"'),
  clip: zClip.optional().describe('for clip ops / clip effects: 1-based index by start time, name, "id:N" or {at: seconds}'),
  name: z.string().optional(), volumeDb: z.number().optional(), pan: z.number().optional().describe('-100 (L) .. 100 (R)'), mute: z.boolean().optional(), solo: z.boolean().optional(), armed: z.boolean().optional(),
  visible: z.boolean().optional(), output: zTrack.optional().describe('route the track to a bus (name) or "master"'), color: z.number().optional().describe('hue 0-359'), height: z.number().optional(),
  gainDb: z.number().optional().describe('clip gain dB'), start: z.number().optional().describe('clip start on timeline (s)'), sourceIn: z.number().optional().describe('trim: source in point (s)'), sourceOut: z.number().optional().describe('trim: source out point (s)'),
  locked: z.boolean().optional(), looped: z.boolean().optional(), fadeIn: zFade.nullable().optional(), fadeOut: zFade.nullable().optional(),
  effect: z.string().optional(), slot: z.number().int().optional().describe('effects rack slot 1-16'), preset: z.string().optional(), params: z.record(z.number()).optional(), chunk: z.string().optional().describe('base64 plug-in state (presetChunkData)'), powered: z.boolean().optional(),
  rackPreset: z.string().optional().describe('one of your saved Effects Rack presets (au_effects {action:"racks"})'), replace: z.boolean().optional(),
  points: z.array(z.object({ time: z.number(), value: z.number() })).nullable().optional().describe('automation keyframes: volume in dB / pan -100..100; time = timeline s for tracks, s from clip start for clips; null clears'),
  kind: z.enum(['audio', 'bus']).optional(), channels: z.enum(['mono', 'stereo', '5.1']).optional(), position: z.number().int().optional(),
  at: z.number().optional().describe('splitClip / duplicateClip time (s)'), toTrack: zTrack.optional(),
  playhead: z.number().optional(), selectionStart: z.number().optional(), selectionEnd: z.number().optional(),
});

function applyOp(s: Sesx, o: z.infer<typeof zOp>) {
  const need = (k: keyof typeof o) => { if (o[k] === undefined || o[k] === null) throw new Error(`${o.op} needs ${String(k)}`); return o[k] as any; };
  const owner = () => s.owner({ track: need('track') as TrackRef, clip: o.clip as any });
  switch (o.op) {
    case 'setTrack': { const t = s.track(need('track')); s.setTrack(t, { name: o.name, volumeDb: o.volumeDb, pan: o.pan, mute: o.mute, solo: o.solo, armed: o.armed, visible: o.visible, output: o.output as any, color: o.color, height: o.height }); return s.trackInfo(t, false); }
    case 'setClip': { const t = s.track(need('track')); const c = s.clip(t, need('clip')); s.setClip(c, { name: o.name, gainDb: o.gainDb, pan: o.pan, mute: o.mute, start: o.start, sourceIn: o.sourceIn, sourceOut: o.sourceOut, locked: o.locked, looped: o.looped, color: o.color, fadeIn: o.fadeIn, fadeOut: o.fadeOut }); return s.clipInfo(c, 0, false); }
    case 'addTrack': { const r = s.addTrack({ name: o.name, kind: o.kind, channels: o.channels, output: o.output as any, position: o.position }); const t = s.track('id:' + r.id); s.setTrack(t, { volumeDb: o.volumeDb, pan: o.pan, mute: o.mute, color: o.color }); return r; }
    case 'removeTrack': { const t = s.track(need('track')); const n = s.trackName(t); s.removeTrack(t); return { removed: n }; }
    case 'moveTrack': { const t = s.track(need('track')); s.moveTrack(t, need('position')); return { moved: s.trackName(t), position: o.position }; }
    case 'removeClip': { const t = s.track(need('track')); const c = s.clip(t, need('clip')); const n = c.getAttribute('name'); s.removeClip(t, c); return { removed: n }; }
    case 'duplicateClip': { const t = s.track(need('track')); const c = s.clip(t, need('clip')); const n = s.duplicateClip(t, c, o.at, o.toTrack !== undefined ? s.track(o.toTrack) : undefined); return s.clipInfo(n, 0, false); }
    case 'splitClip': { const t = s.track(need('track')); const c = s.clip(t, need('clip')); const r = s.splitClip(t, c, need('at')); return { left: s.clipInfo(c, 0, false), right: s.clipInfo(r, 0, false) }; }
    case 'addEffect': return s.addEffect(owner(), { effect: need('effect'), slot: o.slot, preset: o.preset, params: o.params, chunk: o.chunk, powered: o.powered });
    case 'setEffect': s.setEffect(owner(), need('slot'), { powered: o.powered, params: o.params, preset: o.preset }); return { slot: o.slot };
    case 'removeEffect': return { removed: s.removeEffect(owner(), need('slot')) };
    case 'clearEffects': return { removed: s.removeEffect(owner()) };
    case 'applyRackPreset': return s.applyRackPreset(owner(), need('rackPreset'), o.replace !== false);
    case 'volumeAutomation': s.setVolumeAutomation(owner(), o.points ?? null); return { keyframes: o.points?.length || 0 };
    case 'panAutomation': s.setPanAutomation(owner(), o.points ?? null); return { keyframes: o.points?.length || 0 };
    case 'setSession': s.setSessionState({ playhead: o.playhead, selectionStart: o.selectionStart, selectionEnd: o.selectionEnd }); return { ok: true };
  }
}

tool({ name: 'au_mix', toolset: 'au',
  description: `Mix a multitrack session â€” everything the Audition DOM cannot do, in one batch of ops (applied to the .sesx; an open session is saved, closed, edited and reopened automatically â€” undo history resets, a .mcpbak backup is kept):
â€¢ setTrack: volumeDb, pan (-100..100), mute, solo, armed, visible, name, color, output (route to a bus / master)
â€¢ setClip: gainDb, pan, mute, start (move), sourceIn/sourceOut (trim), fadeIn/fadeOut {duration, type log|linear|cosine, curve} (null removes), locked, looped, name
â€¢ addTrack (audio/bus, mono/stereo/5.1, output) Â· removeTrack Â· moveTrack Â· removeClip Â· duplicateClip (at, toTrack) Â· splitClip (at)
â€¢ addEffect / setEffect / removeEffect / clearEffects on a track, bus, master ("master") or a clip (track+clip): any built-in effect or installed VST/VST3 (FabFilter, iZotopeâ€¦), by name or id, with a factory/user preset and/or normalized params
â€¢ applyRackPreset: rebuild a track/clip rack from one of YOUR saved Effects Rack presets â€” exact plug-in states (e.g. "Arunjay Vocal DOCUM")
â€¢ volumeAutomation / panAutomation: keyframes (dB / pan) on track or clip (ducking, rides)
â€¢ setSession: playhead, time selection (then au_mixdown what:"selection").
Pass document (open session) or path (.sesx; works without Audition).`,
  input: { document: zDocAu, path: z.string().optional(), ops: z.array(zOp).min(1) },
  handler: async (a) => {
    const r = await editSession({ document: a.document, path: a.path }, (s) => a.ops.map((o: z.infer<typeof zOp>, i: number) => { try { return { op: o.op, ok: true, result: applyOp(s, o) }; } catch (e: any) { throw new Error(`op ${i + 1} (${o.op}): ${e.message}`); } }));
    return { session: r.path, reopened: r.reopened, results: r.result, tracks: r.info.tracks.map((t: any) => ({ index: t.index, name: t.name, kind: t.kind, volumeDb: t.volumeDb, pan: t.pan, mute: t.mute, solo: t.solo, output: t.output, effects: (t.effects || []).map((e: any) => `${e.slot}:${e.name}${e.powered ? '' : ' (off)'}${e.missing ? ' (MISSING)' : ''}`) })) };
  } });

tool({ name: 'au_sessionInfo', toolset: 'au', readOnly: true,
  description: 'Full mix state of a multitrack session from its .sesx: every track/bus/master with volume dB, pan, mute/solo, routing, effects racks (slot, effect, preset, power, parameters), volume automation; every clip with file, start/end, trim (source in/out), clip gain, pan, fades, clip effects. document (open session; saveFirst:true includes unsaved changes) or path.',
  input: { document: zDocAu, path: z.string().optional(), track: zTrack.optional(), params: z.boolean().optional().describe('include effect parameter values (default false)'), saveFirst: z.boolean().optional() },
  handler: async (a) => {
    const t = await target({ document: a.document, path: a.path });
    if (t.live && t.dirty && a.saveFirst) { await saveAndWait(t.live); t.dirty = false; }
    const s = Sesx.load(t.path);
    const info: any = s.info(!!a.params);
    if (a.track !== undefined) info.tracks = [s.trackInfo(s.track(a.track), !!a.params)];
    if (t.live && t.dirty) info.note = 'The open session has unsaved changes that are not shown â€” pass saveFirst:true.';
    return info;
  } });

/* ---------- effects catalog ---------- */
async function discoverParams(effectId: string) {
  if (!(await auUp())) throw new Error('Audition must be running to discover plug-in parameters.');
  const dir = TMP(), id = randomUUID().slice(0, 8);
  const p1 = join(dir, `fx-${id}.sesx`), p2 = join(dir, `fx-${id}-out.sesx`);
  const s = new Sesx(newSessionXml({}), p1);
  const t = s.addTrack({ name: 'FX' });
  s.addEffect(s.track('id:' + t.id), { effect: effectId });
  s.save(p1, false);
  const prev: any = await au(`var a = app.activeDocument; return a ? a.id : null;`);
  const n: any = await au(`var d = app.openDocument(new DocumentOpenParameter(ARGS.p1)); return d.displayName;`, { p1: fwd(p1) }, 180000);
  let out: Sesx;
  try {
    await au(`var d = __adoc(ARGS.n); var p = new MultitrackSaveAsParameter(); p.copyReferencedDocuments = false; p.includeMetadata = false; d.saveAsDocument(ARGS.p2, p); return d.displayName;`, { n, p2: fwd(p2) }, 180000);
    out = Sesx.load(p2);
  } finally {
    await au(`for (var i = app.documents.length - 1; i >= 0; i--) { var d = app.documents[i]; if (d.path && (__np(d.path) === __np(ARGS.p1) || __np(d.path) === __np(ARGS.p2))) __discard(d); } if (ARGS.prev) for (var k = 0; k < app.documents.length; k++) if (app.documents[k].id === ARGS.prev) app.documents[k].activate(); return true;`, { p1: fwd(p1), p2: fwd(p2), prev }).catch(() => undefined);
  }
  const fx = out.trackInfo(out.track(1), true).effects?.[0];
  for (const f of [p1, p2]) rmSync(f, { force: true });
  return fx;
}

tool({ name: 'au_effects', toolset: 'au', readOnly: true,
  description: 'Audition effects library: list (built-in effects + every installed VST/VST3/AU plug-in, filter by query), info (an effect\'s parameters with defaults and its factory/user presets; discover:true loads it in Audition to read live parameter names â€” for any plug-in), racks (your saved Effects Rack presets with their effect chains), favorites, plugins (scan list with vendor/format/path).',
  input: { action: z.enum(['list', 'info', 'racks', 'favorites', 'plugins']), query: z.string().optional(), effect: z.string().optional(), discover: z.boolean().optional() },
  handler: async (a) => {
    const q = (a.query || '').toLowerCase();
    if (a.action === 'list') return effectCatalog().filter((e) => !q || (e.name + ' ' + (e.vendor || '')).toLowerCase().includes(q)).map((e) => ({ name: e.name, id: e.id, source: e.source, vendor: e.vendor, format: e.format }));
    if (a.action === 'racks') return readRackPresets().filter((r) => !q || r.name.toLowerCase().includes(q)).map((r) => ({ name: r.name, effects: r.slots.map((s) => `${s.slot + 1}:${s.name}${s.powered ? '' : ' (off)'}`) }));
    if (a.action === 'favorites') return readFavorites();
    if (a.action === 'plugins') return readPlugins().filter((p) => !q || (p.name + p.vendor).toLowerCase().includes(q));
    if (!a.effect) throw new Error('Pass effect (name or id).');
    const e = resolveEffect(a.effect);
    const presets = effectPresetNames(e.id).map((p) => p.name + (p.factory ? '' : ' (user)'));
    const out: any = { name: e.name, id: e.id, source: e.source, vendor: e.vendor, presets };
    if (e.params) out.params = e.params.map(([i, n, d]) => ({ index: i, name: n, default: d }));
    if (a.discover || (!e.params && e.source === 'plugin' && a.discover !== false)) {
      try { const d = await discoverParams(e.id); out.loaded = !d?.missing; out.liveParams = d?.params || null; if (d?.state) out.state = d.state; } catch (err: any) { out.discoverError = err.message; }
    }
    out.note = 'Parameters are normalized 0..1 (Audition/VST convention). Use presets or your rack presets for exact settings.';
    return out;
  } });

/* ---------- new session ---------- */
const zNewTrack = z.object({ name: z.string().optional(), kind: z.enum(['audio', 'bus']).optional(), channels: z.enum(['mono', 'stereo', '5.1']).optional(), volumeDb: z.number().optional(), pan: z.number().optional(),
  output: z.string().optional().describe('bus name or "master"'), rackPreset: z.string().optional(), effects: z.array(zFx).optional(),
  files: z.array(z.string()).optional().describe('audio files placed one after another'), time: z.number().optional().describe('start of the first file (s)') });

tool({ name: 'au_newSession', toolset: 'au',
  description: 'Create a new multitrack session without any dialog: sample rate, bit depth, master channels (stereo / 5.1 / mono), and tracks/buses with names, channels, volume, pan, routing, effects or one of your rack presets, and audio files placed on them. Opens it in Audition (if running) and saves it.',
  input: { path: z.string().describe('.sesx file to create'), sampleRate: z.number().int().optional(), bitDepth: z.number().int().optional(), channels: z.enum(['stereo', '5.1', 'mono']).optional(),
    tracks: z.array(zNewTrack).optional().describe('default: 6 stereo audio tracks'), open: z.boolean().optional(), overwrite: z.boolean().optional() },
  handler: async (a, ctx) => {
    if (existsSync(a.path) && !a.overwrite) throw new Error('File exists: ' + a.path + ' (overwrite:true to replace).');
    mkdirSync(dirname(a.path), { recursive: true });
    const s = new Sesx(newSessionXml({ sampleRate: a.sampleRate, bitDepth: a.bitDepth, channels: a.channels }), a.path);
    const specs = a.tracks && a.tracks.length ? a.tracks : Array.from({ length: 6 }, (_, i) => ({ name: `Track ${i + 1}` } as z.infer<typeof zNewTrack>));
    // buses first so audio tracks can route to them by name
    const created: { spec: z.infer<typeof zNewTrack>; id: number }[] = [];
    specs.forEach((sp: z.infer<typeof zNewTrack>, i: number) => { const r = s.addTrack({ name: sp.name, kind: sp.kind, channels: sp.channels, position: i + 1 }); created.push({ spec: sp, id: r.id }); });
    for (const c of created) {
      const t = s.track('id:' + c.id);
      s.setTrack(t, { volumeDb: c.spec.volumeDb, pan: c.spec.pan, output: c.spec.output });
      if (c.spec.rackPreset) s.applyRackPreset(t, c.spec.rackPreset);
      for (const fx of c.spec.effects || []) s.addEffect(t, fx);
    }
    s.save(a.path, false);
    if (a.open === false || !(await auUp())) return { created: a.path, opened: false, tracks: s.info(false).tracks.map((t: any) => t.name), note: (created.some((c) => c.spec.files?.length) ? 'Files are placed when the session is opened in Audition (au_clips add).' : undefined) };
    const name: any = await au(`var d = app.openDocument(new DocumentOpenParameter(ARGS.p)); d.activate(); return d.displayName;`, { p: fwd(a.path) }, 300000);
    const placed: unknown[] = [];
    for (const c of created) if (c.spec.files?.length) placed.push(await ctx.call('au_clips', { document: name, action: 'add', track: 'id:' + c.id, files: c.spec.files, time: c.spec.time ?? 0, sequential: true }));
    if (placed.length) await saveAndWait(name);
    return { created: a.path, opened: name, placed, state: await ctx.call('au_getState', { document: name }) };
  } });

/* ---------- offline effect rendering ---------- */
tool({ name: 'au_processFile', toolset: 'au',
  description: 'Render audio files through Audition effects â€” any built-in effect or VST/VST3 plug-in chain (with presets/params) or one of your Effects Rack presets (e.g. your FabFilter vocal chain) â€” and write the processed files in any format, optionally loudness-normalized. Works on whole files, no manual steps (temporary session + mixdown under the hood). Tails longer than the file (reverb) are cut at the file end unless tailSec is given.',
  input: { inputs: z.array(z.string()).min(1), output: z.string().optional().describe('output file (single input) â€” or use outputDir'), outputDir: z.string().optional(), suffix: z.string().optional().describe('default "_processed"'),
    rackPreset: z.string().optional(), effects: z.array(zFx).optional(), gainDb: z.number().optional(), tailSec: z.number().optional(), ...zExportOpts },
  handler: async (a) => {
    if (!a.rackPreset && !a.effects?.length && a.gainDb === undefined && !a.loudness) throw new Error('Pass rackPreset and/or effects (or gainDb / loudness).');
    if (!(await auUp())) throw new Error('Audition must be running (adobe_launchApp {"app":"au"}).');
    const out: unknown[] = [];
    const prev: any = await au(`var a = app.activeDocument; return a ? a.id : null;`);
    try {
    for (const input of a.inputs) {
      if (!existsSync(input)) throw new Error('Not found: ' + input);
      const info = await probe(input);
      const dst = a.output && a.inputs.length === 1 ? a.output : join(a.outputDir || dirname(input), basename(input, extname(input)) + (a.suffix ?? '_processed') + '.' + (a.format || extname(a.output || input).slice(1) || 'wav'));
      const sesPath = join(TMP(), `proc-${randomUUID().slice(0, 8)}.sesx`);
      const s = new Sesx(newSessionXml({ sampleRate: info.sampleRate, channels: info.channels >= 6 ? '5.1' : info.channels === 1 ? 'mono' : 'stereo', durationSec: info.duration + (a.tailSec || 0) }), sesPath);
      const tr = s.addTrack({ name: 'Process', channels: info.channels >= 6 ? '5.1' : info.channels === 1 ? 'mono' : 'stereo' });
      const t = s.track('id:' + tr.id);
      if (a.rackPreset) s.applyRackPreset(t, a.rackPreset);
      for (const fx of a.effects || []) s.addEffect(t, fx);
      if (a.gainDb !== undefined) s.setTrack(t, { volumeDb: a.gainDb });
      if (a.tailSec) s.setSessionState({ selectionStart: 0, selectionEnd: info.duration + a.tailSec });
      s.save(sesPath, false);
      const wasOpen: any = await au(`for (var i = 0; i < app.documents.length; i++) { var d = app.documents[i]; if (d.path && __np(d.path) === __np(ARGS.p)) return true; } return false;`, { p: fwd(input) });
      const ses: any = await au(`var mt = app.openDocument(new DocumentOpenParameter(ARGS.s)); var src = app.openDocument(new DocumentOpenParameter(ARGS.p));
var c = __trk(mt, 1).audioClips.add(src); if (!c) throw new Error('Audition could not add the file to the render session'); c.startTime = 0; mt.activate();
return { session: mt.displayName, src: src.displayName };`, { s: fwd(sesPath), p: fwd(input) }, 300000);
      try {
        const m = await mixdownToDoc(ses.session, a.tailSec ? 'selection' : 'all');
        try { out.push({ input, ...(await renderDoc(m.name, dst, a)) }); } finally { await closeDoc(m.name); }
      } finally {
        await closeDoc(ses.session);
        if (!wasOpen) await closeDoc(ses.src);
        for (const f of [sesPath, sesPath + '.mcpbak']) rmSync(f, { force: true });
      }
    }
    } finally {
      if (prev) await au(`for (var k = 0; k < app.documents.length; k++) if (app.documents[k].id === ARGS.prev) app.documents[k].activate(); return true;`, { prev }).catch(() => undefined);
    }
    return out;
  } });

/* ---------- loudness ---------- */
tool({ name: 'au_loudness', toolset: 'au',
  description: 'Loudness (EBU R128 / ITU-R BS.1770): analyze a file or an open Audition document (integrated LUFS, loudness range, true peak) â€” or normalize a file to a target (two-pass, true-peak limited), e.g. -14 LUFS / -1 dBTP for YouTube, -16 for podcasts, -23 for broadcast. For a whole session use au_mixdown {loudness:â€¦}.',
  input: { action: z.enum(['analyze', 'normalize']), path: z.string().optional(), document: zDocAu, output: z.string().optional(), targetLufs: z.number().optional(), truePeak: z.number().optional() },
  handler: async (a) => {
    let file = a.path;
    if (!file) { const r: any = await au(`var d = __adoc(ARGS.document); if (__isMT(d)) throw new Error('For a multitrack session use au_mixdown with analyze:true / loudness.'); if (!d.path) throw new Error('Save the file first.'); if (d.dirty) throw new Error('The file has unsaved changes â€” save it first (au_saveDocument).'); return d.path;`, a); file = r; }
    if (!existsSync(file!)) throw new Error('Not found: ' + file);
    if (a.action === 'analyze') return { file, ...(await analyzeLoudness(file!)) };
    const out = a.output || join(dirname(file!), basename(file!, extname(file!)) + `_${a.targetLufs ?? -14}LUFS` + extname(file!));
    const ext = extname(out).slice(1).toLowerCase();
    const extra = ext === 'mp3' ? ['-c:a', 'libmp3lame', '-b:a', '320k'] : ext === 'wav' ? ['-c:a', 'pcm_s24le'] : [];
    const r = await loudnormFile(file!, out, a.targetLufs ?? -14, a.truePeak ?? -1, extra);
    return { input: file, output: out, before: r.measured, after: await analyzeLoudness(out) };
  } });

/* ---------- Audition â†’ Premiere ---------- */
tool({ name: 'xapp_auditionToPremiere', toolset: 'xapp',
  description: 'Send an Audition mix to Premiere Pro: mixes the session down (any format, optional loudness normalization), imports the file into a Premiere bin and places it on an audio track at a time (e.g. the final music/VO mix under the edit).',
  input: { document: zDocAu, path: z.string().optional().describe('mixdown file (default: next to the session, .wav)'), sequence: z.string().optional(), track: z.string().optional().describe('default A1'), time: z.number().optional(), bin: z.string().optional(), ...zExportOpts },
  handler: async (a, ctx) => {
    let path = a.path;
    if (!path) { const r: any = await au(`var d = __mt(ARGS.document); return { p: d.path, n: d.displayName };`, a); path = join(r.p ? dirname(r.p) : join(RUNTIME_DIR, 'au-tmp'), `${r.n} Mixdown.wav`); }
    const mix = await ctx.call('au_mixdown', { ...a, path });
    const imported = await ctx.call('pr_importFiles', { paths: [path], bin: a.bin || 'Audition Mixes' });
    const placed = await ctx.call('pr_placeClip', { item: basename(path), sequence: a.sequence, track: a.track || 'A1', time: a.time ?? 0 });
    return { mix, imported, placed };
  } });
