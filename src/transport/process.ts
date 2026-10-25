import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { APPS, AppId, IS_WIN, IS_MAC, RUNTIME_DIR, findInstalls } from '../config.js';

const exec = promisify(execFile);

/** Image names of running processes (lower-case). Windows: tasklist; macOS: ps. */
export async function runningProcesses(): Promise<Set<string>> {
  try {
    if (IS_WIN) {
      const { stdout } = await exec('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
      const set = new Set<string>();
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/^"([^"]+)"/);
        if (m) set.add(m[1].toLowerCase());
      }
      return set;
    }
    const { stdout } = await exec('ps', ['-axo', 'comm'], { maxBuffer: 16 * 1024 * 1024 });
    return new Set(stdout.split('\n').map((l) => l.trim().split('/').pop()!.toLowerCase()));
  } catch {
    return new Set();
  }
}

export async function isRunning(app: AppId, procs?: Set<string>): Promise<boolean> {
  const p = procs || (await runningProcesses());
  const def = APPS[app];
  if (IS_WIN) return p.has(def.winProcess.toLowerCase());
  for (const name of p) if (name.startsWith(def.macProcess.toLowerCase())) return true;
  return false;
}

export function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

/** Launch an Adobe app by command (no UI automation). Optionally open files with it. */
export async function launchApp(app: AppId, files: string[] = [], version?: number): Promise<{ exe: string; pid?: number; alreadyRunning: boolean }> {
  const installs = findInstalls(app);
  if (!installs.length) throw new Error(`${APPS[app].label} is not installed (or set ${APPS[app].envVar} to its executable).`);
  const inst = (version && installs.find((i) => i.year === version)) || installs[0];
  const already = await isRunning(app);
  if (IS_MAC) {
    const child = spawn('/usr/bin/open', ['-a', inst.path, ...files], { detached: true, stdio: 'ignore' });
    child.unref();
    return { exe: inst.path, pid: child.pid, alreadyRunning: already };
  }
  // Launch through the Windows shell (explorer → wscript) so the app gets a normal user session.
  // Apps spawned directly by a sandboxed/agent process can fail to start their CEP engine (PlugPlugSetup error).
  const q = (s: string) => '""' + s.replace(/"/g, '') + '""';
  const vbs = join(RUNTIME_DIR, `launch-${app}.vbs`);
  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(vbs, '\ufeff' + `CreateObject("WScript.Shell").Run "${[inst.path, ...files].map(q).join(' ')}", 1, False\r\n`, 'utf16le');
  try { await exec('explorer.exe', [vbs], { windowsHide: true }); } catch { /* explorer returns exit code 1 even on success */ }
  if (!(await waitForProcess(app, 15000))) {
    const child = spawn(inst.path, files, { detached: true, stdio: 'ignore', cwd: inst.root });
    child.unref();
    return { exe: inst.path, pid: child.pid, alreadyRunning: already };
  }
  return { exe: inst.path, alreadyRunning: already };
}

export async function waitForProcess(app: AppId, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await isRunning(app)) return true;
    await sleep(1000);
  }
  return false;
}

/** Run a command line through the Windows shell (explorer → wscript), i.e. in the normal user session. */
export async function shellRun(cmdLine: string, hidden = false): Promise<void> {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const vbs = join(RUNTIME_DIR, `shell-${Date.now()}.vbs`);
  writeFileSync(vbs, '\ufeff' + `CreateObject("WScript.Shell").Run "${cmdLine.replace(/"/g, '""')}", ${hidden ? 0 : 1}, False\r\n`, 'utf16le');
  try { await exec('explorer.exe', [vbs], { windowsHide: true }); } catch { /* explorer exit code is meaningless */ }
  setTimeout(() => { try { rmSync(vbs, { force: true }); } catch { /* ignore */ } }, 15000);
}

/** Ask the OS to close the app window (graceful) or kill it (force). */
export async function closeProcess(app: AppId, force: boolean): Promise<void> {
  const def = APPS[app];
  if (IS_WIN) {
    const args = ['/IM', def.winProcess];
    if (force) args.push('/F');
    await exec('taskkill', args, { windowsHide: true }).catch(() => undefined);
    // a sandboxed caller may not be allowed to message windows of apps the user started — repeat it from the user's shell
    await shellRun(`taskkill /IM "${def.winProcess}"${force ? ' /F' : ''}`, true).catch(() => undefined);
  } else {
    await exec('osascript', ['-e', `tell application "${def.macProcess}" to quit`]).catch(() => undefined);
    if (force) await exec('pkill', ['-f', def.macProcess]).catch(() => undefined);
  }
}
