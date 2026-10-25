/** Cross-application workflows — the Adobe "work across apps" features: Dynamic Link, BridgeTalk, PSD/AI → AE comps, frames → Photoshop, MOGRT AE → Premiere, render AE → Premiere. */
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tool } from './define.js';
import { APPS, AppId } from '../config.js';
import { runJsx, availableTransport } from '../transport/runner.js';
import { mediaDir } from '../store.js';
import { imageResult } from './util.js';

const zApp = z.enum(['ae', 'pr', 'ps', 'ai']);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

tool({ name: 'xapp_bridgeTalk', toolset: 'xapp',
  description: 'BridgeTalk: from one running Adobe app, send ExtendScript to another (targets: aftereffects, premierepro, photoshop, illustrator, ame, bridge, indesign... optionally versioned "photoshop-27.0") and wait for its result — Adobe\'s native inter-app messaging. Useful when the target has no direct connection.',
  input: { from: zApp.optional().describe('sender app (default: first connected)'), target: z.string(), script: z.string().describe('ExtendScript evaluated in the target; its last expression is returned as a string'), timeoutSec: z.number().optional() },
  handler: async (a) => {
    let from: AppId | undefined = a.from;
    if (!from) for (const id of ['ps', 'ai', 'ae', 'pr'] as AppId[]) if (await availableTransport(id)) { from = id; break; }
    if (!from) throw new Error('No Adobe app connected to send from.');
    return runJsx(from, `var res = null, err = null, done = false; var bt = new BridgeTalk(); bt.target = ARGS.target; bt.body = ARGS.script;
bt.onResult = function (r) { res = r.body; done = true; }; bt.onError = function (e) { err = e.body; done = true; };
if (!BridgeTalk.isRunning(ARGS.target.split('-')[0])) throw new Error('Target app not running: ' + ARGS.target);
bt.send(ARGS.timeout); var t0 = new Date().getTime(); while (!done && new Date().getTime() - t0 < ARGS.timeout * 1000) { try { BridgeTalk.pump(); } catch (pe) {} $.sleep(50); }
if (err) throw new Error('BridgeTalk error: ' + err); return { from: BridgeTalk.appName, target: ARGS.target, result: res, timedOut: !done };`,
      { target: a.target, script: a.script, timeout: a.timeoutSec || 60 }, { timeoutMs: ((a.timeoutSec || 60) + 30) * 1000 });
  } });

tool({ name: 'xapp_aeCompToPremiere', toolset: 'xapp',
  description: 'Dynamic Link: bring After Effects comps into Premiere Pro WITHOUT rendering (live-linked; edits in AE update in Premiere). Uses the saved .aep (saves the open AE project first if aepPath omitted). Optionally places the first comp on a track at time.',
  input: { compNames: z.array(z.string()).optional().describe('omit = all comps'), aepPath: z.string().optional(), bin: z.string().optional(), sequence: z.string().optional(), track: z.string().optional(), time: z.number().optional() },
  handler: async (a) => {
    let aep = a.aepPath;
    if (!aep) { const r: any = await runJsx('ae', 'if (!app.project.file) throw new Error("Save the AE project first (ae_saveProject with path)."); app.project.save(); return app.project.file.fsName;'); aep = r; }
    const res = await runJsx('pr', `var b = __bin(ARGS.bin || 'Dynamic Link', true); var ok = ARGS.comps && ARGS.comps.length ? app.project.importAEComps(ARGS.aep, ARGS.comps, b) : app.project.importAllAEComps(ARGS.aep, b);
var names = []; for (var i = 0; i < b.children.numItems; i++) names.push(b.children[i].name); var placed = null;
if (ARGS.track) { var want = ARGS.comps && ARGS.comps.length ? ARGS.comps[0] : names[names.length - 1]; var it = null; for (var j = b.children.numItems - 1; j >= 0; j--) if (b.children[j].name.indexOf(want) >= 0) { it = b.children[j]; break; }
  if (it) { var s = __seq(ARGS.sequence); __track(s, ARGS.track).overwriteClip(it, __def(ARGS.time, 0)); placed = { item: it.name, track: ARGS.track, time: __def(ARGS.time, 0) }; } }
return { imported: ok, bin: b.name, items: names, placed: placed };`, { aep, comps: a.compNames, bin: a.bin, sequence: a.sequence, track: a.track, time: a.time }, { timeoutMs: 600000 });
    return { aep, ...(res as object) };
  } });

tool({ name: 'xapp_premiereToAE', toolset: 'xapp',
  description: 'Send a Premiere Pro sequence to After Effects: saves the Premiere project (or exports a trimmed project with just that sequence), then imports it into AE — sequences become AE comps with the clips as layers (like "Replace with After Effects Composition", but scriptable).',
  input: { sequence: z.string().optional(), trimmedProject: z.boolean().optional(), openComp: z.boolean().optional() },
  handler: async (a) => {
    const prproj: any = await runJsx('pr', `var s = __seq(ARGS.sequence); if (ARGS.trimmed) { var p = Folder.temp.fsName + '/mcp_' + s.name.replace(/[^\\w-]+/g, '_') + '.prproj'; s.exportAsProject(p); return { path: p, seq: s.name }; } app.project.save(); return { path: app.project.path, seq: s.name };`,
      { sequence: a.sequence, trimmed: a.trimmedProject !== false }, { timeoutMs: 600000 });
    const r = await runJsx('ae', `var io = new ImportOptions(__file(ARGS.path)); var it = app.project.importFile(io); var comps = [];
for (var i = 1; i <= app.project.numItems; i++) { var x = app.project.item(i); if (x instanceof CompItem && x.parentFolder === it) comps.push(x.name); }
if (ARGS.open) { for (var j = 1; j <= app.project.numItems; j++) { var y = app.project.item(j); if (y instanceof CompItem && y.name === ARGS.seq) { y.openInViewer(); break; } } }
return { importedFolder: it.name, comps: comps };`, { path: prproj.path, seq: prproj.seq, open: a.openComp !== false }, { timeoutMs: 900000, undo: 'Import Premiere sequence' });
    return { premiereProject: prproj.path, ...(r as object) };
  } });

tool({ name: 'xapp_photoshopToAE', toolset: 'xapp',
  description: 'Photoshop → After Effects: save the active (or named) PSD, import it into AE as a layered composition (each PS layer = AE layer, layer styles editable), optionally adding it into a target comp — ideal for parallax / paper-cut animations.',
  input: { document: z.string().optional(), psdPath: z.string().optional(), croppedLayers: z.boolean().optional().describe('each layer gets its own size (better for animation)'), targetComp: z.string().optional(), openComp: z.boolean().optional() },
  handler: async (a) => {
    let psd = a.psdPath;
    if (!psd) psd = await runJsx('ps', `var d = __doc(ARGS.document); app.activeDocument = d; var p; try { p = d.fullName.fsName; } catch (e) { p = ''; }
if (!p || !/\\.psd$/i.test(p)) { p = ARGS.dir + '/' + d.name.replace(/\\.[^.]+$/, '') + '.psd'; var o = new PhotoshopSaveOptions(); o.layers = true; d.saveAs(__file(p), o, false, Extension.LOWERCASE); } else d.save(); return p;`,
      { document: a.document, dir: mediaDir('handoff').replace(/\\/g, '/') }) as string;
    const r = await runJsx('ae', `var io = new ImportOptions(__file(ARGS.psd)); io.importAs = ARGS.cropped ? ImportAsType.COMP_CROPPED_LAYERS : ImportAsType.COMP; var it = app.project.importFile(io);
var comp = null; if (it instanceof CompItem) comp = it; else for (var i = 1; i <= app.project.numItems; i++) { var x = app.project.item(i); if (x instanceof CompItem && x.parentFolder === it) comp = x; }
if (!comp) for (var j = app.project.numItems; j >= 1; j--) { if (app.project.item(j) instanceof CompItem) { comp = app.project.item(j); break; } }
var added = null; if (ARGS.target) { var tc = __comp(ARGS.target); added = tc.layers.add(comp).name; }
if (ARGS.open !== false && comp) comp.openInViewer();
return { comp: comp ? __compInfo(comp) : null, layers: comp ? comp.numLayers : 0, addedTo: ARGS.target || null, layer: added };`, { psd, cropped: a.croppedLayers !== false, target: a.targetComp, open: a.openComp }, { timeoutMs: 600000, undo: 'Import PSD as comp' });
    return { psd, ...(r as object) };
  } });

tool({ name: 'xapp_illustratorToAE', toolset: 'xapp',
  description: 'Illustrator → After Effects: save the active AI document (PDF-compatible), import it into AE as a layered comp, and (shapes:true, default) convert every vector layer to native editable AE shape layers.',
  input: { document: z.string().optional(), aiPath: z.string().optional(), shapes: z.boolean().optional(), targetComp: z.string().optional() },
  handler: async (a) => {
    let ai = a.aiPath;
    if (!ai) ai = await runJsx('ai', `var d = __doc(ARGS.document); app.activeDocument = d; var p = ARGS.dir + '/' + d.name.replace(/\\.[^.]+$/, '') + '_forAE.ai'; var o = new IllustratorSaveOptions(); o.pdfCompatible = true; d.saveAs(__file(p), o); return p;`,
      { document: a.document, dir: mediaDir('handoff').replace(/\\/g, '/') }) as string;
    const r = await runJsx('ae', `var io = new ImportOptions(__file(ARGS.ai)); if (io.canImportAs(ImportAsType.COMP)) io.importAs = ImportAsType.COMP; var it = app.project.importFile(io);
var comp = it instanceof CompItem ? it : null; if (!comp) for (var j = app.project.numItems; j >= 1; j--) { if (app.project.item(j) instanceof CompItem) { comp = app.project.item(j); break; } }
var made = 0; if (comp && ARGS.shapes !== false) { comp.openInViewer(); var n = comp.numLayers;
  for (var i = n; i >= 1; i--) { var l = comp.layer(i); for (var k = 1; k <= comp.numLayers; k++) comp.layer(k).selected = false; l.selected = true; var before = comp.numLayers; app.executeCommand(3973); if (comp.numLayers > before) { made++; l.enabled = false; } } }
var added = null; if (ARGS.target && comp) added = __comp(ARGS.target).layers.add(comp).name;
return { comp: comp ? __compInfo(comp) : null, shapeLayersCreated: made, addedTo: ARGS.target || null, layer: added };`, { ai, shapes: a.shapes, target: a.targetComp }, { timeoutMs: 600000, undo: 'Import AI as shapes' });
    return { ai, ...(r as object) };
  } });

tool({ name: 'xapp_frameToPhotoshop', toolset: 'xapp',
  description: 'Grab a frame from After Effects (comp) or Premiere (sequence) at a time and open it in Photoshop (new document or as a layer in the active one) — thumbnails, retouching, matte painting.',
  input: { from: z.enum(['ae', 'pr']), time: z.number().optional(), compositionName: z.string().optional(), sequence: z.string().optional(), asLayer: z.boolean().optional() },
  handler: async (a, ctx) => {
    const r: any = a.from === 'ae' ? await ctx.call('ae_exportFrame', { compositionName: a.compositionName, time: a.time, path: join(mediaDir('frames'), `ae-${stamp()}.png`) })
      : await ctx.call('pr_exportFrame', { sequence: a.sequence, time: a.time, path: join(mediaDir('frames'), `pr-${stamp()}.png`) });
    const path = r?.info?.path || r?.path;
    if (!path || !existsSync(path)) throw new Error('Frame export failed');
    const ps = a.asLayer ? await ctx.call('ps_placeFile', { path }) : await ctx.call('ps_openFile', { paths: [path] });
    return { frame: path, photoshop: ps };
  } });

tool({ name: 'xapp_toPremiere', toolset: 'xapp',
  description: 'Photoshop / Illustrator → Premiere Pro: save the active PS document (PSD or PNG) or export the active AI artboard (PNG), import into a Premiere bin and optionally place on a track at time with a duration.',
  input: { from: z.enum(['ps', 'ai']), format: z.enum(['psd', 'png']).optional(), bin: z.string().optional(), sequence: z.string().optional(), track: z.string().optional(), time: z.number().optional(), duration: z.number().optional() },
  handler: async (a, ctx) => {
    const path = join(mediaDir('handoff'), `${a.from}-${stamp()}.${a.from === 'ai' ? 'png' : a.format || 'png'}`);
    if (a.from === 'ps') await ctx.call('ps_saveDocument', { path, format: a.format || 'png', asCopy: true }); else await ctx.call('ai_export', { path, format: 'png', scale: 200 });
    const out: any = { file: path, imported: await ctx.call('pr_importFiles', { paths: [path], bin: a.bin || 'From ' + APPS[a.from as AppId].label }) };
    if (a.track) {
      out.placed = await ctx.call('pr_placeClip', { item: path.split(/[\\/]/).pop(), sequence: a.sequence, track: a.track, time: a.time ?? 0 });
      if (a.duration && out.placed?.placed) out.trimmed = await ctx.call('pr_trimClip', { clip: { track: a.track, time: (a.time ?? 0) + 0.001 }, sequence: a.sequence, end: (a.time ?? 0) + a.duration });
    }
    return out;
  } });

tool({ name: 'xapp_mogrtToPremiere', toolset: 'xapp',
  description: 'After Effects → Premiere via Motion Graphics template: publish chosen AE properties to Essential Graphics, export the comp as .mogrt, and place it in Premiere with text overrides — editable titles/lower-thirds in the edit.',
  input: { compositionName: z.string(), templateName: z.string().optional(), properties: z.array(z.object({ layer: z.union([z.string(), z.number()]), property: z.string(), name: z.string().optional() })).optional(),
    sequence: z.string().optional(), track: z.string().optional(), time: z.number().optional(), texts: z.record(z.string()).optional() },
  handler: async (a, ctx) => {
    const path = join(mediaDir('mogrt'), `${(a.templateName || a.compositionName).replace(/[^\w-]+/g, '_')}.mogrt`);
    const ae = await ctx.call('ae_essentialGraphics', { compositionName: a.compositionName, templateName: a.templateName || a.compositionName, add: a.properties, exportPath: path });
    const pr = await ctx.call('pr_addGraphic', { path, sequence: a.sequence, track: a.track || 'V2', time: a.time ?? 0, texts: a.texts });
    return { mogrt: path, ae, pr };
  } });

tool({ name: 'xapp_renderAEToPremiere', toolset: 'xapp',
  description: 'Render an After Effects comp to a file (AE render queue, blocking; e.g. ProRes 4444 / "High Quality with Alpha" / H.264) and import + place the result in Premiere — when Dynamic Link playback is too heavy.',
  input: { compositionName: z.string(), outputModuleTemplate: z.string().optional(), outputPath: z.string().optional(), sequence: z.string().optional(), track: z.string().optional(), time: z.number().optional(), bin: z.string().optional() },
  handler: async (a, ctx) => {
    const out = a.outputPath || join(mediaDir('renders'), `${a.compositionName.replace(/[^\w-]+/g, '_')}-${stamp()}.mov`);
    await ctx.call('ae_renderQueue', { action: 'clear' }).catch(() => undefined);
    const q: any = await ctx.call('ae_addToRenderQueue', { compositionName: a.compositionName, outputPath: out, outputModuleTemplate: a.outputModuleTemplate || 'High Quality with Alpha' });
    await ctx.call('ae_renderQueue', { action: 'render' });
    const rendered = q?.output || out;
    const imp = await ctx.call('pr_importFiles', { paths: [rendered], bin: a.bin || 'AE Renders' });
    const placed = a.track ? await ctx.call('pr_placeClip', { item: rendered.split(/[\\/]/).pop(), sequence: a.sequence, track: a.track, time: a.time ?? 0 }) : null;
    return { rendered, imported: imp, placed };
  } });

tool({ name: 'xapp_preview', toolset: 'xapp', readOnly: true,
  description: 'Look at what any app currently shows: AE comp frame, Premiere frame at playhead, Photoshop document, or Illustrator artboard — returned as an image for a quick visual self-check.',
  input: { app: zApp, time: z.number().optional() },
  handler: async (a, ctx) => {
    if (a.app === 'ae') return ctx.call('ae_exportFrame', { time: a.time });
    if (a.app === 'pr') return ctx.call('pr_exportFrame', { time: a.time });
    if (a.app === 'ps') return ctx.call('ps_preview', {});
    const r: any = await ctx.call('ai_export', { format: 'png', scale: 100 });
    return imageResult(r.path, r);
  } });
