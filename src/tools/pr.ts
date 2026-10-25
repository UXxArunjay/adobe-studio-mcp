/** Premiere Pro — Filmit-parity pr_* tools + advanced (AME export, XML, speed, tracks, auto-reframe, scene detection, MOGRT, captions). */
import { z } from 'zod';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { mediaDir } from '../store.js';
import { join } from 'node:path';
import { jsxTool, tool, zSeq, zTrack, zClipRef, zTime } from './define.js';
import { imageResult, tempPng } from './util.js';
import { findInstalls } from '../config.js';

const R = String.raw;
const zClips = z.array(zClipRef).describe('One or more clips.');

/** recursive file search inside the Premiere install (sequence presets, .epr export presets, built-in .mogrt) */
function findInPremiere(pred: (name: string, full: string) => boolean, sub = '', limit = 1): string[] {
  const inst = findInstalls('pr')[0];
  if (!inst) return [];
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    if (out.length >= limit || depth > 7) return;
    let names: string[] = [];
    try { names = readdirSync(d); } catch { return; }
    for (const n of names) {
      const f = join(d, n);
      let st; try { st = statSync(f); } catch { continue; }
      if (st.isDirectory()) walk(f, depth + 1); else if (pred(n, f)) { out.push(f); if (out.length >= limit) return; }
    }
  };
  walk(join(inst.root, sub), 0);
  return out;
}

jsxTool({ name: 'pr_newProject', toolset: 'pr', app: 'pr', timeoutMs: 300000,
  description: 'Premiere Pro: create a new project at path (.prproj) and make it current (save the open project first).',
  input: { path: z.string() },
  jsx: R`var p = String(ARGS.path).replace(/\\/g, '/'); if (!/\.prproj$/i.test(p)) p += '.prproj'; var f = new File(p); if (!f.parent.exists) f.parent.create();
var ok = app.newProject(p); return { created: ok, path: app.project.path, name: app.project.name };` });

jsxTool({ name: 'pr_getProjectState', toolset: 'pr', app: 'pr', readOnly: true,
  description: 'Premiere Pro: project name/path, sequences (name, id, active) and every project item (bins, clips, sequences, media paths). Call before referencing items.',
  input: { maxItems: z.number().int().optional() },
  jsx: R`var all = []; __walk(app.project.rootItem, all, '', 0); var seqs = [];
for (var i = 0; i < app.project.sequences.numSequences; i++) { var s = app.project.sequences[i]; seqs.push({ name: s.name, id: s.sequenceID, active: app.project.activeSequence ? app.project.activeSequence.sequenceID === s.sequenceID : false }); }
return { name: app.project.name, path: app.project.path, version: app.version, sequences: seqs, items: all.slice(0, __def(ARGS.maxItems, 1500)), totalItems: all.length };` });

jsxTool({ name: 'pr_getSequenceState', toolset: 'pr', app: 'pr', readOnly: true,
  description: 'Premiere Pro: active (or named) sequence — frame size, fps, duration, playhead, in/out, every video/audio track (mute/lock) with its clips (1-based index, name, start/end, source in/out, enabled, speed, media path) and markers. Clip numbers change after edits: re-read.',
  input: { sequence: zSeq, includeMarkers: z.boolean().optional() },
  jsx: R`var s = __seq(ARGS.sequence); var st = s.getSettings(); var o = { name: s.name, id: s.sequenceID, width: st.videoFrameWidth, height: st.videoFrameHeight, fps: __seqFps(s), duration: Number(s.end) / __TICKS, playhead: s.getPlayerPosition().seconds };
try { o.inPoint = s.getInPointAsTime().seconds; o.outPoint = s.getOutPointAsTime().seconds; } catch (e) {}
function tr(coll, p) { var a = []; for (var i = 0; i < coll.numTracks; i++) { var t = coll[i], cl = []; for (var j = 0; j < t.clips.numItems; j++) cl.push(__cinfo(t.clips[j], j)); var x = { id: p + (i + 1), name: t.name, clips: cl }; try { x.muted = t.isMuted(); } catch (e1) {} try { x.locked = t.isLocked(); } catch (e2) {} a.push(x); } return a; }
o.videoTracks = tr(s.videoTracks, 'V'); o.audioTracks = tr(s.audioTracks, 'A');
if (ARGS.includeMarkers !== false) { o.markers = []; var m = s.markers.getFirstMarker(); var n = 0; while (m && n < 500) { o.markers.push({ name: m.name, start: m.start.seconds, end: m.end.seconds, comments: m.comments, type: m.type }); m = s.markers.getNextMarker(m); n++; } }
return o;` });

jsxTool({ name: 'pr_openSequence', toolset: 'pr', app: 'pr',
  description: 'Premiere Pro: open a sequence in the timeline and make it active.',
  input: { sequence: z.string() },
  jsx: R`var s = __seq(ARGS.sequence); app.project.openSequence(s.sequenceID); app.project.activeSequence = s; return { active: s.name };` });

jsxTool({ name: 'pr_createSequence', toolset: 'pr', app: 'pr',
  description: 'Premiere Pro: create a sequence — from clips (settings match the first clip), from a .sqpreset, or a default preset then width/height/fps applied (e.g. 3840x2160 @ 25).',
  input: { name: z.string(), clips: z.array(z.string()).optional().describe('project item names/paths to build the sequence from'), presetPath: z.string().optional(),
    width: z.number().int().optional(), height: z.number().int().optional(), fps: z.number().optional(), bin: z.string().optional() },
  before: (a) => ({ ...a, __preset: a.presetPath || findInPremiere((n) => /\.sqpreset$/i.test(n) && /1080p/i.test(n), 'Settings')[0] || '' }),
  jsx: R`var s = null;
if (ARGS.clips && ARGS.clips.length) { var items = []; for (var i = 0; i < ARGS.clips.length; i++) { var it = __findItem(ARGS.clips[i]); if (!it) throw new Error('Project item not found: ' + ARGS.clips[i]); items.push(it); } s = ARGS.bin ? app.project.createNewSequenceFromClips(ARGS.name, items, __bin(ARGS.bin, true)) : app.project.createNewSequenceFromClips(ARGS.name, items); if (!s) s = __seq(ARGS.name); }
else { if (!ARGS.__preset) throw new Error('No sequence preset found — pass presetPath (.sqpreset).'); app.enableQE(); qe.project.newSequence(ARGS.name, ARGS.__preset); s = __seq(ARGS.name); }
if (ARGS.width || ARGS.height || ARGS.fps) { var st = s.getSettings(); if (ARGS.width) st.videoFrameWidth = ARGS.width; if (ARGS.height) st.videoFrameHeight = ARGS.height; if (ARGS.fps) { var t = new Time(); t.seconds = 1 / ARGS.fps; st.videoFrameRate = t; } s.setSettings(st); }
app.project.activeSequence = s; var f = s.getSettings(); return { name: s.name, id: s.sequenceID, width: f.videoFrameWidth, height: f.videoFrameHeight, fps: __seqFps(s) };` });

jsxTool({ name: 'pr_duplicateSequence', toolset: 'pr', app: 'pr',
  description: 'Premiere Pro: duplicate a sequence (safe copy before big/destructive edits) and optionally rename the copy / open it.',
  input: { sequence: zSeq, newName: z.string().optional(), open: z.boolean().optional() },
  jsx: R`var s = __seq(ARGS.sequence); var ids = {}; for (var i = 0; i < app.project.sequences.numSequences; i++) ids[app.project.sequences[i].sequenceID] = true;
s.clone(); var c = null; for (var j = 0; j < app.project.sequences.numSequences; j++) { var x = app.project.sequences[j]; if (!ids[x.sequenceID]) c = x; }
if (!c) throw new Error('Clone failed.');
if (ARGS.newName) c.name = ARGS.newName; if (ARGS.open !== false) { app.project.openSequence(c.sequenceID); app.project.activeSequence = c; } else { app.project.openSequence(s.sequenceID); app.project.activeSequence = s; } return { copy: c.name, id: c.sequenceID, active: app.project.activeSequence.name };` });

jsxTool({ name: 'pr_importFiles', toolset: 'pr', app: 'pr', timeoutMs: 600000,
  description: 'Premiere Pro: import media files (video, audio, images, PSD, AI, .aep comps, .mogrt, .srt) into a bin (created if missing). numberedStills imports an image sequence.',
  input: { paths: z.array(z.string()), bin: z.string().optional(), numberedStills: z.boolean().optional() },
  jsx: R`var b = __bin(ARGS.bin, true); var ok = app.project.importFiles(ARGS.paths, true, b, !!ARGS.numberedStills); var names = []; for (var i = 0; i < b.children.numItems; i++) names.push(b.children[i].name);
return { imported: ok, bin: ARGS.bin || '/', binContents: names.slice(-ARGS.paths.length - 5) };` });

jsxTool({ name: 'pr_createBin', toolset: 'pr', app: 'pr',
  description: 'Premiere Pro: create a bin (nested paths like "Footage/Day 1" supported).',
  input: { path: z.string() },
  jsx: R`var b = __bin(ARGS.path, true); return { bin: b.name, nodeId: b.nodeId };` });

jsxTool({ name: 'pr_moveItems', toolset: 'pr', app: 'pr',
  description: 'Premiere Pro: move project items (names/paths) into a bin; also rename or set a color label.',
  input: { items: z.array(z.string()), bin: z.string().optional(), rename: z.string().optional(), colorLabel: z.number().int().optional() },
  jsx: R`var b = ARGS.bin ? __bin(ARGS.bin, true) : null, out = [];
for (var i = 0; i < ARGS.items.length; i++) { var it = __findItem(ARGS.items[i]); if (!it) { out.push({ item: ARGS.items[i], error: 'not found' }); continue; } if (b) it.moveBin(b); if (ARGS.rename && ARGS.items.length === 1) it.name = ARGS.rename; if (ARGS.colorLabel !== undefined) it.setColorLabel(ARGS.colorLabel); out.push({ item: it.name, ok: true }); }
return out;` });

jsxTool({ name: 'pr_placeClip', toolset: 'pr', app: 'pr', timeoutMs: 300000,
  description: 'Premiere Pro: place a project item (name/path/media path — or a file path, imported automatically) on a track at a time — overwrite (default) or insert (ripples) — optionally trimmed to source inPoint/outPoint seconds.',
  input: { item: z.string(), sequence: zSeq, track: zTrack.optional(), time: zTime.optional(), mode: z.enum(['overwrite', 'insert']).optional(), inPoint: z.number().optional(), outPoint: z.number().optional(), bin: z.string().optional() },
  jsx: R`var s = __seq(ARGS.sequence); var it = __findItem(ARGS.item);
if (!it) { var f = __file(ARGS.item); if (!f.exists) throw new Error('Project item / file not found: ' + ARGS.item); var b = __bin(ARGS.bin || 'Imported', true); app.project.importFiles([f.fsName], true, b, false); it = __findItem(f.name) || __findItem(f.fsName); if (!it) throw new Error('Import failed: ' + ARGS.item); }
if (ARGS.inPoint !== undefined) it.setInPoint(ARGS.inPoint, 4); if (ARGS.outPoint !== undefined) it.setOutPoint(ARGS.outPoint, 4);
var tr = __track(s, ARGS.track || 'V1'); var t = __sec(ARGS.time);
if (ARGS.mode === 'insert') tr.insertClip(it, t); else tr.overwriteClip(it, t);
if (ARGS.inPoint !== undefined || ARGS.outPoint !== undefined) { try { it.clearInPoint(4); it.clearOutPoint(4); } catch (e) {} }
var placed = null; for (var i = 0; i < tr.clips.numItems; i++) { var c = tr.clips[i]; if (Math.abs(c.start.seconds - t) < 0.02) placed = __cinfo(c, i); }
return { placed: placed, track: ARGS.track || 'V1' };` });

jsxTool({ name: 'pr_removeClips', toolset: 'pr', app: 'pr', destructive: true,
  description: 'Premiere Pro: remove clips from the timeline (media stays in the project). ripple:true closes the gap.',
  input: { clips: zClips, sequence: zSeq, ripple: z.boolean().optional() },
  jsx: R`var s = __seq(ARGS.sequence); var objs = []; for (var i = 0; i < ARGS.clips.length; i++) objs.push(__clip(s, ARGS.clips[i]));
var names = []; for (var j = 0; j < objs.length; j++) { names.push(objs[j].name); objs[j].remove(!!ARGS.ripple, true); } return { removed: names };` });

jsxTool({ name: 'pr_razor', toolset: 'pr', app: 'pr',
  description: 'Premiere Pro: razor (cut) at one or more times across all tracks or the listed tracks.',
  input: { times: z.array(zTime), sequence: zSeq, tracks: z.array(z.string()).optional() },
  jsx: R`var s = __seq(ARGS.sequence); var q = __qeFor(s); var tl = __tracksOf(s, ARGS.tracks); var cuts = [], errors = [], before = 0, after = 0;
for (var k0 = 0; k0 < tl.length; k0++) before += tl[k0].t.clips.numItems;
for (var i = 0; i < ARGS.times.length; i++) { var tc = __tcOf(s, __sec(ARGS.times[i])); for (var k = 0; k < tl.length; k++) { try { __qeTrack(q, tl[k].id).razor(tc); } catch (e) { errors.push(tl[k].id + ': ' + e); } } cuts.push(tc); }
for (var k1 = 0; k1 < tl.length; k1++) after += tl[k1].t.clips.numItems;
return { cutsAt: cuts, tracks: tl.length, newClips: after - before, errors: errors };` });

jsxTool({ name: 'pr_removeRange', toolset: 'pr', app: 'pr', destructive: true,
  description: 'Premiere Pro: cut a time range out of the timeline (razor at start & end, remove what is inside) on all or listed tracks; ripple (default true) shifts later clips left to close the gap. Duplicate the sequence first for safety.',
  input: { start: zTime, end: zTime, sequence: zSeq, tracks: z.array(z.string()).optional(), ripple: z.boolean().optional() },
  jsx: R`var s = __seq(ARGS.sequence); var a = __sec(ARGS.start), b = __sec(ARGS.end); if (b <= a) throw new Error('end must be after start');
var q = __qeFor(s); var tl = __tracksOf(s, ARGS.tracks); var ta = __tcOf(s, a), tb = __tcOf(s, b), eps = 0.5 / __seqFps(s), removed = 0, moved = 0;
for (var k = 0; k < tl.length; k++) { try { var qt = __qeTrack(q, tl[k].id); qt.razor(ta); qt.razor(tb); } catch (e) {} }
for (var k2 = 0; k2 < tl.length; k2++) { var t = tl[k2].t; for (var i = t.clips.numItems - 1; i >= 0; i--) { var c = t.clips[i]; if (c.start.seconds >= a - eps && c.end.seconds <= b + eps) { c.remove(false, false); removed++; } } }
if (ARGS.ripple !== false) { var d = new Time(); d.seconds = -(b - a);
  for (var k3 = 0; k3 < tl.length; k3++) { var t3 = tl[k3].t; for (var j = 0; j < t3.clips.numItems; j++) { var c3 = t3.clips[j]; if (c3.start.seconds >= b - eps) { c3.move(d); moved++; } } } }
return { removedClips: removed, shiftedClips: moved, range: [a, b], rippled: ARGS.ripple !== false };` });

jsxTool({ name: 'pr_trimClip', toolset: 'pr', app: 'pr',
  description: 'Premiere Pro: trim a timeline clip — new timeline start/end (seconds) and/or source inPoint/outPoint.',
  input: { clip: zClipRef, sequence: zSeq, start: zTime.optional(), end: zTime.optional(), inPoint: z.number().optional(), outPoint: z.number().optional() },
  jsx: R`var s = __seq(ARGS.sequence); var c = __clip(s, ARGS.clip);
function T(x) { var t = new Time(); t.seconds = x; return t; }
if (ARGS.inPoint !== undefined) c.inPoint = T(ARGS.inPoint); if (ARGS.outPoint !== undefined) c.outPoint = T(ARGS.outPoint);
if (ARGS.end !== undefined) c.end = T(__sec(ARGS.end)); if (ARGS.start !== undefined) c.start = T(__sec(ARGS.start));
return __cinfo(c, 0);` });

jsxTool({ name: 'pr_moveClip', toolset: 'pr', app: 'pr',
  description: 'Premiere Pro: move a clip in time (toTime or by offset seconds) and/or to another track of the same type (toTrack, re-placed with the same source in/out).',
  input: { clip: zClipRef, sequence: zSeq, toTime: zTime.optional(), by: z.number().optional(), toTrack: z.string().optional() },
  jsx: R`var s = __seq(ARGS.sequence); var c = __clip(s, ARGS.clip);
var target = ARGS.toTime !== undefined ? __sec(ARGS.toTime) : c.start.seconds + __def(ARGS.by, 0);
if (ARGS.toTrack && ARGS.toTrack.toUpperCase() !== String(ARGS.clip.track).toUpperCase()) {
  var it = c.projectItem, inS = c.inPoint.seconds, outS = c.outPoint.seconds; var tr = __track(s, ARGS.toTrack);
  it.setInPoint(inS, 4); it.setOutPoint(outS, 4); c.remove(false, true); tr.overwriteClip(it, target); try { it.clearInPoint(4); it.clearOutPoint(4); } catch (e) {}
  return { moved: it.name, track: ARGS.toTrack, start: target }; }
var d = new Time(); d.seconds = target - c.start.seconds; c.move(d); return __cinfo(c, 0);` });

jsxTool({ name: 'pr_setClipEnabled', toolset: 'pr', app: 'pr',
  description: 'Premiere Pro: enable/disable clips (disabled clips stay on the timeline but do not render).',
  input: { clips: zClips, sequence: zSeq, enabled: z.boolean() },
  jsx: R`var s = __seq(ARGS.sequence); for (var i = 0; i < ARGS.clips.length; i++) __clip(s, ARGS.clips[i]).disabled = !ARGS.enabled; return { clips: ARGS.clips.length, enabled: ARGS.enabled };` });

jsxTool({ name: 'pr_setClipProperties', toolset: 'pr', app: 'pr',
  description: 'Premiere Pro: set Motion/Opacity on video clips (scale %, position [x,y] px 0,0 top-left, rotation deg, anchorPoint px, opacity 0-100) or volume dB on audio clips. keyframes:[{time (timeline s), scale?, position?, rotation?, opacity?, volume?, interpolation?}] are ADDED. A static value on a keyframed parameter is refused unless replaceKeyframes:true.',
  input: { clips: zClips, sequence: zSeq, scale: z.number().optional(), position: z.array(z.number()).optional(), rotation: z.number().optional(), anchorPoint: z.array(z.number()).optional(),
    opacity: z.number().optional(), volume: z.number().optional().describe('dB, 0 = unity'), keyframes: z.array(z.record(z.unknown())).optional(), replaceKeyframes: z.boolean().optional() },
  jsx: R`var s = __seq(ARGS.sequence); var fs = __frameSize(s); var res = [];
var MAP = { scale: ['Motion', 'Scale'], position: ['Motion', 'Position'], rotation: ['Motion', 'Rotation'], anchorPoint: ['Motion', 'Anchor Point'], opacity: ['Opacity', 'Opacity'], volume: ['Volume', 'Level'] };
function conv(k, v) { if (k === 'position' || k === 'anchorPoint') return [v[0] / fs[0], v[1] / fs[1]]; if (k === 'volume') return __dbToLevel(v); return v; }
function interp(n) { return { linear: 0, hold: 4, bezier: 5, autoBezier: 5, easeIn: 6, easeOut: 7 }[n] ; }
for (var i = 0; i < ARGS.clips.length; i++) { var c = __clip(s, ARGS.clips[i]); var r = { clip: c.name, set: [], refused: [] };
  for (var k in MAP) { if (ARGS[k] === undefined) continue; var comp = __comp_(c, MAP[k][0]); if (!comp) { r.refused.push(k + ': no ' + MAP[k][0] + ' component'); continue; } var p = __param(comp, MAP[k][1]);
    if (p.isTimeVarying() && !ARGS.replaceKeyframes) { var ks = []; try { var kk = p.getKeys(); for (var q = 0; q < kk.length; q++) ks.push(kk[q].seconds); } catch (e) {} r.refused.push({ param: k, reason: 'kept keyframes', keys: ks }); continue; }
    if (p.isTimeVarying()) p.setTimeVarying(false); p.setValue(conv(k, ARGS[k]), true); r.set.push(k); }
  if (ARGS.keyframes) for (var j = 0; j < ARGS.keyframes.length; j++) { var K = ARGS.keyframes[j]; var kt = __clipKeyTime(c, __sec(K.time));
    for (var k2 in MAP) { if (K[k2] === undefined) continue; var cp = __comp_(c, MAP[k2][0]); if (!cp) continue; var pp = __param(cp, MAP[k2][1]); if (!pp.isTimeVarying()) pp.setTimeVarying(true); pp.addKey(kt); pp.setValueAtKey(kt, conv(k2, K[k2]), true); if (K.interpolation) { try { pp.setInterpolationTypeAtKey(kt, interp(K.interpolation), true); } catch (e2) {} } r.set.push(k2 + '@' + K.time); } }
  res.push(r); }
return res;` });

jsxTool({ name: 'pr_getClipProperties', toolset: 'pr', app: 'pr', readOnly: true,
  description: 'Premiere Pro: every effect component on a clip with its parameters, values and keyframes (Motion, Opacity, Volume, Lumetri, plugins...).',
  input: { clip: zClipRef, sequence: zSeq },
  jsx: R`var s = __seq(ARGS.sequence); var c = __clip(s, ARGS.clip); var out = [];
for (var i = 0; i < c.components.numItems; i++) { var cp = c.components[i], ps = [];
  for (var j = 0; j < cp.properties.numItems; j++) { var p = cp.properties[j], o = { name: p.displayName }; try { o.value = p.getValue(); } catch (e) {} try { o.keyframed = p.isTimeVarying(); if (o.keyframed) { var ks = p.getKeys(), a = []; for (var q = 0; q < ks.length; q++) a.push(ks[q].seconds); o.keys = a; } } catch (e2) {} ps.push(o); }
  out.push({ index: i, name: cp.displayName, matchName: cp.matchName, params: ps }); }
return { clip: __cinfo(c, 0), components: out };` });

jsxTool({ name: 'pr_findEffects', toolset: 'pr', app: 'pr', readOnly: true,
  description: 'Premiere Pro: search installed video/audio effects and transitions — built-in AND third-party plugins — by name.',
  input: { query: z.string().optional(), kind: z.enum(['videoEffect', 'audioEffect', 'videoTransition', 'audioTransition', 'all']).optional() },
  jsx: R`app.enableQE(); var q = ARGS.query ? String(ARGS.query).toLowerCase() : '', k = __def(ARGS.kind, 'all'), out = {};
var L = { videoEffect: 'getVideoEffectList', audioEffect: 'getAudioEffectList', videoTransition: 'getVideoTransitionList', audioTransition: 'getAudioTransitionList' };
for (var n in L) { if (k !== 'all' && k !== n) continue; var a = []; try { var lst = qe.project[L[n]](); for (var i = 0; i < lst.length; i++) if (!q || String(lst[i]).toLowerCase().indexOf(q) >= 0) a.push(String(lst[i])); } catch (e) {} out[n] = a; }
return out;` });

jsxTool({ name: 'pr_applyEffect', toolset: 'pr', app: 'pr',
  description: 'Premiere Pro: apply a video or audio effect (built-in or plugin, by exact name from pr_findEffects) to clips, optionally setting its parameters {paramName: value}.',
  input: { clips: zClips, effect: z.string(), sequence: zSeq, properties: z.record(z.unknown()).optional() },
  jsx: R`var s = __seq(ARGS.sequence); var q = __qeFor(s); var out = [];
for (var i = 0; i < ARGS.clips.length; i++) { var ref = ARGS.clips[i], c = __clip(s, ref); var isV = String(ref.track).toUpperCase().charAt(0) === 'V';
  var eff = isV ? qe.project.getVideoEffectByName(ARGS.effect) : qe.project.getAudioEffectByName(ARGS.effect); if (!eff) throw new Error('Effect not found: ' + ARGS.effect);
  var qc = __qeClip(__qeTrack(q, ref.track), c); if (!qc) throw new Error('QE clip not found');
  if (isV) qc.addVideoEffect(eff); else qc.addAudioEffect(eff);
  var comp = c.components[c.components.numItems - 1]; var set = [];
  var missing = [];
  if (ARGS.properties && comp) for (var k in ARGS.properties) { var p = __param(comp, k); if (p) { var v = ARGS.properties[k]; if (typeof v === 'string' && v.charAt(0) === '#') { var rgb = __rgb255(v); p.setColorValue(255, rgb[0], rgb[1], rgb[2], true); } else p.setValue(v, true); set.push(k); } else missing.push(k); }
  var o = { clip: c.name, component: comp ? comp.displayName : ARGS.effect, set: set };
  if (missing.length) { o.missing = missing; o.availableParams = []; for (var pi = 0; pi < comp.properties.numItems; pi++) if (comp.properties[pi].displayName) o.availableParams.push(comp.properties[pi].displayName); }
  out.push(o); }
return out;` });

jsxTool({ name: 'pr_setEffectProperties', toolset: 'pr', app: 'pr',
  description: 'Premiere Pro: set parameters of any effect component on a clip (by component displayName, e.g. "Lumetri Color", "Gaussian Blur", "Motion") — static values or keyframes [{time, value}] (timeline s). Colors as hex.',
  input: { clip: zClipRef, effect: z.string(), sequence: zSeq, properties: z.record(z.unknown()).optional(), keyframes: z.array(z.object({ param: z.string(), time: zTime, value: z.unknown() })).optional() },
  jsx: R`var s = __seq(ARGS.sequence); var c = __clip(s, ARGS.clip); var comp = __comp_(c, ARGS.effect); if (!comp) throw new Error('Component not on clip: ' + ARGS.effect);
function put(p, v, t) { if (typeof v === 'string' && v.charAt(0) === '#') { var rgb = __rgb255(v); if (t !== undefined) p.setValueAtKey(t, [255, rgb[0], rgb[1], rgb[2]], true); else p.setColorValue(255, rgb[0], rgb[1], rgb[2], true); } else if (t !== undefined) p.setValueAtKey(t, v, true); else p.setValue(v, true); }
var set = [];
if (ARGS.properties) for (var k in ARGS.properties) { var p = __param(comp, k); if (!p) { var av = []; for (var a1 = 0; a1 < comp.properties.numItems; a1++) if (comp.properties[a1].displayName) av.push(comp.properties[a1].displayName); throw new Error('Param not found: ' + k + '. Available: ' + av.join(', ')); } put(p, ARGS.properties[k]); set.push(k); }
if (ARGS.keyframes) for (var i = 0; i < ARGS.keyframes.length; i++) { var K = ARGS.keyframes[i]; var pp = __param(comp, K.param); if (!pp) throw new Error('Param not found: ' + K.param); if (!pp.isTimeVarying()) pp.setTimeVarying(true); var kt = __clipKeyTime(c, __sec(K.time)); pp.addKey(kt); put(pp, K.value, kt); set.push(K.param + '@' + K.time); }
return { component: comp.displayName, set: set };` });

jsxTool({ name: 'pr_applyTransition', toolset: 'pr', app: 'pr',
  description: 'Premiere Pro: add a transition (video: "Cross Dissolve", "Dip to Black", "Film Dissolve"...; audio: "Constant Power"...) at the start, end or both of clips, duration seconds.',
  input: { clips: zClips, transition: z.string().optional(), sequence: zSeq, position: z.enum(['start', 'end', 'both']).optional(), duration: z.number().optional() },
  jsx: R`var s = __seq(ARGS.sequence); var q = __qeFor(s); var frames = String(Math.round(__def(ARGS.duration, 1) * __seqFps(s))); var out = [];
for (var i = 0; i < ARGS.clips.length; i++) { var ref = ARGS.clips[i], c = __clip(s, ref); var isV = String(ref.track).toUpperCase().charAt(0) === 'V';
  var tn = __def(ARGS.transition, isV ? 'Cross Dissolve' : 'Constant Power'); var tr = isV ? qe.project.getVideoTransitionByName(tn) : qe.project.getAudioTransitionByName(tn); if (!tr) throw new Error('Transition not found: ' + tn);
  var qc = __qeClip(__qeTrack(q, ref.track), c); var pos = __def(ARGS.position, 'end');
  if (pos === 'start' || pos === 'both') qc.addTransition(tr, false, frames, '0', 0.5, true, true);
  if (pos === 'end' || pos === 'both') qc.addTransition(tr, true, frames, '0', 0.5, true, true);
  out.push({ clip: c.name, transition: tn, position: pos, frames: frames }); }
return out;` });

jsxTool({ name: 'pr_addGraphic', toolset: 'pr', app: 'pr', timeoutMs: 180000,
  description: 'Premiere Pro: place a Motion Graphics template — built-in by name (e.g. "Basic Title", "Basic Lower Third") or a .mogrt path (also AE-exported) — on a video track at time; set its text (or texts {paramName: text}) and duration. Returns editable parameter names.',
  input: { template: z.string().optional(), path: z.string().optional(), sequence: zSeq, track: zTrack.optional(), time: zTime.optional(), duration: z.number().optional(), text: z.string().optional(), texts: z.record(z.string()).optional() },
  before: (a) => { let p = a.path; if (!p && a.template) { const want = a.template.toLowerCase().replace(/\.mogrt$/, ''); p = findInPremiere((n) => n.toLowerCase() === want + '.mogrt')[0] || findInPremiere((n) => n.toLowerCase().endsWith('.mogrt') && n.toLowerCase().includes(want))[0]; } return { ...a, __mogrt: p || '' }; },
  jsx: R`if (!ARGS.__mogrt) throw new Error('MOGRT not found — pass path to a .mogrt or a built-in template name.');
var s = __seq(ARGS.sequence); var t = new Time(); t.seconds = __sec(ARGS.time); var vi = Number(String(ARGS.track || 'V2').substr(1)) - 1;
while (s.videoTracks.numTracks <= vi) { try { __qeFor(s).addTracks(1, s.videoTracks.numTracks, 0); } catch (e) { break; } }
var ti = s.importMGT(ARGS.__mogrt, t.ticks, vi, 0); if (!ti) throw new Error('importMGT failed');
if (ARGS.duration) { var e2 = new Time(); e2.seconds = t.seconds + ARGS.duration; ti.end = e2; }
$.sleep(150); var mg = null; try { mg = ti.getMGTComponent(); } catch (eM) {} var names = [], textProps = [];
for (var ci = 0; ci < ti.components.numItems; ci++) { var cc = ti.components[ci]; for (var pi = 0; pi < cc.properties.numItems; pi++) { var pp = cc.properties[pi]; if (isText(pp)) textProps.push(pp); } }
function setText(p, txt) { var v = String(p.getValue()); var b = v.indexOf('{');
  if (b >= 0) { var head = v.substring(0, b), o = null; try { o = (typeof JSON !== 'undefined') ? JSON.parse(v.substring(b)) : eval('(' + v.substring(b) + ')'); } catch (x) {}
    if (o) { if (o.mTextParam && o.mTextParam.mStyleSheet) o.mTextParam.mStyleSheet.mText = txt; if (o.textEditValue !== undefined) o.textEditValue = txt; if (o.mTextString !== undefined) o.mTextString = txt; p.setValue(head + (typeof JSON !== 'undefined' ? JSON.stringify(o) : __s(o)), true); return true; } }
  return false; }
function isText(p) { var dn = String(p.displayName).toLowerCase(); var v = ''; try { v = String(p.getValue()); } catch (x) {} return dn.indexOf('source text') >= 0 || dn === 'text' || v.indexOf('mTextParam') >= 0 || v.indexOf('textEditValue') >= 0 || v.indexOf('mTextString') >= 0; }
if (mg) { for (var i = 0; i < mg.properties.numItems; i++) names.push(mg.properties[i].displayName);
  if (ARGS.texts) for (var k in ARGS.texts) { var p = mg.properties.getParamForDisplayName(k); if (p) setText(p, ARGS.texts[k]); }
  if (ARGS.text) { for (var j = 0; j < mg.properties.numItems; j++) { var q = mg.properties[j]; if (isText(q)) { setText(q, ARGS.text); ARGS.text = null; break; } } } }
var textOk = true; if (ARGS.text && textProps.length) textOk = setText(textProps[0], ARGS.text);
if (ARGS.texts && !mg) { var ks = []; for (var kk in ARGS.texts) ks.push(ARGS.texts[kk]); for (var tpi = 0; tpi < ks.length && tpi < textProps.length; tpi++) setText(textProps[tpi], ks[tpi]); }
return { placed: ti.name, start: ti.start.seconds, end: ti.end.seconds, params: names, textLayers: textProps.length, mogrt: ARGS.__mogrt,
  warning: textOk ? undefined : 'This Premiere-made template stores its text in a binary form scripting cannot edit in this Premiere version. For editable text use an After Effects MOGRT (xapp_mogrtToPremiere) or pr_addCaptions.' };` });

jsxTool({ name: 'pr_importCaptions', toolset: 'pr', app: 'pr', timeoutMs: 180000,
  description: 'Premiere Pro: import an .srt (or other caption file) onto a new caption track starting at time (default 0).',
  input: { path: z.string(), sequence: zSeq, time: zTime.optional(), bin: z.string().optional(), format: z.enum(['subtitle', '608', '708', 'teletext', 'openEBU', 'op42', 'op47']).optional() },
  jsx: R`var s = __seq(ARGS.sequence); var f = __file(ARGS.path); if (!f.exists) throw new Error('Not found: ' + ARGS.path);
var b = __bin(ARGS.bin || 'Captions', true); app.project.importFiles([f.fsName], true, b, false); var it = null;
for (var i = b.children.numItems - 1; i >= 0; i--) if (b.children[i].name === f.name || b.children[i].name === f.name.replace(/\.[^.]+$/, '')) { it = b.children[i]; break; }
if (!it) it = b.children[b.children.numItems - 1];
var F = { subtitle: Sequence.CAPTION_FORMAT_SUBTITLE, '608': Sequence.CAPTION_FORMAT_608, '708': Sequence.CAPTION_FORMAT_708, teletext: Sequence.CAPTION_FORMAT_TELETEXT, openEBU: Sequence.CAPTION_FORMAT_OPEN_EBU, op42: Sequence.CAPTION_FORMAT_OP42, op47: Sequence.CAPTION_FORMAT_OP47 };
var ok = s.createCaptionTrack(it, __sec(ARGS.time), F[__def(ARGS.format, 'subtitle')]); return { captionTrack: ok, item: it.name };` });

tool({ name: 'pr_addCaptions', toolset: 'pr',
  description: 'Premiere Pro: add text captions/subtitles from cues [{start, end, text}] (seconds) — builds an .srt and creates a caption track on the sequence. Reliable editable on-screen text.',
  input: { cues: z.array(z.object({ start: z.number(), end: z.number(), text: z.string() })), sequence: zSeq, name: z.string().optional() },
  handler: async (a, ctx) => {
    const ts = (x: number) => { const ms = Math.round(x * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000), s2 = Math.floor(ms % 60000 / 1000); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s2).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
    const srt = a.cues.map((c: any, i: number) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n');
    const file = join(mediaDir('captions'), `${(a.name || 'captions').replace(/[^\w-]+/g, '_')}-${Date.now()}.srt`);
    writeFileSync(file, srt, 'utf8');
    return ctx.call('pr_importCaptions', { path: file, sequence: a.sequence });
  } });

jsxTool({ name: 'pr_addMarkers', toolset: 'pr', app: 'pr',
  description: 'Premiere Pro: add sequence markers [{time, name?, comment?, duration?, color 0-7?, type comment|chapter|segmentation|weblink, url?}] — e.g. review points before cuts.',
  input: { markers: z.array(z.object({ time: zTime, name: z.string().optional(), comment: z.string().optional(), duration: z.number().optional(), color: z.number().int().optional(), type: z.enum(['comment', 'chapter', 'segmentation', 'weblink']).optional(), url: z.string().optional() })), sequence: zSeq },
  jsx: R`var s = __seq(ARGS.sequence); var n = 0;
for (var i = 0; i < ARGS.markers.length; i++) { var M = ARGS.markers[i]; var t = __sec(M.time); var m = s.markers.createMarker(t); if (M.name) m.name = M.name; if (M.comment) m.comments = M.comment;
  if (M.duration) { var e = new Time(); e.seconds = t + M.duration; m.end = e; } if (M.color !== undefined) { try { m.setColorByIndex(M.color); } catch (x) {} }
  if (M.type === 'chapter') m.setTypeAsChapter(); else if (M.type === 'segmentation') m.setTypeAsSegmentation(); else if (M.type === 'weblink') m.setTypeAsWebLink(M.url || '', ''); n++; }
return { added: n };` });

jsxTool({ name: 'pr_deleteMarkers', toolset: 'pr', app: 'pr', destructive: true,
  description: 'Premiere Pro: delete sequence markers — all, by name, or in a time range.',
  input: { sequence: zSeq, name: z.string().optional(), from: zTime.optional(), to: zTime.optional() },
  jsx: R`var s = __seq(ARGS.sequence); var kill = [], m = s.markers.getFirstMarker(), a = ARGS.from !== undefined ? __sec(ARGS.from) : -1, b = ARGS.to !== undefined ? __sec(ARGS.to) : 1e9;
while (m) { var t = m.start.seconds; if ((!ARGS.name || m.name === ARGS.name) && t >= a && t <= b) kill.push(m); m = s.markers.getNextMarker(m); }
for (var i = 0; i < kill.length; i++) s.markers.deleteMarker(kill[i]); return { deleted: kill.length };` });

jsxTool({ name: 'pr_getSelection', toolset: 'pr', app: 'pr', readOnly: true,
  description: 'Premiere Pro: clips currently selected in the timeline (track + 1-based index usable as clip refs).',
  input: { sequence: zSeq },
  jsx: R`var s = __seq(ARGS.sequence); var out = [];
function scan(coll, p) { for (var i = 0; i < coll.numTracks; i++) { var t = coll[i]; for (var j = 0; j < t.clips.numItems; j++) if (t.clips[j].isSelected()) { var o = __cinfo(t.clips[j], j); o.track = p + (i + 1); out.push(o); } } }
scan(s.videoTracks, 'V'); scan(s.audioTracks, 'A'); return out;` });

jsxTool({ name: 'pr_setInOut', toolset: 'pr', app: 'pr',
  description: 'Premiere Pro: set (or clear) sequence in/out points — or a project item\'s source in/out with item.',
  input: { sequence: zSeq, inPoint: zTime.optional(), outPoint: zTime.optional(), clear: z.boolean().optional(), item: z.string().optional() },
  jsx: R`if (ARGS.item) { var it = __findItem(ARGS.item); if (!it) throw new Error('Item not found'); if (ARGS.clear) { it.clearInPoint(4); it.clearOutPoint(4); } if (ARGS.inPoint !== undefined) it.setInPoint(__sec(ARGS.inPoint), 4); if (ARGS.outPoint !== undefined) it.setOutPoint(__sec(ARGS.outPoint), 4); return { item: it.name }; }
var s = __seq(ARGS.sequence); if (ARGS.clear) { s.setInPoint(0); s.setOutPoint(Number(s.end) / __TICKS); }
if (ARGS.inPoint !== undefined) s.setInPoint(__sec(ARGS.inPoint)); if (ARGS.outPoint !== undefined) s.setOutPoint(__sec(ARGS.outPoint));
return { inPoint: s.getInPointAsTime().seconds, outPoint: s.getOutPointAsTime().seconds };` });

jsxTool({ name: 'pr_setPlayhead', toolset: 'pr', app: 'pr',
  description: 'Premiere Pro: move the timeline playhead to a time.',
  input: { time: zTime, sequence: zSeq },
  jsx: R`var s = __seq(ARGS.sequence); var t = new Time(); t.seconds = __sec(ARGS.time); s.setPlayerPosition(t.ticks); return { playhead: s.getPlayerPosition().seconds };` });

jsxTool({ name: 'pr_saveProject', toolset: 'pr', app: 'pr', timeoutMs: 300000,
  description: 'Premiere Pro: save the project (or Save As path); backup:true also writes a timestamped copy into a "Backups" folder next to it.',
  input: { path: z.string().optional(), backup: z.boolean().optional() },
  jsx: R`if (ARGS.path) app.project.saveAs(ARGS.path); else app.project.save(); var res = { saved: app.project.path };
if (ARGS.backup) { var f = new File(app.project.path); var d = new Folder(f.parent.fsName + '/Backups'); if (!d.exists) d.create(); var n = new Date(), pad = function (x) { return (x < 10 ? '0' : '') + x; };
  var dst = d.fsName + '/' + f.name.replace(/\.prproj$/i, '') + '_backup_' + n.getFullYear() + pad(n.getMonth() + 1) + pad(n.getDate()) + '_' + pad(n.getHours()) + pad(n.getMinutes()) + pad(n.getSeconds()) + '.prproj'; f.copy(dst); res.backup = dst; }
return res;` });

jsxTool({ name: 'pr_exportFrame', toolset: 'pr', app: 'pr', readOnly: true, timeoutMs: 120000,
  description: 'Premiere Pro: export the frame at a time (default playhead) as PNG and return it as an image to check the edit.',
  input: { time: zTime.optional(), sequence: zSeq, path: z.string().optional() },
  before: (a) => ({ ...a, __path: a.path || tempPng('pr-frame') }),
  jsx: R`var s = __seq(ARGS.sequence); var q = __qeFor(s); var t = ARGS.time !== undefined ? __sec(ARGS.time) : s.getPlayerPosition().seconds;
var stem = String(ARGS.__path).replace(/\.png$/i, ''); q.exportFramePNG(__tcOf(s, t), stem); return { path: stem + '.png', time: t };`,
  after: async (r: any) => imageResult(r.path, r, 30000),
});

/* ---------- advanced ---------- */
jsxTool({ name: 'pr_export', toolset: 'pr', app: 'pr', timeoutMs: 6 * 3600 * 1000,
  description: 'Premiere Pro: export a sequence with an .epr preset — via Adobe Media Encoder queue (default, starts batch) or directly inside Premiere (direct:true, blocking). range entire|inToOut|workArea. Default preset: "Match Source - Adaptive High Bitrate".',
  input: { outputPath: z.string(), sequence: zSeq, presetPath: z.string().optional(), presetName: z.string().optional(), range: z.enum(['entire', 'inToOut', 'workArea']).optional(), direct: z.boolean().optional(), startQueue: z.boolean().optional() },
  before: (a) => { const want = (a.presetName || 'Match Source - Adaptive High Bitrate').toLowerCase(); const p = a.presetPath || findInPremiere((n) => n.toLowerCase() === want + '.epr')[0] || findInPremiere((n) => n.toLowerCase().endsWith('.epr') && n.toLowerCase().includes(want))[0]; return { ...a, __epr: p || '' }; },
  jsx: R`if (!ARGS.__epr) throw new Error('Export preset (.epr) not found — pass presetPath.'); var s = __seq(ARGS.sequence); var R = { entire: 0, inToOut: 1, workArea: 2 }[__def(ARGS.range, 'entire')];
if (ARGS.direct) { var r = s.exportAsMediaDirect(ARGS.outputPath, ARGS.__epr, R); return { exported: ARGS.outputPath, result: r, preset: ARGS.__epr }; }
app.encoder.launchEncoder(); var job = app.encoder.encodeSequence(s, ARGS.outputPath, ARGS.__epr, R, 1); if (ARGS.startQueue !== false) app.encoder.startBatch();
return { queuedInAME: job, output: ARGS.outputPath, preset: ARGS.__epr };` });

jsxTool({ name: 'pr_exportProjectFile', toolset: 'pr', app: 'pr', timeoutMs: 600000,
  description: 'Premiere Pro: export the sequence as Final Cut Pro XML (interchange with AE/DaVinci/others), as an AAF, or as a standalone trimmed .prproj (exportAsProject).',
  input: { sequence: zSeq, path: z.string(), format: z.enum(['fcpxml', 'prproj', 'otio']).optional() },
  jsx: R`var s = __seq(ARGS.sequence); var f = __def(ARGS.format, 'fcpxml'); var r;
if (f === 'fcpxml') r = s.exportAsFinalCutProXML(ARGS.path, 1); else if (f === 'prproj') r = s.exportAsProject(ARGS.path); else r = s.exportAsOpenTimelineIO ? s.exportAsOpenTimelineIO(ARGS.path) : 'OTIO not supported in this version';
return { exported: ARGS.path, format: f, result: r };` });

jsxTool({ name: 'pr_setClipSpeed', toolset: 'pr', app: 'pr',
  description: 'Premiere Pro: change clip speed (percent, 200 = 2x), reverse, maintain audio pitch, ripple.',
  input: { clip: zClipRef, sequence: zSeq, speed: z.number(), reverse: z.boolean().optional(), maintainPitch: z.boolean().optional(), ripple: z.boolean().optional() },
  jsx: R`var s = __seq(ARGS.sequence); var c = __clip(s, ARGS.clip); var q = __qeFor(s); var qc = __qeClip(__qeTrack(q, ARGS.clip.track), c);
var ratio = ARGS.speed / 100; var ticks = String(Math.round(Number(c.duration.ticks) / ratio));
try { qc.setSpeed(ratio, ticks, !!ARGS.reverse, ARGS.maintainPitch !== false, !!ARGS.ripple); } catch (e) { qc.setSpeed(ratio, '', !!ARGS.reverse, ARGS.maintainPitch !== false, !!ARGS.ripple); }
return { clip: c.name, speed: ARGS.speed };` });

jsxTool({ name: 'pr_tracks', toolset: 'pr', app: 'pr',
  description: 'Premiere Pro: track operations — add video/audio tracks, mute/unmute, lock/unlock, target/untarget tracks (for inserts/pastes).',
  input: { sequence: zSeq, action: z.enum(['addVideo', 'addAudio', 'mute', 'unmute', 'lock', 'unlock', 'target', 'untarget']), tracks: z.array(z.string()).optional(), count: z.number().int().optional() },
  jsx: R`var s = __seq(ARGS.sequence); var a = ARGS.action, n = __def(ARGS.count, 1);
if (a === 'addVideo') { __qeFor(s).addTracks(n, s.videoTracks.numTracks, 0); return { videoTracks: s.videoTracks.numTracks }; }
if (a === 'addAudio') { __qeFor(s).addTracks(0, 0, n, 1, s.audioTracks.numTracks); return { audioTracks: s.audioTracks.numTracks }; }
var tl = __tracksOf(s, ARGS.tracks), done = [];
for (var i = 0; i < tl.length; i++) { var t = tl[i].t; if (a === 'mute' || a === 'unmute') t.setMute(a === 'mute' ? 1 : 0); if (a === 'lock' || a === 'unlock') t.setLocked(a === 'lock' ? 1 : 0); if (a === 'target' || a === 'untarget') t.setTargeted(a === 'target', true); done.push(tl[i].id); }
return { action: a, tracks: done };` });

jsxTool({ name: 'pr_clipOps', toolset: 'pr', app: 'pr',
  description: 'Premiere Pro: clip operations — select/deselect, link/unlink (selection), rename, set color label, replace footage (changeMediaPath on the project item), set name of item.',
  input: { action: z.enum(['select', 'deselect', 'link', 'unlink', 'rename', 'colorLabel', 'replaceMedia']), clips: zClips.optional(), sequence: zSeq, name: z.string().optional(), label: z.number().int().optional(), mediaPath: z.string().optional() },
  jsx: R`var s = __seq(ARGS.sequence); var a = ARGS.action; var cs = []; if (ARGS.clips) for (var i = 0; i < ARGS.clips.length; i++) cs.push(__clip(s, ARGS.clips[i]));
if (a === 'select' || a === 'link' || a === 'unlink') { for (var j = 0; j < cs.length; j++) cs[j].setSelected(true, true); }
if (a === 'deselect') for (var k = 0; k < cs.length; k++) cs[k].setSelected(false, true);
if (a === 'link') s.linkSelection(); if (a === 'unlink') s.unlinkSelection();
if (a === 'rename') for (var r = 0; r < cs.length; r++) cs[r].name = ARGS.name;
if (a === 'colorLabel') for (var c = 0; c < cs.length; c++) cs[c].projectItem.setColorLabel(ARGS.label);
if (a === 'replaceMedia') for (var m = 0; m < cs.length; m++) cs[m].projectItem.changeMediaPath(ARGS.mediaPath, true);
return { action: a, clips: cs.length };` });

jsxTool({ name: 'pr_sequenceOps', toolset: 'pr', app: 'pr', timeoutMs: 1800000,
  description: 'Premiere Pro: sequence-level AI/automation — autoReframe (new aspect sequence, e.g. 9:16 for Shorts), sceneEditDetection (markers or cuts on selected clips), createSubsequence (from in/out), rename, close.',
  input: { action: z.enum(['autoReframe', 'sceneEditDetection', 'createSubsequence', 'rename', 'close']), sequence: zSeq, numerator: z.number().int().optional(), denominator: z.number().int().optional(),
    motionPreset: z.enum(['default', 'faster', 'slower']).optional(), newName: z.string().optional(), sceneAction: z.enum(['CreateMarkers', 'ApplyCuts']).optional(), sensitivity: z.enum(['LowSensitivity', 'MediumSensitivity', 'HighSensitivity']).optional() },
  jsx: R`var s = __seq(ARGS.sequence); var a = ARGS.action;
if (a === 'autoReframe') { var r = s.autoReframeSequence(__def(ARGS.numerator, 9), __def(ARGS.denominator, 16), __def(ARGS.motionPreset, 'default'), __def(ARGS.newName, s.name + ' - Reframed'), false); return { created: r ? r.name : null }; }
if (a === 'sceneEditDetection') { return { ok: s.performSceneEditDetectionOnSelection(__def(ARGS.sceneAction, 'CreateMarkers'), true, __def(ARGS.sensitivity, 'MediumSensitivity')) }; }
if (a === 'createSubsequence') { var sub = s.createSubsequence(true); if (ARGS.newName) sub.name = ARGS.newName; return { created: sub.name }; }
if (a === 'rename') { s.name = ARGS.newName; return { renamed: s.name }; }
if (a === 'close') { s.close(); return { closed: true }; }` });

tool({ name: 'pr_applyEditPlan', toolset: 'pr', readOnly: false,
  description: 'Premiere Pro: run many pr_* steps in ONE call, in order: steps:[{tool:"pr_addMarkers", input:{...}}, ...]. Stops at the first error unless stopOnError:false. (Works for any native tool, so ae_/ps_/ai_/xapp_ steps can be mixed in.)',
  input: { steps: z.array(z.object({ tool: z.string(), input: z.record(z.unknown()).optional() })), stopOnError: z.boolean().optional() },
  handler: async (a, ctx) => {
    const results: unknown[] = [];
    for (let i = 0; i < a.steps.length; i++) {
      const st = a.steps[i];
      try { results.push({ step: i + 1, tool: st.tool, ok: true, result: await ctx.call(st.tool, st.input || {}) }); }
      catch (e: any) { results.push({ step: i + 1, tool: st.tool, ok: false, error: String(e.message || e) }); if (a.stopOnError !== false) break; }
    }
    return { steps: results.length, results };
  } });
