/**
 * Builds a self-contained ExtendScript (ES3) program from a tool body.
 * The body is a function body that `return`s a JSON-able value; it can read ARGS.
 * Output is always a JSON string {ok,result} | {ok:false,error,line}. ASCII only
 * (non-ASCII is \u-escaped both ways) so Hindi / emoji survive every transport.
 */
import type { AppId } from '../config.js';
import { PRELUDE } from './prelude.js';

export const STRINGIFY = `
function __s(v, d) {
  d = d || 0;
  if (d > 14) return '"[depth]"';
  if (v === null || v === undefined) return 'null';
  var t = typeof v;
  if (t === 'number') return isFinite(v) ? String(v) : 'null';
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'string') {
    var o = '"';
    for (var i = 0; i < v.length; i++) {
      var c = v.charAt(i), n = v.charCodeAt(i);
      if (c === '"') o += '\\\\"';
      else if (c === '\\\\') o += '\\\\\\\\';
      else if (n === 10) o += '\\\\n';
      else if (n === 13) o += '\\\\r';
      else if (n === 9) o += '\\\\t';
      else if (n < 32 || n > 126) { var h = n.toString(16); while (h.length < 4) h = '0' + h; o += '\\\\u' + h; }
      else o += c;
    }
    return o + '"';
  }
  if (t === 'function') return 'null';
  if (v instanceof Array) {
    var a = [];
    for (var j = 0; j < v.length; j++) a.push(__s(v[j], d + 1));
    return '[' + a.join(',') + ']';
  }
  if (v instanceof File || v instanceof Folder) return __s(v.fsName, d);
  if (t === 'object') {
    var p = [];
    try { for (var k in v) { if (!v.hasOwnProperty || v.hasOwnProperty(k)) { var val = v[k]; if (typeof val !== 'function') p.push(__s(String(k)) + ':' + __s(val, d + 1)); } } } catch (e) { return __s(String(v)); }
    return '{' + p.join(',') + '}';
  }
  return __s(String(v));
}`;

/** Escapes every non-ASCII code unit as \uXXXX (valid inside JS string literals). */
export function asciiSafe(code: string): string {
  return code.replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

export interface WrapOptions {
  /** absolute path the script should also write its JSON result to ('' = none) */
  outFile?: string;
  /** After Effects: wrap in an undo group with this name */
  undo?: string;
  /** include app prelude helpers (default true) */
  prelude?: boolean;
}

export function wrapJsx(app: AppId, body: string, args: unknown, opts: WrapOptions = {}): string {
  const out = (opts.outFile || '').replace(/\\/g, '/');
  const pre = opts.prelude === false ? '' : PRELUDE[app] || '';
  const undoOpen = app === 'ae' && opts.undo ? `app.beginUndoGroup(${JSON.stringify(opts.undo)});` : '';
  const undoClose = app === 'ae' && opts.undo ? `try { app.endUndoGroup(); } catch (__u) {}` : '';
  const src = `(function () {
${STRINGIFY}
var __out = ${JSON.stringify(out)};
var __res;
${pre}
var ARGS = ${JSON.stringify(args ?? {})};
${undoOpen}
try {
  var __v = (function () {
${body}
  })();
  __res = '{"ok":true,"result":' + __s(__v) + '}';
} catch (e) {
  __res = '{"ok":false,"error":' + __s(String((e && e.message) || e)) + ',"line":' + __s(e && e.line) + '}';
} finally {
  ${undoClose}
  ${app === 'ps' && opts.prelude !== false ? 'try { app.preferences.rulerUnits = __oldUnits; } catch (__ru) {}' : ''}
}
if (__out) { try { var __f = new File(__out); __f.encoding = 'UTF-8'; __f.open('w'); __f.write(__res); __f.close(); } catch (__w) {} }
return __res;
})();`;
  return asciiSafe(src);
}

export interface JsxResult { ok: boolean; result?: unknown; error?: string; line?: number; raw?: string }

export function parseJsxResult(raw: string): JsxResult {
  const text = (raw || '').trim();
  if (!text) return { ok: false, error: 'Empty response from the app (script did not return).' };
  try {
    const j = JSON.parse(text);
    if (j && typeof j === 'object' && 'ok' in j) return j as JsxResult;
    return { ok: true, result: j };
  } catch {
    // CEP evalScript error string or raw non-JSON
    if (/^EvalScript error/i.test(text)) return { ok: false, error: text };
    return { ok: true, result: text };
  }
}
