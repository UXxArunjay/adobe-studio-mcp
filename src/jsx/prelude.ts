/** ExtendScript (ES3) helper libraries injected before every tool body, per app. */
import type { AppId } from '../config.js';

const COMMON = `
function __hex(h) {
  if (h instanceof Array) { var m = (h[0] > 1 || h[1] > 1 || h[2] > 1) ? 255 : 1; return [h[0] / m, h[1] / m, h[2] / m]; }
  h = String(h).replace('#', '');
  if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
  return [parseInt(h.substr(0, 2), 16) / 255, parseInt(h.substr(2, 2), 16) / 255, parseInt(h.substr(4, 2), 16) / 255];
}
function __rgb255(h) { var c = __hex(h); return [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)]; }
function __toHex(c) { var o = '#'; for (var i = 0; i < 3; i++) { var n = Math.round((c[i] <= 1 ? c[i] * 255 : c[i])); var s = n.toString(16); if (s.length < 2) s = '0' + s; o += s; } return o; }
function __file(p) { return new File(String(p).replace(/\\\\/g, '/')); }
function __def(v, d) { return (v === undefined || v === null) ? d : v; }
`;

const AE = COMMON + `
function __findComp(name) {
  for (var i = 1; i <= app.project.numItems; i++) { var it = app.project.item(i); if (it instanceof CompItem && it.name === name) return it; }
  return null;
}
function __comp(name) {
  if (name) { var c = __findComp(name); if (!c) throw new Error('Composition not found: ' + name); return c; }
  var a = app.project.activeItem;
  if (a instanceof CompItem) return a;
  try { if (app.activeViewer) { app.activeViewer.setActive(); a = app.project.activeItem; if (a instanceof CompItem) return a; } } catch (e) {}
  throw new Error('No active composition. Open a comp in the timeline or pass compositionName.');
}
function __layer(comp, ref) {
  if (ref === undefined || ref === null || ref === '') { var sel = comp.selectedLayers; if (sel.length) return sel[0]; throw new Error('Pass layer (name or 1-based index).'); }
  if (typeof ref === 'number' || /^\\d+$/.test(String(ref))) { var n = Number(ref); if (n < 1 || n > comp.numLayers) throw new Error('Layer index out of range: ' + n); return comp.layer(n); }
  var l = comp.layer(String(ref));
  if (!l) throw new Error('Layer not found: ' + ref + ' (comp ' + comp.name + ')');
  return l;
}
function __item(ref) {
  if (typeof ref === 'number') return app.project.itemByID ? app.project.itemByID(ref) : app.project.item(ref);
  for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i).name === ref) return app.project.item(i);
  throw new Error('Project item not found: ' + ref);
}
function __folder(path, create) {
  if (!path) return app.project.rootFolder;
  var parts = String(path).split('/'), cur = app.project.rootFolder;
  for (var p = 0; p < parts.length; p++) {
    if (!parts[p]) continue; var found = null;
    for (var i = 1; i <= cur.numItems; i++) { var it = cur.item(i); if (it instanceof FolderItem && it.name === parts[p]) { found = it; break; } }
    if (!found) { if (!create) throw new Error('Folder not found: ' + path); found = app.project.items.addFolder(parts[p]); found.parentFolder = cur; }
    cur = found;
  }
  return cur;
}
var __ALIAS = {
  'position': 'ADBE Transform Group/ADBE Position', 'scale': 'ADBE Transform Group/ADBE Scale', 'rotation': 'ADBE Transform Group/ADBE Rotate Z',
  'zrotation': 'ADBE Transform Group/ADBE Rotate Z', 'xrotation': 'ADBE Transform Group/ADBE Rotate X', 'yrotation': 'ADBE Transform Group/ADBE Rotate Y',
  'opacity': 'ADBE Transform Group/ADBE Opacity', 'anchorpoint': 'ADBE Transform Group/ADBE Anchor Point', 'anchor': 'ADBE Transform Group/ADBE Anchor Point',
  'orientation': 'ADBE Transform Group/ADBE Orientation', 'xposition': 'ADBE Transform Group/ADBE Position_0', 'yposition': 'ADBE Transform Group/ADBE Position_1',
  'zposition': 'ADBE Transform Group/ADBE Position_2', 'sourcetext': 'ADBE Text Properties/ADBE Text Document', 'text': 'ADBE Text Properties/ADBE Text Document',
  'timeremap': 'ADBE Time Remapping', 'audiolevels': 'ADBE Audio Group/ADBE Audio Levels',
  'pointofinterest': 'ADBE Transform Group/ADBE Point of Interest', 'zoom': 'ADBE Camera Options Group/ADBE Camera Zoom',
  'intensity': 'ADBE Light Options Group/ADBE Light Intensity'
};
var __GROUP = { 'effects': 'ADBE Effect Parade', 'masks': 'ADBE Mask Parade', 'transform': 'ADBE Transform Group', 'text': 'ADBE Text Properties',
  'contents': 'ADBE Root Vectors Group', 'audio': 'ADBE Audio Group', 'material options': 'ADBE Material Options Group', 'layer styles': 'ADBE Layer Styles',
  'camera options': 'ADBE Camera Options Group', 'light options': 'ADBE Light Options Group', 'animators': 'ADBE Text Animators', 'markers': 'ADBE Marker' };
function __prop(layer, path) {
  if (!path) throw new Error('Pass a property.');
  var key = String(path).toLowerCase().replace(/[\\s_-]/g, '');
  var p = __ALIAS[key] || String(path);
  var segs = p.split(/\\s*[>\\/]\\s*/), cur = layer;
  for (var i = 0; i < segs.length; i++) {
    var s = segs[i]; if (s === '') continue;
    if (i === 0 && __GROUP[s.toLowerCase()]) s = __GROUP[s.toLowerCase()];
    var next = null;
    if (/^\\d+$/.test(s)) { try { next = cur.property(Number(s)); } catch (e) {} }
    if (!next) { try { next = cur.property(s); } catch (e2) {} }
    if (!next && cur.numProperties) { for (var j = 1; j <= cur.numProperties; j++) { var c = cur.property(j); if (c.name.toLowerCase() === s.toLowerCase() || c.matchName.toLowerCase() === s.toLowerCase()) { next = c; break; } } }
    if (!next) throw new Error('Property not found: "' + segs[i] + '" in "' + path + '" on layer ' + layer.name);
    cur = next;
  }
  return cur;
}
function __dims(prop) {
  var t = prop.propertyValueType;
  if (t === PropertyValueType.TwoD) return 2;
  if (t === PropertyValueType.ThreeD) return 3;
  return 1;
}
function __val(prop, v) {
  var t = prop.propertyValueType;
  if (t === PropertyValueType.COLOR) { if (typeof v === 'string' || (v instanceof Array && v.length === 3)) { var c = __hex(v); return [c[0], c[1], c[2], 1]; } return v; }
  if (t === PropertyValueType.OneD) return (v instanceof Array) ? v[0] : v;
  if (t === PropertyValueType.TextDocument) { if (typeof v === 'string') { var td = prop.value; td.text = v; return td; } return v; }
  if (t === PropertyValueType.TwoD || t === PropertyValueType.TwoD_SPATIAL) { if (typeof v === 'number') return [v, v]; return [v[0], v[1]]; }
  if (t === PropertyValueType.ThreeD || t === PropertyValueType.ThreeD_SPATIAL) {
    if (typeof v === 'number') return [v, v, v];
    if (v.length === 2) { var cur = prop.value; var z = (cur instanceof Array && cur.length > 2) ? cur[2] : (prop.matchName === 'ADBE Scale' ? 100 : 0); if (prop.matchName === 'ADBE Scale') z = 100; return [v[0], v[1], z]; }
    return v;
  }
  return v;
}
function __setProp(prop, v, time) {
  var value = __val(prop, v);
  if (time !== undefined && time !== null) { prop.setValueAtTime(time, value); return prop.nearestKeyIndex(time); }
  if (prop.numKeys > 0) { var t = prop.propertyGroup(prop.propertyDepth).containingComp ? prop.propertyGroup(prop.propertyDepth).containingComp.time : 0; prop.setValueAtTime(t, value); return prop.nearestKeyIndex(t); }
  prop.setValue(value); return 0;
}
function __keyEase(prop, k, inf, infOut, spIn, spOut) {
  var n = (prop.isSpatial || prop.propertyValueType === PropertyValueType.COLOR) ? 1 : __dims(prop);
  var ai = [], ao = [];
  for (var i = 0; i < n; i++) { ai.push(new KeyframeEase(__def(spIn, 0), Math.max(0.1, Math.min(100, __def(inf, 33.33))))); ao.push(new KeyframeEase(__def(spOut, 0), Math.max(0.1, Math.min(100, __def(infOut, __def(inf, 33.33)))))); }
  try { prop.setTemporalEaseAtKey(k, ai, ao); } catch (e) { prop.setTemporalEaseAtKey(k, [ai[0]], [ao[0]]); }
}
function __interp(name) {
  name = String(name || 'bezier').toLowerCase();
  if (name === 'linear') return KeyframeInterpolationType.LINEAR;
  if (name === 'hold') return KeyframeInterpolationType.HOLD;
  return KeyframeInterpolationType.BEZIER;
}
function __ltype(l) {
  if (l instanceof TextLayer) return 'text';
  if (l instanceof ShapeLayer) return 'shape';
  if (l instanceof CameraLayer) return 'camera';
  if (l instanceof LightLayer) return 'light';
  if (l.nullLayer) return 'null';
  if (l.adjustmentLayer) return 'adjustment';
  try { if (l.source instanceof CompItem) return 'precomp'; if (l.source.mainSource instanceof SolidSource) return 'solid'; if (l.source.mainSource.isStill) return 'image'; if (!l.hasVideo) return 'audio'; } catch (e) {}
  return 'footage';
}
function __linfo(l, deep) {
  var o = { index: l.index, name: l.name, type: __ltype(l), enabled: l.enabled, inPoint: l.inPoint, outPoint: l.outPoint, startTime: l.startTime,
    parent: l.parent ? l.parent.index : null, locked: l.locked, shy: l.shy, solo: l.solo, label: l.label };
  try { o.threeD = l.threeDLayer; o.blendingMode = l.blendingMode; o.motionBlur = l.motionBlur; o.trackMatte = l.trackMatteType; o.guide = l.guideLayer; } catch (e) {}
  try { if (l.source) o.source = l.source.name; } catch (e2) {}
  try { if (l instanceof TextLayer) o.text = l.property('ADBE Text Properties').property('ADBE Text Document').value.text; } catch (e3) {}
  if (deep) {
    var t = l.property('ADBE Transform Group'); o.transform = {};
    for (var i = 1; i <= t.numProperties; i++) { var p = t.property(i); try { o.transform[p.name] = { value: p.value, keys: p.numKeys, expression: p.expressionEnabled ? p.expression : '' }; } catch (e4) {} }
    var fx = l.property('ADBE Effect Parade'); o.effects = [];
    if (fx) for (var j = 1; j <= fx.numProperties; j++) o.effects.push({ index: j, name: fx.property(j).name, matchName: fx.property(j).matchName, enabled: fx.property(j).enabled });
    var m = l.property('ADBE Mask Parade'); o.masks = m ? m.numProperties : 0;
  }
  return o;
}
function __compInfo(c) {
  return { name: c.name, id: c.id, width: c.width, height: c.height, pixelAspect: c.pixelAspect, frameRate: c.frameRate, duration: c.duration,
    time: c.time, workAreaStart: c.workAreaStart, workAreaDuration: c.workAreaDuration, numLayers: c.numLayers, bgColor: __toHex(c.bgColor) };
}
function __addEffect(layer, name) {
  var fx = layer.property('ADBE Effect Parade');
  if (fx.canAddProperty(name)) return fx.addProperty(name);
  throw new Error('Effect not found or cannot be added: ' + name + ' (use display name like "Gaussian Blur" or matchName like "ADBE Gaussian Blur 2")');
}
function __effect(layer, ref) {
  var fx = layer.property('ADBE Effect Parade');
  var e = null;
  if (typeof ref === 'number') e = fx.property(ref); else { try { e = fx.property(ref); } catch (x) {} }
  if (!e) throw new Error('Effect not on layer: ' + ref);
  return e;
}
function __effectParam(effect, ref) {
  var p = null;
  if (typeof ref === 'number' || /^\\d+$/.test(String(ref))) p = effect.property(Number(ref));
  else { try { p = effect.property(ref); } catch (x) {} if (!p) for (var i = 1; i <= effect.numProperties; i++) { if (effect.property(i).name.toLowerCase() === String(ref).toLowerCase()) { p = effect.property(i); break; } } }
  if (!p) throw new Error('Effect parameter not found: ' + ref + ' on ' + effect.name);
  return p;
}
`;

const PR = COMMON + `
var __TICKS = 254016000000;
function __time(t) { var o = new Time(); if (typeof t === 'string' && t.indexOf(':') > 0) { var s = __tc(t); o.seconds = s; } else o.seconds = Number(t || 0); return o; }
function __fps() { try { var s = app.project.activeSequence; return 1 / s.getSettings().videoFrameRate.seconds; } catch (e) { return 25; } }
function __tc(tc) { var p = String(tc).split(/[:;]/); var f = __fps(); if (p.length === 4) return Number(p[0]) * 3600 + Number(p[1]) * 60 + Number(p[2]) + Number(p[3]) / f; if (p.length === 3) return Number(p[0]) * 60 + Number(p[1]) + Number(p[2]) / f; return Number(tc); }
function __sec(t) { if (t === undefined || t === null) return 0; if (typeof t === 'string' && t.indexOf(':') > 0) return __tc(t); return Number(t); }
function __seq(name) {
  if (name) { for (var i = 0; i < app.project.sequences.numSequences; i++) { var s = app.project.sequences[i]; if (s.name === name) return s; } throw new Error('Sequence not found: ' + name); }
  if (!app.project.activeSequence) throw new Error('No active sequence. Open one or pass sequence.');
  return app.project.activeSequence;
}
function __track(seq, id) {
  var m = String(id || 'V1').toUpperCase().match(/^([VA])(\\d+)$/);
  if (!m) throw new Error('Track must look like V1 or A2: ' + id);
  var coll = m[1] === 'V' ? seq.videoTracks : seq.audioTracks, n = Number(m[2]) - 1;
  if (n < 0 || n >= coll.numTracks) throw new Error('Track ' + id + ' does not exist (sequence has ' + coll.numTracks + ' ' + (m[1] === 'V' ? 'video' : 'audio') + ' tracks).');
  return coll[n];
}
function __clip(seq, ref) {
  var tr = __track(seq, ref.track || 'V1');
  if (ref.clip !== undefined && ref.clip !== null) {
    if (typeof ref.clip === 'number') { if (ref.clip < 1 || ref.clip > tr.clips.numItems) throw new Error('Clip ' + ref.clip + ' not on ' + ref.track + ' (' + tr.clips.numItems + ' clips)'); return tr.clips[ref.clip - 1]; }
    for (var i = 0; i < tr.clips.numItems; i++) if (tr.clips[i].name === ref.clip) return tr.clips[i];
    throw new Error('Clip named ' + ref.clip + ' not on ' + ref.track);
  }
  if (ref.time !== undefined) { var t = __sec(ref.time); for (var j = 0; j < tr.clips.numItems; j++) { var c = tr.clips[j]; if (c.start.seconds <= t + 1e-6 && c.end.seconds > t) return c; } throw new Error('No clip at ' + t + 's on ' + ref.track); }
  throw new Error('Clip reference needs clip (1-based index or name) or time.');
}
function __cinfo(c, i) {
  var o = { index: i + 1, name: c.name, start: c.start.seconds, end: c.end.seconds, duration: c.duration.seconds, inPoint: c.inPoint.seconds, outPoint: c.outPoint.seconds };
  try { o.enabled = !c.disabled; } catch (e) {} try { o.selected = c.isSelected(); } catch (e2) {}
  try { o.mediaPath = c.projectItem ? c.projectItem.getMediaPath() : ''; } catch (e3) {}
  try { o.speed = c.getSpeed(); } catch (e4) {}
  return o;
}
function __walk(item, out, path, depth) {
  for (var i = 0; i < item.children.numItems; i++) {
    var ch = item.children[i], p = path + '/' + ch.name;
    var o = { name: ch.name, path: p, type: ch.type === ProjectItemType.BIN ? 'bin' : (ch.type === ProjectItemType.CLIP ? 'clip' : (ch.type === ProjectItemType.FILE ? 'file' : 'root')), nodeId: ch.nodeId };
    try { if (ch.type !== ProjectItemType.BIN) { o.mediaPath = ch.getMediaPath(); o.isSequence = ch.isSequence(); } } catch (e) {}
    out.push(o);
    if (ch.type === ProjectItemType.BIN && depth < 12) __walk(ch, out, p, depth + 1);
  }
}
function __findItem(ref) {
  var all = []; __walk(app.project.rootItem, all, '', 0);
  var want = String(ref);
  for (var i = 0; i < all.length; i++) if (all[i].path === want || all[i].path === '/' + want || all[i].name === want || all[i].mediaPath === want || all[i].nodeId === want) return __byNode(app.project.rootItem, all[i].nodeId);
  return null;
}
function __byNode(item, id) {
  for (var i = 0; i < item.children.numItems; i++) { var ch = item.children[i]; if (ch.nodeId === id) return ch; if (ch.type === ProjectItemType.BIN) { var r = __byNode(ch, id); if (r) return r; } }
  return null;
}
function __bin(path, create) {
  if (!path) return app.project.rootItem;
  var parts = String(path).split('/'), cur = app.project.rootItem;
  for (var p = 0; p < parts.length; p++) {
    if (!parts[p]) continue; var found = null;
    for (var i = 0; i < cur.children.numItems; i++) { var ch = cur.children[i]; if (ch.type === ProjectItemType.BIN && ch.name === parts[p]) { found = ch; break; } }
    if (!found) { if (!create) throw new Error('Bin not found: ' + path); found = cur.createBin(parts[p]); }
    cur = found;
  }
  return cur;
}
function __comp_(clip, name) { for (var i = 0; i < clip.components.numItems; i++) { var c = clip.components[i]; if (c.displayName === name || c.matchName === name) return c; } return null; }
function __param(comp, name) { for (var i = 0; i < comp.properties.numItems; i++) { var p = comp.properties[i]; if (p.displayName === name) return p; } return null; }
function __dbToLevel(db) { return Math.pow(10, (Number(db) - 15) / 20); }
function __levelToDb(v) { return 20 * Math.log(v) / Math.LN10 + 15; }
function __qeSeq() { app.enableQE(); return qe.project.getActiveSequence(); }
function __frameSize(seq) { var s = seq.getSettings(); return [s.videoFrameWidth, s.videoFrameHeight]; }
function __seqFps(seq) { try { return __TICKS / parseInt(seq.timebase, 10); } catch (e) { return 25; } }
function __tcOf(seq, sec) {
  var fps = __seqFps(seq), rf = Math.round(fps), tf = Math.round(sec * fps);
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  var h = Math.floor(tf / (rf * 3600)), m = Math.floor((tf % (rf * 3600)) / (rf * 60)), s = Math.floor((tf % (rf * 60)) / rf), f = tf % rf;
  return pad(h) + ':' + pad(m) + ':' + pad(s) + ':' + pad(f);
}
function __qeFor(seq) {
  app.enableQE();
  for (var i = 0; i < 25; i++) {
    var a = app.project.activeSequence;
    if (!a || a.sequenceID !== seq.sequenceID) { try { app.project.openSequence(seq.sequenceID); } catch (e) {} try { app.project.activeSequence = seq; } catch (e2) {} }
    var q = qe.project.getActiveSequence();
    if (q && q.name === seq.name && (i > 0 || (a && a.sequenceID === seq.sequenceID))) return q;
    $.sleep(120);
  }
  throw new Error('QE could not address sequence ' + seq.name + ' (open it in the timeline and retry)');
}
function __qeTrack(qs, id) { var m = String(id).toUpperCase().match(/^([VA])(\\d+)$/); if (!m) throw new Error("Bad track id " + id); return m[1] === 'V' ? qs.getVideoTrackAt(Number(m[2]) - 1) : qs.getAudioTrackAt(Number(m[2]) - 1); }
function __qeClip(qeTrack, dom) {
  var tt = String(dom.start.ticks), best = null, bd = null;
  for (var i = 0; i < qeTrack.numItems; i++) { var it = qeTrack.getItemAt(i); if (!it || String(it.type) !== 'Clip') continue; var t = String(it.start.ticks); if (t === tt) return it; var d = Math.abs(parseFloat(t) - parseFloat(tt)); if (best === null || d < bd) { best = it; bd = d; } }
  return best;
}
function __clipKeyTime(c, seqSec) { return c.inPoint.seconds + (seqSec - c.start.seconds); }
function __tracksOf(seq, list) {
  var out = [];
  if (list && list.length) { for (var i = 0; i < list.length; i++) out.push({ id: String(list[i]).toUpperCase(), t: __track(seq, list[i]) }); return out; }
  for (var v = 0; v < seq.videoTracks.numTracks; v++) out.push({ id: 'V' + (v + 1), t: seq.videoTracks[v] });
  for (var a = 0; a < seq.audioTracks.numTracks; a++) out.push({ id: 'A' + (a + 1), t: seq.audioTracks[a] });
  return out;
}
`;

const PS = COMMON + `
function s2t(s) { return stringIDToTypeID(s); }
function c2t(s) { return charIDToTypeID(s); }
function __doc(name) {
  if (!app.documents.length) throw new Error('No open Photoshop document.');
  if (!name) return app.activeDocument;
  for (var i = 0; i < app.documents.length; i++) if (app.documents[i].name === name) return app.documents[i];
  throw new Error('Document not found: ' + name);
}
function __findLayer(container, name) {
  for (var i = 0; i < container.layers.length; i++) { var l = container.layers[i]; if (l.name === name) return l; if (l.typename === 'LayerSet') { var r = __findLayer(l, name); if (r) return r; } }
  return null;
}
function __lyr(doc, ref) {
  if (ref === undefined || ref === null || ref === '') return doc.activeLayer;
  var l = __findLayer(doc, String(ref)); if (!l) throw new Error('Layer not found: ' + ref); return l;
}
function __solid(h) { var c = new SolidColor(); var r = __rgb255(h); c.rgb.red = r[0]; c.rgb.green = r[1]; c.rgb.blue = r[2]; return c; }
function __layers(container, out, depth, path) {
  for (var i = 0; i < container.layers.length; i++) {
    var l = container.layers[i], o = { name: l.name, path: path + l.name, type: l.typename, visible: l.visible, opacity: l.opacity, depth: depth };
    try { o.kind = String(l.kind); o.blendMode = String(l.blendMode); var b = l.bounds; o.bounds = [b[0].as('px'), b[1].as('px'), b[2].as('px'), b[3].as('px')]; } catch (e) {}
    try { if (l.kind === LayerKind.TEXT) o.text = l.textItem.contents; } catch (e2) {}
    out.push(o);
    if (l.typename === 'LayerSet') __layers(l, out, depth + 1, path + l.name + '/');
  }
}
/* batchPlay-style JSON -> ActionDescriptor: {"_obj":"gaussianBlur","radius":{"_unit":"pixelsUnit","_value":5}} */
/* ids are stringIDs ("gaussianBlur"); prefix with $ for a charID ("$Lyr ") */
function __id(s) { s = String(s); return s.charAt(0) === '$' ? c2t(s.substr(1)) : s2t(s); }
function __putVal(desc, isList, key, v) {
  var k = isList ? null : __id(key);
  if (v === null || v === undefined) return;
  if (typeof v === 'boolean') { if (isList) desc.putBoolean(v); else desc.putBoolean(k, v); return; }
  if (typeof v === 'number') { if (isList) { if (Math.floor(v) === v) desc.putInteger(v); else desc.putDouble(v); } else { if (Math.floor(v) === v && Math.abs(v) < 2147483647) desc.putInteger(k, v); else desc.putDouble(k, v); } return; }
  if (typeof v === 'string') { if (isList) desc.putString(v); else desc.putString(k, v); return; }
  if (v instanceof Array) { var l = new ActionList(); for (var i = 0; i < v.length; i++) __putVal(l, true, null, v[i]); if (isList) desc.putList(l); else desc.putList(k, l); return; }
  if (v._unit !== undefined) { if (isList) desc.putUnitDouble(__id(v._unit), v._value); else desc.putUnitDouble(k, __id(v._unit), v._value); return; }
  if (v._enum !== undefined) { if (isList) desc.putEnumerated(__id(v._enum), __id(v._value)); else desc.putEnumerated(k, __id(v._enum), __id(v._value)); return; }
  if (v._path !== undefined) { if (isList) desc.putPath(new File(v._path)); else desc.putPath(k, new File(v._path)); return; }
  if (v._class !== undefined && v._obj === undefined) { if (isList) desc.putClass(__id(v._class)); else desc.putClass(k, __id(v._class)); return; }
  if (v._ref !== undefined || (v[0] && v[0]._ref)) { var r = __ref(v); if (isList) desc.putReference(r); else desc.putReference(k, r); return; }
  var d = __desc(v); var cls = v._obj ? __id(v._obj) : s2t('object');
  if (isList) desc.putObject(cls, d); else desc.putObject(k, cls, d);
}
function __desc(o) { var d = new ActionDescriptor(); for (var key in o) { if (key.charAt(0) === '_' && (key === '_obj' || key === '_target' || key === '_options' || key === '_isCommand')) continue; __putVal(d, false, key, o[key]); } return d; }
function __ref(spec) {
  var r = new ActionReference(); var arr = (spec instanceof Array) ? spec : [spec];
  for (var i = 0; i < arr.length; i++) {
    var s = arr[i], cls = __id(s._ref);
    if (s._name !== undefined) r.putName(cls, s._name);
    else if (s._id !== undefined) r.putIdentifier(cls, s._id);
    else if (s._index !== undefined) r.putIndex(cls, s._index);
    else if (s._offset !== undefined) r.putOffset(cls, s._offset);
    else if (s._enum !== undefined) r.putEnumerated(cls, __id(s._enum), __id(s._value));
    else if (s._property !== undefined) r.putProperty(cls, __id(s._property));
    else r.putEnumerated(cls, c2t('Ordn'), c2t('Trgt'));
  }
  return r;
}
function __play(cmd, dialogs) {
  var d = __desc(cmd);
  if (cmd._target) d.putReference(c2t('null'), __ref(cmd._target));
  var res = executeAction(__id(cmd._obj), d, dialogs ? DialogModes.ALL : DialogModes.NO);
  return __descToJson(res, 0);
}
function __descToJson(d, depth) {
  if (!d || depth > 6) return null; var o = {};
  for (var i = 0; i < d.count; i++) {
    var k = d.getKey(i), name = typeIDToStringID(k) || typeIDToCharID(k), t = d.getType(k);
    try {
      if (t === DescValueType.STRINGTYPE) o[name] = d.getString(k);
      else if (t === DescValueType.INTEGERTYPE) o[name] = d.getInteger(k);
      else if (t === DescValueType.DOUBLETYPE) o[name] = d.getDouble(k);
      else if (t === DescValueType.BOOLEANTYPE) o[name] = d.getBoolean(k);
      else if (t === DescValueType.UNITDOUBLE) o[name] = { _unit: typeIDToStringID(d.getUnitDoubleType(k)), _value: d.getUnitDoubleValue(k) };
      else if (t === DescValueType.ENUMERATEDTYPE) o[name] = { _enum: typeIDToStringID(d.getEnumerationType(k)), _value: typeIDToStringID(d.getEnumerationValue(k)) };
      else if (t === DescValueType.OBJECTTYPE) o[name] = __descToJson(d.getObjectValue(k), depth + 1);
      else if (t === DescValueType.LISTTYPE) { var l = d.getList(k), a = []; for (var j = 0; j < Math.min(l.count, 200); j++) { var lt = l.getType(j); if (lt === DescValueType.OBJECTTYPE) a.push(__descToJson(l.getObjectValue(j), depth + 1)); else if (lt === DescValueType.STRINGTYPE) a.push(l.getString(j)); else if (lt === DescValueType.INTEGERTYPE) a.push(l.getInteger(j)); else if (lt === DescValueType.DOUBLETYPE) a.push(l.getDouble(j)); } o[name] = a; }
      else o[name] = String(t);
    } catch (e) { o[name] = '?'; }
  }
  return o;
}
function __docInfo(d) { return { name: d.name, width: d.width.as('px'), height: d.height.as('px'), resolution: d.resolution, mode: String(d.mode), bits: String(d.bitsPerChannel), layers: d.layers.length, path: (function () { try { return d.fullName.fsName; } catch (e) { return ''; } })(), saved: d.saved }; }
var __oldUnits; try { __oldUnits = app.preferences.rulerUnits; app.preferences.rulerUnits = Units.PIXELS; } catch (__pu) {}
`;

const AI = COMMON + `
function __doc(name) {
  if (!app.documents.length) throw new Error('No open Illustrator document.');
  if (!name) return app.activeDocument;
  for (var i = 0; i < app.documents.length; i++) if (app.documents[i].name === name) return app.documents[i];
  throw new Error('Document not found: ' + name);
}
function __color(doc, h) {
  if (h === null || h === undefined || h === 'none') return new NoColor();
  var r = __rgb255(h);
  if (doc.documentColorSpace === DocumentColorSpace.CMYK) {
    var R = r[0] / 255, G = r[1] / 255, B = r[2] / 255, K = 1 - Math.max(R, G, B), c = new CMYKColor();
    c.black = K * 100; c.cyan = K < 1 ? (1 - R - K) / (1 - K) * 100 : 0; c.magenta = K < 1 ? (1 - G - K) / (1 - K) * 100 : 0; c.yellow = K < 1 ? (1 - B - K) / (1 - K) * 100 : 0; return c;
  }
  var col = new RGBColor(); col.red = r[0]; col.green = r[1]; col.blue = r[2]; return col;
}
function __ailayer(doc, name, create) {
  if (!name) return doc.activeLayer;
  try { return doc.layers.getByName(name); } catch (e) { if (!create) throw new Error('Layer not found: ' + name); var l = doc.layers.add(); l.name = name; return l; }
}
function __item(doc, ref) {
  if (ref === undefined || ref === null) { if (doc.selection && doc.selection.length) return doc.selection[0]; throw new Error('Pass item (name) or select something.'); }
  try { return doc.pageItems.getByName(String(ref)); } catch (e) { throw new Error('Item not found: ' + ref); }
}
/* Convert top-left based [x,y] (y down, artboard-relative) to Illustrator document coordinates. */
function __pt(doc, x, y, ab) {
  var r = doc.artboards[__def(ab, doc.artboards.getActiveArtboardIndex())].artboardRect; return [r[0] + x, r[1] - y];
}
function __iteminfo(it) { var o = { name: it.name, type: it.typename, layer: (function () { try { return it.layer.name; } catch (e) { return ''; } })(), bounds: it.geometricBounds, hidden: it.hidden, locked: it.locked }; try { o.opacity = it.opacity; } catch (e) {} try { if (it.typename === 'TextFrame') o.text = it.contents; } catch (e2) {} return o; }
`;

export const PRELUDE: Record<AppId, string> = { ae: AE, pr: PR, ps: PS, ai: AI, ame: COMMON };
