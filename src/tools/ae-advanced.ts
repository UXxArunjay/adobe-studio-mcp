/** After Effects — advanced tools beyond Filmit: project, 3D/camera, markers, time, render/AME, MOGRT, menu commands, scripts, effects catalog. */
import { z } from 'zod';
import { jsxTool, zComp, zLayer, zLayerOpt, zLayers, zVec, zValue } from './define.js';

const R = String.raw;

/* ---------- project ---------- */
jsxTool({ name: 'ae_getProjectState', toolset: 'ae', app: 'ae', readOnly: true,
  description: 'After Effects: project overview — file path, dirty flag, bit depth, every item (comps/footage/folders with ids, sizes, durations, folder), render queue count, AE version.',
  input: { includeFootage: z.boolean().optional() },
  jsx: R`var p = app.project, items = [];
for (var i = 1; i <= p.numItems; i++) { var it = p.item(i); if (!ARGS.includeFootage && it instanceof FootageItem) continue;
  var o = { id: it.id, name: it.name, type: it.typeName, folder: it.parentFolder ? it.parentFolder.name : '' };
  if (it instanceof CompItem) { o.width = it.width; o.height = it.height; o.duration = it.duration; o.frameRate = it.frameRate; o.layers = it.numLayers; }
  if (it instanceof FootageItem) { try { o.file = it.file ? it.file.fsName : ''; o.missing = it.footageMissing; } catch (e) {} }
  items.push(o); }
return { file: p.file ? p.file.fsName : null, dirty: p.dirty, bitsPerChannel: p.bitsPerChannel, numItems: p.numItems, activeItem: p.activeItem ? p.activeItem.name : null,
  renderQueue: p.renderQueue.numItems, version: app.version, items: items };` });

jsxTool({ name: 'ae_openProject', toolset: 'ae', app: 'ae', timeoutMs: 600000,
  description: 'After Effects: open an .aep/.aepx project (current one must be saved, or pass discardChanges:true).',
  input: { path: z.string(), discardChanges: z.boolean().optional() },
  jsx: R`var f = __file(ARGS.path); if (!f.exists) throw new Error('Not found: ' + ARGS.path);
if (app.project.dirty && !ARGS.discardChanges) throw new Error('Current project has unsaved changes. Save first (ae_saveProject) or pass discardChanges:true.');
if (ARGS.discardChanges) app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
var p = app.open(f); return { opened: p.file.fsName, items: p.numItems };` });

jsxTool({ name: 'ae_newProject', toolset: 'ae', app: 'ae',
  description: 'After Effects: start a new empty project (refuses if the current one is unsaved unless discardChanges:true).',
  input: { discardChanges: z.boolean().optional() },
  jsx: R`if (app.project.dirty && !ARGS.discardChanges) throw new Error('Unsaved changes. Save first or pass discardChanges:true.');
app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); app.newProject(); return { ok: true };` });

jsxTool({ name: 'ae_saveProject', toolset: 'ae', app: 'ae', timeoutMs: 300000,
  description: 'After Effects: save the project (Ctrl+S), or Save As when path is given. backup:true also writes a timestamped copy into a "Backups" folder next to the project.',
  input: { path: z.string().optional(), backup: z.boolean().optional(), incremental: z.boolean().optional().describe('Increment and Save (_01, _02 ...)') },
  jsx: R`var p = app.project;
if (ARGS.incremental) { p.saveWithIncrementalNumber ? app.executeCommand(app.findMenuCommandId('Increment and Save')) : p.save(); }
else if (ARGS.path) p.save(__file(ARGS.path)); else { if (!p.file) throw new Error('Project was never saved — pass path.'); p.save(); }
var res = { saved: p.file ? p.file.fsName : null };
if (ARGS.backup && p.file) { var d = new Folder(p.file.parent.fsName + '/Backups'); if (!d.exists) d.create();
  var n = new Date(), pad = function (x) { return (x < 10 ? '0' : '') + x; };
  var stamp = n.getFullYear() + pad(n.getMonth() + 1) + pad(n.getDate()) + '_' + pad(n.getHours()) + pad(n.getMinutes()) + pad(n.getSeconds());
  var dst = d.fsName + '/' + p.file.name.replace(/\.aepx?$/i, '') + '_backup_' + stamp + '.aep'; p.file.copy(dst); res.backup = dst; }
return res;` });

jsxTool({ name: 'ae_importFile', toolset: 'ae', app: 'ae', undo: true, timeoutMs: 600000,
  description: 'After Effects: import files (footage, audio, image sequences, PSD/AI as comp or footage, .aep projects, .prproj Premiere projects) into a project folder without adding to a comp.',
  input: { paths: z.array(z.string()), importAs: z.enum(['footage', 'comp', 'compCroppedLayers', 'project']).optional(), sequence: z.boolean().optional(), folder: z.string().optional() },
  jsx: R`var out = [], T = { footage: ImportAsType.FOOTAGE, comp: ImportAsType.COMP, compCroppedLayers: ImportAsType.COMP_CROPPED_LAYERS, project: ImportAsType.PROJECT };
for (var i = 0; i < ARGS.paths.length; i++) { var f = __file(ARGS.paths[i]); if (!f.exists) { out.push({ path: ARGS.paths[i], error: 'not found' }); continue; }
  var io = new ImportOptions(f); if (ARGS.importAs && io.canImportAs(T[ARGS.importAs])) io.importAs = T[ARGS.importAs]; if (ARGS.sequence) io.sequence = true;
  var it = app.project.importFile(io); if (ARGS.folder) it.parentFolder = __folder(ARGS.folder, true); out.push({ path: f.fsName, item: it.name, id: it.id, type: it.typeName }); }
return out;` });

jsxTool({ name: 'ae_manageItems', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: project item ops — rename, move to folder, delete, replace footage source (relink), set label, create folder, consolidate/reduce/remove unused.',
  input: { action: z.enum(['rename', 'move', 'delete', 'replaceFootage', 'label', 'createFolder', 'removeUnused', 'consolidate', 'reduceToSelectedComps']), item: z.union([z.string(), z.number()]).optional(),
    newName: z.string().optional(), folder: z.string().optional(), path: z.string().optional(), label: z.number().int().optional() },
  jsx: R`var a = ARGS.action, p = app.project;
if (a === 'createFolder') return { folder: __folder(ARGS.folder || ARGS.newName, true).name };
if (a === 'removeUnused') return { removed: p.removeUnusedFootage() };
if (a === 'consolidate') return { removed: p.consolidateFootage() };
var it = __item(ARGS.item);
if (a === 'rename') it.name = ARGS.newName; else if (a === 'move') it.parentFolder = __folder(ARGS.folder, true);
else if (a === 'delete') { var n = it.name; it.remove(); return { deleted: n }; }
else if (a === 'replaceFootage') it.replace(__file(ARGS.path)); else if (a === 'label') it.label = ARGS.label;
else if (a === 'reduceToSelectedComps') p.reduceProject([it]);
return { item: it.name, id: it.id };` });

jsxTool({ name: 'ae_setCompSettings', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: change comp settings — name, width, height, duration, frameRate, pixelAspect, bgColor, work area, render 3D renderer, preserve resolution, shy/frame-blending switches.',
  input: { compositionName: zComp, name: z.string().optional(), width: z.number().int().optional(), height: z.number().int().optional(), duration: z.number().optional(), frameRate: z.number().optional(),
    pixelAspect: z.number().optional(), bgColor: z.string().optional(), workAreaStart: z.number().optional(), workAreaDuration: z.number().optional(), renderer: z.string().optional().describe('ADBE Advanced 3d | ADBE Calder | ADBE Ernst (Cinema 4D)'),
    hideShyLayers: z.boolean().optional(), frameBlending: z.boolean().optional(), resolutionFactor: zVec.optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var k = ['name', 'width', 'height', 'duration', 'frameRate', 'pixelAspect', 'workAreaStart', 'workAreaDuration', 'renderer', 'hideShyLayers', 'frameBlending', 'resolutionFactor'];
for (var i = 0; i < k.length; i++) if (ARGS[k[i]] !== undefined) c[k[i]] = ARGS[k[i]];
if (ARGS.bgColor) c.bgColor = __hex(ARGS.bgColor); return __compInfo(c);` });

jsxTool({ name: 'ae_openComp', toolset: 'ae', app: 'ae',
  description: 'After Effects: open a comp in the viewer/timeline and optionally move the playhead (time) — makes it the active comp.',
  input: { compositionName: z.string(), time: z.number().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); c.openInViewer(); if (ARGS.time !== undefined) c.time = ARGS.time; return __compInfo(c);` });

jsxTool({ name: 'ae_setCurrentTime', toolset: 'ae', app: 'ae',
  description: 'After Effects: move the comp playhead (current time indicator).',
  input: { compositionName: zComp, time: z.number() },
  jsx: R`var c = __comp(ARGS.compositionName); c.time = ARGS.time; return { time: c.time };` });

/* ---------- 3D ---------- */
jsxTool({ name: 'ae_addCamera', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: add a 3D camera (preset focal length mm, e.g. 35/50/85), with optional position/pointOfInterest, one-node (no POI), depth of field (focusDistance, aperture, blurLevel).',
  input: { compositionName: zComp, name: z.string().optional(), focalLength: z.number().optional(), position: zVec.optional(), pointOfInterest: zVec.optional(), oneNode: z.boolean().optional(),
    depthOfField: z.boolean().optional(), focusDistance: z.number().optional(), aperture: z.number().optional(), blurLevel: z.number().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var cam = c.layers.addCamera(__def(ARGS.name, 'Camera'), [c.width / 2, c.height / 2]);
var opt = cam.property('ADBE Camera Options Group');
if (ARGS.focalLength) { var filmW = 36; opt.property('ADBE Camera Zoom').setValue(c.width * ARGS.focalLength / filmW); }
if (ARGS.oneNode) cam.autoOrient = AutoOrientType.NO_AUTO_ORIENT;
var zoomV = opt.property('ADBE Camera Zoom').value; cam.transform.position.setValue(ARGS.position || [c.width / 2, c.height / 2, -zoomV]); if (!ARGS.oneNode) cam.transform.pointOfInterest.setValue([c.width / 2, c.height / 2, 0]); if (ARGS.pointOfInterest && !ARGS.oneNode) cam.transform.pointOfInterest.setValue(ARGS.pointOfInterest);
if (ARGS.depthOfField) { opt.property('ADBE Camera Depth of Field').setValue(1); if (ARGS.focusDistance) opt.property('ADBE Camera Focus Distance').setValue(ARGS.focusDistance); if (ARGS.aperture) opt.property('ADBE Camera Aperture').setValue(ARGS.aperture); if (ARGS.blurLevel) opt.property('ADBE Camera Blur Level').setValue(ARGS.blurLevel); }
return __linfo(cam, false);` });

jsxTool({ name: 'ae_addLight', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: add a light — point, spot, parallel, ambient — color, intensity %, position, cone angle/feather, casts shadows.',
  input: { compositionName: zComp, type: z.enum(['point', 'spot', 'parallel', 'ambient']).optional(), name: z.string().optional(), color: z.string().optional(), intensity: z.number().optional(),
    position: zVec.optional(), coneAngle: z.number().optional(), coneFeather: z.number().optional(), castsShadows: z.boolean().optional(), shadowDarkness: z.number().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var l = c.layers.addLight(__def(ARGS.name, 'Light'), [c.width / 2, c.height / 2]);
var T = { point: LightType.POINT, spot: LightType.SPOT, parallel: LightType.PARALLEL, ambient: LightType.AMBIENT }; l.lightType = T[__def(ARGS.type, 'point')];
var o = l.property('ADBE Light Options Group');
if (ARGS.color) o.property('ADBE Light Color').setValue(__hex(ARGS.color)); if (ARGS.intensity !== undefined) o.property('ADBE Light Intensity').setValue(ARGS.intensity);
if (ARGS.coneAngle) o.property('ADBE Light Cone Angle').setValue(ARGS.coneAngle); if (ARGS.coneFeather !== undefined) o.property('ADBE Light Cone Feather 2').setValue(ARGS.coneFeather);
if (ARGS.castsShadows !== undefined) o.property('ADBE Light Casts Shadows').setValue(ARGS.castsShadows ? 1 : 0); if (ARGS.shadowDarkness !== undefined) o.property('ADBE Light Shadow Darkness').setValue(ARGS.shadowDarkness);
if (ARGS.position) l.transform.position.setValue(ARGS.position);
return __linfo(l, false);` });

jsxTool({ name: 'ae_set3D', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: make layers 3D (or 2D) and optionally set z position (depth) for parallax, plus material options (castsShadows, acceptsLights, acceptsShadows).',
  input: { compositionName: zComp, layers: zLayers, threeD: z.boolean().optional(), z: z.union([z.number(), z.array(z.number())]).optional().describe('one z for all, or one per layer'),
    castsShadows: z.boolean().optional(), acceptsLights: z.boolean().optional(), acceptsShadows: z.boolean().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var out = [];
for (var i = 0; i < ARGS.layers.length; i++) { var l = __layer(c, ARGS.layers[i]); l.threeDLayer = ARGS.threeD !== false;
  if (ARGS.z !== undefined && l.threeDLayer) { var zz = (ARGS.z instanceof Array) ? ARGS.z[i] : ARGS.z; var p = l.transform.position; var v = p.value; p.numKeys ? p.setValueAtTime(c.time, [v[0], v[1], zz]) : p.setValue([v[0], v[1], zz]); }
  var m = l.property('ADBE Material Options Group');
  if (m) { if (ARGS.castsShadows !== undefined) m.property('ADBE Casts Shadows').setValue(ARGS.castsShadows ? 1 : 0); if (ARGS.acceptsLights !== undefined) m.property('ADBE Accepts Lights').setValue(ARGS.acceptsLights ? 1 : 0); if (ARGS.acceptsShadows !== undefined) m.property('ADBE Accepts Shadows').setValue(ARGS.acceptsShadows ? 1 : 0); }
  out.push(l.name); }
return { layers: out, threeD: ARGS.threeD !== false };` });

jsxTool({ name: 'ae_cameraMove', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: animate a camera with a cinematic preset — pushIn, pullOut, truckLeft, truckRight, pedestalUp, pedestalDown, orbit — from startTime over duration, distance px, with smooth ease. Creates a camera if none.',
  input: { compositionName: zComp, camera: zLayerOpt, move: z.enum(['pushIn', 'pullOut', 'truckLeft', 'truckRight', 'pedestalUp', 'pedestalDown', 'orbit']), startTime: z.number().optional(),
    duration: z.number().optional(), distance: z.number().optional(), ease: z.number().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var cam = null;
if (ARGS.camera !== undefined) cam = __layer(c, ARGS.camera); else { for (var i = 1; i <= c.numLayers; i++) if (c.layer(i) instanceof CameraLayer) { cam = c.layer(i); break; } }
if (!cam) cam = c.layers.addCamera('Camera', [c.width / 2, c.height / 2]);
var t0 = __def(ARGS.startTime, c.time), d = __def(ARGS.duration, 3), D = __def(ARGS.distance, 300), e = __def(ARGS.ease, 60);
var P = cam.transform.position, I = cam.transform.pointOfInterest, p0 = P.valueAtTime(t0, false), i0 = I.valueAtTime(t0, false);
var dv = { pushIn: [0, 0, D], pullOut: [0, 0, -D], truckLeft: [-D, 0, 0], truckRight: [D, 0, 0], pedestalUp: [0, -D, 0], pedestalDown: [0, D, 0] }[ARGS.move];
function key(prop, a, b) { prop.setValueAtTime(t0, a); prop.setValueAtTime(t0 + d, b); __keyEase(prop, prop.nearestKeyIndex(t0), e, e); __keyEase(prop, prop.nearestKeyIndex(t0 + d), e, e); }
if (ARGS.move === 'orbit') { var r = Math.sqrt(Math.pow(p0[0] - i0[0], 2) + Math.pow(p0[2] - i0[2], 2)); var ang = D / r;
  for (var s = 0; s <= 8; s++) { var t = t0 + d * s / 8, a = Math.atan2(p0[0] - i0[0], p0[2] - i0[2]) + ang * s / 8; P.setValueAtTime(t, [i0[0] + Math.sin(a) * r, p0[1], i0[2] + Math.cos(a) * r]); } }
else { key(P, p0, [p0[0] + dv[0], p0[1] + dv[1], p0[2] + dv[2]]); if (ARGS.move !== 'pushIn' && ARGS.move !== 'pullOut') key(I, i0, [i0[0] + dv[0], i0[1] + dv[1], i0[2] + dv[2]]); }
return { camera: cam.name, move: ARGS.move, from: t0, to: t0 + d };` });

/* ---------- layer switches & generic properties ---------- */
jsxTool({ name: 'ae_setLayerSwitches', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: set layer switches — enabled, audioEnabled, solo, shy, locked, guide, collapseTransformation, adjustment, effectsActive, motionBlur, frameBlending, quality (best|draft|wireframe), label (0-16), name, comment, autoOrient, timeRemap.',
  input: { compositionName: zComp, layers: zLayers, enabled: z.boolean().optional(), audioEnabled: z.boolean().optional(), solo: z.boolean().optional(), shy: z.boolean().optional(),
    locked: z.boolean().optional(), guide: z.boolean().optional(), collapseTransformation: z.boolean().optional(), adjustment: z.boolean().optional(), effectsActive: z.boolean().optional(),
    motionBlur: z.boolean().optional(), frameBlending: z.boolean().optional(), quality: z.enum(['best', 'draft', 'wireframe']).optional(), label: z.number().int().optional(), name: z.string().optional(),
    comment: z.string().optional(), autoOrient: z.enum(['none', 'alongPath', 'towardsCamera']).optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var out = [];
var M = { enabled: 'enabled', audioEnabled: 'audioEnabled', solo: 'solo', shy: 'shy', guide: 'guideLayer', collapseTransformation: 'collapseTransformation', adjustment: 'adjustmentLayer', effectsActive: 'effectsActive', motionBlur: 'motionBlur', frameBlending: 'frameBlending', label: 'label', comment: 'comment' };
for (var i = 0; i < ARGS.layers.length; i++) { var l = __layer(c, ARGS.layers[i]); var wasLocked = l.locked; if (wasLocked) l.locked = false;
  for (var k in M) if (ARGS[k] !== undefined) { try { l[M[k]] = ARGS[k]; } catch (e) {} }
  if (ARGS.quality) l.quality = { best: LayerQuality.BEST, draft: LayerQuality.DRAFT, wireframe: LayerQuality.WIREFRAME }[ARGS.quality];
  if (ARGS.autoOrient) l.autoOrient = { none: AutoOrientType.NO_AUTO_ORIENT, alongPath: AutoOrientType.ALONG_PATH, towardsCamera: AutoOrientType.CAMERA_OR_POINT_OF_INTEREST }[ARGS.autoOrient];
  if (ARGS.name && ARGS.layers.length === 1) l.name = ARGS.name;
  l.locked = ARGS.locked !== undefined ? ARGS.locked : wasLocked; out.push(__linfo(l, false)); }
return out;` });

jsxTool({ name: 'ae_setProperty', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: set ANY property by path (any group, effect, shape content, text animator, layer style, material, camera option...) e.g. "Contents>Rectangle 1>Contents>Fill 1>Color", "Effects>CC Light Rays>Intensity", "Layer Styles>Drop Shadow>Opacity". Optional time = keyframe.',
  input: { compositionName: zComp, layer: zLayer, property: z.string(), value: zValue, time: z.number().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var p = __prop(__layer(c, ARGS.layer), ARGS.property); var k = __setProp(p, ARGS.value, ARGS.time);
return { property: p.name, matchName: p.matchName, value: p.valueAtTime(__def(ARGS.time, c.time), false), key: k };` });

jsxTool({ name: 'ae_getProperties', toolset: 'ae', app: 'ae', readOnly: true,
  description: 'After Effects: dump the property tree of a layer (or a sub-group path) — names, matchNames, values, keys, expressions — to discover exact paths for ae_setProperty / ae_setKeyframe.',
  input: { compositionName: zComp, layer: zLayer, path: z.string().optional(), depth: z.number().int().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var l = __layer(c, ARGS.layer); var root = ARGS.path ? __prop(l, ARGS.path) : l; var maxD = __def(ARGS.depth, 4);
function dump(g, d) { var o = []; if (!g.numProperties) return o;
  for (var i = 1; i <= g.numProperties; i++) { var p = g.property(i); var e = { i: i, name: p.name, matchName: p.matchName };
    if (p.propertyType === PropertyType.PROPERTY) { try { if (p.propertyValueType !== PropertyValueType.NO_VALUE && p.propertyValueType !== PropertyValueType.CUSTOM_VALUE) e.value = p.propertyValueType === PropertyValueType.TextDocument ? p.value.text : (p.propertyValueType === PropertyValueType.SHAPE ? 'shape(' + p.value.vertices.length + ' pts)' : p.value); } catch (x) {} if (p.numKeys) e.keys = p.numKeys; if (p.expressionEnabled) e.expression = p.expression; if (!p.canSetExpression) e.noExpr = true; }
    else if (d < maxD) e.children = dump(p, d + 1); else if (p.numProperties) e.children = '…' + p.numProperties;
    o.push(e); }
  return o; }
return { layer: l.name, path: ARGS.path || '', tree: dump(root, 1) };` });

jsxTool({ name: 'ae_selectLayers', toolset: 'ae', app: 'ae',
  description: 'After Effects: select layers (and deselect others) — needed before menu commands that act on the selection (ae_executeCommand).',
  input: { compositionName: zComp, layers: zLayers, properties: z.array(z.string()).optional().describe('also select these property paths on the first layer') },
  jsx: R`var c = __comp(ARGS.compositionName); c.openInViewer(); for (var i = 1; i <= c.numLayers; i++) c.layer(i).selected = false;
for (var j = 0; j < ARGS.layers.length; j++) __layer(c, ARGS.layers[j]).selected = true;
if (ARGS.properties) for (var k = 0; k < ARGS.properties.length; k++) __prop(__layer(c, ARGS.layers[0]), ARGS.properties[k]).selected = true;
return { selected: ARGS.layers };` });

/* ---------- markers ---------- */
jsxTool({ name: 'ae_addMarkers', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: add comp or layer markers [{time, comment?, duration?, chapter?, url?, label?}] — e.g. VO word/sync markers.',
  input: { compositionName: zComp, layer: zLayerOpt, markers: z.array(z.object({ time: z.number(), comment: z.string().optional(), duration: z.number().optional(), chapter: z.string().optional(), url: z.string().optional(), label: z.number().int().optional() })) },
  jsx: R`var c = __comp(ARGS.compositionName); var mp = ARGS.layer !== undefined ? __layer(c, ARGS.layer).property('ADBE Marker') : c.markerProperty;
for (var i = 0; i < ARGS.markers.length; i++) { var m = ARGS.markers[i]; var mv = new MarkerValue(__def(m.comment, '')); if (m.duration) mv.duration = m.duration; if (m.chapter) mv.chapter = m.chapter; if (m.url) mv.url = m.url; if (m.label !== undefined) { try { mv.label = m.label; } catch (e) {} } mp.setValueAtTime(m.time, mv); }
return { added: ARGS.markers.length, total: mp.numKeys };` });

jsxTool({ name: 'ae_getMarkers', toolset: 'ae', app: 'ae', readOnly: true,
  description: 'After Effects: list comp markers (or a layer\'s markers).',
  input: { compositionName: zComp, layer: zLayerOpt },
  jsx: R`var c = __comp(ARGS.compositionName); var mp = ARGS.layer !== undefined ? __layer(c, ARGS.layer).property('ADBE Marker') : c.markerProperty; var o = [];
for (var k = 1; k <= mp.numKeys; k++) { var v = mp.keyValue(k); o.push({ index: k, time: mp.keyTime(k), comment: v.comment, duration: v.duration, chapter: v.chapter }); }
return o;` });

jsxTool({ name: 'ae_deleteMarkers', toolset: 'ae', app: 'ae', undo: true, destructive: true,
  description: 'After Effects: delete comp/layer markers — all, by index list, or within a time range.',
  input: { compositionName: zComp, layer: zLayerOpt, indexes: z.array(z.number().int()).optional(), from: z.number().optional(), to: z.number().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var mp = ARGS.layer !== undefined ? __layer(c, ARGS.layer).property('ADBE Marker') : c.markerProperty; var n = 0;
for (var k = mp.numKeys; k >= 1; k--) { var t = mp.keyTime(k), hit = true; if (ARGS.indexes) { hit = false; for (var i = 0; i < ARGS.indexes.length; i++) if (ARGS.indexes[i] === k) hit = true; } if (ARGS.from !== undefined && t < ARGS.from) hit = false; if (ARGS.to !== undefined && t > ARGS.to) hit = false; if (hit) { mp.removeKey(k); n++; } }
return { deleted: n };` });

/* ---------- time ---------- */
jsxTool({ name: 'ae_timeRemap', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: enable time remapping on a footage/precomp layer and set remap keys [{time, sourceTime}] (freeze frames, speed ramps), or freezeAt a single time.',
  input: { compositionName: zComp, layer: zLayer, keys: z.array(z.object({ time: z.number(), sourceTime: z.number() })).optional(), freezeAt: z.number().optional(), extendTo: z.number().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var l = __layer(c, ARGS.layer); if (!l.canSetTimeRemapEnabled) throw new Error('Layer cannot be time-remapped.');
l.timeRemapEnabled = true; var tr = l.property('ADBE Time Remapping');
if (ARGS.freezeAt !== undefined) { while (tr.numKeys) tr.removeKey(1); tr.setValueAtTime(l.inPoint, ARGS.freezeAt); tr.setInterpolationTypeAtKey(1, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD); }
if (ARGS.keys) for (var i = 0; i < ARGS.keys.length; i++) tr.setValueAtTime(ARGS.keys[i].time, ARGS.keys[i].sourceTime);
if (ARGS.extendTo) l.outPoint = ARGS.extendTo;
return { layer: l.name, keys: tr.numKeys };` });

jsxTool({ name: 'ae_timeStretch', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: time-stretch a layer (stretch % — 200 = half speed, -100 = reverse) or set playback speed %.',
  input: { compositionName: zComp, layer: zLayer, stretch: z.number().optional(), speed: z.number().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var l = __layer(c, ARGS.layer); l.stretch = ARGS.speed ? 10000 / ARGS.speed : __def(ARGS.stretch, 100); return { layer: l.name, stretch: l.stretch, inPoint: l.inPoint, outPoint: l.outPoint };` });

jsxTool({ name: 'ae_sequenceLayers', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: arrange layers one after another (like Keyframe Assistant > Sequence Layers) with overlap seconds, or stagger start times by offset.',
  input: { compositionName: zComp, layers: zLayers, startTime: z.number().optional(), overlap: z.number().optional(), stagger: z.number().optional().describe('if set: start_i = startTime + i*stagger (durations kept)') },
  jsx: R`var c = __comp(ARGS.compositionName); var t = __def(ARGS.startTime, 0), out = [];
for (var i = 0; i < ARGS.layers.length; i++) { var l = __layer(c, ARGS.layers[i]); var dur = l.outPoint - l.inPoint, off = l.inPoint - l.startTime;
  var start = ARGS.stagger !== undefined ? __def(ARGS.startTime, 0) + i * ARGS.stagger : t; l.startTime = start - off; t = start + dur - __def(ARGS.overlap, 0); out.push({ name: l.name, in: l.inPoint, out: l.outPoint }); }
return out;` });

jsxTool({ name: 'ae_alignLayers', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: align layers to the comp — left, hCenter, right, top, vCenter, bottom, center — with margin px (uses visual bounds, respects anchor point).',
  input: { compositionName: zComp, layers: zLayers, align: z.enum(['left', 'hCenter', 'right', 'top', 'vCenter', 'bottom', 'center']), margin: z.number().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var m = __def(ARGS.margin, 0), out = [];
for (var i = 0; i < ARGS.layers.length; i++) { var l = __layer(c, ARGS.layers[i]); var r = l.sourceRectAtTime(c.time, false); var s = l.transform.scale.value, a = l.transform.anchorPoint.value, p = l.transform.position.value;
  var w = r.width * s[0] / 100, h = r.height * s[1] / 100, left = p[0] + (r.left - a[0]) * s[0] / 100, top = p[1] + (r.top - a[1]) * s[1] / 100; var nx = p[0], ny = p[1];
  if (ARGS.align === 'left') nx += m - left; if (ARGS.align === 'right') nx += (c.width - m) - (left + w); if (ARGS.align === 'hCenter' || ARGS.align === 'center') nx += c.width / 2 - (left + w / 2);
  if (ARGS.align === 'top') ny += m - top; if (ARGS.align === 'bottom') ny += (c.height - m) - (top + h); if (ARGS.align === 'vCenter' || ARGS.align === 'center') ny += c.height / 2 - (top + h / 2);
  var v = p.length > 2 ? [nx, ny, p[2]] : [nx, ny]; __setProp(l.transform.position, v); out.push({ name: l.name, position: v }); }
return out;` });

/* ---------- effects catalog, presets, commands, scripts ---------- */
jsxTool({ name: 'ae_listEffects', toolset: 'ae', app: 'ae', readOnly: true,
  description: 'After Effects: list every installed effect — built-in AND third-party plugins (Red Giant, Sapphire, BorisFX, Video Copilot...) — displayName, matchName, category. Filter by text/category.',
  input: { filter: z.string().optional(), category: z.string().optional(), limit: z.number().int().optional() },
  jsx: R`var out = [], f = ARGS.filter ? String(ARGS.filter).toLowerCase() : '', cat = ARGS.category ? String(ARGS.category).toLowerCase() : '';
var E = app.effects; for (var i = 0; i < E.length; i++) { var e = E[i]; var dn = String(e.displayName), mn = String(e.matchName), ct = String(e.category);
  if (f && dn.toLowerCase().indexOf(f) < 0 && mn.toLowerCase().indexOf(f) < 0) continue; if (cat && ct.toLowerCase().indexOf(cat) < 0) continue;
  out.push({ name: dn, matchName: mn, category: ct }); if (out.length >= __def(ARGS.limit, 2000)) break; }
return { total: E.length, returned: out.length, effects: out };` });

jsxTool({ name: 'ae_applyPreset', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: apply an animation preset (.ffx — including third-party preset packs) to layers.',
  input: { compositionName: zComp, layers: zLayers, path: z.string() },
  jsx: R`var c = __comp(ARGS.compositionName); var f = __file(ARGS.path); if (!f.exists) throw new Error('Preset not found: ' + ARGS.path);
for (var i = 0; i < ARGS.layers.length; i++) __layer(c, ARGS.layers[i]).applyPreset(f); return { applied: f.name, layers: ARGS.layers };` });

jsxTool({ name: 'ae_executeCommand', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: run ANY menu command by name ("Create Shapes from Vector Layer", "Convert Audio to Keyframes", "Drop Shadow" layer style, "Scene Edit Detection", script/panel names under Window...) or numeric command id. Acts on the current selection — use ae_selectLayers first.',
  input: { command: z.union([z.string(), z.number().int()]), compositionName: zComp, layers: zLayers.optional() },
  jsx: R`if (ARGS.layers) { var c = __comp(ARGS.compositionName); c.openInViewer(); for (var i = 1; i <= c.numLayers; i++) c.layer(i).selected = false; for (var j = 0; j < ARGS.layers.length; j++) __layer(c, ARGS.layers[j]).selected = true; }
var id = typeof ARGS.command === 'number' ? ARGS.command : app.findMenuCommandId(ARGS.command);
if (!id) throw new Error('Menu command not found: ' + ARGS.command);
app.executeCommand(id); return { command: ARGS.command, id: id };` });

jsxTool({ name: 'ae_runScriptFile', toolset: 'ae', app: 'ae', timeoutMs: 600000,
  description: 'After Effects: run a .jsx/.jsxbin script file (any installed script, ScriptUI panel or tool) and return its last value. Scripts in Scripts/ScriptUI Panels can be found with adobe_listPlugins.',
  input: { path: z.string(), args: z.record(z.unknown()).optional().describe('exposed to the script as $.global.MCP_ARGS') },
  jsx: R`var f = __file(ARGS.path); if (!f.exists) throw new Error('Script not found: ' + ARGS.path); $.global.MCP_ARGS = ARGS.args || {};
var r = $.evalFile(f); return { ran: f.fsName, result: (r === undefined ? null : (typeof r === 'object' ? String(r) : r)) };` });

/* ---------- render ---------- */
jsxTool({ name: 'ae_addToRenderQueue', toolset: 'ae', app: 'ae',
  description: 'After Effects: add a comp to the Render Queue with output path, output-module template (e.g. "H.264 - Match Render Settings - 15 Mbps", "Lossless", "High Quality with Alpha") and render-settings template; work area or custom range.',
  input: { compositionName: zComp, outputPath: z.string(), outputModuleTemplate: z.string().optional(), renderSettingsTemplate: z.string().optional(), start: z.number().optional(), duration: z.number().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var rq = app.project.renderQueue.items.add(c);
if (ARGS.renderSettingsTemplate) rq.applyTemplate(ARGS.renderSettingsTemplate);
if (ARGS.start !== undefined) rq.timeSpanStart = ARGS.start; if (ARGS.duration !== undefined) rq.timeSpanDuration = ARGS.duration;
var om = rq.outputModule(1); if (ARGS.outputModuleTemplate) om.applyTemplate(ARGS.outputModuleTemplate); om.file = __file(ARGS.outputPath);
return { index: app.project.renderQueue.numItems, comp: c.name, output: om.file.fsName, outputModuleTemplates: om.templates, renderTemplates: rq.templates };` });

jsxTool({ name: 'ae_renderQueue', toolset: 'ae', app: 'ae',
  description: 'After Effects: Render Queue — list items/status, clear (remove all), remove index, or render now (blocking, AE internal renderer).',
  input: { action: z.enum(['list', 'clear', 'remove', 'render']), index: z.number().int().optional() },
  timeoutMs: 6 * 3600 * 1000,
  jsx: R`var rq = app.project.renderQueue;
if (ARGS.action === 'clear') { while (rq.numItems) rq.item(1).remove(); return { cleared: true }; }
if (ARGS.action === 'remove') { rq.item(ARGS.index).remove(); return { removed: ARGS.index }; }
if (ARGS.action === 'render') { rq.render(); }
var o = []; for (var i = 1; i <= rq.numItems; i++) { var it = rq.item(i); var f = ''; try { f = it.outputModule(1).file.fsName; } catch (e) {} o.push({ index: i, comp: it.comp.name, status: String(it.status), output: f, elapsed: it.elapsedSeconds }); }
return o;` });

jsxTool({ name: 'ae_queueInAME', toolset: 'ae', app: 'ae', timeoutMs: 300000,
  description: 'After Effects: send queued Render Queue items to Adobe Media Encoder (preferred render path), optionally adding a comp first and starting the AME queue immediately.',
  input: { compositionName: zComp, outputPath: z.string().optional(), addComp: z.boolean().optional(), startRender: z.boolean().optional() },
  jsx: R`var rq = app.project.renderQueue;
if (ARGS.addComp || ARGS.outputPath) { var c = __comp(ARGS.compositionName); var it = rq.items.add(c); if (ARGS.outputPath) it.outputModule(1).file = __file(ARGS.outputPath); }
if (!rq.canQueueInAME) throw new Error('Nothing queued for AME (Render Queue items must be in Queued state) or AME is not installed.');
rq.queueInAME(ARGS.startRender !== false); return { sentToAME: true, startRender: ARGS.startRender !== false };` });

/* ---------- Essential Graphics / MOGRT ---------- */
jsxTool({ name: 'ae_essentialGraphics', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: add properties to the Essential Graphics panel ({layer, property, name?}[]), set template name, and/or export the comp as a .mogrt for Premiere.',
  input: { compositionName: zComp, templateName: z.string().optional(), add: z.array(z.object({ layer: zLayer, property: z.string(), name: z.string().optional() })).optional(), exportPath: z.string().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); if (ARGS.templateName) c.motionGraphicsTemplateName = ARGS.templateName; var added = [];
if (ARGS.add) for (var i = 0; i < ARGS.add.length; i++) { var a = ARGS.add[i]; var p = __prop(__layer(c, a.layer), a.property); var ok = a.name ? p.addToMotionGraphicsTemplateAs(c, a.name) : p.addToMotionGraphicsTemplate(c); added.push({ property: p.name, ok: ok }); }
var exp = null; if (ARGS.exportPath) exp = c.exportAsMotionGraphicsTemplate(true, ARGS.exportPath);
return { comp: c.name, templateName: c.motionGraphicsTemplateName, added: added, exported: exp };` });

jsxTool({ name: 'ae_purgeMemory', toolset: 'ae', app: 'ae',
  description: 'After Effects: purge caches (all memory & disk cache / undo / image cache) to free RAM on heavy projects.',
  input: { target: z.enum(['all', 'undo', 'image', 'snapshot']).optional() },
  jsx: R`var T = { all: PurgeTarget.ALL_CACHES, undo: PurgeTarget.UNDO_CACHES, image: PurgeTarget.IMAGE_CACHES, snapshot: PurgeTarget.SNAPSHOT_CACHES }; app.purge(T[__def(ARGS.target, 'all')]); return { purged: __def(ARGS.target, 'all') };` });

jsxTool({ name: 'ae_shapesFromVector', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: convert an Illustrator/vector footage layer into native editable shape layers (Create Shapes from Vector Layer).',
  input: { compositionName: zComp, layer: zLayer },
  jsx: R`var c = __comp(ARGS.compositionName); c.openInViewer(); for (var i = 1; i <= c.numLayers; i++) c.layer(i).selected = false; var l = __layer(c, ARGS.layer); l.selected = true;
var n0 = c.numLayers; app.executeCommand(3973); if (c.numLayers === n0) { var id = app.findMenuCommandId('Create Shapes from Vector Layer'); if (id) app.executeCommand(id); }
return { created: c.numLayers - n0, shapeLayer: c.numLayers > n0 ? c.layer(l.index - 1 > 0 ? l.index - 1 : 1).name : null };` });

jsxTool({ name: 'ae_audioToKeyframes', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: Convert Audio to Keyframes on an audio layer (creates "Audio Amplitude" null with sliders) — for audio-reactive animation.',
  input: { compositionName: zComp, layer: zLayer },
  jsx: R`var c = __comp(ARGS.compositionName); c.openInViewer(); for (var i = 1; i <= c.numLayers; i++) c.layer(i).selected = false; __layer(c, ARGS.layer).selected = true;
var id = app.findMenuCommandId('Convert Audio to Keyframes'); if (!id) throw new Error('Command not found'); app.executeCommand(id);
return { created: c.layer(1).name, hint: 'use effect("Both Channels")("Slider") in expressions' };` });
