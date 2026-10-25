import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type AppId = 'ae' | 'pr' | 'ps' | 'ai' | 'ame';

export interface AppDef {
  id: AppId;
  label: string;
  /** folder prefix under C:\Program Files\Adobe (Windows) or /Applications (macOS) */
  folder: string;
  /** exe relative to the install folder (Windows) */
  winExe: string;
  /** process image name (Windows) */
  winProcess: string;
  /** BridgeTalk target specifier */
  bridgeTalk: string;
  /** CEP host id */
  cepHost: string;
  /** env var that overrides the executable path */
  envVar: string;
  macProcess: string;
}

export const APPS: Record<AppId, AppDef> = {
  ae: { id: 'ae', label: 'After Effects', folder: 'Adobe After Effects', winExe: 'Support Files\\AfterFX.exe', winProcess: 'AfterFX.exe', bridgeTalk: 'aftereffects', cepHost: 'AEFT', envVar: 'ADOBE_MCP_AE_EXE', macProcess: 'After Effects' },
  pr: { id: 'pr', label: 'Premiere Pro', folder: 'Adobe Premiere Pro', winExe: 'Adobe Premiere Pro.exe', winProcess: 'Adobe Premiere Pro.exe', bridgeTalk: 'premierepro', cepHost: 'PPRO', envVar: 'ADOBE_MCP_PR_EXE', macProcess: 'Adobe Premiere Pro' },
  ps: { id: 'ps', label: 'Photoshop', folder: 'Adobe Photoshop', winExe: 'Photoshop.exe', winProcess: 'Photoshop.exe', bridgeTalk: 'photoshop', cepHost: 'PHXS', envVar: 'ADOBE_MCP_PS_EXE', macProcess: 'Adobe Photoshop' },
  ai: { id: 'ai', label: 'Illustrator', folder: 'Adobe Illustrator', winExe: 'Support Files\\Contents\\Windows\\Illustrator.exe', winProcess: 'Illustrator.exe', bridgeTalk: 'illustrator', cepHost: 'ILST', envVar: 'ADOBE_MCP_AI_EXE', macProcess: 'Adobe Illustrator' },
  ame: { id: 'ame', label: 'Media Encoder', folder: 'Adobe Media Encoder', winExe: 'Adobe Media Encoder.exe', winProcess: 'Adobe Media Encoder.exe', bridgeTalk: 'ame', cepHost: 'AME', envVar: 'ADOBE_MCP_AME_EXE', macProcess: 'Adobe Media Encoder' },
};

export const SCRIPT_APPS: AppId[] = ['ae', 'pr', 'ps', 'ai'];

export const IS_WIN = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';

/** Shared runtime folder: job files, CEP hub IPC, logs. */
export const RUNTIME_DIR = process.env.ADOBE_MCP_RUNTIME_DIR || join(homedir(), '.adobe-studio-mcp');
export const HOME = homedir();

export const DEFAULT_TIMEOUT_MS = Number(process.env.ADOBE_MCP_TIMEOUT_MS || 120000);

export interface Install { path: string; year: number; root: string }

/** Finds every installed version of an app; newest first. */
export function findInstalls(app: AppId): Install[] {
  const def = APPS[app];
  const out: Install[] = [];
  const override = process.env[def.envVar];
  if (override && existsSync(override)) out.push({ path: override, year: 9999, root: override });
  const roots = IS_WIN
    ? [process.env.ADOBE_MCP_ADOBE_DIR, 'C:\\Program Files\\Adobe', 'D:\\Program Files\\Adobe'].filter(Boolean) as string[]
    : ['/Applications'];
  for (const root of roots) {
    let names: string[] = [];
    try { names = readdirSync(root); } catch { continue; }
    for (const n of names) {
      if (!n.startsWith(def.folder)) continue;
      // "Adobe Premiere Pro 2026", "Adobe Photoshop (Beta)" ...
      const year = Number((n.match(/(20\d\d)/) || [])[1] || (n.includes('Beta') ? 9000 : 0));
      const base = join(root, n);
      const exe = IS_WIN ? join(base, def.winExe) : join(base, `${n}.app`);
      if (existsSync(exe)) out.push({ path: exe, year, root: base });
    }
  }
  return out.sort((a, b) => b.year - a.year);
}

export function enabledToolsets(): Set<string> {
  const raw = (process.env.ADOBE_MCP_TOOLSETS || 'all').toLowerCase();
  if (raw === 'all') return new Set(['adobe', 'ae', 'pr', 'ps', 'ai', 'xapp', 'hub']);
  return new Set(['adobe', ...raw.split(/[,\s]+/).filter(Boolean)]);
}

/** compact = upstream tools via catalog gateway; full = every upstream tool flat; off = native only */
export const HUB_MODE = (process.env.ADOBE_MCP_MODE || 'compact').toLowerCase() as 'compact' | 'full' | 'off';
