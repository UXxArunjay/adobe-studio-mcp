import { promises as fs, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RUNTIME_DIR } from '../config.js';
import { sleep } from '../transport/process.js';

export const EXPORT_DIR = join(RUNTIME_DIR, 'frames');

export function tempPng(prefix: string, ext = 'png') {
  mkdirSync(EXPORT_DIR, { recursive: true });
  return join(EXPORT_DIR, `${prefix}-${Date.now()}-${randomUUID().slice(0, 6)}.${ext}`);
}

/** Marks a result so the server returns the image inline (the model can look at it). */
export interface ImageResult { __image: { data: string; mimeType: string }; info: unknown }

export async function imageResult(path: string, info: unknown, waitMs = 20000): Promise<ImageResult | unknown> {
  const end = Date.now() + waitMs;
  let last = -1;
  // some apps write the frame asynchronously: wait until the file exists and its size is stable
  while (Date.now() < end) {
    if (existsSync(path)) {
      const st = await fs.stat(path);
      if (st.size > 0 && st.size === last) break;
      last = st.size;
    }
    await sleep(150);
  }
  if (!existsSync(path)) return { ...(info as object), warning: 'Frame file was not written yet: ' + path };
  const buf = await fs.readFile(path);
  if (buf.length > 8 * 1024 * 1024) return { ...(info as object), note: 'image larger than 8 MB — not inlined', path };
  const mimeType = path.toLowerCase().endsWith('.jpg') || path.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
  return { __image: { data: buf.toString('base64'), mimeType }, info };
}

export async function waitForFile(path: string, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (existsSync(path)) { try { if ((await fs.stat(path)).size > 0) return true; } catch { /* retry */ } } await sleep(200); }
  return false;
}
