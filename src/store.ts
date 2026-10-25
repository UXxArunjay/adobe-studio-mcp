import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { RUNTIME_DIR } from './config.js';

export interface StudioConfig { pixabayKey?: string; mediaDir?: string; ytdlpArgs?: string; [k: string]: string | undefined }
const FILE = join(RUNTIME_DIR, 'config.json');

export function readConfig(): StudioConfig {
  let c: StudioConfig = {};
  try { c = JSON.parse(readFileSync(FILE, 'utf8')); } catch { /* none yet */ }
  if (process.env.PIXABAY_API_KEY) c.pixabayKey = process.env.PIXABAY_API_KEY;
  if (process.env.ADOBE_MCP_MEDIA_DIR) c.mediaDir = process.env.ADOBE_MCP_MEDIA_DIR;
  return c;
}

export function writeConfig(c: StudioConfig) {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(c, null, 2), 'utf8');
}

export function mediaDir(sub = ''): string {
  const base = readConfig().mediaDir || join(RUNTIME_DIR, 'media');
  const d = sub ? join(base, sub) : base;
  mkdirSync(d, { recursive: true });
  return d;
}
