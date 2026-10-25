/** Cross-cutting tools: status, launch / open / quit apps by command (no UI automation), raw scripts, setup, config, batch. */
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tool } from './define.js';
import { APPS, AppId, SCRIPT_APPS, IS_WIN, RUNTIME_DIR, findInstalls } from '../config.js';
import { availableTransport, hubHeartbeat, runJsx, runJsxResult } from '../transport/runner.js';
import { isRunning, launchApp, closeProcess, runningProcesses, sleep } from '../transport/process.js';
import { readConfig, writeConfig } from '../store.js';

const exec = promisify(execFile);
export const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const zApp = z.enum(['ae', 'pr', 'ps', 'ai']).describe('ae = After Effects, pr = Premiere Pro, ps = Photoshop, ai = Illustrator');
const zAnyApp = z.enum(['ae', 'pr', 'ps', 'ai', 'ame']);

tool({ name: 'adobe_status', toolset: 'adobe', readOnly: true,
  description: 'Which Adobe apps are installed (versions, paths), running, and scriptable right now (transport: hub|com|afterfx|osascript), hub panel heartbeats, and next steps. Call first in a session.',
  input: {},
  handler: async () => {
    const procs = await runningProcesses();
    const apps: Record<string, unknown> = {};
    for (const id of Object.keys(APPS) as AppId[]) {
      const inst = findInstalls(id);
      const running = await isRunning(id, procs);
      const t = id === 'ame' ? null : await availableTransport(id);
      const hb = hubHeartbeat(id);
      apps[id] = { label: APPS[id].label, installed: inst.map((i) => ({ year: i.year, path: i.path })), running, transport: t, hub: hb ? { appVersion: hb.appVersion, role: hb.role } : null,
        hint: !inst.length ? 'not installed' : !running ? `adobe_launchApp {"app":"${id}"}` : !t && id !== 'ame' ? 'running but not connected — run adobe_setup, then restart the app' : 'ready' };
    }
    return { platform: process.platform, runtimeDir: RUNTIME_DIR, apps };
  } });

async function waitScriptable(app: AppId, timeoutMs: number) {
  const end = Date.now() + timeoutMs;
  // After Effects: never fire AfterFX -r while AE is still booting ("Scripting plugin is not installed" dialog).
  // Wait for the hub first; only fall back to -r after AE had plenty of time to finish loading.
  if (app === 'ae') {
    const hubEnd = Math.min(end, Date.now() + 120000);
    while (Date.now() < hubEnd) { if (hubHeartbeat('ae')) break; await sleep(2000); }
  }
  while (Date.now() < end) {
    if (await availableTransport(app)) {
      try { const r = await runJsxResult(app, 'return app.version;', {}, { prelude: false, timeoutMs: 15000 }); if (r.ok) return String(r.result); } catch { /* still booting */ }
    }
    await sleep(2500);
  }
  return null;
}

tool({ name: 'adobe_launchApp', toolset: 'adobe',
  description: 'Open an Adobe app by command — After Effects, Premiere Pro, Photoshop, Illustrator or Media Encoder — optionally with files (projects/images) and a specific version year; waits until it accepts scripts (wait:false to return immediately). No computer-use needed.',
  input: { app: zAnyApp, files: z.array(z.string()).optional(), version: z.number().int().optional().describe('e.g. 2026 when several versions are installed'), wait: z.boolean().optional(), timeoutSec: z.number().optional() },
  handler: async (a) => {
    const r = await launchApp(a.app, a.files || [], a.version);
    if (a.wait === false || a.app === 'ame') return { ...r, waited: false };
    const v = await waitScriptable(a.app, (a.timeoutSec || 240) * 1000);
    return { ...r, ready: !!v, appVersion: v, transport: await availableTransport(a.app), note: v ? undefined : 'App is starting but not scriptable yet (still loading, a startup dialog is open, or the hub/prefs are not set up — run adobe_setup).' };
  } });

const QUIT: Record<string, string> = {
  ae: 'if (ARGS.mode === "save" && app.project.file) app.project.save(); if (ARGS.mode === "discard") app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); else if (app.project.dirty) return "UNSAVED"; app.quit(); return "OK";',
  pr: 'if (ARGS.mode === "save") app.project.save(); app.quit(); return "OK";',
  ps: 'for (var i = app.documents.length - 1; i >= 0; i--) { var d = app.documents[i]; if (!d.saved) { if (ARGS.mode === "save") d.save(); else if (ARGS.mode === "discard") d.close(SaveOptions.DONOTSAVECHANGES); else return "UNSAVED"; } } executeAction(charIDToTypeID("quit"), undefined, DialogModes.NO); return "OK";',
  ai: 'for (var i = app.documents.length - 1; i >= 0; i--) { var d = app.documents[i]; if (!d.saved) { if (ARGS.mode === "save") d.save(); else if (ARGS.mode === "discard") d.close(SaveOptions.DONOTSAVECHANGES); else return "UNSAVED"; } } app.quit(); return "OK";',
};

tool({ name: 'adobe_quitApp', toolset: 'adobe', destructive: true,
  description: 'Quit an Adobe app by command. mode: "safe" (default — refuses if anything is unsaved), "save" (saves open work first), "discard" (closes without saving), "force" (kills the process — unsaved work is lost).',
  input: { app: zAnyApp, mode: z.enum(['safe', 'save', 'discard', 'force']).optional() },
  handler: async (a) => {
    const mode = a.mode || 'safe';
    if (!(await isRunning(a.app))) return { app: a.app, running: false };
    if (mode === 'force') { await closeProcess(a.app, true); return { app: a.app, killed: true }; }
    if (a.app !== 'ame' && (await availableTransport(a.app))) {
      const r = await runJsxResult(a.app, QUIT[a.app], { mode }, { prelude: false, timeoutMs: 120000 }).catch((e) => ({ ok: false, error: String(e.message) } as any));
      if (r.ok && r.result === 'UNSAVED') return { app: a.app, quit: false, reason: 'Unsaved changes. Use mode "save" or "discard".' };
    }
    for (let i = 0; i < 8; i++) { if (!(await isRunning(a.app))) return { app: a.app, quit: true }; await sleep(1000); }
    // apps that ignore app.quit() from a script (e.g. AE via AfterFX -r): ask the window to close like the X button
    await closeProcess(a.app, false);
    for (let i = 0; i < 30; i++) { if (!(await isRunning(a.app))) return { app: a.app, quit: true }; await sleep(1000); }
    return { app: a.app, quit: false, reason: 'Still running (a save dialog may be open). Use mode "force" to kill it.' };
  } });

const EXT_APP: Record<string, AppId> = { '.aep': 'ae', '.aepx': 'ae', '.aet': 'ae', '.prproj': 'pr', '.psd': 'ps', '.psb': 'ps', '.jpg': 'ps', '.jpeg': 'ps', '.png': 'ps', '.tif': 'ps', '.tiff': 'ps', '.webp': 'ps', '.heic': 'ps', '.cr2': 'ps', '.nef': 'ps', '.dng': 'ps', '.ai': 'ai', '.eps': 'ai', '.svg': 'ai', '.pdf': 'ai' };
const OPEN_JSX: Record<string, string> = {
  ae: 'var f = __file(ARGS.path); if (app.project.dirty && !ARGS.discardChanges) throw new Error("AE project has unsaved changes — save first or pass discardChanges:true"); if (ARGS.discardChanges) app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); app.open(f); return app.project.file.fsName;',
  pr: 'app.openDocument(ARGS.path, true, true, true); return app.project.path;',
  ps: 'return app.open(__file(ARGS.path)).name;',
  ai: 'return app.open(__file(ARGS.path)).name;',
};

tool({ name: 'adobe_openFile', toolset: 'adobe',
  description: 'Open any file in the right Adobe app (.aep→AE, .prproj→Premiere, .psd/.jpg/.png/RAW→Photoshop, .ai/.svg/.eps/.pdf→Illustrator) — launches the app first if needed. app overrides the choice.',
  input: { path: z.string(), app: zApp.optional(), discardChanges: z.boolean().optional() },
  handler: async (a) => {
    const app = a.app || EXT_APP[extname(a.path).toLowerCase()];
    if (!app) throw new Error('Cannot tell which app opens ' + a.path + ' — pass app.');
    if (!existsSync(a.path)) throw new Error('File not found: ' + a.path);
    if (!(await isRunning(app))) { const r = await launchApp(app, [a.path]); const v = await waitScriptable(app, 240000); return { app, launchedWithFile: true, exe: r.exe, ready: !!v }; }
    const opened = await runJsx(app, OPEN_JSX[app], { path: a.path, discardChanges: a.discardChanges }, { timeoutMs: 600000 });
    return { app, opened };
  } });

tool({ name: 'adobe_runScript', toolset: 'adobe',
  description: 'Run raw ExtendScript inside an app — full scripting-DOM access to EVERYTHING the app exposes (AE app.project, Premiere app.project + QE (app.enableQE(); qe.project), Photoshop DOM + Action Manager, Illustrator DOM, BridgeTalk). The code is a function body: `return` a JSON-able value; helpers are preloaded (__comp, __layer, __prop, __seq, __track, __clip, __doc, __hex, __s...). ARGS holds args. Or pass file to $.evalFile a .jsx.',
  input: { app: zApp, code: z.string().optional(), file: z.string().optional(), args: z.record(z.unknown()).optional(), undoGroup: z.string().optional().describe('AE: wrap in an undo group with this name'), timeoutSec: z.number().optional() },
  handler: async (a) => {
    const body = a.file ? `$.global.MCP_ARGS = ARGS; var __r = $.evalFile(__file(${JSON.stringify(a.file)})); return __r;` : a.code;
    if (!body) throw new Error('Pass code or file.');
    return runJsx(a.app, body, a.args || {}, { undo: a.undoGroup, timeoutMs: (a.timeoutSec || 300) * 1000 });
  } });

tool({ name: 'adobe_batch', toolset: 'adobe',
  description: 'Run many tool calls (any native tool: ae_*, pr_*, ps_*, ai_*, xapp_*, media_*, pixabay_*) in one go, in order — fewer round trips. steps:[{tool, input}]. stopOnError default true.',
  input: { steps: z.array(z.object({ tool: z.string(), input: z.record(z.unknown()).optional() })), stopOnError: z.boolean().optional() },
  handler: async (a, ctx) => {
    const results: unknown[] = [];
    for (let i = 0; i < a.steps.length; i++) {
      const st = a.steps[i];
      try { results.push({ step: i + 1, tool: st.tool, ok: true, result: await ctx.call(st.tool, st.input || {}) }); }
      catch (e: any) { results.push({ step: i + 1, tool: st.tool, ok: false, error: String(e.message || e) }); if (a.stopOnError !== false) break; }
    }
    return results;
  } });

/* ---------- setup ---------- */
export function cepExtensionsDir() { return join(process.env.APPDATA || join(process.env.HOME || '', 'Library/Application Support'), 'Adobe', 'CEP', 'extensions'); }

async function setPlayerDebugMode(): Promise<string[]> {
  const done: string[] = [];
  if (!IS_WIN) {
    for (let v = 9; v <= 13; v++) { await exec('defaults', ['write', `com.adobe.CSXS.${v}`, 'PlayerDebugMode', '1']).catch(() => undefined); done.push(`CSXS.${v}`); }
    return done;
  }
  for (let v = 9; v <= 13; v++) {
    await exec('reg', ['add', `HKCU\\Software\\Adobe\\CSXS.${v}`, '/v', 'PlayerDebugMode', '/t', 'REG_SZ', '/d', '1', '/f'], { windowsHide: true }).then(() => done.push(`CSXS.${v}`)).catch(() => undefined);
  }
  return done;
}

function aePrefFiles(): string[] {
  const base = IS_WIN ? join(process.env.APPDATA || '', 'Adobe', 'After Effects') : join(process.env.HOME || '', 'Library', 'Preferences', 'Adobe', 'After Effects');
  const out: string[] = [];
  let vers: string[] = []; try { vers = readdirSync(base); } catch { return out; }
  for (const v of vers) { try { for (const f of readdirSync(join(base, v))) if (/Prefs\.txt$/i.test(f) && !/indep/i.test(f)) out.push(join(base, v, f)); } catch { /* skip */ } }
  return out;
}

function patchAePrefs(): string[] {
  const changed: string[] = [];
  for (const f of aePrefFiles()) {
    let s = readFileSync(f, 'utf8');
    const key = '"Pref_SCRIPTING_FILE_NETWORK_SECURITY"';
    if (s.includes(key)) s = s.replace(/"Pref_SCRIPTING_FILE_NETWORK_SECURITY"\s*=\s*\S+/, `${key} = 01`);
    else if (s.includes('["Main Pref Section v2"]')) s = s.replace('["Main Pref Section v2"]', `["Main Pref Section v2"]\n\t${key} = 01`);
    else continue;
    writeFileSync(f, s, 'utf8'); changed.push(f);
  }
  return changed;
}

tool({ name: 'adobe_setup', toolset: 'adobe',
  description: 'One-time setup / repair: installs the Adobe Studio MCP Hub CEP extension (for all 4 apps), enables unsigned CEP extensions (PlayerDebugMode), and turns on After Effects "Allow Scripts to Write Files and Access Network". Restart the apps afterwards.',
  input: { skipAePrefs: z.boolean().optional() },
  handler: async (a) => {
    const res: Record<string, unknown> = {};
    res.playerDebugMode = await setPlayerDebugMode();
    const src = join(PKG_ROOT, 'cep-hub');
    const dst = join(cepExtensionsDir(), 'com.adobestudiomcp.hub');
    mkdirSync(dst, { recursive: true });
    cpSync(src, dst, { recursive: true, force: true });
    res.cepHubInstalledTo = dst;
    if (!a.skipAePrefs) {
      if (await isRunning('ae')) {
        // running AE would overwrite the prefs file on quit — set it from inside AE instead (needs no file access)
        const inst = findInstalls('ae')[0];
        const jsx = join(RUNTIME_DIR, 'set-ae-pref.jsx');
        mkdirSync(RUNTIME_DIR, { recursive: true });
        writeFileSync(jsx, 'app.preferences.savePrefAsLong("Main Pref Section v2","Pref_SCRIPTING_FILE_NETWORK_SECURITY",1,PREFType.PREF_Type_MACHINE_INDEPENDENT);app.preferences.saveToDisk();app.preferences.reload();');
        if (inst && IS_WIN) execFile(inst.path, ['-r', jsx], { windowsHide: true }, () => undefined);
        res.aePrefs = 'set inside running After Effects';
      } else res.aePrefs = patchAePrefs();
    }
    res.next = 'Restart After Effects / Premiere Pro / Photoshop / Illustrator so the hub loads (it starts hidden; Window > Extensions > Adobe Studio MCP Hub shows its status). Then call adobe_status.';
    return res;
  } });

tool({ name: 'adobe_config', toolset: 'adobe',
  description: 'Read or set Adobe Studio MCP settings stored on this computer: pixabayKey (Pixabay API key), mediaDir (default download folder), ytdlpArgs (extra yt-dlp args).',
  input: { set: z.record(z.string()).optional() },
  handler: async (a) => {
    if (a.set) writeConfig({ ...readConfig(), ...a.set });
    const c = readConfig();
    return { ...c, pixabayKey: c.pixabayKey ? c.pixabayKey.slice(0, 4) + '…' : undefined };
  } });

export { SCRIPT_APPS };
