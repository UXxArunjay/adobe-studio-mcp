/** After Effects — Filmit-parity core tools (same names, same arguments, ae_ prefix). */
import { z } from 'zod';
import { jsxTool, zComp, zLayer, zLayerOpt, zLayers, zVec, zValue } from './define.js';
import { imageResult, tempPng, waitForFile } from './util.js';
import { runJsx } from '../transport/runner.js';
import { ensureFfmpeg } from './media.js';
import { execFile } from 'node:child_process';
import { rmSync } from 'node:fs';

const R = String.raw;

jsxTool({ name: 'ae_getCompState', toolset: 'ae', app: 'ae', readOnly: true,
  description: 'After Effects: read the active (or named) comp — size, fps, duration, current time, work area and every layer (index, name, type, enabled, in/out, parent, 3D, blend, matte). Call this first.',
  input: { compositionName: zComp },
  jsx: R`var c = __comp(ARGS.compositionName); var o = __compInfo(c); o.layers = [];
for (var i = 1; i <= c.numLayers; i++) o.layers.push(__linfo(c.layer(i), false));
o.selected = []; for (var s = 0; s < c.selectedLayers.length; s++) o.selected.push(c.selectedLayers[s].index);
return o;` });

jsxTool({ name: 'ae_getLayer', toolset: 'ae', app: 'ae', readOnly: true,
  description: 'After Effects: full detail of one layer — transform values, keyframe counts, expressions, effects, masks, text.',
  input: { compositionName: zComp, layer: zLayer },
  jsx: R`var c = __comp(ARGS.compositionName); return __linfo(__layer(c, ARGS.layer), true);` });

jsxTool({ name: 'ae_createComp', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: create a composition (defaults 1920x1080, 30 fps, 10 s) and open it in the viewer.',
  input: { name: z.string(), width: z.number().int().optional(), height: z.number().int().optional(), duration: z.number().optional(),
    frameRate: z.number().optional(), pixelAspect: z.number().optional(), bgColor: z.string().optional(), folder: z.string().optional().describe('Project folder path like "Comps/Chapter 1" (created if missing).'), open: z.boolean().optional() },
  jsx: R`var c = app.project.items.addComp(ARGS.name, __def(ARGS.width, 1920), __def(ARGS.height, 1080), __def(ARGS.pixelAspect, 1), __def(ARGS.duration, 10), __def(ARGS.frameRate, 30));
if (ARGS.bgColor) c.bgColor = __hex(ARGS.bgColor);
if (ARGS.folder) c.parentFolder = __folder(ARGS.folder, true);
if (ARGS.open !== false) c.openInViewer();
return __compInfo(c);` });

jsxTool({ name: 'ae_addTextLayer', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: add a text layer (point text, or paragraph text when boxSize is given) with font, size, color, stroke, tracking, leading, justification and position (default comp center).',
  input: { text: z.string(), compositionName: zComp, name: z.string().optional(), font: z.string().optional().describe('PostScript font name, e.g. "Montserrat-Bold".'), fontSize: z.number().optional(),
    color: z.string().optional(), strokeColor: z.string().optional(), strokeWidth: z.number().optional(), strokeOverFill: z.boolean().optional(),
    tracking: z.number().optional(), leading: z.number().optional(), justification: z.enum(['left', 'center', 'right']).optional(),
    allCaps: z.boolean().optional(), fauxBold: z.boolean().optional(), fauxItalic: z.boolean().optional(),
    boxSize: zVec.optional().describe('[w,h] → paragraph (box) text'), position: zVec.optional(), startTime: z.number().optional(), duration: z.number().optional(), centerAnchor: z.boolean().optional().describe('default true: anchor point at text center') },
  jsx: R`var c = __comp(ARGS.compositionName);
var l = ARGS.boxSize ? c.layers.addBoxText(ARGS.boxSize, ARGS.text) : c.layers.addText(ARGS.text);
if (ARGS.name) l.name = ARGS.name;
var sp = l.property('ADBE Text Properties').property('ADBE Text Document'); var td = sp.value;
if (ARGS.boxSize) td.text = ARGS.text;
if (ARGS.font) td.font = ARGS.font;
td.fontSize = __def(ARGS.fontSize, 72);
td.applyFill = true; td.fillColor = __hex(__def(ARGS.color, '#FFFFFF'));
if (ARGS.strokeColor || ARGS.strokeWidth) { td.applyStroke = true; td.strokeColor = __hex(__def(ARGS.strokeColor, '#000000')); td.strokeWidth = __def(ARGS.strokeWidth, 2); td.strokeOverFill = __def(ARGS.strokeOverFill, false); }
if (ARGS.tracking !== undefined) td.tracking = ARGS.tracking;
if (ARGS.leading !== undefined) { td.autoLeading = false; td.leading = ARGS.leading; }
var J = { left: ParagraphJustification.LEFT_JUSTIFY, center: ParagraphJustification.CENTER_JUSTIFY, right: ParagraphJustification.RIGHT_JUSTIFY };
td.justification = J[__def(ARGS.justification, 'center')];
if (ARGS.allCaps !== undefined) td.allCaps = ARGS.allCaps; if (ARGS.fauxBold !== undefined) td.fauxBold = ARGS.fauxBold; if (ARGS.fauxItalic !== undefined) td.fauxItalic = ARGS.fauxItalic;
sp.setValue(td);
if (ARGS.centerAnchor !== false) { var r = l.sourceRectAtTime(0, false); l.transform.anchorPoint.setValue([r.left + r.width / 2, r.top + r.height / 2]); }
l.transform.position.setValue(ARGS.position || [c.width / 2, c.height / 2]);
if (ARGS.startTime !== undefined) l.startTime = ARGS.startTime;
if (ARGS.duration !== undefined) l.outPoint = l.inPoint + ARGS.duration;
return __linfo(l, false);` });

jsxTool({ name: 'ae_styleText', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: restyle an existing text layer — font, size, color, tracking, leading, justification, caps, faux bold/italic, real text stroke (strokeColor/strokeWidth/strokeOverFill), optionally new text.',
  input: { compositionName: zComp, layer: zLayer, text: z.string().optional(), font: z.string().optional(), fontSize: z.number().optional(), color: z.string().optional(),
    tracking: z.number().optional(), leading: z.number().optional(), strokeColor: z.string().optional(), strokeWidth: z.number().optional(), strokeOverFill: z.boolean().optional(),
    justification: z.enum(['left', 'center', 'right']).optional(), allCaps: z.boolean().optional(), smallCaps: z.boolean().optional(), fauxBold: z.boolean().optional(), fauxItalic: z.boolean().optional(),
    baselineShift: z.number().optional(), time: z.number().optional().describe('set as a Source Text keyframe at this time') },
  jsx: R`var c = __comp(ARGS.compositionName); var l = __layer(c, ARGS.layer);
var sp = l.property('ADBE Text Properties').property('ADBE Text Document'); var td = sp.value;
if (ARGS.text !== undefined) td.text = ARGS.text;
if (ARGS.font) td.font = ARGS.font; if (ARGS.fontSize) td.fontSize = ARGS.fontSize;
if (ARGS.color) { td.applyFill = true; td.fillColor = __hex(ARGS.color); }
if (ARGS.tracking !== undefined) td.tracking = ARGS.tracking;
if (ARGS.leading !== undefined) { td.autoLeading = false; td.leading = ARGS.leading; }
if (ARGS.strokeColor || ARGS.strokeWidth !== undefined) { td.applyStroke = (ARGS.strokeWidth !== 0); if (ARGS.strokeColor) td.strokeColor = __hex(ARGS.strokeColor); if (ARGS.strokeWidth) td.strokeWidth = ARGS.strokeWidth; }
if (ARGS.strokeOverFill !== undefined) td.strokeOverFill = ARGS.strokeOverFill;
if (ARGS.justification) td.justification = { left: ParagraphJustification.LEFT_JUSTIFY, center: ParagraphJustification.CENTER_JUSTIFY, right: ParagraphJustification.RIGHT_JUSTIFY }[ARGS.justification];
if (ARGS.allCaps !== undefined) td.allCaps = ARGS.allCaps; if (ARGS.smallCaps !== undefined) td.smallCaps = ARGS.smallCaps;
if (ARGS.fauxBold !== undefined) td.fauxBold = ARGS.fauxBold; if (ARGS.fauxItalic !== undefined) td.fauxItalic = ARGS.fauxItalic;
if (ARGS.baselineShift !== undefined) td.baselineShift = ARGS.baselineShift;
if (ARGS.time !== undefined) sp.setValueAtTime(ARGS.time, td); else if (sp.numKeys) sp.setValueAtTime(c.time, td); else sp.setValue(td);
return { layer: l.name, font: td.font, fontSize: td.fontSize, text: td.text };` });

jsxTool({ name: 'ae_addTextAnimator', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: per-character text animator with a range-selector reveal — typewriter, fadeInChars, scaleInChars, slideInChars, tracking — over `duration` seconds from startTime. basedOn chars|words|lines.',
  input: { compositionName: zComp, layer: zLayer, animator: z.enum(['typewriter', 'fadeInChars', 'scaleInChars', 'slideInChars', 'tracking', 'blurInChars', 'rotateInChars']),
    startTime: z.number().optional(), duration: z.number().optional(), slide: z.number().optional().describe('px offset for slideInChars (default 60)'), tracking: z.number().optional(),
    basedOn: z.enum(['chars', 'words', 'lines']).optional(), randomOrder: z.boolean().optional(), reverse: z.boolean().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var l = __layer(c, ARGS.layer);
var anims = l.property('ADBE Text Properties').property('ADBE Text Animators');
var an = anims.addProperty('ADBE Text Animator'); an.name = ARGS.animator;
var props = an.property('ADBE Text Animator Properties');
var kind = ARGS.animator, t0 = __def(ARGS.startTime, l.inPoint), d = __def(ARGS.duration, 1);
if (kind !== 'tracking') props.addProperty('ADBE Text Opacity').setValue(0);
if (kind === 'scaleInChars') props.addProperty('ADBE Text Scale 3D').setValue([0, 0, 100]);
if (kind === 'slideInChars') props.addProperty('ADBE Text Position 3D').setValue([0, __def(ARGS.slide, 60), 0]);
if (kind === 'blurInChars') props.addProperty('ADBE Text Blur').setValue([20, 20]);
if (kind === 'rotateInChars') props.addProperty('ADBE Text Rotation').setValue(-90);
var sel = an.property('ADBE Text Selectors').addProperty('ADBE Text Selector');
var adv = sel.property('ADBE Text Range Advanced');
try { adv.property('ADBE Text Range Type2').setValue({ chars: 1, words: 3, lines: 4 }[__def(ARGS.basedOn, 'chars')] || 1); } catch (e) {}
if (kind === 'typewriter') { try { adv.property('ADBE Text Selector Smoothness').setValue(0); } catch (e2) {} }
if (ARGS.randomOrder) { try { adv.property('ADBE Text Randomize Order').setValue(1); } catch (e3) {} }
if (kind === 'tracking') {
  var tr = props.addProperty('ADBE Text Tracking Amount');
  tr.setValueAtTime(t0, __def(ARGS.tracking, 50)); tr.setValueAtTime(t0 + d, 0);
  __keyEase(tr, 1, 33, 33); __keyEase(tr, 2, 80, 33);
} else {
  var st = sel.property('ADBE Text Percent Start');
  st.setValueAtTime(t0, ARGS.reverse ? 100 : 0); st.setValueAtTime(t0 + d, ARGS.reverse ? 0 : 100);
  if (kind === 'typewriter') { st.setInterpolationTypeAtKey(1, KeyframeInterpolationType.LINEAR); st.setInterpolationTypeAtKey(2, KeyframeInterpolationType.LINEAR); }
  else { __keyEase(st, 1, 33, 33); __keyEase(st, 2, 60, 33); }
}
return { layer: l.name, animator: an.name, from: t0, to: t0 + d };` });

jsxTool({ name: 'ae_addSolid', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: add a solid layer (default comp size, full duration).',
  input: { compositionName: zComp, color: z.string().optional(), name: z.string().optional(), size: zVec.optional(), startTime: z.number().optional(), duration: z.number().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var s = ARGS.size || [c.width, c.height];
var l = c.layers.addSolid(__hex(__def(ARGS.color, '#000000')), __def(ARGS.name, 'Solid'), s[0], s[1], c.pixelAspect, c.duration);
if (ARGS.startTime !== undefined) l.startTime = ARGS.startTime; if (ARGS.duration !== undefined) l.outPoint = l.inPoint + ARGS.duration;
return __linfo(l, false);` });

jsxTool({ name: 'ae_addNull', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: add a null object (for parenting / rigs), optionally 3D and positioned.',
  input: { compositionName: zComp, name: z.string().optional(), position: zVec.optional(), threeD: z.boolean().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var l = c.layers.addNull(c.duration); l.name = __def(ARGS.name, 'Null');
if (ARGS.threeD) l.threeDLayer = true; if (ARGS.position) l.transform.position.setValue(__val(l.transform.position, ARGS.position));
return __linfo(l, false);` });

jsxTool({ name: 'ae_addAdjustment', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: add an adjustment layer (optionally with effects by name/matchName) affecting everything below it.',
  input: { compositionName: zComp, name: z.string().optional(), effects: z.array(z.string()).optional(), startTime: z.number().optional(), duration: z.number().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var l = c.layers.addSolid([1, 1, 1], __def(ARGS.name, 'Adjustment Layer'), c.width, c.height, c.pixelAspect, c.duration);
l.adjustmentLayer = true; var fx = [];
if (ARGS.effects) for (var i = 0; i < ARGS.effects.length; i++) fx.push(__addEffect(l, ARGS.effects[i]).name);
if (ARGS.startTime !== undefined) l.startTime = ARGS.startTime; if (ARGS.duration !== undefined) l.outPoint = l.inPoint + ARGS.duration;
var o = __linfo(l, false); o.effects = fx; return o;` });

jsxTool({ name: 'ae_addShapeLayer', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: add a vector shape layer — rect, roundedRect, ellipse, polygon, star or custom path (points [[x,y],...] relative to the layer center) — with hex fill/stroke. position = layer center (default comp center).',
  input: { compositionName: zComp, shape: z.enum(['rect', 'roundedRect', 'ellipse', 'polygon', 'star', 'path']), size: zVec.describe('[w, h] px (for polygon/star: outer diameter)'),
    name: z.string().optional(), position: zVec.optional(), fill: z.string().nullable().optional().describe('hex, or null for no fill'), stroke: z.string().optional(), strokeWidth: z.number().optional(),
    cornerRadius: z.number().optional(), points: z.number().int().optional().describe('polygon/star points'), innerRatio: z.number().optional().describe('star inner/outer radius (default 0.5)'),
    pathPoints: z.array(zVec).optional().describe('for shape "path": [[x,y],...]'), closed: z.boolean().optional(), opacity: z.number().optional(),
    lineCap: z.enum(['butt', 'round', 'square']).optional(), trimPaths: z.boolean().optional().describe('add Trim Paths (for write-on animation)') },
  jsx: R`var c = __comp(ARGS.compositionName); var l = c.layers.addShape(); l.name = __def(ARGS.name, ARGS.shape);
var g = l.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group'); g.name = ARGS.shape;
var ct = g.property('ADBE Vectors Group'); var w = ARGS.size[0], h = __def(ARGS.size[1], ARGS.size[0]);
if (ARGS.shape === 'rect' || ARGS.shape === 'roundedRect') { var r = ct.addProperty('ADBE Vector Shape - Rect'); r.property('ADBE Vector Rect Size').setValue([w, h]); r.property('ADBE Vector Rect Roundness').setValue(__def(ARGS.cornerRadius, ARGS.shape === 'roundedRect' ? Math.min(w, h) * 0.15 : 0)); }
else if (ARGS.shape === 'ellipse') { ct.addProperty('ADBE Vector Shape - Ellipse').property('ADBE Vector Ellipse Size').setValue([w, h]); }
else if (ARGS.shape === 'polygon' || ARGS.shape === 'star') { var st = ct.addProperty('ADBE Vector Shape - Star'); st.property('ADBE Vector Star Type').setValue(ARGS.shape === 'star' ? 1 : 2);
  st.property('ADBE Vector Star Points').setValue(__def(ARGS.points, ARGS.shape === 'star' ? 5 : 6)); st.property('ADBE Vector Star Outer Radius').setValue(w / 2);
  if (ARGS.shape === 'star') st.property('ADBE Vector Star Inner Radius').setValue(w / 2 * __def(ARGS.innerRatio, 0.5)); if (ARGS.cornerRadius) st.property('ADBE Vector Star Outer Roundess').setValue(ARGS.cornerRadius); }
else { var pg = ct.addProperty('ADBE Vector Shape - Group'); var sh = new Shape(); sh.vertices = ARGS.pathPoints || [[0, 0], [w, 0]]; sh.closed = __def(ARGS.closed, false); pg.property('ADBE Vector Shape').setValue(sh); }
if (ARGS.fill !== null && (ARGS.fill || !ARGS.stroke)) { var f = ct.addProperty('ADBE Vector Graphic - Fill'); f.property('ADBE Vector Fill Color').setValue(__val(f.property('ADBE Vector Fill Color'), __def(ARGS.fill, '#FFFFFF'))); }
if (ARGS.stroke) { var s = ct.addProperty('ADBE Vector Graphic - Stroke'); s.property('ADBE Vector Stroke Color').setValue(__val(s.property('ADBE Vector Stroke Color'), ARGS.stroke)); s.property('ADBE Vector Stroke Width').setValue(__def(ARGS.strokeWidth, 4));
  if (ARGS.lineCap) s.property('ADBE Vector Stroke Line Cap').setValue({ butt: 1, round: 2, square: 3 }[ARGS.lineCap]); }
if (ARGS.trimPaths) ct.addProperty('ADBE Vector Filter - Trim');
l.transform.position.setValue(ARGS.position || [c.width / 2, c.height / 2]);
if (ARGS.opacity !== undefined) l.transform.opacity.setValue(ARGS.opacity);
return __linfo(l, false);` });

jsxTool({ name: 'ae_addMask', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: add a mask to a layer — rect [x,y,w,h], ellipse [x,y,w,h] or path points (layer space) — with mode, feather, expansion, opacity, inverted.',
  input: { compositionName: zComp, layer: zLayer, shape: z.enum(['rect', 'ellipse', 'path']).optional(), rect: zVec.optional().describe('[x, y, w, h] in layer pixels (default full layer)'),
    points: z.array(zVec).optional(), mode: z.enum(['add', 'subtract', 'intersect', 'lighten', 'darken', 'difference', 'none']).optional(), feather: z.number().optional(),
    expansion: z.number().optional(), opacity: z.number().optional(), inverted: z.boolean().optional(), name: z.string().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var l = __layer(c, ARGS.layer);
var m = l.property('ADBE Mask Parade').addProperty('ADBE Mask Atom'); if (ARGS.name) m.name = ARGS.name;
var M = { add: MaskMode.ADD, subtract: MaskMode.SUBTRACT, intersect: MaskMode.INTERSECT, lighten: MaskMode.LIGHTEN, darken: MaskMode.DARKEN, difference: MaskMode.DIFFERENCE, none: MaskMode.NONE };
m.maskMode = M[__def(ARGS.mode, 'add')];
var src = l.sourceRectAtTime(c.time, false); var r = ARGS.rect || [src.left, src.top, src.width, src.height];
var s = new Shape(), x = r[0], y = r[1], w = r[2], h = r[3];
if (ARGS.shape === 'path' && ARGS.points) { s.vertices = ARGS.points; }
else if (ARGS.shape === 'ellipse') { var k = 0.5523, cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
  s.vertices = [[cx, y], [x + w, cy], [cx, y + h], [x, cy]];
  s.inTangents = [[-rx * k, 0], [0, -ry * k], [rx * k, 0], [0, ry * k]]; s.outTangents = [[rx * k, 0], [0, ry * k], [-rx * k, 0], [0, -ry * k]]; }
else s.vertices = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
s.closed = true; m.property('ADBE Mask Shape').setValue(s);
if (ARGS.feather !== undefined) m.property('ADBE Mask Feather').setValue([ARGS.feather, ARGS.feather]);
if (ARGS.expansion !== undefined) m.property('ADBE Mask Offset').setValue(ARGS.expansion);
if (ARGS.opacity !== undefined) m.property('ADBE Mask Opacity').setValue(ARGS.opacity);
if (ARGS.inverted) m.inverted = true;
return { layer: l.name, mask: m.name, index: m.propertyIndex };` });

jsxTool({ name: 'ae_addEffect', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: add ANY effect (built-in or third-party plugin) by display name or matchName, optionally setting parameters {paramName: value} (colors as hex). Use ae_listEffects to discover installed effects.',
  input: { compositionName: zComp, layer: zLayer, effect: z.string(), name: z.string().optional(), properties: z.record(zValue).optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var l = __layer(c, ARGS.layer); var e = __addEffect(l, ARGS.effect);
if (ARGS.name) e.name = ARGS.name; var set = {};
if (ARGS.properties) for (var k in ARGS.properties) { var p = __effectParam(e, k); __setProp(p, ARGS.properties[k]); set[k] = ARGS.properties[k]; }
var params = []; for (var i = 1; i <= e.numProperties; i++) { var q = e.property(i); if (q.propertyType === PropertyType.PROPERTY && q.propertyValueType !== PropertyValueType.NO_VALUE) { var v = null; try { v = q.value; } catch (x) {} params.push({ index: i, name: q.name, matchName: q.matchName, value: v }); } }
return { layer: l.name, effect: e.name, matchName: e.matchName, index: e.propertyIndex, set: set, params: params };` });

jsxTool({ name: 'ae_setEffectProperties', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: set parameters of an effect already on a layer: properties {paramNameOrIndex: value}. With time, sets keyframes.',
  input: { compositionName: zComp, layer: zLayer, effect: z.union([z.string(), z.number().int()]), properties: z.record(zValue), time: z.number().optional(), enabled: z.boolean().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var l = __layer(c, ARGS.layer); var e = __effect(l, ARGS.effect); var out = {};
if (ARGS.enabled !== undefined) e.enabled = ARGS.enabled;
for (var k in ARGS.properties) { var p = __effectParam(e, k); __setProp(p, ARGS.properties[k], ARGS.time); out[p.name] = p.value; }
return { effect: e.name, values: out };` });

jsxTool({ name: 'ae_setEffectKeyframe', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: keyframe one effect parameter at a time (optional ease influence %, interpolation linear|bezier|hold).',
  input: { compositionName: zComp, layer: zLayer, effect: z.union([z.string(), z.number().int()]), property: z.union([z.string(), z.number().int()]), time: z.number(), value: zValue,
    ease: z.number().optional(), interpolation: z.enum(['linear', 'bezier', 'hold']).optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var l = __layer(c, ARGS.layer); var p = __effectParam(__effect(l, ARGS.effect), ARGS.property);
var k = __setProp(p, ARGS.value, ARGS.time);
if (ARGS.interpolation) p.setInterpolationTypeAtKey(k, __interp(ARGS.interpolation), __interp(ARGS.interpolation));
if (ARGS.ease !== undefined) __keyEase(p, k, ARGS.ease, ARGS.ease);
return { param: p.name, key: k, keys: p.numKeys };` });

jsxTool({ name: 'ae_setEffectExpression', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: set (or clear with "") an expression on an effect parameter.',
  input: { compositionName: zComp, layer: zLayer, effect: z.union([z.string(), z.number().int()]), property: z.union([z.string(), z.number().int()]), expression: z.string() },
  jsx: R`var c = __comp(ARGS.compositionName); var l = __layer(c, ARGS.layer); var p = __effectParam(__effect(l, ARGS.effect), ARGS.property);
p.expression = ARGS.expression; p.expressionEnabled = ARGS.expression !== '';
return { param: p.name, expressionError: p.expressionError || '' };` });

jsxTool({ name: 'ae_addExpressionControl', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: add an expression control (slider/angle/checkbox/color/point/point3d/layer/dropdown) to rig expressions against.',
  input: { compositionName: zComp, layer: zLayer, controlType: z.enum(['slider', 'angle', 'checkbox', 'color', 'point', 'point3d', 'layer', 'dropdown']), name: z.string().optional(),
    value: z.union([z.number(), z.boolean(), z.string(), z.array(z.number())]).optional(), items: z.array(z.string()).optional().describe('dropdown menu items') },
  jsx: R`var c = __comp(ARGS.compositionName); var l = __layer(c, ARGS.layer);
var MN = { slider: 'ADBE Slider Control', angle: 'ADBE Angle Control', checkbox: 'ADBE Checkbox Control', color: 'ADBE Color Control', point: 'ADBE Point Control', point3d: 'ADBE Point3D Control', layer: 'ADBE Layer Control', dropdown: 'ADBE Dropdown Control' };
var e = __addEffect(l, MN[ARGS.controlType]); if (ARGS.name) e.name = ARGS.name;
var p = e.property(1);
if (ARGS.controlType === 'dropdown' && ARGS.items) { p = p.setPropertyParameters(ARGS.items); }
if (ARGS.value !== undefined && ARGS.controlType !== 'layer') __setProp(p, ARGS.controlType === 'checkbox' ? (ARGS.value ? 1 : 0) : ARGS.value);
if (ARGS.controlType === 'layer' && ARGS.value !== undefined) p.setValue(typeof ARGS.value === 'number' ? ARGS.value : __layer(c, ARGS.value).index);
return { layer: l.name, control: e.name, ref: 'effect("' + e.name + '")(1)' };` });

jsxTool({ name: 'ae_setExpression', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: set (or clear with "") an expression on any property — aliases (position, scale, rotation, opacity, anchorPoint...) or a path like "Effects>Gaussian Blur>Blurriness" / "Contents>Rectangle 1>...". Returns the expression error if any.',
  input: { compositionName: zComp, layer: zLayer, property: z.string(), expression: z.string() },
  jsx: R`var c = __comp(ARGS.compositionName); var l = __layer(c, ARGS.layer); var p = __prop(l, ARGS.property);
p.expression = ARGS.expression; p.expressionEnabled = ARGS.expression !== '';
return { property: p.name, expressionError: p.expressionError || '' };` });

const TEMPLATES: Record<string, (p: Record<string, number>) => string> = {
  wiggle: (p) => `wiggle(${p.freq ?? 2}, ${p.amp ?? 30})`,
  wiggleSmooth: (p) => `wiggle(${p.freq ?? 1}, ${p.amp ?? 20}, ${p.octaves ?? 1}, ${p.ampMult ?? 0.5})`,
  loopCycle: () => 'loopOut("cycle")', loopPingpong: () => 'loopOut("pingpong")', loopOffset: () => 'loopOut("offset")', loopContinue: () => 'loopOut("continue")',
  time: (p) => `value + time * ${p.rate ?? 90}`,
  inertia: (p) => `var amp = ${p.amp ?? 0.05}, freq = ${p.freq ?? 2.5}, decay = ${p.decay ?? 6}; var n = 0; if (numKeys > 0) { n = nearestKey(time).index; if (key(n).time > time) n--; } var t = (n == 0) ? 0 : time - key(n).time; if (n > 0 && t < 2) { var v = velocityAtTime(key(n).time - thisComp.frameDuration / 10); value + v * amp * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t); } else { value; }`,
  overshoot: (p) => `var freq = ${p.freq ?? 3}, decay = ${p.decay ?? 5}; var n = 0; if (numKeys > 0) { n = nearestKey(time).index; if (key(n).time > time) n--; } if (n > 0) { var t = time - key(n).time; var amp = velocityAtTime(key(n).time - .001) / 10 * ${p.amp ?? 1}; var w = freq * Math.PI * 2; value + amp * (Math.sin(t * w) / Math.exp(decay * t) / w) * 10; } else { value; }`,
  bounce: (p) => `var e = ${p.elasticity ?? 0.7}, g = ${p.gravity ?? 5000}, nMax = ${p.bounces ?? 9}; var n = 0; if (numKeys > 0) { n = nearestKey(time).index; if (key(n).time > time) n--; } if (n > 0) { var t = time - key(n).time; var v = -velocityAtTime(key(n).time - .001) * e; var vl = length(v); var vu = (value instanceof Array) ? ((vl > 0) ? normalize(v) : v * 0) : ((v < 0) ? -1 : 1); var tCur = 0, segDur = 2 * vl / g, tNext = segDur, nb = 1; while (tNext < t && nb <= nMax) { vl *= e; segDur *= e; tCur = tNext; tNext += segDur; nb++; } if (nb <= nMax) { var delta = t - tCur; value + vu * delta * (vl - g * delta / 2); } else { value; } } else { value; }`,
};

jsxTool({ name: 'ae_applyExpressionTemplate', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: apply a ready-made expression — wiggle, wiggleSmooth, loopCycle, loopPingpong, loopOffset, loopContinue, bounce, inertia, overshoot, time. params tune it (freq/amp/decay/rate/elasticity/gravity/bounces). bounce/inertia/overshoot ride after your keyframes.',
  input: { compositionName: zComp, layer: zLayer, property: z.string().describe('position|scale|rotation|opacity or any property path'),
    template: z.enum(['wiggle', 'wiggleSmooth', 'loopCycle', 'loopPingpong', 'loopOffset', 'loopContinue', 'bounce', 'inertia', 'overshoot', 'time']), params: z.record(z.number()).optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var l = __layer(c, ARGS.layer); var p = __prop(l, ARGS.property);
p.expression = ARGS.__expr; p.expressionEnabled = true; return { property: p.name, expression: ARGS.__expr, expressionError: p.expressionError || '' };`,
  before: (a) => ({ ...a, __expr: TEMPLATES[a.template](a.params || {}) }),
});

jsxTool({ name: 'ae_linkProperties', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: drive targetLayer.targetProperty from sourceLayer.sourceProperty with an expression (pick-whip), optionally from another comp, scaled by multiplier and offset.',
  input: { compositionName: zComp, sourceLayer: zLayer, sourceProperty: z.string(), targetLayer: zLayer, targetProperty: z.string(), sourceComp: z.string().optional(), multiplier: z.number().optional(), offset: z.number().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var sc = ARGS.sourceComp ? __comp(ARGS.sourceComp) : c;
var sl = __layer(sc, ARGS.sourceLayer), sp = __prop(sl, ARGS.sourceProperty), tl = __layer(c, ARGS.targetLayer), tp = __prop(tl, ARGS.targetProperty);
var chain = []; var p = sp; while (p && p.propertyDepth > 0) { var par = p.parentProperty; var useName = par && par.propertyType === PropertyType.INDEXED_GROUP; chain.unshift('(' + __s(useName ? p.name : p.matchName) + ')'); p = par; }
var base = (sc === c ? 'thisComp' : 'comp(' + __s(sc.name) + ')') + '.layer(' + __s(sl.name) + ')' + chain.join('');
var ex = base; if (ARGS.multiplier !== undefined) ex = base + ' * ' + ARGS.multiplier; if (ARGS.offset !== undefined) ex = '(' + ex + ') + ' + ARGS.offset;
tp.expression = ex; tp.expressionEnabled = true;
return { target: tl.name + '.' + tp.name, expression: ex, expressionError: tp.expressionError || '' };` });

jsxTool({ name: 'ae_setKeyframe', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: set one keyframe on any property (aliases or path) at time with value; optional ease influence %, interpolation, easeIn/easeOut.',
  input: { compositionName: zComp, layer: zLayer, property: z.string(), time: z.number(), value: zValue, ease: z.number().optional(), easeIn: z.number().optional(), easeOut: z.number().optional(),
    interpolation: z.enum(['linear', 'bezier', 'hold']).optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var l = __layer(c, ARGS.layer); var p = __prop(l, ARGS.property);
var k = __setProp(p, ARGS.value, ARGS.time);
if (ARGS.interpolation) p.setInterpolationTypeAtKey(k, __interp(ARGS.interpolation), __interp(ARGS.interpolation));
if (ARGS.ease !== undefined || ARGS.easeIn !== undefined || ARGS.easeOut !== undefined) __keyEase(p, k, __def(ARGS.easeIn, ARGS.ease), __def(ARGS.easeOut, ARGS.ease));
return { property: p.name, key: k, keys: p.numKeys };` });

jsxTool({ name: 'ae_setKeyframes', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: bulk-set many keyframes in one call (cheapest way to build motion). keys: [{layer, property, time, value, ease?, easeIn?, easeOut?, interpolation?}].',
  input: { compositionName: zComp, keys: z.array(z.object({ layer: zLayer, property: z.string(), time: z.number(), value: zValue, ease: z.number().optional(), easeIn: z.number().optional(), easeOut: z.number().optional(), interpolation: z.enum(['linear', 'bezier', 'hold']).optional() })) },
  jsx: R`var c = __comp(ARGS.compositionName); var done = 0, errors = [];
for (var i = 0; i < ARGS.keys.length; i++) { var K = ARGS.keys[i];
  try { var l = __layer(c, K.layer), p = __prop(l, K.property); var k = __setProp(p, K.value, K.time);
    if (K.interpolation) p.setInterpolationTypeAtKey(k, __interp(K.interpolation), __interp(K.interpolation));
    if (K.ease !== undefined || K.easeIn !== undefined || K.easeOut !== undefined) __keyEase(p, k, __def(K.easeIn, K.ease), __def(K.easeOut, K.ease));
    done++; } catch (e) { errors.push({ index: i, error: String(e.message || e) }); } }
return { set: done, errors: errors };` });

jsxTool({ name: 'ae_getKeyframes', toolset: 'ae', app: 'ae', readOnly: true,
  description: 'After Effects: list keyframes of a property — time, value, interpolation and temporal ease.',
  input: { compositionName: zComp, layer: zLayer, property: z.string() },
  jsx: R`var c = __comp(ARGS.compositionName); var p = __prop(__layer(c, ARGS.layer), ARGS.property); var out = [];
for (var k = 1; k <= p.numKeys; k++) { var o = { index: k, time: p.keyTime(k), value: p.keyValue(k) };
  try { o.inInterp = String(p.keyInInterpolationType(k)); o.outInterp = String(p.keyOutInterpolationType(k)); var ei = p.keyInTemporalEase(k), eo = p.keyOutTemporalEase(k); o.easeIn = { influence: ei[0].influence, speed: ei[0].speed }; o.easeOut = { influence: eo[0].influence, speed: eo[0].speed }; } catch (e) {}
  out.push(o); }
return { property: p.name, numKeys: p.numKeys, expression: p.expressionEnabled ? p.expression : '', keys: out };` });

jsxTool({ name: 'ae_setKeyframeEase', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: directional/asymmetric temporal ease on an existing keyframe (by time, keyIndex, or all:true): influenceIn/Out 0-100, speedIn/Out.',
  input: { compositionName: zComp, layer: zLayer, property: z.string(), keyIndex: z.number().int().optional(), time: z.number().optional(), all: z.boolean().optional(),
    influenceIn: z.number().optional(), influenceOut: z.number().optional(), speedIn: z.number().optional(), speedOut: z.number().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var p = __prop(__layer(c, ARGS.layer), ARGS.property);
if (!p.numKeys) throw new Error('Property has no keyframes.');
var ks = []; if (ARGS.all) { for (var i = 1; i <= p.numKeys; i++) ks.push(i); } else ks.push(ARGS.keyIndex || p.nearestKeyIndex(__def(ARGS.time, c.time)));
for (var j = 0; j < ks.length; j++) { p.setInterpolationTypeAtKey(ks[j], KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER); __keyEase(p, ks[j], __def(ARGS.influenceIn, 33.33), __def(ARGS.influenceOut, 33.33), ARGS.speedIn, ARGS.speedOut); }
return { property: p.name, keys: ks };` });

jsxTool({ name: 'ae_setInterpolation', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: set keyframe interpolation (linear|bezier|hold, in/out separately), plus roving / auto-bezier / continuous for spatial props. keyIndex, time, or all keys.',
  input: { compositionName: zComp, layer: zLayer, property: z.string(), keyIndex: z.number().int().optional(), time: z.number().optional(), inType: z.enum(['linear', 'bezier', 'hold']).optional(),
    outType: z.enum(['linear', 'bezier', 'hold']).optional(), roving: z.boolean().optional(), autoBezier: z.boolean().optional(), continuous: z.boolean().optional(), easyEase: z.boolean().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var p = __prop(__layer(c, ARGS.layer), ARGS.property); var ks = [];
if (ARGS.keyIndex) ks.push(ARGS.keyIndex); else if (ARGS.time !== undefined) ks.push(p.nearestKeyIndex(ARGS.time)); else for (var i = 1; i <= p.numKeys; i++) ks.push(i);
for (var j = 0; j < ks.length; j++) { var k = ks[j];
  if (ARGS.inType || ARGS.outType) p.setInterpolationTypeAtKey(k, __interp(__def(ARGS.inType, ARGS.outType)), __interp(__def(ARGS.outType, ARGS.inType)));
  if (ARGS.easyEase) __keyEase(p, k, 33.33, 33.33);
  try { if (ARGS.roving !== undefined) p.setRovingAtKey(k, ARGS.roving); if (ARGS.autoBezier !== undefined) p.setSpatialAutoBezierAtKey(k, ARGS.autoBezier); if (ARGS.continuous !== undefined) p.setSpatialContinuousAtKey(k, ARGS.continuous); } catch (e) {} }
return { property: p.name, keys: ks };` });

jsxTool({ name: 'ae_setTransform', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: set transform — position, scale (number or [x,y]), rotation, opacity, anchorPoint, xRotation, yRotation, orientation. With time, sets keyframes instead.',
  input: { compositionName: zComp, layer: zLayer, position: zVec.optional(), scale: z.union([z.number(), zVec]).optional(), rotation: z.number().optional(), opacity: z.number().optional(),
    anchorPoint: zVec.optional(), xRotation: z.number().optional(), yRotation: z.number().optional(), orientation: zVec.optional(), time: z.number().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var l = __layer(c, ARGS.layer); var map = { position: 'position', scale: 'scale', rotation: 'rotation', opacity: 'opacity', anchorPoint: 'anchorpoint', xRotation: 'xrotation', yRotation: 'yrotation', orientation: 'orientation' };
var done = {};
for (var k in map) if (ARGS[k] !== undefined) { var p = __prop(l, map[k]); __setProp(p, ARGS[k], ARGS.time); done[k] = p.valueAtTime(__def(ARGS.time, c.time), true); }
return { layer: l.name, set: done };` });

jsxTool({ name: 'ae_setBlendingMode', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: set a layer blending mode (normal, add, screen, multiply, overlay, softLight, hardLight, colorDodge, colorBurn, difference, luminosity, color, hue, ... any AE mode name).',
  input: { compositionName: zComp, layer: zLayer, mode: z.string() },
  jsx: R`var c = __comp(ARGS.compositionName); var l = __layer(c, ARGS.layer);
var k = String(ARGS.mode).replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').toUpperCase(); if (k === 'SILHOUETTE_ALPHA') k = 'SILHOUETE_ALPHA';
if (BlendingMode[k] === undefined) throw new Error('Unknown blending mode: ' + ARGS.mode);
l.blendingMode = BlendingMode[k]; return { layer: l.name, mode: k };` });

jsxTool({ name: 'ae_setMotionBlur', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: toggle motion blur on layers (or all) and the comp switch; shutterAngle/phase/samples.',
  input: { compositionName: zComp, layers: zLayers.optional(), enabled: z.boolean().optional(), shutterAngle: z.number().optional(), shutterPhase: z.number().optional(), samples: z.number().int().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var on = ARGS.enabled !== false; var n = 0;
if (ARGS.layers) { for (var i = 0; i < ARGS.layers.length; i++) { __layer(c, ARGS.layers[i]).motionBlur = on; n++; } } else { for (var j = 1; j <= c.numLayers; j++) { try { c.layer(j).motionBlur = on; n++; } catch (e) {} } }
c.motionBlur = on; if (ARGS.shutterAngle !== undefined) c.shutterAngle = ARGS.shutterAngle; if (ARGS.shutterPhase !== undefined) c.shutterPhase = ARGS.shutterPhase; if (ARGS.samples) c.motionBlurSamplesPerFrame = ARGS.samples;
return { layers: n, compMotionBlur: c.motionBlur };` });

jsxTool({ name: 'ae_setTrackMatte', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: use matteLayer as track matte for layer (alpha|alphaInverted|luma|lumaInverted|none). Image on top, shape as alpha matte = clip image into shape.',
  input: { compositionName: zComp, layer: zLayer, matteLayer: zLayerOpt, type: z.enum(['alpha', 'alphaInverted', 'luma', 'lumaInverted', 'none']).optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var l = __layer(c, ARGS.layer); var T = { alpha: TrackMatteType.ALPHA, alphaInverted: TrackMatteType.ALPHA_INVERTED, luma: TrackMatteType.LUMA, lumaInverted: TrackMatteType.LUMA_INVERTED, none: TrackMatteType.NO_TRACK_MATTE };
var t = T[__def(ARGS.type, 'alpha')];
if (t === TrackMatteType.NO_TRACK_MATTE) { if (l.removeTrackMatte) l.removeTrackMatte(); else l.trackMatteType = t; return { layer: l.name, matte: null }; }
var m = __layer(c, ARGS.matteLayer);
if (l.setTrackMatte) { l.setTrackMatte(m, t); } else { m.moveBefore(l); l.trackMatteType = t; }
return { layer: l.name, matte: m.name, type: ARGS.type || 'alpha' };` });

jsxTool({ name: 'ae_trimLayer', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: set a layer inPoint/outPoint (or duration) and/or startTime (slides the layer).',
  input: { compositionName: zComp, layer: zLayer, inPoint: z.number().optional(), outPoint: z.number().optional(), duration: z.number().optional(), startTime: z.number().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var l = __layer(c, ARGS.layer);
if (ARGS.startTime !== undefined) l.startTime = ARGS.startTime; if (ARGS.inPoint !== undefined) l.inPoint = ARGS.inPoint;
if (ARGS.outPoint !== undefined) l.outPoint = ARGS.outPoint; if (ARGS.duration !== undefined) l.outPoint = l.inPoint + ARGS.duration;
return __linfo(l, false);` });

jsxTool({ name: 'ae_parentLayer', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: parent layer(s) to a parent layer (or unparent with parent null).',
  input: { compositionName: zComp, layer: z.union([zLayer, zLayers]), parent: zLayer.nullable() },
  jsx: R`var c = __comp(ARGS.compositionName); var ls = (ARGS.layer instanceof Array) ? ARGS.layer : [ARGS.layer]; var par = ARGS.parent === null ? null : __layer(c, ARGS.parent);
for (var i = 0; i < ls.length; i++) __layer(c, ls[i]).parent = par;
return { layers: ls, parent: par ? par.name : null };` });

jsxTool({ name: 'ae_reorderLayer', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: move a layer to index, or to top/bottom, or above/below another layer.',
  input: { compositionName: zComp, layer: zLayer, toIndex: z.number().int().optional(), position: z.enum(['top', 'bottom']).optional(), above: zLayerOpt, below: zLayerOpt },
  jsx: R`var c = __comp(ARGS.compositionName); var l = __layer(c, ARGS.layer);
if (ARGS.position === 'top') l.moveToBeginning(); else if (ARGS.position === 'bottom') l.moveToEnd();
else if (ARGS.above !== undefined) l.moveBefore(__layer(c, ARGS.above)); else if (ARGS.below !== undefined) l.moveAfter(__layer(c, ARGS.below));
else if (ARGS.toIndex) { if (ARGS.toIndex <= 1) l.moveToBeginning(); else if (ARGS.toIndex >= c.numLayers) l.moveToEnd(); else { var tgt = c.layer(ARGS.toIndex); if (tgt.index > l.index) l.moveAfter(tgt); else l.moveBefore(tgt); } }
return { layer: l.name, index: l.index };` });

jsxTool({ name: 'ae_duplicateLayer', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: duplicate a layer (count copies), optionally rename and offset each copy in time.',
  input: { compositionName: zComp, layer: zLayer, newName: z.string().optional(), count: z.number().int().optional(), timeOffset: z.number().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var l = __layer(c, ARGS.layer); var out = [];
for (var i = 1; i <= __def(ARGS.count, 1); i++) { var d = l.duplicate(); if (ARGS.newName) d.name = ARGS.newName + (__def(ARGS.count, 1) > 1 ? ' ' + i : ''); if (ARGS.timeOffset) d.startTime = l.startTime + ARGS.timeOffset * i; out.push({ index: d.index, name: d.name }); }
return out;` });

jsxTool({ name: 'ae_deleteLayer', toolset: 'ae', app: 'ae', undo: true, destructive: true,
  description: 'After Effects: delete one or more layers (undoable with Ctrl+Z).',
  input: { compositionName: zComp, layer: z.union([zLayer, zLayers]) },
  jsx: R`var c = __comp(ARGS.compositionName); var ls = (ARGS.layer instanceof Array) ? ARGS.layer : [ARGS.layer]; var objs = [], names = [];
for (var i = 0; i < ls.length; i++) objs.push(__layer(c, ls[i]));
for (var j = 0; j < objs.length; j++) { names.push(objs[j].name); objs[j].remove(); }
return { deleted: names };` });

jsxTool({ name: 'ae_precompose', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: precompose layers into a new comp (moveAllAttributes default true), optionally open it.',
  input: { compositionName: zComp, layers: zLayers, name: z.string(), moveAllAttributes: z.boolean().optional(), open: z.boolean().optional() },
  jsx: R`var c = __comp(ARGS.compositionName); var idx = [];
for (var i = 0; i < ARGS.layers.length; i++) idx.push(__layer(c, ARGS.layers[i]).index);
var nc = c.layers.precompose(idx, ARGS.name, ARGS.moveAllAttributes !== false); if (ARGS.open) nc.openInViewer();
return __compInfo(nc);` });

jsxTool({ name: 'ae_importImage', toolset: 'ae', app: 'ae', undo: true, timeoutMs: 300000,
  description: 'After Effects: import an image/video/audio/PSD/AI file into the project and (default) add it to the comp — fit contain|cover|width|height|none, position, scale, name. asGuide:true makes a locked 50% guide layer for tracing a reference. PSD/AI with asComp:true import as a layered comp.',
  input: { path: z.string(), compositionName: zComp, addToComp: z.boolean().optional(), name: z.string().optional(), fit: z.enum(['contain', 'cover', 'width', 'height', 'none']).optional(),
    position: zVec.optional(), scale: z.number().optional(), asGuide: z.boolean().optional(), asComp: z.boolean().optional().describe('PSD/AI: import as composition with layers'), sequence: z.boolean().optional().describe('import numbered image sequence'),
    folder: z.string().optional(), startTime: z.number().optional() },
  jsx: R`var f = __file(ARGS.path); if (!f.exists) throw new Error('File not found: ' + ARGS.path);
var io = new ImportOptions(f);
if (ARGS.asComp && io.canImportAs(ImportAsType.COMP)) io.importAs = ImportAsType.COMP;
if (ARGS.sequence) io.sequence = true;
var item = app.project.importFile(io); if (ARGS.folder) item.parentFolder = __folder(ARGS.folder, true);
var res = { item: item.name, id: item.id, type: item.typeName, width: item.width, height: item.height, duration: item.duration };
if (ARGS.addToComp === false) return res;
var c = __comp(ARGS.compositionName); var l = c.layers.add(item); if (ARGS.name) l.name = ARGS.name;
if (ARGS.startTime !== undefined) l.startTime = ARGS.startTime;
var fit = __def(ARGS.fit, 'contain');
if (item.width && fit !== 'none' && !ARGS.scale) { var sx = c.width / item.width * 100, sy = c.height / item.height * 100; var s = fit === 'cover' ? Math.max(sx, sy) : fit === 'width' ? sx : fit === 'height' ? sy : Math.min(sx, sy); l.transform.scale.setValue(__val(l.transform.scale, s)); }
if (ARGS.scale) l.transform.scale.setValue(__val(l.transform.scale, ARGS.scale));
if (ARGS.position) l.transform.position.setValue(__val(l.transform.position, ARGS.position));
if (ARGS.asGuide) { l.guideLayer = true; l.transform.opacity.setValue(50); l.locked = true; l.moveToEnd(); }
res.layer = __linfo(l, false); return res;` });

jsxTool({ name: 'ae_exportFrame', toolset: 'ae', app: 'ae', readOnly: true, timeoutMs: 180000,
  description: 'After Effects: render one frame of the comp to PNG (default current time) and return it as an image so you can check your work.',
  input: { compositionName: zComp, time: z.number().optional(), path: z.string().optional().describe('output .png (default: temp file)') },
  jsx: R`var c = __comp(ARGS.compositionName); var f = __file(ARGS.__path);
if (f.exists) f.remove();
c.saveFrameToPng(__def(ARGS.time, c.time), f);
return { path: f.fsName, time: __def(ARGS.time, c.time), comp: c.name };`,
  before: (a) => ({ ...a, __path: a.path || tempPng('ae-frame') }),
  after: async (r: any, a: any) => {
    if (await waitForFile(r.path, 8000)) return imageResult(r.path, r);
    // saveFrameToPng is asynchronous in AE 2025+ and skips uncached frames → deterministic Render Queue fallback (TIFF → PNG)
    const tif: any = await runJsx('ae', RQ_FRAME, { compositionName: r.comp, time: r.time, base: r.path.replace(/\.png$/i, '').replace(/\\/g, '/') }, { timeoutMs: 600000 });
    if (!tif?.file) return { ...r, error: 'Frame render failed', detail: tif };
    const ff = await ensureFfmpeg();
    await new Promise<void>((res, rej) => execFile(ff, ['-y', '-loglevel', 'error', '-i', tif.file, r.path], { windowsHide: true }, (e) => (e ? rej(e) : res())));
    try { rmSync(tif.file, { force: true }); } catch { /* ignore */ }
    return imageResult(r.path, { ...r, via: 'renderQueue' });
  },
});

const RQ_FRAME = R`var c = __comp(ARGS.compositionName); var rq = app.project.renderQueue; var prev = [];
for (var i = 1; i <= rq.numItems; i++) { var x = rq.item(i); prev.push(x.render); try { x.render = false; } catch (e) {} }
var it = rq.items.add(c); try { it.applyTemplate('Best Settings'); } catch (e1) {}
it.timeSpanStart = ARGS.time; it.timeSpanDuration = c.frameDuration;
var om = it.outputModule(1); om.applyTemplate('TIFF Sequence with Alpha'); om.file = new File(ARGS.base + '_[#####].tif');
var err = null; try { rq.render(); } catch (e2) { err = String(e2); }
var dir = new File(ARGS.base).parent, stem = new File(ARGS.base).name; var fl = dir.getFiles(stem + '_*.tif');
it.remove(); for (var j = 1; j <= rq.numItems && j <= prev.length; j++) { try { rq.item(j).render = prev[j - 1]; } catch (e3) {} }
return { file: fl.length ? fl[0].fsName : null, error: err };`;

jsxTool({ name: 'ae_applyGradient', toolset: 'ae', app: 'ae', undo: true,
  description: 'After Effects: apply a reliable gradient (Gradient Ramp) with real colors. stops [{color:hex}, ...] (first + last used), type linear|radial, angleDeg (linear direction).',
  input: { compositionName: zComp, layer: zLayer, stops: z.array(z.object({ color: z.string() })), type: z.enum(['linear', 'radial']).optional(), angleDeg: z.number().optional(), blend: z.number().optional().describe('ramp scatter 0-..') },
  jsx: R`var c = __comp(ARGS.compositionName); var l = __layer(c, ARGS.layer); var e = __addEffect(l, 'ADBE Ramp');
var r = l.sourceRectAtTime(c.time, false); var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
var a = __def(ARGS.angleDeg, 90) * Math.PI / 180, len = Math.max(r.width, r.height) / 2;
var start = ARGS.type === 'radial' ? [cx, cy] : [cx - Math.cos(a) * len, cy - Math.sin(a) * len];
var end = ARGS.type === 'radial' ? [cx + len, cy] : [cx + Math.cos(a) * len, cy + Math.sin(a) * len];
e.property('ADBE Ramp-0001').setValue(start); e.property('ADBE Ramp-0002').setValue(__val(e.property('ADBE Ramp-0002'), ARGS.stops[0].color));
e.property('ADBE Ramp-0003').setValue(end); e.property('ADBE Ramp-0004').setValue(__val(e.property('ADBE Ramp-0004'), ARGS.stops[ARGS.stops.length - 1].color));
e.property('ADBE Ramp-0005').setValue(ARGS.type === 'radial' ? 2 : 1); if (ARGS.blend !== undefined) e.property('ADBE Ramp-0006').setValue(ARGS.blend);
return { layer: l.name, effect: e.name };` });
