/**
 * Adobe Audition — live scripting-DOM tools (au_*). Documents, multitrack tracks/clips, markers, transport, favorites,
 * every menu command, preferences, mixdown/export with any format & sample-type conversion, session export, DOM reflection.
 * Mixing/effects/automation that the DOM does not expose live in au-session.ts (SESX engine).
 * API units: seconds (DOM works in samples; converted with the document's sample rate).
 */
import { z } from 'zod';
import { existsSync, statSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { jsxTool, tool } from './define.js';
import { runJsx } from '../transport/runner.js';
import { listDialogs, describeDialog } from '../transport/dialogs.js';
import { sleep } from '../transport/process.js';
import { RUNTIME_DIR } from '../config.js';
import { ensureFfmpeg, ensureFfprobe, run } from './media.js';
import { readFavorites } from '../audition/library.js';

export const zDocAu = z.string().optional().describe('Audition document: display name, file path or id; omit for the active document.');
const zTrackAu = z.union([z.string(), z.number().int()]).describe('Track: 1-based index (top to bottom, excluding Mix), name, "id:10001", or "mix".');
const zClipAu = z.union([z.string(), z.number().int(), z.object({ at: z.number() })]).describe('Clip on that track: 1-based index (by start time), name/id, or {at: seconds}.');
const zFormat = z.enum(['wav', 'mp3', 'flac', 'aiff', 'ogg', 'aac', 'm4a', 'mp2', 'wma', 'ape', 'au']);
const fwd = (p: string) => (process.platform === 'win32' ? p.replace(/\//g, '\\') : p); // Audition compares media paths literally: use native separators
export const au = (body: string, args: unknown = {}, timeoutMs = 120000) => runJsx('au', body, args, { timeoutMs });

/* ---------- state ---------- */
jsxTool({ name: 'au_getState', toolset: 'au', app: 'au', readOnly: true,
  description: 'Audition state: open documents (waveform / multitrack, path, dirty, sample rate, duration, playhead), the active (or given) document in detail — multitrack: every track (index, name, kind audio/bus, channels, mute/solo/arm/selected, clips with start/end seconds and source file), Mix track, panner mode, markers — plus transport state. Call before editing; indexes change after edits. For volume/pan/effects/fades/automation read au_sessionInfo.',
  input: { document: zDocAu, detail: z.enum(['summary', 'full']).optional() },
  jsx: `var o = { app: app.name, version: app.version, documents: [] };
for (var i = 0; i < app.documents.length; i++) o.documents.push(__docInfo(app.documents[i], false));
var d = null; try { d = __adoc(ARGS.document); } catch (e) { if (ARGS.document) throw e; }
if (d) o.active = __docInfo(d, ARGS.detail !== 'summary');
try { var t = app.transport; o.transport = { playing: t.isPlaying, recording: t.isRecording, paused: t.isPaused, loop: t.loop }; } catch (e2) {}
return o;` });

jsxTool({ name: 'au_openFile', toolset: 'au', app: 'au', timeoutMs: 600000,
  description: 'Open files in Audition: audio (wav, mp3, aif, flac, ogg, m4a…) and video files open as waveform documents; .sesx sessions, Premiere .prproj / Premiere XML, FCP XML, OMF and Audition 3 XML open as multitrack sessions. The last one becomes active.',
  input: { paths: z.array(z.string()), activate: z.boolean().optional() },
  before: (a) => ({ ...a, paths: a.paths.map(fwd) }),
  jsx: `var out = [];
for (var i = 0; i < ARGS.paths.length; i++) {
  var p = ARGS.paths[i];
  if (!new File(p).exists) throw new Error('File not found: ' + p);
  var d = app.openDocument(new DocumentOpenParameter(p));
  if (!d) throw new Error('Audition could not open ' + p + ' (unsupported file or a dialog is waiting)');
  out.push(__docInfo(d, false));
  if (ARGS.activate !== false) { try { d.activate(); } catch (e) {} }
}
return out;` });

/* ---------- new audio file (generated with ffmpeg, then opened) ---------- */
tool({ name: 'au_newAudioFile', toolset: 'au',
  description: 'Create a new waveform file without dialogs and open it in Audition: silence (empty file to record/paste into), a test tone, or noise (white/pink/brown) — any duration, sample rate, channels (mono/stereo/5.1) and bit depth.',
  input: { path: z.string().describe('.wav path to create'), duration: z.number().optional().describe('seconds (default 10)'), sampleRate: z.number().int().optional(), channels: z.enum(['mono', 'stereo', '5.1']).optional(),
    bitDepth: z.enum(['16', '24', '32']).optional(), content: z.enum(['silence', 'tone', 'whiteNoise', 'pinkNoise', 'brownNoise']).optional(), frequency: z.number().optional(), levelDb: z.number().optional().describe('tone/noise level dBFS (default -18)'), open: z.boolean().optional() },
  handler: async (a) => {
    const ff = await ensureFfmpeg();
    const dur = a.duration ?? 10, sr = a.sampleRate || 48000, ch = a.channels === 'mono' ? 1 : a.channels === '5.1' ? 6 : 2;
    const amp = Math.pow(10, (a.levelDb ?? -18) / 20);
    const c = a.content || 'silence';
    const src = c === 'silence' ? `anullsrc=r=${sr}:cl=${ch === 6 ? '5.1' : ch === 1 ? 'mono' : 'stereo'}` : c === 'tone' ? `sine=f=${a.frequency || 1000}:r=${sr}` : `anoisesrc=r=${sr}:c=${c.replace('Noise', '')}:a=${amp}`;
    const codec = a.bitDepth === '16' ? 'pcm_s16le' : a.bitDepth === '32' ? 'pcm_f32le' : 'pcm_s24le';
    mkdirSync(dirname(a.path), { recursive: true });
    const args = ['-y', '-hide_banner', '-f', 'lavfi', '-i', src, '-t', String(dur)];
    if (c === 'tone') args.push('-af', `volume=${amp}`);
    args.push('-ac', String(ch), '-ar', String(sr), '-c:a', codec, a.path);
    const r = await run(ff, args, 300000);
    if (r.code !== 0) throw new Error('ffmpeg failed: ' + r.err.slice(-500));
    const opened = a.open === false ? null : await au(`var d = app.openDocument(new DocumentOpenParameter(ARGS.p)); try { d.activate(); } catch (e) {} return __docInfo(d, false);`, { p: fwd(a.path) });
    return { file: a.path, duration: dur, sampleRate: sr, channels: ch, opened };
  } });

/* ---------- save / close ---------- */
/** saveDocument() returns before Audition has written the file — wait until the document is clean and idle */
export async function saveAndWait(name: string, timeoutMs = 300000) {
  await au(`var d = __adoc(ARGS.n); if (!d.dirty) return false; if (__isMT(d)) { if (!d.path) throw new Error('Untitled session: save it with au_saveDocument {path}.'); __mtSave(d); } else { try { d.saveDocument(); } catch (e) { if (!d.path) throw new Error('Untitled file: save it with au_saveDocument {path}.'); d.saveAs(d.path, false); } } return true;`, { n: name });
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r: any = await au(`var d = __adoc(ARGS.n), b = false; try { b = d.isBusy; } catch (e) {} return { dirty: d.dirty, busy: b };`, { n: name }, 30000);
    if (!r.dirty && !r.busy) return true;
    await sleep(300);
  }
  throw new Error(`Audition did not finish saving "${name}" — check for a dialog (adobe_dialogs) and retry.`);
}
async function waitNotBusy(doc: string, timeoutMs = 600000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r: any = await au(`var d = __adoc(ARGS.d); var b = false; try { b = d.isBusy; } catch (e) {} return { busy: b, p: (function () { try { return d.busyProgress; } catch (x) { return null; } })() };`, { d: doc }, 30000);
    if (!r.busy) return true;
    await sleep(400);
  }
  return false;
}
async function waitFileStable(path: string, timeoutMs = 600000) {
  const end = Date.now() + timeoutMs; let last = -1, same = 0;
  while (Date.now() < end) {
    const s = existsSync(path) ? statSync(path).size : -1;
    if (s > 0 && s === last) { if (++same >= 2) return s; } else same = 0;
    last = s; await sleep(400);
  }
  return existsSync(path) ? statSync(path).size : 0;
}

const SAVE_JSX = `var d = __adoc(ARGS.document);
if (__isMT(d)) {
  if (ARGS.path) {
    var p = new MultitrackSaveAsParameter(); p.copyReferencedDocuments = !!ARGS.copyMedia; p.includeMetadata = ARGS.includeMetadata !== false;
    d.saveAsDocument(ARGS.path, p); return { kind: 'multitrack', saved: ARGS.path, name: d.displayName };
  }
  if (!d.path) throw new Error('Untitled session: pass path (e.g. D:/Project/Mix.sesx).');
  var sp = new MultitrackSaveParameter(); sp.copyReferencedDocuments = !!ARGS.copyMedia; d.saveDocument(sp);
  return { kind: 'multitrack', saved: d.path, name: d.displayName };
}
var ext = ARGS.path ? String(ARGS.path).replace(/^.*\\./, '') : null;
var fmt = __fileFormat(ARGS.format || ext, ARGS.mp3Kbps);
var stc = __stc(ARGS);
if (!ARGS.path) {
  if (fmt || stc) throw new Error('Pass path to save in another format / sample type.');
  try { d.saveDocument(); } catch (e) { if (!d.path) throw new Error('Untitled file: pass path.'); d.saveAs(d.path, false); }
  return { kind: 'waveform', saved: d.path, name: d.displayName };
}
if (ARGS.asCopy) {
  var ep = new WaveDocumentExportParameters(); if (fmt) ep.fileFormat = fmt; if (stc) ep.sampleTypeConversion = stc; ep.includeMetadata = ARGS.includeMetadata !== false;
  d.exportDocument(ARGS.path, ep); return { kind: 'waveform', exported: ARGS.path, name: d.displayName };
}
var sa = new WaveDocumentSaveAsParameters(); if (fmt) sa.fileFormat = fmt; if (stc) sa.sampleTypeConversion = stc; sa.includeMetadata = ARGS.includeMetadata !== false;
d.saveAsDocument(ARGS.path, sa); return { kind: 'waveform', saved: ARGS.path, name: d.displayName };`;

tool({ name: 'au_saveDocument', toolset: 'au',
  description: 'Save an Audition document. Multitrack: save, or save as a new .sesx (copyMedia copies all referenced audio next to it). Waveform: save, save as (switches the document to the new file) or asCopy:true (export, document stays as is) in any format — wav, mp3 (mp3Kbps), flac, aiff, ogg, aac/m4a, wma… — with optional sample-rate / bit-depth / channel conversion (mono, stereo, 5.1) and dither.',
  input: { document: zDocAu, path: z.string().optional(), format: zFormat.optional().describe('default: from the path extension'), mp3Kbps: z.number().optional(), sampleRate: z.number().int().optional(), bitDepth: z.number().int().optional().describe('8, 16, 24 or 32 (float)'),
    channels: z.enum(['mono', 'stereo', '5.1', '7.1']).optional(), dither: z.boolean().optional(), asCopy: z.boolean().optional(), copyMedia: z.boolean().optional(), includeMetadata: z.boolean().optional() },
  handler: async (a) => {
    const args = { ...a, path: a.path ? fwd(a.path) : undefined };
    if (a.path) mkdirSync(dirname(a.path), { recursive: true });
    const r: any = await au(SAVE_JSX, args, 600000);
    if (r.kind === 'multitrack') await saveAndWait(r.name);
    await waitNotBusy(r.name).catch(() => undefined);
    const f = r.exported || r.saved;
    if (f && a.path) r.bytes = await waitFileStable(a.path, 120000);
    return r;
  } });

const CLOSE_JSX = `var list = [], i;
if (ARGS.all) { for (i = 0; i < app.documents.length; i++) list.push(app.documents[i]); } else list.push(__adoc(ARGS.document));
var mode = ARGS.mode || 'safe', closed = [], unsaved = [];
var media = [];
if (ARGS.closeMedia && !ARGS.all) { try { var mt = list[0]; if (__isMT(mt)) { var tl = __tlist(mt, false); for (var t = 0; t < tl.length; t++) { var cs = __clist(tl[t]); for (var c = 0; c < cs.length; c++) { try { if (cs[c].link) media.push(cs[c].link.id); } catch (e) {} } } } } catch (e2) {} }
for (i = list.length - 1; i >= 0; i--) {
  var d = list[i], n = d.displayName, dirty = false; try { dirty = d.dirty; } catch (e3) {}
  if (dirty) {
    if (mode === 'save') { if (__isMT(d)) { if (!d.path) { unsaved.push(n + ' (untitled - use au_saveDocument with path)'); continue; } __mtSave(d); } else { try { d.saveDocument(); } catch (e4) { if (!d.path) { unsaved.push(n + ' (untitled)'); continue; } d.saveAs(d.path, false); } } }
    else if (mode === 'discard') { try { d.dirty = false; } catch (e5) {} }
    else { unsaved.push(n); continue; }
  }
  if (d.closeDocument()) closed.push(n); else unsaved.push(n + ' (Audition refused)');
}
for (var m = 0; m < media.length; m++) { for (i = app.documents.length - 1; i >= 0; i--) { var w = app.documents[i]; if (w.id === media[m]) { try { if (!w.dirty) { w.closeDocument(); closed.push(w.displayName); } } catch (e6) {} } } }
return { closed: closed, notClosed: unsaved, open: app.documents.length };`;

tool({ name: 'au_closeDocument', toolset: 'au', destructive: true,
  description: 'Close Audition documents. mode "safe" (default) refuses unsaved documents and lists them, "save" saves first, "discard" closes without saving. all:true closes every document; multitrack sessions keep their media files open unless closeMedia:true.',
  input: { document: zDocAu, all: z.boolean().optional(), mode: z.enum(['safe', 'save', 'discard']).optional(), closeMedia: z.boolean().optional() },
  handler: async (a) => {
    if (a.mode === 'save') {
      const dirty: any = await au(`var o = [], l = []; if (ARGS.all) { for (var i = 0; i < app.documents.length; i++) l.push(app.documents[i]); } else l.push(__adoc(ARGS.document)); for (var k = 0; k < l.length; k++) if (l[k].dirty && l[k].path) o.push(l[k].displayName); return o;`, a);
      for (const n of dirty) await saveAndWait(n);
    }
    const args = { ...a, mode: a.mode === 'save' ? 'safe' : a.mode };
    const r: any = await au(CLOSE_JSX, args);
    // media of a just-closed session is released asynchronously — retry the ones Audition refused
    for (let i = 0; i < 4 && a.all && r.notClosed.some((n: string) => n.endsWith('(Audition refused)')); i++) {
      await sleep(600);
      const again: any = await au(CLOSE_JSX, args);
      r.closed.push(...again.closed); r.notClosed = again.notClosed; r.open = again.open;
    }
    return r;
  } });

/* ---------- tracks ---------- */
jsxTool({ name: 'au_tracks', toolset: 'au', app: 'au',
  description: 'Multitrack tracks (live): list | add (audio or bus tracks — mono/stereo/5.1/7.1, count, names) | remove | rename | mute | unmute | solo | unsolo | arm | disarm | show | hide | select | deselect. For volume, pan, routing to buses, effects and automation use au_mix.',
  input: { document: zDocAu, action: z.enum(['list', 'add', 'remove', 'rename', 'mute', 'unmute', 'solo', 'unsolo', 'arm', 'disarm', 'show', 'hide', 'select', 'deselect']),
    tracks: z.array(z.union([z.string(), z.number().int()])).optional().describe('targets (index/name/"mix"); default: selected or first track'), name: z.string().optional(),
    names: z.array(z.string()).optional().describe('add: names for the new tracks'), kind: z.enum(['audio', 'bus']).optional(), channels: z.enum(['mono', 'stereo', '5.1', '7.1', 'quad']).optional(), count: z.number().int().optional() },
  jsx: `var mt = __mt(ARGS.document), act = ARGS.action, out = [];
function info() { var l = __tlist(mt, false), r = []; for (var i = 0; i < l.length; i++) r.push(__trackInfo(mt, l[i], i + 1, false)); return r; }
if (act === 'list') return info();
if (act === 'add') {
  var n = ARGS.count || (ARGS.names ? ARGS.names.length : 1);
  var type = ARGS.kind === 'bus' ? AudioTrack.AUDIOTRACKTYPE_BUS : AudioTrack.AUDIOTRACKTYPE_CLIP;
  for (var k = 0; k < n; k++) { var t = mt.audioTracks.add(__layout(ARGS.channels || 'stereo'), type); if (ARGS.names && ARGS.names[k]) t.name = ARGS.names[k]; else if (ARGS.name) t.name = n > 1 ? ARGS.name + ' ' + (k + 1) : ARGS.name; out.push(t.name); }
  return { added: out, tracks: info() };
}
var refs = ARGS.tracks && ARGS.tracks.length ? ARGS.tracks : [undefined], ts = [];
for (var r = 0; r < refs.length; r++) ts.push(__trk(mt, refs[r]));
for (var j = 0; j < ts.length; j++) {
  var x = ts[j];
  if (act === 'remove') { if (__tkind(x) === 'mix') throw new Error('The Mix track cannot be removed.'); out.push(x.name); mt.audioTracks.remove(x); continue; }
  if (act === 'rename') { if (!ARGS.name) throw new Error('Pass name.'); x.name = ts.length > 1 ? ARGS.name + ' ' + (j + 1) : ARGS.name; }
  else if (act === 'mute' || act === 'unmute') x.mute = act === 'mute';
  else if (act === 'solo' || act === 'unsolo') x.solo = act === 'solo';
  else if (act === 'arm' || act === 'disarm') x.armed = act === 'arm';
  else if (act === 'show' || act === 'hide') x.visible = act === 'show';
  else if (act === 'select' || act === 'deselect') x.selected = act === 'select';
  out.push(x.name);
}
return { action: act, tracks: out, now: info() };` });

/* ---------- clips ---------- */
jsxTool({ name: 'au_clips', toolset: 'au', app: 'au', timeoutMs: 600000,
  description: 'Multitrack clips (live): list | add (insert audio/video files as clips on a track at a time; sequential:true places them one after another; files are opened in Audition if needed) | move (to time, or by delta seconds, optionally to another track) | remove | select | deselect | clearSelection. For trimming, splitting, fades, clip gain/pan, clip effects use au_mix.',
  input: { document: zDocAu, action: z.enum(['list', 'add', 'move', 'remove', 'select', 'deselect', 'clearSelection']), track: zTrackAu.optional(), clip: zClipAu.optional(), clips: z.array(zClipAu).optional(),
    files: z.array(z.string()).optional(), time: z.number().optional().describe('seconds on the session timeline'), delta: z.number().optional().describe('move by seconds (+/-)'), toTrack: zTrackAu.optional(),
    sequential: z.boolean().optional(), gap: z.number().optional().describe('seconds between sequential clips'), sourceChannels: z.array(z.number().int()).optional().describe('source channel routing, e.g. [0,1] or [0] for left only') },
  before: (a) => ({ ...a, files: a.files ? a.files.map(fwd) : undefined }),
  jsx: `var mt = __mt(ARGS.document), act = ARGS.action;
if (act === 'clearSelection') { mt.audioClipSelection.clear(); return { cleared: true }; }
if (act === 'list') {
  var res = [], l = ARGS.track !== undefined ? [__trk(mt, ARGS.track)] : __tlist(mt, false);
  for (var i = 0; i < l.length; i++) { if (__tkind(l[i]) !== 'audio') continue; var cs = __clist(l[i]), cl = []; for (var c = 0; c < cs.length; c++) cl.push(__clipInfo(mt, cs[c], c)); res.push({ track: l[i].name, clips: cl }); }
  return res;
}
var t = __trk(mt, ARGS.track);
if (act === 'add') {
  if (!ARGS.files || !ARGS.files.length) throw new Error('Pass files.');
  var at = Number(ARGS.time || 0), added = [];
  for (var f = 0; f < ARGS.files.length; f++) {
    var p = ARGS.files[f], src = null;
    for (var k = 0; k < app.documents.length; k++) { var d = app.documents[k]; if (__isWave(d) && d.path && __np(d.path) === __np(p)) { src = d; break; } }
    if (!src) { if (!new File(p).exists) throw new Error('File not found: ' + p); src = app.openDocument(new DocumentOpenParameter(p)); }
    if (!src) throw new Error('Could not open ' + p);
    var clip = ARGS.sourceChannels ? t.audioClips.add(src, ARGS.sourceChannels) : t.audioClips.add(src);
    if (!clip) throw new Error('Audition refused to add ' + p + ' (sample rate / channel mismatch?)');
    clip.startTime = __smp(mt, at);
    added.push({ name: clip.name, start: __sec(mt, clip.startTime), end: __sec(mt, clip.startTime + clip.duration) });
    if (ARGS.sequential) at = __sec(mt, clip.startTime + clip.duration) + Number(ARGS.gap || 0);
  }
  try { mt.activate(); } catch (e) {}
  return { track: t.name, added: added };
}
var refs = ARGS.clips && ARGS.clips.length ? ARGS.clips : [ARGS.clip !== undefined ? ARGS.clip : 1], targets = [];
for (var r = 0; r < refs.length; r++) targets.push(__clp(mt, t, refs[r]));
var out = [];
for (var j = 0; j < targets.length; j++) {
  var x = targets[j];
  if (act === 'move') {
    var ns = ARGS.time !== undefined ? __smp(mt, ARGS.time) + (j ? targets[j].startTime - targets[0].startTime : 0) : x.startTime + __smp(mt, ARGS.delta || 0);
    if (ns < 0) ns = 0;
    if (ARGS.toTrack !== undefined) {
      var tt = __trk(mt, ARGS.toTrack), lk = x.link; if (!lk) throw new Error('Clip has no linked file; cannot move across tracks.');
      var nc = tt.audioClips.add(lk, x.sourceChannelRouting); nc.startTime = ns; t.audioClips.remove(x); out.push({ name: nc.name, track: tt.name, start: __sec(mt, ns) }); continue;
    }
    x.startTime = ns; out.push({ name: x.name, start: __sec(mt, x.startTime) });
  } else if (act === 'remove') { out.push(x.name); t.audioClips.remove(x); }
  else if (act === 'select') { mt.audioClipSelection.add(x); out.push(x.name); }
  else if (act === 'deselect') { mt.audioClipSelection.remove(x); out.push(x.name); }
}
return { action: act, track: t.name, clips: out };` });

/* ---------- markers ---------- */
tool({ name: 'au_markers', toolset: 'au',
  description: 'Markers of a waveform or multitrack document: list | add (point or range markers: time, duration, name, type cue/cd/cart/subclip, description) | exportCsv (writes name,start,duration,type,description). Delete/rename markers with au_command (e.g. Edit.DeleteAllMarkers) or in the Markers panel.',
  input: { document: zDocAu, action: z.enum(['list', 'add', 'exportCsv']), markers: z.array(z.object({ time: z.number(), duration: z.number().optional(), name: z.string().optional(), type: z.enum(['cue', 'cd', 'cart', 'subclip']).optional(), description: z.string().optional() })).optional(), path: z.string().optional() },
  handler: async (a) => {
    if (a.action === 'add') {
      if (!a.markers?.length) throw new Error('Pass markers.');
      return au(`var d = __adoc(ARGS.document), n = 0; for (var i = 0; i < ARGS.markers.length; i++) { var m = ARGS.markers[i]; if (d.addMarker(__smp(d, m.time), __smp(d, m.duration || 0), m.name || ('Marker ' + (i + 1)), m.type || 'cue', m.description || '')) n++; } return { added: n, markers: __markers(d) };`, a);
    }
    const list: any[] = await au(`return __markers(__adoc(ARGS.document));`, a) as any[];
    if (a.action === 'list') return list;
    if (!a.path) throw new Error('Pass path for the CSV.');
    const esc = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    writeFileSync(a.path, 'name,start,duration,type,description\n' + list.map((m) => [esc(m.name), m.start, m.duration, m.type, esc(m.description)].join(',')).join('\n'), 'utf8');
    return { written: a.path, count: list.length };
  } });

/* ---------- transport ---------- */
jsxTool({ name: 'au_transport', toolset: 'au', app: 'au',
  description: 'Transport: play | stop | pause | record | seek (move the playhead to time seconds) | loop (on/off) | status.',
  input: { action: z.enum(['play', 'stop', 'pause', 'record', 'seek', 'loop', 'status']), time: z.number().optional(), on: z.boolean().optional(), document: zDocAu },
  jsx: `var t = app.transport, a = ARGS.action;
if (a === 'seek') { var d = __adoc(ARGS.document); d.playheadPosition = __smp(d, ARGS.time || 0); }
else if (a === 'loop') t.loop = ARGS.on !== false;
else if (a === 'play') t.play(); else if (a === 'stop') t.stop(); else if (a === 'pause') t.pause(); else if (a === 'record') t.record();
var o = { playing: t.isPlaying, recording: t.isRecording, paused: t.isPaused, loop: t.loop };
try { var x = app.activeDocument; if (x) o.playhead = __sec(x, x.playheadPosition); } catch (e) {}
return o;` });

/* ---------- favorites ---------- */
tool({ name: 'au_favorites', toolset: 'au',
  description: 'Audition Favorites (one-click processes: Normalize, Hard Limit, Remove Hum, De-Noise, Fade In/Out, Convert to Mono/5.1, your own recorded favorites…): list them, or apply one to a waveform document (or a file path, opened first; save:true saves afterwards). Whole file, or the current time selection if one is set in the editor.',
  input: { action: z.enum(['list', 'apply']), name: z.string().optional(), document: zDocAu, path: z.string().optional(), save: z.boolean().optional() },
  handler: async (a) => {
    if (a.action === 'list') return readFavorites();
    if (!a.name) throw new Error('Pass name (see action list).');
    let doc = a.document;
    if (a.path) { const r: any = await au(`var d = app.openDocument(new DocumentOpenParameter(ARGS.p)); d.activate(); return d.displayName;`, { p: fwd(a.path) }); doc = r; }
    const r: any = await au(`var d = __wv(ARGS.document); d.activate(); var ok = d.applyFavorite(ARGS.name); if (!ok) throw new Error('Favorite failed or not found: ' + ARGS.name); return d.displayName;`, { document: doc, name: a.name }, 600000);
    await waitNotBusy(r);
    const out: any = { applied: a.name, document: r };
    if (a.save) out.saved = await au(`var d = __adoc(ARGS.d); try { d.saveDocument(); } catch (e) { d.saveAs(d.path, false); } return d.path;`, { d: r });
    return out;
  } });

/* ---------- commands ---------- */
tool({ name: 'au_command', toolset: 'au',
  description: 'Run ANY Audition menu command (~610: File, Edit, Multitrack, Clip, Effects, Favorites, View, Window, Transport…) by id ("Multitrack.MixdownAllToNewFile", "Effects.Normalize", "Edit.SelectAll") or constant ("COMMAND_CLIP_SPLIT"). action list (filter) shows ids with enabled/checked state. Commands that open a dialog return immediately; the dialog text and buttons are reported (answer with adobe_dialogs).',
  input: { action: z.enum(['list', 'run', 'status']), command: z.string().optional(), filter: z.string().optional(), document: zDocAu, waitSec: z.number().optional().describe('run: seconds to wait before checking for a dialog (default 1.5)') },
  handler: async (a) => {
    if (a.action === 'list') return au(`var r = Application.reflect.properties, o = [], f = String(ARGS.filter || '').toLowerCase();
for (var i = 0; i < r.length; i++) { var n = r[i].name; if (n.indexOf('COMMAND_') !== 0) continue; var v = Application[n]; if (f && (n + ' ' + v).toLowerCase().indexOf(f) < 0) continue; var e = null; try { e = app.isCommandEnabled(v); } catch (x) {} o.push(v + (e === false ? ' (disabled)' : '')); }
return { count: o.length, commands: o };`, a);
    if (!a.command) throw new Error('Pass command.');
    const body = `var c = String(ARGS.command); if (/^(COMMAND_)?[A-Z0-9_]+$/.test(c)) { var k = c.indexOf('COMMAND_') === 0 ? c : 'COMMAND_' + c; if (Application[k] === undefined) throw new Error('Unknown command ' + c); c = Application[k]; }
if (ARGS.document) { try { __adoc(ARGS.document).activate(); } catch (e) {} }
var en = app.isCommandEnabled(c), ch = null; try { ch = app.isCommandChecked(c); } catch (e2) {}
if (ARGS.action === 'status') return { command: c, enabled: en, checked: ch };
if (!en) throw new Error('Command is disabled right now: ' + c + ' (needs a document / selection / different editor view?)');
return { command: c, invoked: app.invokeCommand(c) };`;
    const r: any = await au(body, a);
    if (a.action === 'run') {
      await sleep((a.waitSec ?? 1.5) * 1000);
      const ds = await listDialogs('au');
      if (ds.length) r.dialog = ds.map(describeDialog);
    }
    return r;
  } });

jsxTool({ name: 'au_preferences', toolset: 'au', app: 'au',
  description: 'Read or write Audition local preferences by key (bool / number / string).',
  input: { action: z.enum(['get', 'set']), key: z.string(), type: z.enum(['bool', 'number', 'string']).optional(), value: z.union([z.string(), z.number(), z.boolean()]).optional() },
  jsx: `var p = app.localPreferences, t = ARGS.type || (typeof ARGS.value === 'boolean' ? 'bool' : typeof ARGS.value === 'number' ? 'number' : 'string');
if (ARGS.action === 'set') { var ok = t === 'bool' ? p.setBoolValue(ARGS.key, !!ARGS.value) : t === 'number' ? p.setNumberValue(ARGS.key, Number(ARGS.value)) : p.setStringValue(ARGS.key, String(ARGS.value)); return { key: ARGS.key, set: ok }; }
var v = null; try { v = t === 'bool' ? p.getBoolValue(ARGS.key) : t === 'number' ? p.getNumberValue(ARGS.key) : p.getStringValue(ARGS.key); } catch (e) { return { key: ARGS.key, type: t, value: null, note: 'not set (or stored with another type)' }; }
return { key: ARGS.key, type: t, value: v };` });

jsxTool({ name: 'au_panner', toolset: 'au', app: 'au',
  description: 'Session panning law: mode "minusXdbCenter" with centerGain (e.g. -3 dB) or "logarithmic" — or read it.',
  input: { document: zDocAu, mode: z.enum(['minusXdbCenter', 'logarithmic']).optional(), centerGain: z.number().optional() },
  jsx: `var mt = __mt(ARGS.document), p = mt.pannerSettings;
if (ARGS.mode) p.mode = ARGS.mode === 'logarithmic' ? PannerSettings.MODE_LOGARITHMICCUT : PannerSettings.MODE_MINUSXDBCENTER;
if (ARGS.centerGain !== undefined) p.gain = Number(ARGS.centerGain);
return { mode: p.mode === PannerSettings.MODE_LOGARITHMICCUT ? 'logarithmic' : 'minusXdbCenter', centerGain: p.mode === PannerSettings.MODE_LOGARITHMICCUT ? null : p.gain };` });

/* ---------- mixdown / export ---------- */
const MIX_CMD: Record<string, string> = { all: 'Multitrack.MixdownAllToNewFile', selection: 'Multitrack.MixdownSelectionToNewFile', selectedClips: 'Multitrack.MixdownSelectedClipsToNewFile' };

/** Mixes a session down to a new waveform document; returns its display name. */
export async function mixdownToDoc(document: string | undefined, what: 'all' | 'selection' | 'selectedClips' = 'all', timeoutMs = 3600000): Promise<{ name: string; session: string }> {
  const s: any = await au(`var mt = __mt(ARGS.document); mt.activate(); var ids = []; for (var i = 0; i < app.documents.length; i++) ids.push(app.documents[i].id);
if (!app.isCommandEnabled(ARGS.cmd)) throw new Error(ARGS.what === 'all' ? 'Mixdown is not available (empty session?)' : 'Nothing to mix down: set a time selection / select clips first.');
app.invokeCommand(ARGS.cmd); return { ids: ids, session: mt.displayName };`, { document, cmd: MIX_CMD[what], what });
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await sleep(500);
    const r: any = await au(`for (var i = 0; i < app.documents.length; i++) { var d = app.documents[i]; var known = false; for (var k = 0; k < ARGS.ids.length; k++) if (ARGS.ids[k] === d.id) known = true; if (!known && __isWave(d)) { var b = false; try { b = d.isBusy; } catch (e) {} return { name: d.displayName, busy: b }; } } return null;`, { ids: s.ids }, 30000);
    if (r && !r.busy) return { name: r.name, session: s.session };
    const ds = await listDialogs('au');
    if (ds.length) throw new Error('Audition shows a dialog during mixdown: ' + ds.map(describeDialog).join(' | '));
  }
  throw new Error('Mixdown did not finish in time.');
}

export async function exportWaveDoc(doc: string, path: string, o: { format?: string; mp3Kbps?: number; sampleRate?: number; bitDepth?: number; channels?: string; dither?: boolean; includeMetadata?: boolean }) {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) rmSync(path, { force: true });
  await au(`var d = __adoc(ARGS.d); var ep = new WaveDocumentExportParameters(); var ext = String(ARGS.path).replace(/^.*\\./, '');
var f = __fileFormat(ARGS.format || ext, ARGS.mp3Kbps); if (f) ep.fileFormat = f; var st = __stc(ARGS); if (st) ep.sampleTypeConversion = st; ep.includeMetadata = ARGS.includeMetadata !== false;
d.exportDocument(ARGS.path, ep); return true;`, { ...o, d: doc, path: fwd(path) }, 600000);
  await waitNotBusy(doc);
  return waitFileStable(path, 600000);
}

export async function closeDoc(doc: string) {
  return au(`return __discard(__adoc(ARGS.d));`, { d: doc }).catch(() => false);
}

/** ffmpeg EBU R128 analysis */
export async function analyzeLoudness(file: string) {
  const ff = await ensureFfmpeg();
  const r = await run(ff, ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], 1800000);
  const s = r.err.slice(r.err.lastIndexOf('Summary:'));
  const g = (rx: RegExp) => { const m = s.match(rx); return m ? Number(m[1]) : null; };
  return { integratedLufs: g(/I:\s+(-?[\d.]+) LUFS/), loudnessRange: g(/LRA:\s+(-?[\d.]+) LU/), truePeakDbtp: g(/Peak:\s+(-?[\d.]+) dBFS/) };
}

export async function loudnormFile(input: string, output: string, targetLufs: number, truePeak: number, extra: string[] = []) {
  // Static gain to the target + 4x-oversampled peak limiter at the true-peak ceiling (dynamics untouched below it),
  // then re-measure and correct once — exact integrated loudness even for short or peaky material (ffmpeg loudnorm is not).
  const ff = await ensureFfmpeg();
  const m = await analyzeLoudness(input);
  if (m.integratedLufs === null || !Number.isFinite(m.integratedLufs)) throw new Error('Could not measure loudness (silent file?)');
  const sr = (await probe(input)).sampleRate || 48000;
  const ceiling = Math.pow(10, (truePeak - 0.3) / 20);
  const render = async (gainDb: number) => {
    const af = `highpass=f=5,aresample=${sr * 4},volume=${gainDb.toFixed(3)}dB,alimiter=limit=${ceiling.toFixed(5)}:attack=1:release=60:level=false,aresample=${sr}`;
    const r = await run(ff, ['-y', '-hide_banner', '-i', input, '-af', af, ...extra, output], 1800000);
    if (r.code !== 0) throw new Error('ffmpeg loudness render failed: ' + r.err.slice(-500));
    return analyzeLoudness(output);
  };
  let gain = targetLufs - m.integratedLufs;
  let after = await render(gain);
  for (let i = 0; i < 2 && after.integratedLufs !== null && Math.abs(after.integratedLufs - targetLufs) > 0.3; i++) { gain += targetLufs - after.integratedLufs; after = await render(gain); }
  return { measured: m, gainDb: Math.round(gain * 100) / 100 };
}

export async function probe(file: string): Promise<{ sampleRate: number; channels: number; duration: number; codec: string; bitDepth: number | null }> {
  const fp = await ensureFfprobe();
  const r = await run(fp, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels,codec_name,bits_per_raw_sample,bits_per_sample:format=duration', '-of', 'json', file], 60000);
  try {
    const j = JSON.parse(r.out); const st = (j.streams || [])[0] || {};
    return { sampleRate: Number(st.sample_rate), channels: Number(st.channels), duration: Number(j.format?.duration), codec: st.codec_name, bitDepth: Number(st.bits_per_raw_sample || st.bits_per_sample) || null };
  } catch { throw new Error('ffprobe could not read ' + file); }
}

function codecArgs(path: string, o: { mp3Kbps?: number; sampleRate?: number; bitDepth?: number }) {
  const ext = extname(path).slice(1).toLowerCase();
  const a: string[] = [];
  if (ext === 'mp3') a.push('-c:a', 'libmp3lame', '-b:a', `${o.mp3Kbps || 320}k`);
  else if (ext === 'wav') a.push('-c:a', o.bitDepth === 16 ? 'pcm_s16le' : o.bitDepth === 32 ? 'pcm_f32le' : 'pcm_s24le');
  else if (ext === 'flac') a.push('-c:a', 'flac');
  else if (ext === 'm4a' || ext === 'aac') a.push('-c:a', 'aac', '-b:a', '320k');
  else if (ext === 'aif' || ext === 'aiff') a.push('-c:a', o.bitDepth === 16 ? 'pcm_s16be' : 'pcm_s24be');
  if (o.sampleRate) a.push('-ar', String(o.sampleRate));
  return a;
}

export const zExportOpts = {
  format: zFormat.optional().describe('default: from the path extension'), mp3Kbps: z.number().optional().describe('mp3 bitrate (e.g. 320)'), sampleRate: z.number().int().optional(), bitDepth: z.number().int().optional(),
  channels: z.enum(['mono', 'stereo', '5.1', '7.1']).optional(), dither: z.boolean().optional(),
  range: z.object({ start: z.number(), end: z.number() }).optional().describe('only this part of the timeline (seconds)'),
  loudness: z.object({ targetLufs: z.number(), truePeak: z.number().optional() }).optional().describe('normalize the result, e.g. {targetLufs:-14, truePeak:-1} for YouTube'),
};

/** export a waveform doc to path, with optional range trim and loudness normalization (ffmpeg post-pass) */
export async function renderDoc(doc: string, path: string, a: any) {
  const post = !!(a.range || a.loudness);
  if (!post) { const bytes = await exportWaveDoc(doc, path, a); return { file: path, bytes }; }
  const tmp = join(RUNTIME_DIR, 'au-tmp', `render-${randomUUID()}.wav`);
  await exportWaveDoc(doc, tmp, { bitDepth: 32, sampleRate: a.sampleRate, channels: a.channels });
  let src = tmp;
  if (a.range) {
    const ff = await ensureFfmpeg(); const cut = tmp.replace(/\.wav$/, '-cut.wav');
    const r = await run(ff, ['-y', '-hide_banner', '-i', tmp, '-ss', String(a.range.start), '-to', String(a.range.end), '-c:a', 'pcm_f32le', cut], 600000);
    if (r.code !== 0) throw new Error('ffmpeg trim failed: ' + r.err.slice(-400));
    src = cut;
  }
  mkdirSync(dirname(path), { recursive: true });
  let measured: any = null;
  if (a.loudness) measured = (await loudnormFile(src, path, a.loudness.targetLufs, a.loudness.truePeak ?? -1, codecArgs(path, a))).measured;
  else { const ff = await ensureFfmpeg(); const r = await run(ff, ['-y', '-hide_banner', '-i', src, ...codecArgs(path, a), path], 600000); if (r.code !== 0) throw new Error('ffmpeg encode failed: ' + r.err.slice(-400)); }
  for (const f of [tmp, tmp.replace(/\.wav$/, '-cut.wav')]) rmSync(f, { force: true });
  return { file: path, bytes: statSync(path).size, before: measured, after: a.loudness ? await analyzeLoudness(path) : undefined };
}

tool({ name: 'au_mixdown', toolset: 'au',
  description: 'Export the mix of a multitrack session to an audio file in one call (File > Export > Multitrack Mixdown, no dialogs): what = all (whole session), selection (current time selection) or selectedClips. Any format/bitrate/sample rate/bit depth/channels (stereo or 5.1 for surround mixes), optional range and loudness normalization (e.g. -14 LUFS / -1 dBTP for YouTube). keepOpen:true leaves the mixdown open as a waveform document.',
  input: { document: zDocAu, path: z.string(), what: z.enum(['all', 'selection', 'selectedClips']).optional(), keepOpen: z.boolean().optional(), analyze: z.boolean().optional().describe('report loudness (LUFS, true peak) of the result'), ...zExportOpts },
  handler: async (a) => {
    const m = await mixdownToDoc(a.document, a.what || 'all');
    try {
      const r: any = await renderDoc(m.name, a.path, a);
      if (a.analyze && !r.after) r.loudness = await analyzeLoudness(a.path);
      return { session: m.session, mixdown: m.name, ...r, keptOpen: !!a.keepOpen };
    } finally { if (!a.keepOpen) await closeDoc(m.name); }
  } });

jsxTool({ name: 'au_exportSession', toolset: 'au', app: 'au', timeoutMs: 1800000,
  description: 'Export a multitrack session: kind "session" (save a copy as .sesx, optionally copying all media next to it — archive / hand-off), "template" (session template by name), "omf" or "fcpxml" (exchange with Pro Tools / Premiere / Resolve).',
  input: { document: zDocAu, kind: z.enum(['session', 'template', 'omf', 'fcpxml']), path: z.string().optional(), name: z.string().optional().describe('template name'), copyMedia: z.boolean().optional(), includeMetadata: z.boolean().optional(), encapsulate: z.boolean().optional().describe('omf: embed media'), overwrite: z.boolean().optional() },
  before: (a) => ({ ...a, path: a.path ? fwd(a.path) : undefined }),
  jsx: `var mt = __mt(ARGS.document), k = ARGS.kind;
if (k === 'template') { var tp = new MultitrackExportAsTemplateParameter(); tp.includeMetadata = ARGS.includeMetadata !== false; tp.overwriteFiles = !!ARGS.overwrite; mt.exportAsTemplate(ARGS.name || mt.displayName, tp); return { template: ARGS.name || mt.displayName }; }
if (!ARGS.path) throw new Error('Pass path.');
var p;
if (k === 'omf') { p = new OMFExportParameter(); p.encapsulate = !!ARGS.encapsulate; }
else if (k === 'fcpxml') { p = new FCPXMLExportParameter(); p.includeMetadata = ARGS.includeMetadata !== false; p.copyReferencedDocuments = !!ARGS.copyMedia; }
else { p = new MultitrackExportParameter(); p.includeMetadata = ARGS.includeMetadata !== false; p.copyReferencedDocuments = !!ARGS.copyMedia; }
mt.exportDocument(ARGS.path, p);
return { exported: ARGS.path, kind: k };` });

/* ---------- reflection ---------- */
jsxTool({ name: 'au_dictionary', toolset: 'au', app: 'au', readOnly: true,
  description: 'Introspect Audition\'s live scripting DOM (for adobe_runScript work): no class → list every class; with class → its properties, methods and constants with help text.',
  input: { class: z.string().optional(), filter: z.string().optional() },
  jsx: `var g = $.dictionary.getGroups(), cls = $.dictionary.getClasses(g[0].length ? g[0] : ''), names = [];
for (var i = 0; i < cls.length; i++) names.push(String(cls[i]).split('\\t')[0]);
if (!ARGS['class']) { var f = String(ARGS.filter || '').toLowerCase(), o = []; for (var j = 0; j < names.length; j++) if (!f || names[j].toLowerCase().indexOf(f) >= 0) o.push(names[j]); return o; }
var cn = ARGS['class'], r = $.dictionary.getClass(cn); if (!r) throw new Error('No class ' + cn);
function h(x) { try { return x.description || x.help || ''; } catch (e) { return ''; } }
function args(m) { var a = []; try { for (var k = 0; k < m.arguments.length; k++) a.push(m.arguments[k].name + ':' + m.arguments[k].dataType); } catch (e) {} return a.join(', '); }
var out = { name: cn, help: h(r), constants: [], staticMethods: [], properties: [], methods: [] }, flt = String(ARGS.filter || '').toUpperCase();
for (var a = 0; a < r.staticProperties.length; a++) { var sp = r.staticProperties[a].name; if (!flt || sp.indexOf(flt) >= 0) out.constants.push(sp); }
for (var b = 0; b < r.staticMethods.length; b++) out.staticMethods.push(r.staticMethods[b].name + '(' + args(r.staticMethods[b]) + ')');
for (var c = 0; c < r.properties.length; c++) { var p = r.properties[c]; out.properties.push(p.name + ':' + p.dataType + (p.type === 'readonly' ? ' (ro)' : '') + (h(p) ? ' — ' + h(p) : '')); }
for (var d = 0; d < r.methods.length; d++) { var m = r.methods[d]; out.methods.push(m.name + '(' + args(m) + ')' + (m.dataType ? ':' + m.dataType : '') + (h(m) ? ' — ' + h(m) : '')); }
if (out.constants.length > 300) out.constants = out.constants.slice(0, 300).concat(['… use filter']);
return out;` });

