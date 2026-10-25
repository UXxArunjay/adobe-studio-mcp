import { z, ZodRawShape } from 'zod';
import type { AppId } from '../config.js';
import { runJsx } from '../transport/runner.js';

export type Toolset = 'adobe' | 'ae' | 'pr' | 'ps' | 'ai' | 'xapp' | 'hub';

export interface ToolCtx { call: (name: string, args: Record<string, unknown>) => Promise<unknown> }

export interface NativeTool {
  name: string;
  toolset: Toolset;
  description: string;
  input: ZodRawShape;
  readOnly?: boolean;
  destructive?: boolean;
  handler: (args: any, ctx: ToolCtx) => Promise<unknown>;
}

export const TOOLS: NativeTool[] = [];
/** every ExtendScript body, for the ES3 syntax check (scripts/check-jsx.mjs) */
export const JSX_BODIES: { name: string; app: AppId; jsx: string }[] = [];

export function tool(t: NativeTool) { TOOLS.push(t); return t; }

/** A tool whose whole implementation is an ExtendScript body run inside `app`. */
export function jsxTool(t: Omit<NativeTool, 'handler'> & { app: AppId; jsx: string; undo?: boolean; timeoutMs?: number;
  before?: (args: any) => any | Promise<any>; after?: (r: any, args: any) => Promise<unknown> }) {
  const { app, jsx, undo, timeoutMs, before, after, ...rest } = t;
  JSX_BODIES.push({ name: t.name, app, jsx });
  return tool({
    ...rest,
    handler: async (input) => {
      const args = before ? await before(input) : input;
      const r = await runJsx(app, jsx, args, { undo: undo ? t.name : undefined, timeoutMs });
      return after ? after(r, args) : r;
    },
  });
}

/* ---- shared schema pieces ---- */
export const zComp = z.string().optional().describe('Comp name; omit to use the active comp.');
export const zLayer = z.union([z.string(), z.number().int()]).describe('Layer name or 1-based index.');
export const zLayerOpt = zLayer.optional();
export const zLayers = z.array(z.union([z.string(), z.number().int()])).describe('Layer names or 1-based indexes.');
export const zVec = z.array(z.number());
export const zValue = z.union([z.number(), z.array(z.number()), z.string(), z.boolean()]);
export const zTime = z.union([z.number(), z.string()]).describe('Seconds on the timeline (or timecode "HH:MM:SS:FF").');
export const zSeq = z.string().optional().describe('Sequence name; omit for the active sequence.');
export const zTrack = z.string().describe('Track: V1, V2... or A1, A2...');
export const zClipRef = z.object({ track: zTrack, clip: z.union([z.number().int(), z.string()]).optional(), time: zTime.optional() })
  .describe('A timeline clip: {track:"V1", clip:2} (1-based on that track), {track:"V1", clip:"name"}, or {track:"V1", time:12.5}.');
export const zDoc = z.string().optional().describe('Document name; omit for the active document.');
export const zColor = z.string().describe('Hex color like "#FF8800".');

/** escape a JS value for safe embedding (used by tools that build expressions) */
export const js = (v: unknown) => JSON.stringify(v);
