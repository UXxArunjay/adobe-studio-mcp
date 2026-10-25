/** Illustrator — core native tools + menu-command / action / live-effect escape hatches. Coordinates: [x,y] px from the artboard's top-left, y down. */
import { z } from 'zod';
import { jsxTool, zDoc, zVec } from './define.js';
import { imageResult, tempPng } from './util.js';

const R = String.raw;
const zItems = z.array(z.string()).optional().describe('Item names; omit to use the current selection.');

jsxTool({ name: 'ai_getState', toolset: 'ai', app: 'ai', readOnly: true,
  description: 'Illustrator: open documents and the active one — size, color mode, artboards (rects), layers (visible/locked/item counts), selection, item counts by type.',
  input: { document: zDoc, listItems: z.boolean().optional() },
  jsx: R`var docs = []; for (var i = 0; i < app.documents.length; i++) docs.push(app.documents[i].name); if (!app.documents.length) return { version: app.version, documents: [] };
var d = __doc(ARGS.document); var ab = []; for (var a = 0; a < d.artboards.length; a++) ab.push({ index: a, name: d.artboards[a].name, rect: d.artboards[a].artboardRect });
var ly = []; for (var l = 0; l < d.layers.length; l++) ly.push({ name: d.layers[l].name, visible: d.layers[l].visible, locked: d.layers[l].locked, items: d.layers[l].pageItems.length });
var sel = []; for (var s = 0; s < d.selection.length && s < 100; s++) sel.push(__iteminfo(d.selection[s]));
var o = { version: app.version, documents: docs, name: d.name, path: (function () { try { return d.fullName.fsName; } catch (e) { return ''; } })(), width: d.width, height: d.height, colorSpace: String(d.documentColorSpace), saved: d.saved,
  artboards: ab, activeArtboard: d.artboards.getActiveArtboardIndex(), layers: ly, selection: sel, counts: { pageItems: d.pageItems.length, paths: d.pathItems.length, text: d.textFrames.length, placed: d.placedItems.length, raster: d.rasterItems.length, symbols: d.symbolItems.length } };
if (ARGS.listItems) { o.items = []; for (var p = 0; p < d.pageItems.length && p < 500; p++) o.items.push(__iteminfo(d.pageItems[p])); }
return o;` });

jsxTool({ name: 'ai_newDocument', toolset: 'ai', app: 'ai',
  description: 'Illustrator: new document — width/height px (pt), color mode rgb|cmyk, number of artboards, name.',
  input: { width: z.number().optional(), height: z.number().optional(), colorMode: z.enum(['rgb', 'cmyk']).optional(), artboards: z.number().int().optional(), name: z.string().optional() },
  jsx: R`var p = new DocumentPreset(); p.width = __def(ARGS.width, 1920); p.height = __def(ARGS.height, 1080); p.colorMode = ARGS.colorMode === 'cmyk' ? DocumentColorSpace.CMYK : DocumentColorSpace.RGB; p.numArtboards = __def(ARGS.artboards, 1); p.units = RulerUnits.Pixels; if (ARGS.name) p.title = ARGS.name;
var d = app.documents.addDocument(ARGS.colorMode === 'cmyk' ? 'Print' : 'Web', p); return { name: d.name, width: d.width, height: d.height };` });

jsxTool({ name: 'ai_openFile', toolset: 'ai', app: 'ai', timeoutMs: 300000,
  description: 'Illustrator: open .ai/.pdf/.eps/.svg files.',
  input: { paths: z.array(z.string()) },
  jsx: R`var out = []; for (var i = 0; i < ARGS.paths.length; i++) { var f = __file(ARGS.paths[i]); if (!f.exists) { out.push({ path: ARGS.paths[i], error: 'not found' }); continue; } var d = app.open(f); out.push({ name: d.name }); } return out;` });

jsxTool({ name: 'ai_saveDocument', toolset: 'ai', app: 'ai', timeoutMs: 300000,
  description: 'Illustrator: save in place, or save as .ai (PDF-compatible, best for After Effects import) / .pdf / .eps / .svg to path; optionally close.',
  input: { document: zDoc, path: z.string().optional(), format: z.enum(['ai', 'pdf', 'eps', 'svg']).optional(), close: z.boolean().optional() },
  jsx: R`var d = __doc(ARGS.document); app.activeDocument = d;
if (!ARGS.path) d.save(); else { var f = __file(ARGS.path), fmt = __def(ARGS.format, String(ARGS.path).split('.').pop().toLowerCase());
  if (fmt === 'pdf') d.saveAs(f, new PDFSaveOptions()); else if (fmt === 'eps') d.saveAs(f, new EPSSaveOptions());
  else if (fmt === 'svg') { var so = new ExportOptionsSVG(); so.embedRasterImages = true; d.exportFile(f, ExportType.SVG, so); }
  else { var o = new IllustratorSaveOptions(); o.pdfCompatible = true; o.compatibility = Compatibility.ILLUSTRATOR17; d.saveAs(f, o); } }
var p = ''; try { p = d.fullName.fsName; } catch (e) {} if (ARGS.close) d.close(SaveOptions.DONOTSAVECHANGES); return { saved: ARGS.path || p };` });

jsxTool({ name: 'ai_closeDocument', toolset: 'ai', app: 'ai', destructive: true,
  description: 'Illustrator: close a document (save:true saves first, else discards changes).',
  input: { document: zDoc, save: z.boolean().optional() },
  jsx: R`var d = __doc(ARGS.document); var n = d.name; d.close(ARGS.save ? SaveOptions.SAVECHANGES : SaveOptions.DONOTSAVECHANGES); return { closed: n };` });

jsxTool({ name: 'ai_export', toolset: 'ai', app: 'ai', timeoutMs: 600000,
  description: 'Illustrator: export artboard(s) or the document — png (scale %, transparent), jpg, svg, pdf, psd (layered, for Photoshop/AE). Returns the PNG inline when preview:true.',
  input: { document: zDoc, path: z.string().optional(), format: z.enum(['png', 'jpg', 'svg', 'pdf', 'psd']).optional(), artboard: z.number().int().optional(), scale: z.number().optional(), transparent: z.boolean().optional(), preview: z.boolean().optional() },
  before: (a) => ({ ...a, __path: a.path || tempPng('ai-export', a.format === 'jpg' ? 'jpg' : a.format || 'png') }),
  jsx: R`var d = __doc(ARGS.document); app.activeDocument = d; var f = __file(ARGS.__path), fmt = __def(ARGS.format, 'png');
if (ARGS.artboard !== undefined) d.artboards.setActiveArtboardIndex(ARGS.artboard);
if (fmt === 'png') { var o = new ExportOptionsPNG24(); o.artBoardClipping = true; o.transparency = ARGS.transparent !== false; o.antiAliasing = true; o.horizontalScale = o.verticalScale = __def(ARGS.scale, 100); d.exportFile(f, ExportType.PNG24, o); }
else if (fmt === 'jpg') { var j = new ExportOptionsJPEG(); j.artBoardClipping = true; j.qualitySetting = 90; j.horizontalScale = j.verticalScale = __def(ARGS.scale, 100); d.exportFile(f, ExportType.JPEG, j); }
else if (fmt === 'svg') { var s = new ExportOptionsSVG(); s.embedRasterImages = true; d.exportFile(f, ExportType.SVG, s); }
else if (fmt === 'psd') { var p = new ExportOptionsPhotoshop(); p.writeLayers = true; p.resolution = 72 * __def(ARGS.scale, 100) / 100; p.antiAliasing = true; d.exportFile(f, ExportType.PHOTOSHOP, p); }
else { d.saveAs(f, new PDFSaveOptions()); }
return { path: f.fsName, format: fmt };`,
  after: async (r: any, a: any) => (a.preview && (a.format || 'png') === 'png' ? imageResult(r.path, r) : r),
});

jsxTool({ name: 'ai_addShape', toolset: 'ai', app: 'ai',
  description: 'Illustrator: draw rect, roundedRect, ellipse, polygon, star, line or path (points [[x,y],...]) at position [x,y] (top-left of the shape, artboard coords) with size [w,h], fill/stroke hex (or "none"), strokeWidth, opacity, name, layer.',
  input: { document: zDoc, shape: z.enum(['rect', 'roundedRect', 'ellipse', 'polygon', 'star', 'line', 'path']), position: zVec.optional(), size: zVec.optional(), points: z.array(zVec).optional(), closed: z.boolean().optional(),
    sides: z.number().int().optional(), cornerRadius: z.number().optional(), fill: z.string().optional(), stroke: z.string().optional(), strokeWidth: z.number().optional(), opacity: z.number().optional(), name: z.string().optional(), layer: z.string().optional() },
  jsx: R`var d = __doc(ARGS.document); var L = __ailayer(d, ARGS.layer, true); var P = ARGS.position || [0, 0], S = ARGS.size || [100, 100]; var o = __pt(d, P[0], P[1]); var it;
if (ARGS.shape === 'rect') it = L.pathItems.rectangle(o[1], o[0], S[0], S[1]);
else if (ARGS.shape === 'roundedRect') it = L.pathItems.roundedRectangle(o[1], o[0], S[0], S[1], __def(ARGS.cornerRadius, 12), __def(ARGS.cornerRadius, 12));
else if (ARGS.shape === 'ellipse') it = L.pathItems.ellipse(o[1], o[0], S[0], S[1]);
else if (ARGS.shape === 'polygon') it = L.pathItems.polygon(o[0] + S[0] / 2, o[1] - S[1] / 2, S[0] / 2, __def(ARGS.sides, 6));
else if (ARGS.shape === 'star') it = L.pathItems.star(o[0] + S[0] / 2, o[1] - S[1] / 2, S[0] / 2, S[0] / 4, __def(ARGS.sides, 5));
else { var pts = ARGS.points || [[P[0], P[1]], [P[0] + S[0], P[1] + S[1]]]; var conv = []; for (var i = 0; i < pts.length; i++) conv.push(__pt(d, pts[i][0], pts[i][1])); it = L.pathItems.add(); it.setEntirePath(conv); it.closed = ARGS.shape === 'path' ? __def(ARGS.closed, false) : false; }
if (ARGS.fill === 'none' || ARGS.shape === 'line') it.filled = false; else { it.filled = true; it.fillColor = __color(d, __def(ARGS.fill, '#000000')); }
if (ARGS.stroke && ARGS.stroke !== 'none') { it.stroked = true; it.strokeColor = __color(d, ARGS.stroke); it.strokeWidth = __def(ARGS.strokeWidth, 2); } else if (ARGS.shape === 'line') { it.stroked = true; it.strokeColor = __color(d, '#000000'); it.strokeWidth = __def(ARGS.strokeWidth, 2); } else it.stroked = false;
if (ARGS.opacity !== undefined) it.opacity = ARGS.opacity; if (ARGS.name) it.name = ARGS.name;
return __iteminfo(it);` });

jsxTool({ name: 'ai_addText', toolset: 'ai', app: 'ai',
  description: 'Illustrator: add point text (or area text with box [w,h]) at position [x,y] — font (PostScript name), size, color, justification, tracking, leading, name, layer; outline:true converts to outlines.',
  input: { document: zDoc, text: z.string(), position: zVec.optional(), box: zVec.optional(), font: z.string().optional(), size: z.number().optional(), color: z.string().optional(), justification: z.enum(['left', 'center', 'right']).optional(),
    tracking: z.number().optional(), leading: z.number().optional(), name: z.string().optional(), layer: z.string().optional(), outline: z.boolean().optional() },
  jsx: R`var d = __doc(ARGS.document); var L = __ailayer(d, ARGS.layer, true); var P = ARGS.position || [0, 0]; var o = __pt(d, P[0], P[1]); var tf;
if (ARGS.box) { var r = L.pathItems.rectangle(o[1], o[0], ARGS.box[0], ARGS.box[1]); tf = L.textFrames.areaText(r); } else { tf = L.textFrames.add(); tf.position = o; }
tf.contents = ARGS.text; var ca = tf.textRange.characterAttributes; ca.size = __def(ARGS.size, 48); ca.fillColor = __color(d, __def(ARGS.color, '#000000'));
if (ARGS.font) ca.textFont = app.textFonts.getByName(ARGS.font); if (ARGS.tracking !== undefined) ca.tracking = ARGS.tracking; if (ARGS.leading !== undefined) { ca.autoLeading = false; ca.leading = ARGS.leading; }
if (ARGS.justification) tf.textRange.paragraphAttributes.justification = { left: Justification.LEFT, center: Justification.CENTER, right: Justification.RIGHT }[ARGS.justification];
if (ARGS.name) tf.name = ARGS.name; if (ARGS.outline) { var g = tf.createOutline(); if (ARGS.name) g.name = ARGS.name; return __iteminfo(g); }
return __iteminfo(tf);` });

jsxTool({ name: 'ai_modifyItems', toolset: 'ai', app: 'ai',
  description: 'Illustrator: modify items (by name or selection) — fill, stroke, strokeWidth, opacity, moveBy [dx,dy], position [x,y], resize % [x,y], rotate deg, rename, hide/show, lock/unlock, zOrder (front|back|forward|backward), group, ungroup, delete, duplicate, blendMode.',
  input: { document: zDoc, items: zItems, fill: z.string().optional(), stroke: z.string().optional(), strokeWidth: z.number().optional(), opacity: z.number().optional(), moveBy: zVec.optional(), position: zVec.optional(),
    resize: zVec.optional(), rotate: z.number().optional(), name: z.string().optional(), hidden: z.boolean().optional(), locked: z.boolean().optional(), zOrder: z.enum(['front', 'back', 'forward', 'backward']).optional(),
    action: z.enum(['group', 'ungroup', 'delete', 'duplicate']).optional(), blendMode: z.string().optional() },
  jsx: R`var d = __doc(ARGS.document); var its = []; if (ARGS.items) { for (var i = 0; i < ARGS.items.length; i++) its.push(__item(d, ARGS.items[i])); } else { for (var s = 0; s < d.selection.length; s++) its.push(d.selection[s]); }
if (!its.length) throw new Error('No items (pass items or select something).');
if (ARGS.action === 'group') { var g = its[0].layer.groupItems.add(); for (var k = its.length - 1; k >= 0; k--) its[k].move(g, ElementPlacement.PLACEATBEGINNING); if (ARGS.name) g.name = ARGS.name; return __iteminfo(g); }
if (ARGS.action === 'delete') { var n = []; for (var q = 0; q < its.length; q++) { n.push(its[q].name || its[q].typename); its[q].remove(); } return { deleted: n }; }
var out = [];
for (var j = 0; j < its.length; j++) { var it = its[j];
  if (ARGS.action === 'ungroup' && it.typename === 'GroupItem') { while (it.pageItems.length) it.pageItems[0].move(it, ElementPlacement.PLACEBEFORE); it.remove(); continue; }
  if (ARGS.action === 'duplicate') it = it.duplicate();
  try { if (ARGS.fill) { if (ARGS.fill === 'none') it.filled = false; else { it.filled = true; it.fillColor = __color(d, ARGS.fill); } } if (ARGS.stroke) { if (ARGS.stroke === 'none') it.stroked = false; else { it.stroked = true; it.strokeColor = __color(d, ARGS.stroke); } } if (ARGS.strokeWidth !== undefined) it.strokeWidth = ARGS.strokeWidth; } catch (e) {}
  if (ARGS.opacity !== undefined) it.opacity = ARGS.opacity; if (ARGS.moveBy) it.translate(ARGS.moveBy[0], -ARGS.moveBy[1]); if (ARGS.position) it.position = __pt(d, ARGS.position[0], ARGS.position[1]);
  if (ARGS.resize) it.resize(ARGS.resize[0], __def(ARGS.resize[1], ARGS.resize[0])); if (ARGS.rotate) it.rotate(ARGS.rotate);
  if (ARGS.name) it.name = ARGS.name; if (ARGS.hidden !== undefined) it.hidden = ARGS.hidden; if (ARGS.locked !== undefined) it.locked = ARGS.locked;
  if (ARGS.zOrder) it.zOrder({ front: ZOrderMethod.BRINGTOFRONT, back: ZOrderMethod.SENDTOBACK, forward: ZOrderMethod.BRINGFORWARD, backward: ZOrderMethod.SENDBACKWARD }[ARGS.zOrder]);
  if (ARGS.blendMode) { var k2 = String(ARGS.blendMode).replace(/([a-z])([A-Z])/g, '$1$2').replace(/[\s_-]/g, '').toUpperCase(); if (BlendModes[k2] !== undefined) it.blendingMode = BlendModes[k2]; }
  out.push(__iteminfo(it)); }
return out;` });

jsxTool({ name: 'ai_layers', toolset: 'ai', app: 'ai',
  description: 'Illustrator: layer ops — list, add, rename, delete, show, hide, lock, unlock, moveToTop, moveToBottom, setActive; moveItems moves named items into the layer.',
  input: { document: zDoc, action: z.enum(['list', 'add', 'rename', 'delete', 'show', 'hide', 'lock', 'unlock', 'moveToTop', 'moveToBottom', 'setActive', 'moveItems']), layer: z.string().optional(), newName: z.string().optional(), items: z.array(z.string()).optional() },
  jsx: R`var d = __doc(ARGS.document); var a = ARGS.action;
if (a === 'add') { var nl = d.layers.add(); nl.name = __def(ARGS.newName, __def(ARGS.layer, 'Layer')); return { added: nl.name }; }
if (a !== 'list') { var l = __ailayer(d, ARGS.layer, a === 'moveItems');
  if (a === 'rename') l.name = ARGS.newName; else if (a === 'delete') { var n = l.name; l.remove(); return { deleted: n }; } else if (a === 'show') l.visible = true; else if (a === 'hide') l.visible = false;
  else if (a === 'lock') l.locked = true; else if (a === 'unlock') l.locked = false; else if (a === 'moveToTop') l.zOrder(ZOrderMethod.BRINGTOFRONT); else if (a === 'moveToBottom') l.zOrder(ZOrderMethod.SENDTOBACK); else if (a === 'setActive') d.activeLayer = l;
  else if (a === 'moveItems') for (var i = 0; i < (ARGS.items || []).length; i++) __item(d, ARGS.items[i]).move(l, ElementPlacement.PLACEATBEGINNING); }
var o = []; for (var j = 0; j < d.layers.length; j++) o.push({ name: d.layers[j].name, visible: d.layers[j].visible, locked: d.layers[j].locked, items: d.layers[j].pageItems.length }); return o;` });

jsxTool({ name: 'ai_select', toolset: 'ai', app: 'ai',
  description: 'Illustrator: select items — all, none, by names, by type (PathItem/TextFrame/PlacedItem/GroupItem...), by layer, or by fill color hex.',
  input: { document: zDoc, mode: z.enum(['all', 'none', 'names', 'type', 'layer', 'fillColor']), names: z.array(z.string()).optional(), type: z.string().optional(), layer: z.string().optional(), color: z.string().optional() },
  jsx: R`var d = __doc(ARGS.document); d.selection = null; var picked = [];
if (ARGS.mode === 'none') return { selected: 0 };
if (ARGS.mode === 'names') { for (var i = 0; i < ARGS.names.length; i++) picked.push(__item(d, ARGS.names[i])); }
else { var src = ARGS.mode === 'layer' ? __ailayer(d, ARGS.layer).pageItems : d.pageItems; var want = ARGS.color ? __rgb255(ARGS.color) : null;
  for (var j = 0; j < src.length; j++) { var it = src[j]; if (it.locked || it.hidden) continue; if (ARGS.mode === 'type' && it.typename !== ARGS.type) continue;
    if (ARGS.mode === 'fillColor') { try { var c = it.fillColor; if (!(c.typename === 'RGBColor' && Math.abs(c.red - want[0]) < 3 && Math.abs(c.green - want[1]) < 3 && Math.abs(c.blue - want[2]) < 3)) continue; } catch (e) { continue; } }
    picked.push(it); } }
for (var k = 0; k < picked.length; k++) picked[k].selected = true; return { selected: picked.length };` });

jsxTool({ name: 'ai_executeMenuCommand', toolset: 'ai', app: 'ai', timeoutMs: 600000,
  description: 'Illustrator: run ANY menu command by its command string on the current selection — e.g. "group", "ungroup", "outline" (create outlines), "expandStyle", "Live Pathfinder Add", "Live Pathfinder Subtract", "makeMask", "OffsetPath v22", "Make Envelope", "Expand3", "selectall", "deselectall", "fitin", "Live Blend". Third-party plugin menu items work too.',
  input: { command: z.string(), repeat: z.number().int().optional() },
  jsx: R`for (var i = 0; i < __def(ARGS.repeat, 1); i++) app.executeMenuCommand(ARGS.command); app.redraw(); return { ran: ARGS.command };` });

jsxTool({ name: 'ai_runAction', toolset: 'ai', app: 'ai', timeoutMs: 1800000,
  description: 'Illustrator: play a recorded action (action + set), optionally loading an .aia action file first.',
  input: { action: z.string(), set: z.string(), loadAia: z.string().optional() },
  jsx: R`if (ARGS.loadAia) app.loadAction(__file(ARGS.loadAia)); app.doScript(ARGS.action, ARGS.set); return { played: ARGS.set + ' / ' + ARGS.action };` });

jsxTool({ name: 'ai_placeFile', toolset: 'ai', app: 'ai', timeoutMs: 300000,
  description: 'Illustrator: place an image/PDF/PSD/SVG file at position [x,y] with optional width (keeps ratio); embed:true embeds it; trace:true runs Image Trace (preset e.g. "High Fidelity Photo", "Black and White Logo", "6 Colors") and expands to vectors.',
  input: { document: zDoc, path: z.string(), position: zVec.optional(), width: z.number().optional(), embed: z.boolean().optional(), trace: z.boolean().optional(), tracePreset: z.string().optional(), layer: z.string().optional(), name: z.string().optional() },
  jsx: R`var d = __doc(ARGS.document); var L = __ailayer(d, ARGS.layer, true); var f = __file(ARGS.path); if (!f.exists) throw new Error('Not found: ' + ARGS.path);
var p = L.placedItems.add(); p.file = f; if (ARGS.width) { var k = ARGS.width / p.width; p.width = ARGS.width; p.height = p.height * k; } p.position = __pt(d, __def(ARGS.position, [0, 0])[0], __def(ARGS.position, [0, 0])[1]);
if (ARGS.name) p.name = ARGS.name; var res = __iteminfo(p);
if (ARGS.trace) { var t = p.trace(); if (ARGS.tracePreset) t.tracing.tracingOptions.loadFromPreset(ARGS.tracePreset); app.redraw(); var g = t.tracing.expandTracing(); res = __iteminfo(g); res.traced = true; }
else if (ARGS.embed) { p.embed(); res.embedded = true; }
return res;` });

jsxTool({ name: 'ai_applyEffect', toolset: 'ai', app: 'ai',
  description: 'Illustrator: apply a Live Effect via its XML definition to items/selection — e.g. <LiveEffect name="Adobe Drop Shadow"><Dict data="R horz 7 R vert 7 R blur 5 R opac 0.75 I mode 2"/></LiveEffect>, "Adobe Gaussian Blur", "Adobe Round Corners", "Adobe Offset Path", plugin effects.',
  input: { document: zDoc, items: zItems, xml: z.string() },
  jsx: R`var d = __doc(ARGS.document); var its = []; if (ARGS.items) { for (var i = 0; i < ARGS.items.length; i++) its.push(__item(d, ARGS.items[i])); } else for (var s = 0; s < d.selection.length; s++) its.push(d.selection[s]);
for (var j = 0; j < its.length; j++) its[j].applyEffect(ARGS.xml); app.redraw(); return { applied: its.length };` });

jsxTool({ name: 'ai_artboards', toolset: 'ai', app: 'ai',
  description: 'Illustrator: artboards — list, add [x,y,w,h], remove index, rename, resize rect, setActive, fitToArtwork, rearrange (columns, spacing).',
  input: { document: zDoc, action: z.enum(['list', 'add', 'remove', 'rename', 'resize', 'setActive', 'fitToArtwork']), index: z.number().int().optional(), rect: zVec.optional(), name: z.string().optional() },
  jsx: R`var d = __doc(ARGS.document); var a = ARGS.action, ab = d.artboards;
if (a === 'add') { var r = ARGS.rect; var n = ab.add([r[0], -r[1], r[0] + r[2], -(r[1] + r[3])]); if (ARGS.name) n.name = ARGS.name; }
else if (a === 'remove') ab.remove(ARGS.index); else if (a === 'rename') ab[ARGS.index].name = ARGS.name;
else if (a === 'resize') { var q = ARGS.rect; ab[__def(ARGS.index, 0)].artboardRect = [q[0], -q[1], q[0] + q[2], -(q[1] + q[3])]; } else if (a === 'setActive') ab.setActiveArtboardIndex(ARGS.index);
else if (a === 'fitToArtwork') { ab.setActiveArtboardIndex(__def(ARGS.index, 0)); d.fitArtboardToSelectedArt ? d.fitArtboardToSelectedArt(__def(ARGS.index, 0)) : app.executeMenuCommand('Fit Artboard to artwork bounds'); }
var o = []; for (var i = 0; i < ab.length; i++) o.push({ index: i, name: ab[i].name, rect: ab[i].artboardRect }); return o;` });
