/** Photoshop — core native tools + Action Manager (batchPlay-style) escape hatch for 100% coverage. */
import { z } from 'zod';
import { jsxTool, zDoc, zVec } from './define.js';
import { imageResult, tempPng } from './util.js';

const R = String.raw;
const zLyr = z.string().optional().describe('Layer name (searched in groups too); omit for the active layer.');

jsxTool({ name: 'ps_getState', toolset: 'ps', app: 'ps', readOnly: true,
  description: 'Photoshop: open documents and the active document — size, resolution, mode, bit depth, path, saved flag, full layer tree (type/kind, visibility, opacity, blend, bounds, text), active layer.',
  input: { document: zDoc },
  jsx: R`var docs = []; for (var i = 0; i < app.documents.length; i++) docs.push(app.documents[i].name);
if (!app.documents.length) return { version: app.version, documents: [] };
var d = __doc(ARGS.document); var layers = []; __layers(d, layers, 0, '');
return { version: app.version, documents: docs, active: __docInfo(d), activeLayer: d.activeLayer.name, layers: layers };` });

jsxTool({ name: 'ps_newDocument', toolset: 'ps', app: 'ps',
  description: 'Photoshop: create a new document (px) — width, height, resolution, name, mode rgb|cmyk|gray|lab, fill white|black|transparent|background, bits 8|16|32.',
  input: { width: z.number(), height: z.number(), resolution: z.number().optional(), name: z.string().optional(), mode: z.enum(['rgb', 'cmyk', 'gray', 'lab']).optional(), fill: z.enum(['white', 'black', 'transparent', 'background']).optional(), bits: z.enum(['8', '16', '32']).optional() },
  jsx: R`var M = { rgb: NewDocumentMode.RGB, cmyk: NewDocumentMode.CMYK, gray: NewDocumentMode.GRAYSCALE, lab: NewDocumentMode.LAB };
var F = { white: DocumentFill.WHITE, black: DocumentFill.WHITE, transparent: DocumentFill.TRANSPARENT, background: DocumentFill.BACKGROUNDCOLOR };
var B = { '8': BitsPerChannelType.EIGHT, '16': BitsPerChannelType.SIXTEEN, '32': BitsPerChannelType.THIRTYTWO };
var d = app.documents.add(UnitValue(ARGS.width, 'px'), UnitValue(ARGS.height, 'px'), __def(ARGS.resolution, 72), __def(ARGS.name, 'Untitled'), M[__def(ARGS.mode, 'rgb')], F[__def(ARGS.fill, 'white')], 1, B[__def(ARGS.bits, '8')]);
if (ARGS.fill === 'black') { d.selection.selectAll(); d.selection.fill(__solid('#000000')); d.selection.deselect(); }
return __docInfo(d);` });

jsxTool({ name: 'ps_openFile', toolset: 'ps', app: 'ps', timeoutMs: 300000,
  description: 'Photoshop: open image/PSD/PDF/RAW files (asSmartObject opens as smart object).',
  input: { paths: z.array(z.string()), asSmartObject: z.boolean().optional() },
  jsx: R`var out = []; for (var i = 0; i < ARGS.paths.length; i++) { var f = __file(ARGS.paths[i]); if (!f.exists) { out.push({ path: ARGS.paths[i], error: 'not found' }); continue; } var d = app.open(f, undefined, !!ARGS.asSmartObject); out.push(__docInfo(d)); } return out;` });

jsxTool({ name: 'ps_saveDocument', toolset: 'ps', app: 'ps', timeoutMs: 300000,
  description: 'Photoshop: save the document — in place (Ctrl+S) or as psd|psb|png|jpg|tif|pdf|webp to path (asCopy default true for non-PSD), jpg quality 0-12, then optionally close.',
  input: { document: zDoc, path: z.string().optional(), format: z.enum(['psd', 'png', 'jpg', 'tif', 'pdf', 'webp']).optional(), quality: z.number().int().optional(), asCopy: z.boolean().optional(), close: z.boolean().optional() },
  jsx: R`var d = __doc(ARGS.document); app.activeDocument = d;
if (!ARGS.path) { d.save(); } else { var f = __file(ARGS.path), fmt = __def(ARGS.format, String(ARGS.path).split('.').pop().toLowerCase()), o;
  if (fmt === 'png') { o = new PNGSaveOptions(); o.compression = 6; }
  else if (fmt === 'jpg' || fmt === 'jpeg') { o = new JPEGSaveOptions(); o.quality = __def(ARGS.quality, 11); o.embedColorProfile = true; }
  else if (fmt === 'tif' || fmt === 'tiff') { o = new TiffSaveOptions(); o.layers = true; }
  else if (fmt === 'pdf') { o = new PDFSaveOptions(); }
  else if (fmt === 'webp') { var dd = new ActionDescriptor(), w = new ActionDescriptor(); w.putEnumerated(s2t('compression'), s2t('WebPCompression'), s2t('compressionLossy')); w.putInteger(s2t('quality'), __def(ARGS.quality, 90)); dd.putObject(s2t('as'), s2t('WebPFormat'), w); dd.putPath(s2t('in'), f); dd.putBoolean(s2t('copy'), true); executeAction(s2t('save'), dd, DialogModes.NO); return { saved: f.fsName }; }
  else { o = new PhotoshopSaveOptions(); o.layers = true; }
  d.saveAs(f, o, ARGS.asCopy !== undefined ? ARGS.asCopy : fmt !== 'psd', Extension.LOWERCASE); }
var p = ''; try { p = d.fullName.fsName; } catch (e) {} if (ARGS.close) d.close(SaveOptions.DONOTSAVECHANGES);
return { saved: ARGS.path || p };` });

jsxTool({ name: 'ps_closeDocument', toolset: 'ps', app: 'ps', destructive: true,
  description: 'Photoshop: close a document — save:true saves first, otherwise changes are discarded.',
  input: { document: zDoc, save: z.boolean().optional() },
  jsx: R`var d = __doc(ARGS.document); var n = d.name; d.close(ARGS.save ? SaveOptions.SAVECHANGES : SaveOptions.DONOTSAVECHANGES); return { closed: n };` });

jsxTool({ name: 'ps_layerOps', toolset: 'ps', app: 'ps',
  description: 'Photoshop: layer operations — select, rename, show, hide, opacity, fillOpacity, blend, delete, duplicate, moveTop, moveBottom, moveUp, moveDown, lock, unlock, rasterize, mergeDown, translate [dx,dy], resize % [x,y], rotate deg, newLayer, newGroup, groupLayers (names), fillColor.',
  input: { document: zDoc, layer: zLyr, action: z.enum(['select', 'rename', 'show', 'hide', 'opacity', 'fillOpacity', 'blend', 'delete', 'duplicate', 'moveTop', 'moveBottom', 'moveUp', 'moveDown', 'lock', 'unlock', 'rasterize', 'mergeDown', 'translate', 'resize', 'rotate', 'newLayer', 'newGroup', 'groupLayers', 'fillColor']),
    value: z.union([z.number(), z.string(), z.array(z.number())]).optional(), name: z.string().optional(), layers: z.array(z.string()).optional() },
  jsx: R`var d = __doc(ARGS.document); app.activeDocument = d; var a = ARGS.action, v = ARGS.value;
if (a === 'newLayer') { var nl = d.artLayers.add(); if (ARGS.name) nl.name = ARGS.name; return { created: nl.name }; }
if (a === 'newGroup') { var g = d.layerSets.add(); if (ARGS.name) g.name = ARGS.name; return { created: g.name }; }
if (a === 'groupLayers') { var grp = d.layerSets.add(); grp.name = __def(ARGS.name, 'Group'); var ls = ARGS.layers || []; for (var i = ls.length - 1; i >= 0; i--) __lyr(d, ls[i]).move(grp, ElementPlacement.INSIDE); return { group: grp.name, layers: ls.length }; }
var l = __lyr(d, ARGS.layer); d.activeLayer = l;
if (a === 'rename') l.name = ARGS.name || String(v); else if (a === 'show') l.visible = true; else if (a === 'hide') l.visible = false;
else if (a === 'opacity') l.opacity = Number(v); else if (a === 'fillOpacity') l.fillOpacity = Number(v);
else if (a === 'blend') { var k = String(v).replace(/([a-z])([A-Z])/g, '$1$2').replace(/[\s_-]/g, '').toUpperCase(); if (!BlendMode[k]) throw new Error('Unknown blend mode ' + v); l.blendMode = BlendMode[k]; }
else if (a === 'delete') { var n = l.name; l.remove(); return { deleted: n }; }
else if (a === 'duplicate') { var dl = l.duplicate(); if (ARGS.name) dl.name = ARGS.name; return { duplicate: dl.name }; }
else if (a === 'moveTop') l.move(d, ElementPlacement.PLACEATBEGINNING); else if (a === 'moveBottom') l.move(d, ElementPlacement.PLACEATEND);
else if (a === 'moveUp') { var r1 = new ActionReference(); r1.putEnumerated(c2t('Lyr '), c2t('Ordn'), c2t('Trgt')); var d1 = new ActionDescriptor(); d1.putReference(c2t('null'), r1); var r2 = new ActionReference(); r2.putEnumerated(c2t('Lyr '), c2t('Ordn'), c2t('Nxt ')); d1.putReference(c2t('T   '), r2); executeAction(c2t('move'), d1, DialogModes.NO); }
else if (a === 'moveDown') { var r3 = new ActionReference(); r3.putEnumerated(c2t('Lyr '), c2t('Ordn'), c2t('Trgt')); var d3 = new ActionDescriptor(); d3.putReference(c2t('null'), r3); var r4 = new ActionReference(); r4.putEnumerated(c2t('Lyr '), c2t('Ordn'), c2t('Prvs')); d3.putReference(c2t('T   '), r4); executeAction(c2t('move'), d3, DialogModes.NO); }
else if (a === 'lock') l.allLocked = true; else if (a === 'unlock') l.allLocked = false;
else if (a === 'rasterize') l.rasterize(RasterizeType.ENTIRELAYER); else if (a === 'mergeDown') l.merge();
else if (a === 'translate') l.translate(UnitValue(v[0], 'px'), UnitValue(v[1], 'px'));
else if (a === 'resize') { var sx = v instanceof Array ? v[0] : Number(v), sy = v instanceof Array ? v[1] : Number(v); l.resize(sx, sy, AnchorPosition.MIDDLECENTER); }
else if (a === 'rotate') l.rotate(Number(v), AnchorPosition.MIDDLECENTER);
else if (a === 'fillColor') { d.selection.selectAll(); d.selection.fill(__solid(v)); d.selection.deselect(); }
return { layer: l.name, action: a };` });

jsxTool({ name: 'ps_addTextLayer', toolset: 'ps', app: 'ps',
  description: 'Photoshop: add a text layer — text, font (PostScript name), size pt, color, position [x,y] px, justification, paragraph box [w,h], tracking, leading, allCaps, fauxBold.',
  input: { document: zDoc, text: z.string(), font: z.string().optional(), size: z.number().optional(), color: z.string().optional(), position: zVec.optional(), justification: z.enum(['left', 'center', 'right']).optional(),
    box: zVec.optional(), tracking: z.number().optional(), leading: z.number().optional(), allCaps: z.boolean().optional(), fauxBold: z.boolean().optional(), name: z.string().optional() },
  jsx: R`var d = __doc(ARGS.document); app.activeDocument = d; var l = d.artLayers.add(); l.kind = LayerKind.TEXT; var t = l.textItem;
if (ARGS.box) { t.kind = TextType.PARAGRAPHTEXT; t.width = UnitValue(ARGS.box[0], 'px'); t.height = UnitValue(ARGS.box[1], 'px'); }
t.contents = String(ARGS.text).replace(/\n/g, '\r'); if (ARGS.font) t.font = ARGS.font; t.size = UnitValue(__def(ARGS.size, 48), 'pt'); t.color = __solid(__def(ARGS.color, '#000000'));
if (ARGS.justification) t.justification = { left: Justification.LEFT, center: Justification.CENTER, right: Justification.RIGHT }[ARGS.justification];
if (ARGS.tracking !== undefined) t.tracking = ARGS.tracking; if (ARGS.leading !== undefined) { t.useAutoLeading = false; t.leading = UnitValue(ARGS.leading, 'pt'); }
if (ARGS.allCaps) t.capitalization = TextCase.ALLCAPS; if (ARGS.fauxBold) t.fauxBold = true;
t.position = [UnitValue(__def(ARGS.position, [d.width.as('px') / 2, d.height.as('px') / 2])[0], 'px'), UnitValue(__def(ARGS.position, [0, d.height.as('px') / 2])[1], 'px')];
if (ARGS.name) l.name = ARGS.name; return { layer: l.name };` });

jsxTool({ name: 'ps_placeFile', toolset: 'ps', app: 'ps', timeoutMs: 300000,
  description: 'Photoshop: place a file (image, PSD, AI, PDF, video) as an embedded or linked smart object, optionally scaled % and moved so its center is at position [x,y].',
  input: { document: zDoc, path: z.string(), linked: z.boolean().optional(), scale: z.number().optional(), position: zVec.optional(), name: z.string().optional() },
  jsx: R`var d = __doc(ARGS.document); app.activeDocument = d; var f = __file(ARGS.path); if (!f.exists) throw new Error('Not found: ' + ARGS.path);
var ds = new ActionDescriptor(); ds.putPath(c2t('null'), f); if (ARGS.linked) ds.putBoolean(c2t('Lnkd'), true); ds.putEnumerated(c2t('FTcs'), c2t('QCSt'), c2t('Qcsa'));
executeAction(ARGS.linked ? s2t('placeEvent') : c2t('Plc '), ds, DialogModes.NO); var l = d.activeLayer;
if (ARGS.scale) l.resize(ARGS.scale, ARGS.scale, AnchorPosition.MIDDLECENTER);
if (ARGS.position) { var b = l.bounds; var cx = (b[0].as('px') + b[2].as('px')) / 2, cy = (b[1].as('px') + b[3].as('px')) / 2; l.translate(UnitValue(ARGS.position[0] - cx, 'px'), UnitValue(ARGS.position[1] - cy, 'px')); }
if (ARGS.name) l.name = ARGS.name; return { layer: l.name };` });

jsxTool({ name: 'ps_adjustmentLayer', toolset: 'ps', app: 'ps',
  description: 'Photoshop: add an adjustment layer — brightnessContrast {brightness, contrast}, hueSaturation {hue, saturation, lightness, colorize}, vibrance {vibrance, saturation}, exposure {exposure, offset, gamma}, levels, curves, colorBalance, blackAndWhite, photoFilter, channelMixer, invert, posterize {levels}, threshold {level}, gradientMap, selectiveColor. clip:true clips it to the layer below.',
  input: { document: zDoc, type: z.enum(['brightnessContrast', 'hueSaturation', 'vibrance', 'exposure', 'levels', 'curves', 'colorBalance', 'blackAndWhite', 'photoFilter', 'channelMixer', 'invert', 'posterize', 'threshold', 'gradientMap', 'selectiveColor']),
    settings: z.record(z.union([z.number(), z.boolean()])).optional(), name: z.string().optional(), clip: z.boolean().optional() },
  jsx: R`var d = __doc(ARGS.document); app.activeDocument = d; var S = ARGS.settings || {};
var CLS = { brightnessContrast: 'brightnessEvent', hueSaturation: 'hueSaturation', vibrance: 'vibrance', exposure: 'exposure', levels: 'levels', curves: 'curves', colorBalance: 'colorBalance', blackAndWhite: 'blackAndWhite', photoFilter: 'photoFilter', channelMixer: 'channelMixer', invert: 'invert', posterize: 'posterization', threshold: 'thresholdClassEvent', gradientMap: 'gradientMapClass', selectiveColor: 'selectiveColor' };
var t = new ActionDescriptor();
if (ARGS.type === 'brightnessContrast') { t.putInteger(s2t('brightness'), __def(S.brightness, 0)); t.putInteger(s2t('center'), __def(S.contrast, 0)); t.putBoolean(s2t('useLegacy'), false); }
if (ARGS.type === 'vibrance') { t.putInteger(s2t('vibrance'), __def(S.vibrance, 0)); t.putInteger(s2t('saturation'), __def(S.saturation, 0)); }
if (ARGS.type === 'exposure') { t.putDouble(s2t('exposure'), __def(S.exposure, 0)); t.putDouble(s2t('offset'), __def(S.offset, 0)); t.putDouble(s2t('gammaCorrection'), __def(S.gamma, 1)); }
if (ARGS.type === 'posterize') t.putInteger(s2t('levels'), __def(S.levels, 4));
if (ARGS.type === 'threshold') t.putInteger(s2t('level'), __def(S.level, 128));
if (ARGS.type === 'hueSaturation') { t.putBoolean(s2t('colorize'), !!S.colorize); var lst = new ActionList(), adj = new ActionDescriptor(); adj.putInteger(s2t('hue'), __def(S.hue, 0)); adj.putInteger(s2t('saturation'), __def(S.saturation, 0)); adj.putInteger(s2t('lightness'), __def(S.lightness, 0)); lst.putObject(s2t('hueSatAdjustmentV2'), adj); t.putList(s2t('adjustment'), lst); }
var mk = new ActionDescriptor(), ref = new ActionReference(); ref.putClass(s2t('adjustmentLayer')); mk.putReference(s2t('null'), ref);
var u = new ActionDescriptor(); if (ARGS.name) u.putString(s2t('name'), ARGS.name); if (ARGS.clip) u.putBoolean(s2t('group'), true); u.putObject(s2t('type'), s2t(CLS[ARGS.type]), t); mk.putObject(s2t('using'), s2t('adjustmentLayer'), u);
executeAction(s2t('make'), mk, DialogModes.NO); return { layer: d.activeLayer.name, type: ARGS.type };` });

jsxTool({ name: 'ps_applyFilter', toolset: 'ps', app: 'ps', timeoutMs: 300000,
  description: 'Photoshop: apply a filter to a layer (converts smart objects? no — on smart objects use ps_actionManager for smart filters) — gaussianBlur {radius}, motionBlur {angle, distance}, unsharpMask {amount, radius, threshold}, addNoise {amount, mono}, highPass {radius}, median {radius}, dustAndScratches {radius, threshold}, clouds, lensFlare? (use ps_actionManager for any other / third-party filter).',
  input: { document: zDoc, layer: zLyr, filter: z.enum(['gaussianBlur', 'motionBlur', 'unsharpMask', 'addNoise', 'highPass', 'median', 'dustAndScratches', 'clouds', 'sharpen', 'sharpenMore', 'blur', 'despeckle']), settings: z.record(z.union([z.number(), z.boolean()])).optional() },
  jsx: R`var d = __doc(ARGS.document); app.activeDocument = d; var l = __lyr(d, ARGS.layer); d.activeLayer = l; var S = ARGS.settings || {}, f = ARGS.filter;
if (f === 'gaussianBlur') l.applyGaussianBlur(__def(S.radius, 5)); else if (f === 'motionBlur') l.applyMotionBlur(__def(S.angle, 0), __def(S.distance, 20));
else if (f === 'unsharpMask') l.applyUnSharpMask(__def(S.amount, 80), __def(S.radius, 1), __def(S.threshold, 0)); else if (f === 'addNoise') l.applyAddNoise(__def(S.amount, 4), NoiseDistribution.GAUSSIAN, !!S.mono);
else if (f === 'highPass') l.applyHighPass(__def(S.radius, 3)); else if (f === 'median') l.applyMedianNoise(__def(S.radius, 2)); else if (f === 'dustAndScratches') l.applyDustAndScratches(__def(S.radius, 2), __def(S.threshold, 10));
else if (f === 'clouds') l.applyClouds(); else if (f === 'sharpen') l.applySharpen(); else if (f === 'sharpenMore') l.applySharpenMore(); else if (f === 'blur') l.applyBlur(); else if (f === 'despeckle') l.applyDespeckle();
return { layer: l.name, filter: f };` });

jsxTool({ name: 'ps_selection', toolset: 'ps', app: 'ps', timeoutMs: 300000,
  description: 'Photoshop: selections — all, none, invert, rect [x,y,w,h], ellipse [x,y,w,h], subject (AI Select Subject), sky, layerTransparency, feather {value}, expand {value}, contract {value}, smooth {value}; then optional fill hex, delete, or mask (adds a layer mask from the selection).',
  input: { document: zDoc, layer: zLyr, action: z.enum(['all', 'none', 'invert', 'rect', 'ellipse', 'subject', 'sky', 'layerTransparency', 'feather', 'expand', 'contract', 'smooth']), rect: zVec.optional(), value: z.number().optional(),
    then: z.enum(['fill', 'delete', 'mask', 'copyToLayer']).optional(), color: z.string().optional() },
  jsx: R`var d = __doc(ARGS.document); app.activeDocument = d; if (ARGS.layer) d.activeLayer = __lyr(d, ARGS.layer); var a = ARGS.action, s = d.selection, r = ARGS.rect;
if (a === 'all') s.selectAll(); else if (a === 'none') s.deselect(); else if (a === 'invert') s.invert();
else if (a === 'rect') s.select([[r[0], r[1]], [r[0] + r[2], r[1]], [r[0] + r[2], r[1] + r[3]], [r[0], r[1] + r[3]]]);
else if (a === 'ellipse') { var de = new ActionDescriptor(), rs = new ActionReference(); rs.putProperty(c2t('Chnl'), c2t('fsel')); de.putReference(c2t('null'), rs); var e = new ActionDescriptor(); e.putUnitDouble(c2t('Top '), c2t('#Pxl'), r[1]); e.putUnitDouble(c2t('Left'), c2t('#Pxl'), r[0]); e.putUnitDouble(c2t('Btom'), c2t('#Pxl'), r[1] + r[3]); e.putUnitDouble(c2t('Rght'), c2t('#Pxl'), r[0] + r[2]); de.putObject(c2t('T   '), c2t('Elps'), e); executeAction(c2t('setd'), de, DialogModes.NO); }
else if (a === 'subject') { var ds = new ActionDescriptor(); ds.putBoolean(s2t('sampleAllLayers'), false); executeAction(s2t('autoCutout'), ds, DialogModes.NO); }
else if (a === 'sky') executeAction(s2t('selectSky'), new ActionDescriptor(), DialogModes.NO);
else if (a === 'layerTransparency') { var dt = new ActionDescriptor(), r1 = new ActionReference(); r1.putProperty(c2t('Chnl'), c2t('fsel')); dt.putReference(c2t('null'), r1); var r2 = new ActionReference(); r2.putEnumerated(c2t('Chnl'), c2t('Chnl'), c2t('Trsp')); dt.putReference(c2t('T   '), r2); executeAction(c2t('setd'), dt, DialogModes.NO); }
else if (a === 'feather') s.feather(__def(ARGS.value, 5)); else if (a === 'expand') s.expand(__def(ARGS.value, 5)); else if (a === 'contract') s.contract(__def(ARGS.value, 5)); else if (a === 'smooth') s.smooth(__def(ARGS.value, 5));
if (ARGS.then === 'fill') s.fill(__solid(__def(ARGS.color, '#000000'))); else if (ARGS.then === 'delete') s.clear();
else if (ARGS.then === 'mask') { var dm = new ActionDescriptor(); dm.putClass(c2t('Nw  '), c2t('Chnl')); var rm = new ActionReference(); rm.putEnumerated(c2t('Chnl'), c2t('Chnl'), c2t('Msk ')); dm.putReference(c2t('At  '), rm); dm.putEnumerated(c2t('Usng'), c2t('UsrM'), c2t('RvlS')); executeAction(c2t('Mk  '), dm, DialogModes.NO); }
else if (ARGS.then === 'copyToLayer') executeAction(c2t('CpTL'), undefined, DialogModes.NO);
var b = null; try { var bb = s.bounds; b = [bb[0].as('px'), bb[1].as('px'), bb[2].as('px'), bb[3].as('px')]; } catch (e2) {}
return { action: a, then: ARGS.then || null, bounds: b };` });

jsxTool({ name: 'ps_removeBackground', toolset: 'ps', app: 'ps', timeoutMs: 300000,
  description: 'Photoshop: AI Remove Background on a layer (adds a layer mask around the subject; smart objects/backgrounds are converted as needed).',
  input: { document: zDoc, layer: zLyr },
  jsx: R`var d = __doc(ARGS.document); app.activeDocument = d; var l = __lyr(d, ARGS.layer); if (l.isBackgroundLayer) l.isBackgroundLayer = false; d.activeLayer = l;
executeAction(s2t('removeBackground'), new ActionDescriptor(), DialogModes.NO); return { layer: d.activeLayer.name };` });

jsxTool({ name: 'ps_contentAwareFill', toolset: 'ps', app: 'ps', timeoutMs: 300000,
  description: 'Photoshop: content-aware fill the current selection (or rect [x,y,w,h]) on the active/named layer — removes objects.',
  input: { document: zDoc, layer: zLyr, rect: zVec.optional(), expand: z.number().optional() },
  jsx: R`var d = __doc(ARGS.document); app.activeDocument = d; if (ARGS.layer) d.activeLayer = __lyr(d, ARGS.layer); var r = ARGS.rect;
if (r) d.selection.select([[r[0], r[1]], [r[0] + r[2], r[1]], [r[0] + r[2], r[1] + r[3]], [r[0], r[1] + r[3]]]); if (ARGS.expand) d.selection.expand(ARGS.expand);
var ds = new ActionDescriptor(); ds.putEnumerated(c2t('Usng'), c2t('FlCn'), s2t('contentAware')); ds.putBoolean(s2t('contentAwareColorAdaptationFill'), true); ds.putUnitDouble(c2t('Opct'), c2t('#Prc'), 100); ds.putEnumerated(c2t('Md  '), c2t('BlnM'), c2t('Nrml'));
executeAction(c2t('Fl  '), ds, DialogModes.NO); d.selection.deselect(); return { filled: true };` });

jsxTool({ name: 'ps_layerStyle', toolset: 'ps', app: 'ps',
  description: 'Photoshop: add layer effects — stroke {size, color, position outside|inside|center, opacity}, dropShadow {distance, size, angle, opacity, color, spread}, outerGlow {size, opacity, color, spread}. clear:true removes all effects.',
  input: { document: zDoc, layer: zLyr, stroke: z.record(z.union([z.number(), z.string()])).optional(), dropShadow: z.record(z.union([z.number(), z.string()])).optional(), outerGlow: z.record(z.union([z.number(), z.string()])).optional(), clear: z.boolean().optional() },
  jsx: R`var d = __doc(ARGS.document); app.activeDocument = d; var l = __lyr(d, ARGS.layer); d.activeLayer = l;
if (ARGS.clear) { try { executeAction(s2t('disableLayerStyle'), (function () { var x = new ActionDescriptor(), r = new ActionReference(); r.putEnumerated(c2t('Lyr '), c2t('Ordn'), c2t('Trgt')); x.putReference(c2t('null'), r); return x; })(), DialogModes.NO); } catch (e) {} return { cleared: true }; }
function col(h) { var c = __rgb255(h), x = new ActionDescriptor(); x.putDouble(c2t('Rd  '), c[0]); x.putDouble(c2t('Grn '), c[1]); x.putDouble(c2t('Bl  '), c[2]); return x; }
var fx = new ActionDescriptor(); fx.putUnitDouble(c2t('Scl '), c2t('#Prc'), 100);
if (ARGS.stroke) { var S = ARGS.stroke, s = new ActionDescriptor(); s.putBoolean(c2t('enab'), true); s.putEnumerated(c2t('Styl'), c2t('FStl'), c2t({ outside: 'OutF', inside: 'InsF', center: 'CtrF' }[S.position || 'outside'])); s.putEnumerated(c2t('PntT'), c2t('FrFl'), c2t('SClr')); s.putEnumerated(c2t('Md  '), c2t('BlnM'), c2t('Nrml')); s.putUnitDouble(c2t('Opct'), c2t('#Prc'), __def(S.opacity, 100)); s.putUnitDouble(c2t('Sz  '), c2t('#Pxl'), __def(S.size, 3)); s.putObject(c2t('Clr '), c2t('RGBC'), col(__def(S.color, '#000000'))); fx.putObject(c2t('FrFX'), c2t('FrFX'), s); }
if (ARGS.dropShadow) { var D = ARGS.dropShadow, ds = new ActionDescriptor(); ds.putBoolean(c2t('enab'), true); ds.putEnumerated(c2t('Md  '), c2t('BlnM'), c2t('Mltp')); ds.putObject(c2t('Clr '), c2t('RGBC'), col(__def(D.color, '#000000'))); ds.putUnitDouble(c2t('Opct'), c2t('#Prc'), __def(D.opacity, 60)); ds.putBoolean(c2t('uglg'), false); ds.putUnitDouble(c2t('lagl'), c2t('#Ang'), __def(D.angle, 120)); ds.putUnitDouble(c2t('Dstn'), c2t('#Pxl'), __def(D.distance, 10)); ds.putUnitDouble(c2t('Ckmt'), c2t('#Pxl'), __def(D.spread, 0)); ds.putUnitDouble(c2t('blur'), c2t('#Pxl'), __def(D.size, 15)); fx.putObject(c2t('DrSh'), c2t('DrSh'), ds); }
if (ARGS.outerGlow) { var G = ARGS.outerGlow, og = new ActionDescriptor(); og.putBoolean(c2t('enab'), true); og.putEnumerated(c2t('Md  '), c2t('BlnM'), c2t('Scrn')); og.putObject(c2t('Clr '), c2t('RGBC'), col(__def(G.color, '#FFFFBE'))); og.putUnitDouble(c2t('Opct'), c2t('#Prc'), __def(G.opacity, 75)); og.putUnitDouble(c2t('Ckmt'), c2t('#Pxl'), __def(G.spread, 0)); og.putUnitDouble(c2t('blur'), c2t('#Pxl'), __def(G.size, 20)); fx.putObject(c2t('OrGl'), c2t('OrGl'), og); }
var dd = new ActionDescriptor(), rr = new ActionReference(); rr.putProperty(c2t('Prpr'), c2t('Lefx')); rr.putEnumerated(c2t('Lyr '), c2t('Ordn'), c2t('Trgt')); dd.putReference(c2t('null'), rr); dd.putObject(c2t('T   '), c2t('Lefx'), fx);
executeAction(c2t('setd'), dd, DialogModes.NO); return { layer: l.name };` });

jsxTool({ name: 'ps_resize', toolset: 'ps', app: 'ps', timeoutMs: 300000,
  description: 'Photoshop: image size (width/height px, resample), canvas size (anchor), crop [left,top,right,bottom], rotate canvas deg, trim transparent pixels, flatten, flip horizontal/vertical.',
  input: { document: zDoc, action: z.enum(['imageSize', 'canvasSize', 'crop', 'rotate', 'trim', 'flatten', 'flipH', 'flipV']), width: z.number().optional(), height: z.number().optional(), resolution: z.number().optional(),
    anchor: z.enum(['topLeft', 'top', 'topRight', 'left', 'center', 'right', 'bottomLeft', 'bottom', 'bottomRight']).optional(), bounds: zVec.optional(), angle: z.number().optional() },
  jsx: R`var d = __doc(ARGS.document); app.activeDocument = d; var a = ARGS.action;
var A = { topLeft: AnchorPosition.TOPLEFT, top: AnchorPosition.TOPCENTER, topRight: AnchorPosition.TOPRIGHT, left: AnchorPosition.MIDDLELEFT, center: AnchorPosition.MIDDLECENTER, right: AnchorPosition.MIDDLERIGHT, bottomLeft: AnchorPosition.BOTTOMLEFT, bottom: AnchorPosition.BOTTOMCENTER, bottomRight: AnchorPosition.BOTTOMRIGHT };
var w = ARGS.width ? UnitValue(ARGS.width, 'px') : undefined, h = ARGS.height ? UnitValue(ARGS.height, 'px') : undefined;
if (a === 'imageSize') { if (w && !h) h = UnitValue(d.height.as('px') * ARGS.width / d.width.as('px'), 'px'); if (h && !w) w = UnitValue(d.width.as('px') * ARGS.height / d.height.as('px'), 'px'); d.resizeImage(w, h, ARGS.resolution, ResampleMethod.BICUBICAUTOMATIC); }
else if (a === 'canvasSize') d.resizeCanvas(w || d.width, h || d.height, A[__def(ARGS.anchor, 'center')]);
else if (a === 'crop') { var b = ARGS.bounds; d.crop([UnitValue(b[0], 'px'), UnitValue(b[1], 'px'), UnitValue(b[2], 'px'), UnitValue(b[3], 'px')]); }
else if (a === 'rotate') d.rotateCanvas(__def(ARGS.angle, 90)); else if (a === 'trim') d.trim(TrimType.TRANSPARENT, true, true, true, true); else if (a === 'flatten') d.flatten();
else if (a === 'flipH') d.flipCanvas(Direction.HORIZONTAL); else if (a === 'flipV') d.flipCanvas(Direction.VERTICAL);
return __docInfo(d);` });

jsxTool({ name: 'ps_smartObject', toolset: 'ps', app: 'ps', timeoutMs: 300000,
  description: 'Photoshop: smart objects — convert layer to smart object, edit contents (opens it), replace contents with a file, export contents to a file, rasterize.',
  input: { document: zDoc, layer: zLyr, action: z.enum(['convert', 'edit', 'replace', 'export', 'rasterize']), path: z.string().optional() },
  jsx: R`var d = __doc(ARGS.document); app.activeDocument = d; var l = __lyr(d, ARGS.layer); d.activeLayer = l; var a = ARGS.action;
if (a === 'convert') executeAction(s2t('newPlacedLayer'), undefined, DialogModes.NO);
else if (a === 'edit') executeAction(s2t('placedLayerEditContents'), new ActionDescriptor(), DialogModes.NO);
else if (a === 'replace') { var ds = new ActionDescriptor(); ds.putPath(c2t('null'), __file(ARGS.path)); executeAction(s2t('placedLayerReplaceContents'), ds, DialogModes.NO); }
else if (a === 'export') { var de = new ActionDescriptor(); de.putPath(c2t('null'), __file(ARGS.path)); executeAction(s2t('placedLayerExportContents'), de, DialogModes.NO); }
else if (a === 'rasterize') l.rasterize(RasterizeType.ENTIRELAYER);
return { layer: app.activeDocument.activeLayer.name, action: a, document: app.activeDocument.name };` });

jsxTool({ name: 'ps_runAction', toolset: 'ps', app: 'ps', timeoutMs: 1800000,
  description: 'Photoshop: play a recorded action from the Actions panel (action name + set name) — including third-party action packs. loadAtn loads an .atn file first.',
  input: { action: z.string(), set: z.string(), loadAtn: z.string().optional() },
  jsx: R`if (ARGS.loadAtn) app.load(__file(ARGS.loadAtn)); app.doAction(ARGS.action, ARGS.set); return { played: ARGS.set + ' / ' + ARGS.action };` });

jsxTool({ name: 'ps_actionManager', toolset: 'ps', app: 'ps', timeoutMs: 1800000,
  description: 'Photoshop: run ANY Photoshop command (full feature access incl. every filter, neural/AI command, third-party plugin filter, menu item) with batchPlay-style JSON: commands:[{"_obj":"gaussianBlur","radius":{"_unit":"pixelsUnit","_value":4}}, {"_obj":"set","_target":[{"_ref":"layer","_enum":"ordinal","_value":"targetEnum"}],"to":{"_obj":"layer","opacity":{"_unit":"percentUnit","_value":50}}}]. IDs are stringIDs; prefix "$" for a charID ("$Lyr "). Returns result descriptors. dialogs:true shows the plugin dialog.',
  input: { commands: z.array(z.record(z.unknown())), dialogs: z.boolean().optional() },
  jsx: R`var out = []; for (var i = 0; i < ARGS.commands.length; i++) out.push(__play(ARGS.commands[i], ARGS.dialogs)); return out;` });

jsxTool({ name: 'ps_getDescriptor', toolset: 'ps', app: 'ps', readOnly: true,
  description: 'Photoshop: read Action Manager properties (application, document, layer, channel...) as JSON — e.g. target [{"_ref":"layer","_enum":"ordinal","_value":"targetEnum"}], optional property "layerEffects". Discover what ps_actionManager can set.',
  input: { target: z.array(z.record(z.unknown())), property: z.string().optional() },
  jsx: R`var spec = ARGS.target.slice(0); if (ARGS.property) spec.unshift({ _ref: 'property', _property: ARGS.property });
var r = new ActionReference(); for (var i = 0; i < spec.length; i++) { var s = spec[i], cls = __id(s._ref); if (s._ref === 'property') r.putProperty(s2t('property'), __id(s._property)); else if (s._name !== undefined) r.putName(cls, s._name); else if (s._id !== undefined) r.putIdentifier(cls, s._id); else if (s._index !== undefined) r.putIndex(cls, s._index); else if (s._enum !== undefined) r.putEnumerated(cls, __id(s._enum), __id(s._value)); else r.putEnumerated(cls, c2t('Ordn'), c2t('Trgt')); }
return __descToJson(executeActionGet(r), 0);` });

jsxTool({ name: 'ps_runMenuCommand', toolset: 'ps', app: 'ps', timeoutMs: 600000,
  description: 'Photoshop: run a menu item by its stringID (e.g. "flattenImage", "newPlacedLayer", "copyMerged", "selectAllLayers", "toggleRulers") via app.runMenuItem.',
  input: { command: z.string() },
  jsx: R`app.runMenuItem(ARGS.command.charAt(0) === '$' ? c2t(ARGS.command.substr(1)) : s2t(ARGS.command)); return { ran: ARGS.command };` });

jsxTool({ name: 'ps_exportLayers', toolset: 'ps', app: 'ps', timeoutMs: 1800000,
  description: 'Photoshop: export each top-level layer (or the listed ones) as its own PNG (trimmed or full canvas) into a folder — e.g. cut-outs for After Effects parallax.',
  input: { document: zDoc, folder: z.string(), layers: z.array(z.string()).optional(), trim: z.boolean().optional() },
  jsx: R`var src = __doc(ARGS.document); var out = []; var fld = new Folder(String(ARGS.folder).replace(/\\/g, '/')); if (!fld.exists) fld.create();
var names = ARGS.layers || (function () { var a = []; for (var i = 0; i < src.layers.length; i++) a.push(src.layers[i].name); return a; })();
for (var n = 0; n < names.length; n++) { app.activeDocument = src; var tmp = src.duplicate('mcp_tmp', false);
  for (var j = 0; j < tmp.layers.length; j++) tmp.layers[j].visible = (tmp.layers[j].name === names[n]);
  for (var k = tmp.layers.length - 1; k >= 0; k--) if (!tmp.layers[k].visible) { try { tmp.layers[k].remove(); } catch (e) {} }
  if (ARGS.trim) { try { tmp.trim(TrimType.TRANSPARENT, true, true, true, true); } catch (e2) {} }
  var f = new File(fld.fsName + '/' + names[n].replace(/[\\\/:*?"<>|]/g, '_') + '.png'); var o = new PNGSaveOptions(); tmp.saveAs(f, o, true, Extension.LOWERCASE); tmp.close(SaveOptions.DONOTSAVECHANGES); out.push(f.fsName); }
return { exported: out };` });

jsxTool({ name: 'ps_preview', toolset: 'ps', app: 'ps', readOnly: true, timeoutMs: 180000,
  description: 'Photoshop: render the current document (merged, downscaled to maxSize px) and return it as an image to check your work.',
  input: { document: zDoc, maxSize: z.number().int().optional() },
  before: (a) => ({ ...a, __path: tempPng('ps-preview', 'jpg') }),
  jsx: R`var d = __doc(ARGS.document); app.activeDocument = d; var t = d.duplicate('mcp_preview', true); var m = __def(ARGS.maxSize, 1600);
if (t.bitsPerChannel !== BitsPerChannelType.EIGHT) t.bitsPerChannel = BitsPerChannelType.EIGHT; if (t.mode !== DocumentMode.RGB) t.changeMode(ChangeMode.RGB);
var w = t.width.as('px'), h = t.height.as('px'); if (Math.max(w, h) > m) { var k = m / Math.max(w, h); t.resizeImage(UnitValue(w * k, 'px'), UnitValue(h * k, 'px'), t.resolution, ResampleMethod.BICUBIC); }
var o = new JPEGSaveOptions(); o.quality = 9; t.saveAs(__file(ARGS.__path), o, true, Extension.LOWERCASE); t.close(SaveOptions.DONOTSAVECHANGES); return { path: ARGS.__path, document: d.name };`,
  after: async (r: any) => imageResult(r.path, r),
});
