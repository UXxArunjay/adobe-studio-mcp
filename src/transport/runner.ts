/**
 * runJsx(app, body, args): executes ExtendScript inside a running Adobe app and returns its JSON result.
 * Transport order per app (first that is available wins):
 *   1. CEP hub panel (all 4 apps)          – fastest, no prefs needed, the only route for Premiere
 *   2. Windows COM via PowerShell          – Photoshop, Illustrator
 *   3. AfterFX.exe -r + result file         – After Effects (needs "Allow Scripts to Write Files")
 *   4. macOS osascript                      – Photoshop, Illustrator, After Effects
 */
import { execFile } from 'node:child_process';
import { promises as fs, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { APPS, AppId, IS_WIN, IS_MAC, RUNTIME_DIR, DEFAULT_TIMEOUT_MS, findInstalls } from '../config.js';
import { wrapJsx, parseJsxResult, JsxResult, WrapOptions, asciiSafe } from '../jsx/wrap.js';
import { isRunning, sleep } from './process.js';

export const HUB_DIR = join(RUNTIME_DIR, 'hub');
const JOB_DIR = join(RUNTIME_DIR, 'jobs');
const HUB_STALE_MS = 4000;

export class AdobeError extends Error {
  constructor(message: string, public hint?: string) { super(message); }
}

export interface HubBeat { ts: number; appVersion?: string; role?: string; hubVersion?: string; appName?: string }

export function hubHeartbeat(app: AppId): HubBeat | null {
  try {
    const hb = JSON.parse(readFileSync(join(HUB_DIR, app, 'heartbeat.json'), 'utf8')) as HubBeat;
    return Date.now() - hb.ts < HUB_STALE_MS ? hb : null;
  } catch { return null; }
}

// one call at a time per app — Adobe scripting engines are single threaded
const queues = new Map<AppId, Promise<unknown>>();
function serial<T>(app: AppId, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(app) || Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  queues.set(app, next.catch(() => undefined));
  return next;
}

function ps(script: string, timeout: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) reject(Object.assign(err, { stdout, stderr })); else resolve({ stdout, stderr });
      });
  });
}

let jobsCleaned = false;
async function newJob(code: string) {
  mkdirSync(JOB_DIR, { recursive: true });
  if (!jobsCleaned) { jobsCleaned = true; try { for (const f of await fs.readdir(JOB_DIR)) { const p = join(JOB_DIR, f); if (Date.now() - (await fs.stat(p)).mtimeMs > 3600000) await fs.rm(p, { force: true }); } } catch { /* ignore */ } }
  const id = randomUUID();
  const jsx = join(JOB_DIR, `${id}.jsx`);
  const out = join(JOB_DIR, `${id}.json`);
  return { id, jsx, out, write: (c: string) => fs.writeFile(jsx, c, 'utf8'), cleanup: () => Promise.all([fs.rm(jsx, { force: true }), fs.rm(out, { force: true })]) };
}

async function waitFile(path: string, timeout: number, isAlive?: () => Promise<boolean>): Promise<string | null> {
  const end = Date.now() + timeout;
  let n = 0;
  while (Date.now() < end) {
    try { const s = await fs.readFile(path, 'utf8'); if (s.length) { await sleep(15); return await fs.readFile(path, 'utf8'); } } catch { /* not yet */ }
    await sleep(n < 40 ? 50 : 200);
    if (isAlive && ++n % 25 === 0 && !(await isAlive())) return null;
  }
  return null;
}

/* ---------- transports ---------- */

async function viaHub(app: AppId, code: string, timeout: number): Promise<string> {
  const dir = join(HUB_DIR, app);
  mkdirSync(join(dir, 'in'), { recursive: true });
  mkdirSync(join(dir, 'out'), { recursive: true });
  const id = `${Date.now()}-${randomUUID()}`;
  const tmp = join(dir, 'in', `${id}.tmp`);
  await fs.writeFile(tmp, JSON.stringify({ id, code }), 'utf8');
  await fs.rename(tmp, join(dir, 'in', `${id}.json`));
  const outPath = join(dir, 'out', `${id}.json`);
  const res = await waitFile(outPath, timeout, async () => !!hubHeartbeat(app));
  await fs.rm(outPath, { force: true }).catch(() => undefined);
  if (res === null) {
    await fs.rm(join(dir, 'in', `${id}.json`), { force: true }).catch(() => undefined);
    throw new AdobeError(`${APPS[app].label} did not answer within ${Math.round(timeout / 1000)}s (a modal dialog may be open, or the app is busy).`);
  }
  return res;
}

async function viaCom(app: 'ps' | 'ai', code: string, timeout: number): Promise<string> {
  const job = await newJob(code);
  const wrapped = code.replace('var __out = "";', () => asciiSafe(`var __out = ${JSON.stringify(job.out.replace(/\\/g, '/'))};`));
  await job.write(wrapped);
  const prog = app === 'ps' ? 'Photoshop.Application' : 'Illustrator.Application';
  const p = job.jsx.replace(/\\/g, '/').replace(/'/g, "\\'");
  const script = `$ErrorActionPreference='Stop'; $a = New-Object -ComObject '${prog}'; $r = $a.DoJavaScript("$.evalFile(new File('${p}'))"); if ($r -ne $null) { [Console]::Out.Write([string]$r) }`;
  try {
    const { stdout } = await ps(script, timeout);
    const fromFile = existsSync(job.out) ? await fs.readFile(job.out, 'utf8') : '';
    return fromFile || stdout;
  } catch (e: any) {
    const fromFile = existsSync(job.out) ? await fs.readFile(job.out, 'utf8') : '';
    if (fromFile) return fromFile;
    const msg = String(e.stderr || e.message || e).split('\n').slice(0, 4).join(' ');
    if (e.killed) throw new AdobeError(`${APPS[app].label} did not answer within ${Math.round(timeout / 1000)}s (modal dialog open or app busy).`);
    throw new AdobeError(`${APPS[app].label} COM call failed: ${msg}`);
  } finally { await job.cleanup(); }
}

async function viaAfterFx(code: string, timeout: number): Promise<string> {
  const inst = findInstalls('ae')[0];
  if (!inst) throw new AdobeError('After Effects is not installed (or set ADOBE_MCP_AE_EXE).');
  const job = await newJob(code);
  await job.write(code.replace('var __out = "";', () => asciiSafe(`var __out = ${JSON.stringify(job.out.replace(/\\/g, '/'))};`)));
  try {
    execFile(inst.path, ['-r', job.jsx], { windowsHide: true }, () => undefined);
    const res = await waitFile(job.out, timeout, () => isRunning('ae'));
    if (res === null) throw new AdobeError('After Effects did not return a result.',
      'Enable Edit > Preferences > Scripting & Expressions > "Allow Scripts to Write Files and Access Network" (adobe_setup does this), install the CEP hub (faster), and close any open dialog in AE.');
    return res;
  } finally { await job.cleanup(); }
}

async function viaOsa(app: AppId, code: string, timeout: number): Promise<string> {
  const job = await newJob(code);
  await job.write(code.replace('var __out = "";', () => asciiSafe(`var __out = ${JSON.stringify(job.out)};`)));
  const inst = findInstalls(app)[0];
  const name = inst ? inst.path.split('/').pop()!.replace(/\.app$/, '') : APPS[app].macProcess;
  const f = job.jsx.replace(/"/g, '\\"');
  const verb = app === 'ae' ? `DoScriptFile "${f}"` : app === 'ps' ? `do javascript (file "${f}")` : `do javascript (file "${f}")`;
  try {
    const stdout = await new Promise<string>((resolve, reject) => execFile('osascript', ['-e', `with timeout of ${Math.ceil(timeout / 1000)} seconds`, '-e', `tell application "${name}" to ${verb}`, '-e', 'end timeout'],
      { timeout }, (err, so, se) => (err && !existsSync(job.out) ? reject(new AdobeError(String(se || err.message))) : resolve(so))));
    const fromFile = existsSync(job.out) ? await fs.readFile(job.out, 'utf8') : '';
    return fromFile || stdout;
  } finally { await job.cleanup(); }
}

/* ---------- public API ---------- */

export type TransportName = 'hub' | 'com' | 'afterfx' | 'osascript';

export async function availableTransport(app: AppId): Promise<TransportName | null> {
  if (hubHeartbeat(app)) return 'hub';
  if (!(await isRunning(app))) return null;
  if (IS_WIN && (app === 'ps' || app === 'ai')) return 'com';
  if (IS_WIN && app === 'ae') return 'afterfx';
  if (IS_MAC && (app === 'ps' || app === 'ai' || app === 'ae')) return 'osascript';
  return null;
}

export interface RunOptions extends WrapOptions { timeoutMs?: number; raw?: boolean }

/** Runs a tool body (function body returning a value) inside `app`. Throws AdobeError on failure. */
export async function runJsx(app: AppId, body: string, args: unknown = {}, opts: RunOptions = {}): Promise<unknown> {
  const res = await runJsxResult(app, body, args, opts);
  if (!res.ok) throw new AdobeError(`${APPS[app].label}: ${res.error}${res.line ? ` (script line ${res.line})` : ''}`);
  return res.result;
}

/** test hook: when set, scripts are handed to it instead of an app */
export const TEST_HOOK: { capture: null | ((app: AppId, code: string) => unknown) } = { capture: null };

export async function runJsxResult(app: AppId, body: string, args: unknown = {}, opts: RunOptions = {}): Promise<JsxResult> {
  if (TEST_HOOK.capture) return { ok: true, result: TEST_HOOK.capture(app, wrapJsx(app, body, args, { ...opts, outFile: '' })) };
  const timeout = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  return serial(app, async () => {
    const t = await availableTransport(app);
    if (!t) {
      const running = await isRunning(app);
      if (!running) throw new AdobeError(`${APPS[app].label} is not running.`, `Start it with adobe_launchApp {"app":"${app}"}.`);
      throw new AdobeError(`${APPS[app].label} is running but the Adobe Studio MCP Hub panel is not connected.`,
        app === 'pr' ? 'Run the installer (scripts/install-windows.ps1) once, restart Premiere, then open Window > Extensions > Adobe Studio MCP Hub if it did not auto-start.' : 'Install the CEP hub (scripts/install-windows.ps1).');
    }
    const code = wrapJsx(app, body, args, { ...opts, outFile: '' });
    let raw: string;
    if (t === 'hub') raw = await viaHub(app, code, timeout);
    else if (t === 'com') raw = await viaCom(app as 'ps' | 'ai', code, timeout);
    else if (t === 'afterfx') raw = await viaAfterFx(code, timeout);
    else raw = await viaOsa(app, code, timeout);
    return parseJsxResult(raw);
  });
}

/** CEP-level hub operation (listExtensions, openExtension, dispatchEvent, listen, readEvents, hostEnv). Needs the hub panel. */
export async function runHubOp(app: AppId, op: string, args: unknown = {}, timeoutMs = 20000): Promise<unknown> {
  if (!hubHeartbeat(app)) throw new AdobeError(`${APPS[app].label}: the Adobe Studio MCP Hub (CEP) is not connected — this operation needs it.`, 'Run scripts/install-windows.ps1 and restart the app.');
  return serial(app, async () => {
    const dir = join(HUB_DIR, app);
    mkdirSync(join(dir, 'in'), { recursive: true });
    const id = `${Date.now()}-${randomUUID()}`;
    const tmp = join(dir, 'in', `${id}.tmp`);
    await fs.writeFile(tmp, JSON.stringify({ id, op, args }), 'utf8');
    await fs.rename(tmp, join(dir, 'in', `${id}.json`));
    const outPath = join(dir, 'out', `${id}.json`);
    const raw = await waitFile(outPath, timeoutMs, async () => !!hubHeartbeat(app));
    await fs.rm(outPath, { force: true }).catch(() => undefined);
    if (raw === null) throw new AdobeError(`${APPS[app].label} hub did not answer.`);
    const r = parseJsxResult(raw);
    if (!r.ok) throw new AdobeError(String(r.error));
    return r.result;
  });
}
