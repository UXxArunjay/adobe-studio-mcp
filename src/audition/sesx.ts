/**
 * SESX engine â€” reads and edits Adobe Audition multitrack session files (.sesx, XML).
 * Covers what Audition's scripting DOM cannot reach: track/clip volume, pan, mute, solo, routing, fades, clip gain,
 * volume/pan automation (keyframes), effects racks (any built-in effect, VST/VST3 plug-in, factory presets,
 * your own effects-rack presets with exact plug-in state), session playhead/selection.
 * Units: seconds and dB in the API; samples / linear gain inside the file. Formats verified against Audition 26.3.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { resolveEffect, readRackPresets, RackSlot, effectName } from './library.js';
import { AU_BUILTIN_EFFECTS, AU_EFFECT_ALIASES } from './effects-data.js';

type El = any;
const kids = (n: El, tag?: string): El[] => { const o: El[] = []; for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && (!tag || c.tagName === tag)) o.push(c); return o; };
const kid = (n: El, tag: string): El | null => kids(n, tag)[0] || null;
const num = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
export const dbToLin = (db: number) => Math.pow(10, db / 20);
export const linToDb = (v: number) => (v <= 0 ? -Infinity : Math.round(2000 * Math.log10(v)) / 100);

export type TrackRef = string | number;
export type ClipRef = string | number | { at: number };

export interface FadeSpec { duration: number; type?: 'log' | 'linear' | 'cosine'; curve?: number }
export interface Keyframe { time: number; value: number }

export class Sesx {
  doc: El;
  path: string;
  constructor(xml: string, path = '') {
    this.path = path;
    this.doc = new DOMParser().parseFromString(xml.replace(/^\uFEFF/, ''), 'text/xml');
    if (!this.session) throw new Error('Not an Audition session (.sesx): ' + path);
  }
  static load(path: string) {
    if (!existsSync(path)) throw new Error('Session file not found: ' + path);
    return new Sesx(readFileSync(path, 'utf8'), path);
  }
  save(path = this.path, backup = true) {
    if (backup && existsSync(path) && !existsSync(path + '.mcpbak')) copyFileSync(path, path + '.mcpbak');
    let xml = new XMLSerializer().serializeToString(this.doc);
    if (!xml.startsWith('<?xml')) xml = '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n' + xml;
    writeFileSync(path, xml, 'utf8');
    return path;
  }

  get root(): El { return this.doc.documentElement; }
  get session(): El { return this.root ? kid(this.root, 'session') : null; }
  get sampleRate(): number { return num(this.session.getAttribute('sampleRate'), 48000); }
  smp(sec: number) { return Math.round(sec * this.sampleRate); }
  sec(smp: number | string) { return Math.round((num(smp) / this.sampleRate) * 1e6) / 1e6; }

  /* ---------- tracks ---------- */
  get tracksEl(): El { return kid(this.session, 'tracks'); }
  /** audio tracks, then bus tracks (each in display order), then the master (Mix) track — the same numbering Audition's scripting DOM uses (au_tracks / au_clips) */
  tracks(): El[] {
    const by = (a: El, b: El) => num(a.getAttribute('index')) - num(b.getAttribute('index'));
    return [...kids(this.tracksEl, 'audioTrack').sort(by), ...kids(this.tracksEl, 'busTrack').sort(by), ...kids(this.tracksEl, 'masterTrack')];
  }
  trackName(t: El) { const p = kid(t, 'trackParameters'); const n = p && kid(p, 'name'); return n ? n.textContent : ''; }
  track(ref: TrackRef): El {
    const all = this.tracks();
    if (typeof ref === 'number' || /^\d+$/.test(String(ref))) {
      const n = Number(ref); const list = all.filter((t) => t.tagName !== 'masterTrack');
      if (n < 1 || n > list.length) throw new Error(`Track ${n} does not exist (session has ${list.length} tracks).`);
      return list[n - 1];
    }
    const s = String(ref);
    if (/^(master|mix)$/i.test(s)) { const m = all.find((t) => t.tagName === 'masterTrack'); if (m) return m; }
    if (/^id:/i.test(s)) { const t = all.find((x) => x.getAttribute('id') === s.slice(3)); if (t) return t; }
    const t = all.find((x) => this.trackName(x) === s) || all.find((x) => this.trackName(x).toLowerCase() === s.toLowerCase());
    if (!t) throw new Error(`Track not found: "${s}". Tracks: ${all.map((x) => this.trackName(x)).join(', ')}`);
    return t;
  }
  private tap(t: El): El { const a = kid(t, 'trackAudioParameters'); if (!a) throw new Error('Malformed track (no trackAudioParameters)'); return a; }
  component(parent: El, id: string): El | null { return kids(parent, 'component').find((c) => c.getAttribute('id') === id) || null; }
  param(comp: El, ref: string | number): El | null {
    const ps = kids(comp, 'parameter');
    if (typeof ref === 'number') return ps.find((p) => num(p.getAttribute('index'), -1) === ref) || null;
    return ps.find((p) => p.getAttribute('name') === ref) || ps.find((p) => (p.getAttribute('name') || '').toLowerCase() === String(ref).toLowerCase()) || null;
  }
  private ensureParam(comp: El, index: number, name: string | null, value: number) {
    let p = this.param(comp, index);
    if (!p) { p = this.doc.createElement('parameter'); p.setAttribute('index', String(index)); if (name) p.setAttribute('name', name); comp.appendChild(p); }
    p.setAttribute('parameterValue', String(value));
    return p;
  }
  private ensureComp(parent: El, id: string, componentID: string, name: string, params: [number, string | null, number][], before?: El | null) {
    let c = this.component(parent, id);
    if (!c) {
      c = this.doc.createElement('component');
      c.setAttribute('componentGuid', randomUUID()); c.setAttribute('componentID', componentID); c.setAttribute('id', id); c.setAttribute('name', name); c.setAttribute('powered', 'true');
      for (const [i, n, v] of params) this.ensureParam(c, i, n, v);
      if (before) parent.insertBefore(c, before); else parent.appendChild(c);
    }
    return c;
  }
  private faderOf(parent: El, id: string) { return this.ensureComp(parent, id, 'Audition.Fader', 'volume', [[0, 'volume', 1], [1, 'static gain', 1]]); }
  private muteOf(parent: El, id: string) { return this.ensureComp(parent, id, 'Audition.Mute', 'Mute', [[0, null, 0], [1, 'mute', 0]]); }
  private panOf(parent: El, id: string) {
    const c = this.component(parent, id);
    if (c && c.getAttribute('componentID') !== 'Audition.StereoPanner') return null; // surround / output panner: not a simple L-R pan
    return this.ensureComp(parent, id, 'Audition.StereoPanner', 'StereoPanner', [[0, 'Pan', 0]]);
  }

  trackInfo(t: El, deep = true) {
    const a = this.tap(t);
    const fader = this.component(a, 'trackFader'), mute = this.component(a, 'trackMute'), pan = this.component(a, 'trackPan');
    const out = kid(a, 'trackOutput');
    const o: any = {
      index: t.tagName === 'masterTrack' ? 'master' : this.tracks().filter((x) => x.tagName !== 'masterTrack').indexOf(t) + 1,
      id: Number(t.getAttribute('id')), name: this.trackName(t), kind: t.tagName.replace('Track', ''), channels: a.getAttribute('audioChannelType'),
      volumeDb: fader ? linToDb(num(this.param(fader, 'volume')?.getAttribute('parameterValue'), 1)) : 0,
      mute: mute ? num(this.param(mute, 'mute')?.getAttribute('parameterValue')) > 0.5 : false,
      solo: a.getAttribute('solo') === 'true', armed: a.getAttribute('recordArmed') === 'true', visible: t.getAttribute('visible') !== 'false',
      output: out ? (out.getAttribute('type') === 'trackID' ? this.trackNameById(out.getAttribute('outputID')) : 'hardware ' + out.getAttribute('outputID')) : null,
    };
    if (pan && pan.getAttribute('componentID') === 'Audition.StereoPanner') o.pan = Math.round(num(this.param(pan, 0)?.getAttribute('parameterValue')) * 100);
    else if (pan) o.panner = pan.getAttribute('componentID');
    const vk = fader && this.keyframesOf(this.param(fader, 'volume'));
    if (vk && vk.length) o.volumeAutomation = vk.map((k: { offset: number; value: number }) => ({ time: this.sec(k.offset), db: linToDb(k.value) }));
    const rack = kid(t, 'effectsRack');
    if (rack) o.effects = this.rackInfo(rack, deep);
    if (t.tagName === 'audioTrack') o.clips = this.clips(t).map((c, i) => this.clipInfo(c, i, deep));
    return o;
  }
  private trackNameById(id: string) { const t = this.tracks().find((x) => x.getAttribute('id') === id); return t ? this.trackName(t) : 'track ' + id; }

  /* ---------- clips ---------- */
  clips(t: El): El[] { return kids(t, 'audioClip').sort((a, b) => num(a.getAttribute('startPoint')) - num(b.getAttribute('startPoint'))); }
  clip(t: El, ref: ClipRef): El {
    const cs = this.clips(t);
    if (typeof ref === 'object' && ref && 'at' in ref) {
      const s = this.smp(ref.at); const c = cs.find((x) => num(x.getAttribute('startPoint')) <= s && num(x.getAttribute('endPoint')) > s);
      if (!c) throw new Error(`No clip at ${ref.at}s on track ${this.trackName(t)}`); return c;
    }
    if (typeof ref === 'number' || /^\d+$/.test(String(ref))) { const n = Number(ref); if (n < 1 || n > cs.length) throw new Error(`Clip ${n} not on track ${this.trackName(t)} (${cs.length} clips)`); return cs[n - 1]; }
    const s = String(ref);
    const c = (/^id:/i.test(s) ? cs.find((x) => x.getAttribute('id') === s.slice(3)) : null) || cs.find((x) => x.getAttribute('name') === s) || cs.find((x) => (x.getAttribute('name') || '').toLowerCase() === s.toLowerCase());
    if (!c) throw new Error(`Clip "${s}" not on track ${this.trackName(t)}. Clips: ${cs.map((x) => x.getAttribute('name')).join(', ')}`);
    return c;
  }
  fileOf(fileId: string) { const f = kids(kid(this.root, 'files') || this.root, 'file').find((x) => x.getAttribute('id') === fileId); return f ? f.getAttribute('absolutePath') : null; }
  clipInfo(c: El, i: number, deep = true) {
    const start = num(c.getAttribute('startPoint')), end = num(c.getAttribute('endPoint'));
    const gain = this.component(c, 'clipGain'), mute = this.component(c, 'clipMute'), pan = this.component(c, 'clipPan');
    const fi = kid(c, 'fadeIn'), fo = kid(c, 'fadeOut');
    const o: any = {
      index: i + 1, id: Number(c.getAttribute('id')), name: c.getAttribute('name'), file: this.fileOf(c.getAttribute('fileID')),
      start: this.sec(start), end: this.sec(end), duration: this.sec(end - start),
      sourceIn: this.sec(c.getAttribute('sourceInPoint')), sourceOut: this.sec(c.getAttribute('sourceOutPoint')),
      gainDb: gain ? linToDb(num(this.param(gain, 'volume')?.getAttribute('parameterValue'), 1)) : 0,
      mute: mute ? num(this.param(mute, 'mute')?.getAttribute('parameterValue')) > 0.5 : false,
      locked: c.getAttribute('lockedInTime') === 'true', looped: c.getAttribute('looped') === 'true',
    };
    if (pan && pan.getAttribute('componentID') === 'Audition.StereoPanner') o.pan = Math.round(num(this.param(pan, 0)?.getAttribute('parameterValue')) * 100);
    if (fi) { const d = num(fi.getAttribute('endPoint')) - num(fi.getAttribute('startPoint')); if (d > 0) o.fadeIn = { duration: this.sec(d), type: fi.getAttribute('type'), curve: num(fi.getAttribute('shape')) }; }
    if (fo) { const d = num(fo.getAttribute('endPoint')) - num(fo.getAttribute('startPoint')); if (d > 0) o.fadeOut = { duration: this.sec(d), type: fo.getAttribute('type'), curve: num(fo.getAttribute('shape')) }; }
    const gk = gain && this.keyframesOf(this.param(gain, 'volume'));
    if (gk && gk.length) o.gainAutomation = gk.map((k: { offset: number; value: number }) => ({ time: this.sec(k.offset), db: linToDb(k.value) }));
    const rack = kid(c, 'effectsRack');
    if (rack) o.effects = this.rackInfo(rack, deep);
    return o;
  }

  /* ---------- automation keyframes ---------- */
  keyframesOf(p: El | null): { offset: number; value: number }[] {
    if (!p) return [];
    const k = kid(p, 'parameterKeyframes');
    return k ? kids(k, 'parameterKeyframe').map((x) => ({ offset: num(x.getAttribute('sampleOffset')), value: num(x.getAttribute('value')) })) : [];
  }
  setKeyframes(p: El, points: { offset: number; value: number }[], splines = false) {
    for (const old of kids(p, 'parameterKeyframes')) p.removeChild(old);
    if (!points.length) return;
    const k = this.doc.createElement('parameterKeyframes');
    k.setAttribute('enableSplines', String(splines)); k.setAttribute('readOnly', 'false');
    for (const pt of [...points].sort((a, b) => a.offset - b.offset)) {
      const e = this.doc.createElement('parameterKeyframe');
      e.setAttribute('sampleOffset', String(Math.max(0, Math.round(pt.offset)))); e.setAttribute('select', 'false'); e.setAttribute('type', 'linear'); e.setAttribute('value', String(pt.value));
      k.appendChild(e);
    }
    p.appendChild(k);
  }

  /* ---------- effects racks ---------- */
  rackInfo(rack: El, deep = true) {
    return kids(rack, 'slot').map((s) => {
      const c = kid(s, 'component');
      const o: any = { slot: num(s.getAttribute('slotIndex')) + 1, powered: s.getAttribute('powered') !== 'false', name: c?.getAttribute('name'), id: c?.getAttribute('componentID') };
      const pr = c?.getAttribute('presetName'); if (pr) o.preset = pr;
      const bc = c && kid(c, 'busConfig'); if (bc && /"in":\[\]/.test(bc.textContent || '')) o.missing = true;
      if (c && kid(c, 'presetChunkData')) o.state = 'plug-in chunk';
      if (deep && c) { const ps = kids(c, 'parameter').filter((p) => p.getAttribute('name')); if (ps.length) o.params = Object.fromEntries(ps.slice(0, 80).map((p) => [p.getAttribute('name'), num(p.getAttribute('parameterValue'))])); }
      return o;
    });
  }
  private rackOf(owner: El, create: boolean): El | null {
    let r = kid(owner, 'effectsRack');
    if (!r && create) {
      r = this.doc.createElement('effectsRack'); r.setAttribute('preFader', 'true');
      if (owner.tagName === 'audioClip') {
        const firstComp = kids(owner, 'component')[0] || kid(owner, 'fadeIn');
        owner.insertBefore(r, firstComp || null);
      } else {
        const ep = kid(owner, 'editParameter') || kid(owner, 'audioClip');
        owner.insertBefore(r, ep || null);
      }
    }
    return r;
  }
  /** owner = track (name/index/'master') or {track, clip} */
  owner(target: { track: TrackRef; clip?: ClipRef }): El {
    const t = this.track(target.track);
    return target.clip !== undefined && target.clip !== null ? this.clip(t, target.clip) : t;
  }
  addEffect(owner: El, spec: { effect: string; slot?: number; preset?: string; params?: Record<string, number>; chunk?: string; powered?: boolean; name?: string }) {
    const rack = this.rackOf(owner, true)!;
    const used = new Set(kids(rack, 'slot').map((s) => num(s.getAttribute('slotIndex'))));
    let idx = spec.slot !== undefined ? spec.slot - 1 : -1;
    if (idx < 0) { idx = 0; while (used.has(idx)) idx++; }
    if (idx > 15) throw new Error('Effects rack is full (16 slots).');
    const old = kids(rack, 'slot').find((s) => num(s.getAttribute('slotIndex')) === idx);
    if (old) rack.removeChild(old);
    const fx = resolveEffect(spec.effect);
    const slot = this.doc.createElement('slot'); slot.setAttribute('powered', String(spec.powered !== false)); slot.setAttribute('slotIndex', String(idx));
    const c = this.doc.createElement('component');
    c.setAttribute('componentGuid', randomUUID()); c.setAttribute('componentID', fx.id); c.setAttribute('name', spec.name || fx.name); c.setAttribute('presetName', spec.preset || '');
    if (spec.chunk) { const ch = this.doc.createElement('presetChunkData'); ch.appendChild(this.doc.createCDATASection(spec.chunk)); c.appendChild(ch); }
    if (spec.params) this.applyParams(c, fx.id, spec.params);
    slot.appendChild(c);
    // keep slots ordered by index
    const after = kids(rack, 'slot').find((s) => num(s.getAttribute('slotIndex')) > idx);
    rack.insertBefore(slot, after || null);
    return { slot: idx + 1, effect: fx.name, id: fx.id };
  }
  private applyParams(comp: El, effectId: string, params: Record<string, number>) {
    const def = AU_BUILTIN_EFFECTS.find((e) => e.id === (AU_EFFECT_ALIASES[effectId] || effectId));
    for (const [k, v] of Object.entries(params)) {
      if (typeof v !== 'number' || v < 0 || v > 1) throw new Error(`Effect parameter "${k}" must be a normalized number 0..1 (Audition stores plug-in parameters normalized). Use au_effects {"action":"info"} for defaults.`);
      let p = this.param(comp, /^\d+$/.test(k) ? Number(k) : k);
      if (!p && def) { const d = def.params.find((x) => String(x[0]) === k || x[1].toLowerCase() === k.toLowerCase()); if (d) p = this.ensureParam(comp, d[0], d[1], v); }
      if (!p) { if (/^\d+$/.test(k)) p = this.ensureParam(comp, Number(k), null, v); else throw new Error(`Unknown parameter "${k}" for ${def ? def.name : effectId}${def ? ' â€” known: ' + def.params.map((x) => x[1]).join(', ') : ' (use the parameter index for plug-ins)'}`); }
      p.setAttribute('parameterValue', String(v));
    }
  }
  slotEl(owner: El, slot: number): El {
    const rack = this.rackOf(owner, false);
    const s = rack && kids(rack, 'slot').find((x) => num(x.getAttribute('slotIndex')) === slot - 1);
    if (!s) throw new Error(`No effect in slot ${slot}.`);
    return s;
  }
  setEffect(owner: El, slot: number, spec: { powered?: boolean; params?: Record<string, number>; preset?: string }) {
    const s = this.slotEl(owner, slot); const c = kid(s, 'component');
    if (spec.powered !== undefined) s.setAttribute('powered', String(spec.powered));
    if (spec.preset !== undefined) { c.setAttribute('presetName', spec.preset); for (const p of kids(c, 'parameter')) c.removeChild(p); }
    if (spec.params) this.applyParams(c, c.getAttribute('componentID'), spec.params);
  }
  removeEffect(owner: El, slot?: number) {
    const rack = this.rackOf(owner, false); if (!rack) return 0;
    let n = 0;
    for (const s of kids(rack, 'slot')) if (slot === undefined || num(s.getAttribute('slotIndex')) === slot - 1) { rack.removeChild(s); n++; }
    return n;
  }
  /** Rebuilds a rack from one of your saved Effects Rack presets (exact plug-in state incl. FabFilter/VST3 chunks). */
  applyRackPreset(owner: El, presetName: string, replace = true) {
    const all = readRackPresets();
    const p = all.find((x) => x.name === presetName) || all.find((x) => x.name.toLowerCase() === presetName.toLowerCase());
    if (!p) throw new Error(`Effects rack preset not found: "${presetName}". Available: ${all.map((x) => x.name).join(', ')}`);
    if (replace) this.removeEffect(owner);
    const added = [];
    for (const s of p.slots) added.push(this.addFromSettings(owner, s, replace ? s.slot + 1 : undefined));
    return { preset: p.name, effects: added };
  }
  addFromSettings(owner: El, s: RackSlot, slot?: number) {
    const st = s.settings || {};
    const spec: any = { effect: s.effectId, name: s.name, powered: s.powered, slot };
    if (st.ChunkData) spec.chunk = st.ChunkData;
    if (st.FactoryPreset) spec.preset = st.FactoryPreset;
    const r = this.addEffect(owner, spec);
    if (Array.isArray(st.ParamList)) {
      const c = kid(this.slotEl(owner, r.slot), 'component');
      const def = AU_BUILTIN_EFFECTS.find((e) => e.id === (AU_EFFECT_ALIASES[s.effectId] || s.effectId));
      st.ParamList.forEach((v: number, i: number) => { const d = def?.params.find((x) => x[0] === i); this.ensureParam(c, i, d ? d[1] : null, v); });
    }
    return { ...r, effect: s.name || effectName(s.effectId) };
  }

  /* ---------- track / clip setters ---------- */
  setTrack(t: El, o: { name?: string; volumeDb?: number; pan?: number; mute?: boolean; solo?: boolean; armed?: boolean; visible?: boolean; output?: string; color?: number; height?: number }) {
    const a = this.tap(t);
    if (o.name !== undefined) { const p = kid(t, 'trackParameters'); let n = kid(p, 'name'); if (!n) { n = this.doc.createElement('name'); p.appendChild(n); } n.textContent = o.name; }
    if (o.volumeDb !== undefined) this.param(this.faderOf(a, 'trackFader'), 'volume')!.setAttribute('parameterValue', String(dbToLin(o.volumeDb)));
    if (o.mute !== undefined) this.ensureParam(this.muteOf(a, 'trackMute'), 1, 'mute', o.mute ? 1 : 0);
    if (o.pan !== undefined) { const p = this.panOf(a, 'trackPan'); if (!p) throw new Error(`Track "${this.trackName(t)}" uses a surround/output panner â€” L/R pan does not apply.`); this.ensureParam(p, 0, 'Pan', Math.max(-1, Math.min(1, o.pan / 100))); }
    if (o.solo !== undefined) a.setAttribute('solo', String(o.solo));
    if (o.armed !== undefined) a.setAttribute('recordArmed', String(o.armed));
    if (o.visible !== undefined) t.setAttribute('visible', String(o.visible));
    if (o.color !== undefined) kid(t, 'trackParameters').setAttribute('trackHue', String(Math.round(o.color)));
    if (o.height !== undefined) kid(t, 'trackParameters').setAttribute('trackHeight', String(Math.round(o.height)));
    if (o.output !== undefined) {
      const out = kid(a, 'trackOutput');
      const target = this.track(o.output);
      if (target === t) throw new Error('A track cannot output to itself.');
      if (target.tagName === 'audioTrack') throw new Error('Route to a bus or the master (Mix) track, not to an audio track.');
      out.setAttribute('outputID', target.getAttribute('id')); out.setAttribute('type', 'trackID');
    }
  }
  setClip(c: El, o: { name?: string; gainDb?: number; pan?: number; mute?: boolean; start?: number; sourceIn?: number; sourceOut?: number; locked?: boolean; looped?: boolean; color?: number; fadeIn?: FadeSpec | null; fadeOut?: FadeSpec | null }) {
    let start = num(c.getAttribute('startPoint')), sIn = num(c.getAttribute('sourceInPoint')), sOut = num(c.getAttribute('sourceOutPoint'));
    if (o.name !== undefined) c.setAttribute('name', o.name);
    if (o.gainDb !== undefined) this.param(this.faderOf(c, 'clipGain'), 'volume')!.setAttribute('parameterValue', String(dbToLin(o.gainDb)));
    if (o.mute !== undefined) this.ensureParam(this.muteOf(c, 'clipMute'), 1, 'mute', o.mute ? 1 : 0);
    if (o.pan !== undefined) { const p = this.panOf(c, 'clipPan'); if (!p) throw new Error('This clip has no stereo panner.'); this.ensureParam(p, 0, 'Pan', Math.max(-1, Math.min(1, o.pan / 100))); }
    if (o.locked !== undefined) c.setAttribute('lockedInTime', String(o.locked));
    if (o.looped !== undefined) c.setAttribute('looped', String(o.looped));
    if (o.color !== undefined) c.setAttribute('hue', String(Math.round(o.color)));
    if (o.sourceIn !== undefined) sIn = this.smp(o.sourceIn);
    if (o.sourceOut !== undefined) sOut = this.smp(o.sourceOut);
    if (sOut <= sIn) throw new Error('sourceOut must be after sourceIn.');
    if (o.start !== undefined) start = this.smp(o.start);
    if (start < 0) throw new Error('Clip start cannot be negative.');
    c.setAttribute('startPoint', String(start)); c.setAttribute('endPoint', String(start + (sOut - sIn)));
    c.setAttribute('sourceInPoint', String(sIn)); c.setAttribute('sourceOutPoint', String(sOut));
    const len = sOut - sIn;
    const fade = (tag: 'fadeIn' | 'fadeOut', f: FadeSpec | null | undefined) => {
      let e = kid(c, tag);
      if (!e) { e = this.doc.createElement(tag); e.setAttribute('crossFadeLinkType', 'linkedAsymmetric'); e.setAttribute('shape', '19'); e.setAttribute('type', 'log'); const ref = kid(c, tag === 'fadeIn' ? 'fadeOut' : 'editParameter') || kid(c, 'channelMap'); c.insertBefore(e, tag === 'fadeIn' ? (kid(c, 'fadeOut') || ref) : ref); }
      const d = f ? Math.min(len, this.smp(f.duration)) : 0;
      if (tag === 'fadeIn') { e.setAttribute('startPoint', '0'); e.setAttribute('endPoint', String(d)); } else { e.setAttribute('startPoint', String(len - d)); e.setAttribute('endPoint', String(len)); }
      // Audition stores two fade families: "log" (linear/logarithmic, bent by shape; 0 = straight line) and "cosine" (S-curve)
      if (f?.type === 'linear') { e.setAttribute('type', 'log'); e.setAttribute('shape', '0'); }
      else if (f?.type) e.setAttribute('type', f.type);
      if (f?.curve !== undefined) e.setAttribute('shape', String(Math.round(f.curve)));
    };
    if (o.fadeIn !== undefined) fade('fadeIn', o.fadeIn);
    else if (o.sourceIn !== undefined || o.sourceOut !== undefined) { const fi = kid(c, 'fadeIn'); if (fi && num(fi.getAttribute('endPoint')) > len) fi.setAttribute('endPoint', String(len)); }
    if (o.fadeOut !== undefined) fade('fadeOut', o.fadeOut);
    else if (o.sourceIn !== undefined || o.sourceOut !== undefined) { const fo = kid(c, 'fadeOut'); if (fo) { const d = num(fo.getAttribute('endPoint')) - num(fo.getAttribute('startPoint')); fo.setAttribute('startPoint', String(Math.max(0, len - d))); fo.setAttribute('endPoint', String(len)); } }
  }
  /** volume automation in dB; track: absolute timeline seconds, clip: seconds from clip start */
  setVolumeAutomation(owner: El, points: Keyframe[] | null) {
    const isClip = owner.tagName === 'audioClip';
    const comp = isClip ? this.faderOf(owner, 'clipGain') : this.faderOf(this.tap(owner), 'trackFader');
    const p = this.param(comp, 'volume')!;
    this.setKeyframes(p, (points || []).map((k) => ({ offset: this.smp(k.time), value: dbToLin(k.value) })));
    if (!isClip && points && points.length) this.tap(owner).setAttribute('automationMode', '1');
  }
  setPanAutomation(owner: El, points: Keyframe[] | null) {
    const isClip = owner.tagName === 'audioClip';
    const comp = isClip ? this.panOf(owner, 'clipPan') : this.panOf(this.tap(owner), 'trackPan');
    if (!comp) throw new Error('No stereo panner on this target.');
    this.setKeyframes(this.param(comp, 0) || this.ensureParam(comp, 0, 'Pan', 0), (points || []).map((k) => ({ offset: this.smp(k.time), value: Math.max(-1, Math.min(1, k.value / 100)) })));
  }

  /* ---------- structure: tracks / clips ---------- */
  private nextTrackId() { let m = 10000; for (const t of kids(this.tracksEl)) m = Math.max(m, num(t.getAttribute('id'))); return m + 1; }
  addTrack(o: { name?: string; kind?: 'audio' | 'bus'; channels?: 'mono' | 'stereo' | '5.1'; output?: string; position?: number }) {
    const kind = o.kind || 'audio';
    const ch = o.channels === 'mono' ? 'mono' : o.channels === '5.1' ? 'fivePointOne' : 'stereo';
    const list = this.tracks().filter((t) => t.tagName !== 'masterTrack');
    const id = this.nextTrackId();
    const t = this.doc.createElement(kind === 'bus' ? 'busTrack' : 'audioTrack');
    t.setAttribute('automationLaneOpenState', 'false'); t.setAttribute('id', String(id)); t.setAttribute('index', '0'); t.setAttribute('select', 'false'); t.setAttribute('visible', 'true');
    const tp = this.doc.createElement('trackParameters'); tp.setAttribute('trackHeight', '134'); tp.setAttribute('trackHue', String(Math.floor(Math.random() * 360))); tp.setAttribute('trackMinimized', 'false');
    const nm = this.doc.createElement('name'); nm.textContent = o.name || (kind === 'bus' ? 'Bus ' : 'Track ') + (list.length + 1); tp.appendChild(nm); t.appendChild(tp);
    const a = this.doc.createElement('trackAudioParameters');
    a.setAttribute('audioChannelType', ch); a.setAttribute('automationMode', '1'); a.setAttribute('monitoring', 'false'); a.setAttribute('recordArmed', 'false'); a.setAttribute('solo', 'false'); a.setAttribute('soloSafe', kind === 'bus' ? 'true' : 'false');
    const out = this.doc.createElement('trackOutput'); const master = this.tracks().find((x) => x.tagName === 'masterTrack');
    out.setAttribute('outputID', master ? master.getAttribute('id') : '10000'); out.setAttribute('type', 'trackID'); a.appendChild(out);
    const inp = this.doc.createElement('trackInput'); inp.setAttribute('inputID', kind === 'bus' ? '-1' : '1'); a.appendChild(inp);
    t.appendChild(a);
    this.faderOf(a, 'trackFader'); this.muteOf(a, 'trackMute');
    const masterCh = master ? this.tap(master).getAttribute('audioChannelType') : 'stereo';
    if (ch !== 'fivePointOne' && masterCh !== 'fivePointOne') this.panOf(a, 'trackPan');
    const ep = this.doc.createElement('editParameter'); ep.setAttribute('parameterIndex', '0'); ep.setAttribute('slotIndex', '4294967280'); t.appendChild(ep);
    // insert before the master track, renumber indexes
    const pos = Math.max(1, Math.min(o.position || list.length + 1, list.length + 1));
    const before = list[pos - 1] || master || null;
    this.tracksEl.insertBefore(t, before);
    this.renumber();
    if (o.output) this.setTrack(t, { output: o.output });
    return { id, name: nm.textContent, index: pos };
  }
  removeTrack(t: El) {
    if (t.tagName === 'masterTrack') throw new Error('The master (Mix) track cannot be removed.');
    const id = t.getAttribute('id');
    for (const x of this.tracks()) { const o = kid(this.tap(x), 'trackOutput'); if (o && o.getAttribute('outputID') === id) { const m = this.tracks().find((y) => y.tagName === 'masterTrack'); o.setAttribute('outputID', m ? m.getAttribute('id') : '10000'); } }
    this.tracksEl.removeChild(t); this.renumber();
  }
  moveTrack(t: El, position: number) {
    const list = this.tracks().filter((x) => x.tagName !== 'masterTrack' && x !== t);
    const before = list[position - 1] || this.tracks().find((x) => x.tagName === 'masterTrack') || null;
    this.tracksEl.insertBefore(t, before); this.renumber();
  }
  private renumber() {
    // document order defines display order: audio/bus tracks first, master last
    let i = 1; for (const t of kids(this.tracksEl)) if (/^(audioTrack|busTrack)$/.test(t.tagName)) t.setAttribute('index', String(i++));
    for (const t of kids(this.tracksEl, 'masterTrack')) t.setAttribute('index', String(i++));
  }
  removeClip(t: El, c: El) { t.removeChild(c); }
  duplicateClip(t: El, c: El, at?: number, toTrack?: El) {
    const n = c.cloneNode(true);
    let mx = 0; for (const tr of this.tracks()) for (const x of kids(tr, 'audioClip')) mx = Math.max(mx, num(x.getAttribute('id')));
    n.setAttribute('id', String(mx + 1));
    for (const comp of kids(n, 'component')) comp.setAttribute('componentGuid', randomUUID());
    (toTrack || t).appendChild(n);
    if (at !== undefined) this.setClip(n, { start: at });
    return n;
  }
  /** split a clip at a timeline time (seconds) into two clips */
  splitClip(t: El, c: El, at: number) {
    const s = num(c.getAttribute('startPoint')), e = num(c.getAttribute('endPoint')), cut = this.smp(at);
    if (cut <= s || cut >= e) throw new Error(`Split time ${at}s is outside the clip (${this.sec(s)}â€“${this.sec(e)}s).`);
    const sIn = num(c.getAttribute('sourceInPoint'));
    const right = this.duplicateClip(t, c);
    this.setClip(c, { sourceOut: this.sec(sIn + (cut - s)), fadeOut: null });
    this.setClip(right, { start: this.sec(cut), sourceIn: this.sec(sIn + (cut - s)), fadeIn: null });
    return right;
  }

  setSessionState(o: { playhead?: number; selectionStart?: number; selectionEnd?: number }) {
    const st = kid(this.session, 'sessionState'); if (!st) return;
    if (o.playhead !== undefined) st.setAttribute('ctiPosition', String(this.smp(o.playhead)));
    if (o.selectionStart !== undefined || o.selectionEnd !== undefined) {
      const sel = kid(st, 'selectionState'); const a = this.smp(o.selectionStart || 0), b = this.smp(o.selectionEnd ?? o.selectionStart ?? 0);
      sel.setAttribute('selectionStart', String(Math.min(a, b))); sel.setAttribute('selectionDuration', String(Math.abs(b - a)));
    }
  }

  info(deep = true) {
    const s = this.session;
    const files = kids(kid(this.root, 'files') || this.root, 'file').map((f) => ({ id: Number(f.getAttribute('id')), path: f.getAttribute('absolutePath') }));
    const st = kid(s, 'sessionState');
    return {
      path: this.path, appVersion: s.getAttribute('appVersion'), sampleRate: this.sampleRate, bitDepth: Number(s.getAttribute('bitDepth')), channels: s.getAttribute('audioChannelType'),
      duration: this.sec(s.getAttribute('duration')), playhead: st ? this.sec(st.getAttribute('ctiPosition')) : 0,
      tracks: this.tracks().map((t) => this.trackInfo(t, deep)), files,
    };
  }
}

/** A fresh, empty session file (what File > New > Multitrack Session writes, minus device/UI noise). */
export function newSessionXml(o: { sampleRate?: number; bitDepth?: number; channels?: 'mono' | 'stereo' | '5.1'; durationSec?: number }) {
  const sr = o.sampleRate || 48000, ch = o.channels === '5.1' ? 'fivePointOne' : o.channels === 'mono' ? 'mono' : 'stereo';
  const dur = Math.round((o.durationSec || 30) * sr);
  const pan = ch === 'fivePointOne' ? '' : `<component componentGuid="${randomUUID()}" componentID="Audition.StereoPanner" id="trackPan" name="StereoPanner" powered="true"><parameter index="0" name="Pan" parameterValue="0"/></component>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<!DOCTYPE sesx>
<sesx version="1.9">
  <session appBuild="26.3.0.79" appVersion="26.3" audioChannelType="${ch}" bitDepth="${o.bitDepth || 32}" duration="${dur}" sampleRate="${sr}">
    <tracks>
      <masterTrack automationLaneOpenState="false" id="10000" index="1" select="false" visible="true">
        <trackParameters trackHeight="134" trackHue="-1" trackMinimized="false"><name>Mix</name></trackParameters>
        <trackAudioParameters audioChannelType="${ch}" automationMode="1" monitoring="false" recordArmed="false" solo="false" soloSafe="true">
          <trackOutput outputID="1" type="hardwareOutput"/>
          <trackInput inputID="-1"/>
          <component componentGuid="${randomUUID()}" componentID="Audition.Fader" id="trackFader" name="volume" powered="true"><parameter index="0" name="volume" parameterValue="1"/><parameter index="1" name="static gain" parameterValue="1"/></component>
          <component componentGuid="${randomUUID()}" componentID="Audition.Mute" id="trackMute" name="Mute" powered="true"><parameter index="0" parameterValue="0"/><parameter index="1" name="mute" parameterValue="0"/></component>
          ${pan}
        </trackAudioParameters>
        <editParameter parameterIndex="0" slotIndex="4294967280"/>
      </masterTrack>
    </tracks>
    <sessionState ctiPosition="0" smpteStart="0">
      <selectionState selectionDuration="0" selectionStart="0"/>
      <viewState horizontalViewDuration="${dur}" horizontalViewStart="0" trackControlsWidth="224" verticalScrollOffset="0"/>
      <timeFormatState beatsPerBar="4" beatsPerMinute="120" customFrameRate="12" linkToDefaultTimeSettings="true" noteLength="4" subdivisions="16" timeCodeDropFrame="false" timeCodeFrameRate="30" timeCodeNTSC="false" timeFormat="timeFormatDecimal"/>
      <mixingOptionState defaultPanModeLogarithmic="false" panPower="-3" playOverlappingClips="false"/>
    </sessionState>
    <clipGroups/>
  </session>
  <files/>
</sesx>
`;
}
