/** Plugins, extensions, scripts & presets: discover, use, read/edit, enable/disable, install — plus live CEP-extension control through the hub. */
import { z } from 'zod';
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, copyFileSync, renameSync, mkdirSync, cpSync } from 'node:fs';
import { join, basename, extname, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tool } from './define.js';
import { AppId, IS_WIN, findInstalls } from '../config.js';
import { runHubOp } from '../transport/runner.js';
import { cepExtensionsDir } from './adobe.js';

const exec = promisify(execFile);
const APPDATA = process.env.APPDATA || '';
const HOMEDIR = process.env.USERPROFILE || process.env.HOME || '';

export type Kind = 'plugin' | 'cep' | 'uxp' | 'script' | 'preset' | 'mogrt' | 'action';
interface Root { app: AppId | 'common'; kind: Kind; dir: string; exts?: string[] }

function roots(): Root[] {
  const r: Root[] = [];
  const add = (app: Root['app'], kind: Kind, dir: string, exts?: string[]) => { if (dir && existsSync(dir)) r.push({ app, kind, dir, exts }); };
  for (const i of findInstalls('ae')) {
    add('ae', 'plugin', join(i.root, 'Support Files', 'Plug-ins'), ['.aex', '.plugin']);
    add('ae', 'script', join(i.root, 'Support Files', 'Scripts'), ['.jsx', '.jsxbin']);
    add('ae', 'preset', join(i.root, 'Support Files', 'Presets'), ['.ffx']);
  }
  for (const i of findInstalls('pr')) { add('pr', 'plugin', join(i.root, 'Plug-ins'), ['.prm', '.aex']); add('pr', 'mogrt', join(i.root, 'Essential Graphics'), ['.mogrt']); }
  for (const i of findInstalls('ps')) { add('ps', 'plugin', join(i.root, 'Plug-ins'), ['.8bf', '.8li', '.8be', '.8by', '.8bi', '.8ba', '.plugin']); add('ps', 'script', join(i.root, 'Presets', 'Scripts'), ['.jsx', '.jsxbin', '.js']); add('ps', 'action', join(i.root, 'Presets', 'Actions'), ['.atn']); }
  for (const i of findInstalls('ai')) { add('ai', 'plugin', join(i.root, 'Plug-ins'), ['.aip']); add('ai', 'script', join(i.root, 'Presets'), ['.jsx', '.jsxbin']); }
  add('common', 'plugin', IS_WIN ? 'C:\\Program Files\\Adobe\\Common\\Plug-ins' : '/Library/Application Support/Adobe/Common/Plug-ins', ['.aex', '.prm', '.plugin']);
  // AE user scripts / presets
  add('ae', 'script', join(APPDATA, 'Adobe', 'After Effects'), ['.jsx', '.jsxbin']);
  for (const d of safeDirs(join(HOMEDIR, 'Documents', 'Adobe'))) if (/After Effects/i.test(d)) add('ae', 'preset', join(HOMEDIR, 'Documents', 'Adobe', d, 'User Presets'), ['.ffx']);
  // CEP & UXP extensions
  add('common', 'cep', cepExtensionsDir());
  if (IS_WIN) { add('common', 'cep', 'C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions'); add('common', 'cep', 'C:\\Program Files\\Common Files\\Adobe\\CEP\\extensions'); add('common', 'uxp', 'C:\\Program Files\\Common Files\\Adobe\\UXP\\extensions'); }
  else { add('common', 'cep', '/Library/Application Support/Adobe/CEP/extensions'); add('common', 'uxp', '/Library/Application Support/Adobe/UXP/extensions'); }
  add('common', 'uxp', join(APPDATA, 'Adobe', 'UXP', 'Plugins', 'External'));
  add('common', 'uxp', join(APPDATA, 'Adobe', 'UXP', 'PluginsStorage'));
  return r;
}

function safeDirs(d: string): string[] { try { return readdirSync(d).filter((n) => { try { return statSync(join(d, n)).isDirectory(); } catch { return false; } }); } catch { return []; } }

function walk(dir: string, exts: string[], max: number, depth = 0, out: string[] = []): string[] {
  if (depth > 6 || out.length >= max) return out;
  let names: string[] = []; try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    const f = join(dir, n); let st; try { st = statSync(f); } catch { continue; }
    if (st.isDirectory()) { if (n.endsWith('.plugin') && exts.includes('.plugin')) out.push(f); else walk(f, exts, max, depth + 1, out); }
    else if (exts.includes(extname(n).toLowerCase()) || exts.some((e) => n.toLowerCase().endsWith(e + '.disabled'))) out.push(f);
    if (out.length >= max) break;
  }
  return out;
}

function cepInfo(dir: string) {
  const m = join(dir, 'CSXS', 'manifest.xml');
  if (!existsSync(m)) return null;
  const x = readFileSync(m, 'utf8');
  const id = (x.match(/ExtensionBundleId="([^"]+)"/) || [])[1];
  const ver = (x.match(/ExtensionBundleVersion="([^"]+)"/) || [])[1];
  const hosts = [...new Set([...x.matchAll(/<Host\s+Name="([^"]+)"/g)].map((h) => h[1]))];
  const exts = [...x.matchAll(/<Extension\s+Id="([^"]+)"/g)].map((h) => h[1]).filter((v, i, a) => a.indexOf(v) === i);
  const menus = [...new Set([...x.matchAll(/<Menu[^>]*>([^<]+)<\/Menu>/g)].map((h) => h[1]))];
  const script = (x.match(/<ScriptPath>([^<]+)<\/ScriptPath>/) || [])[1];
  return { bundleId: id, version: ver, hosts, extensionIds: exts, menus, hostScript: script };
}

function uxpInfo(dir: string) {
  const m = join(dir, 'manifest.json');
  if (!existsSync(m)) return null;
  try { const j = JSON.parse(readFileSync(m, 'utf8')); return { id: j.id, name: j.name, version: j.version, host: j.host, entrypoints: (j.entrypoints || []).map((e: any) => e.id) }; } catch { return null; }
}

const APP_HOSTS: Record<string, string[]> = { ae: ['AEFT'], pr: ['PPRO'], ps: ['PHXS', 'PHSP', 'PS'], ai: ['ILST', 'AI'] };

tool({ name: 'adobe_listPlugins', toolset: 'adobe', readOnly: true,
  description: 'Discover everything installed for the Adobe apps: effect/filter plugins (.aex/.prm/.8bf/.aip), CEP extensions (panels, with bundle ids/hosts/menus), UXP plugins, ExtendScript scripts & ScriptUI panels, AE presets (.ffx), MOGRTs, Photoshop actions. Filter by app, kind, text. For live in-app effect lists also use ae_listEffects / pr_findEffects.',
  input: { app: z.enum(['ae', 'pr', 'ps', 'ai']).optional(), kind: z.enum(['plugin', 'cep', 'uxp', 'script', 'preset', 'mogrt', 'action']).optional(), filter: z.string().optional(), limit: z.number().int().optional() },
  handler: async (a) => {
    const limit = a.limit || 400, f = (a.filter || '').toLowerCase();
    const out: any[] = [];
    for (const r of roots()) {
      if (a.kind && r.kind !== a.kind) continue;
      if (a.app && r.app !== a.app && r.app !== 'common') continue;
      if (r.kind === 'cep' || r.kind === 'uxp') {
        const dirs = r.kind === 'uxp' && r.dir.endsWith('PluginsStorage') ? safeDirs(r.dir).flatMap((h) => safeDirs(join(r.dir, h)).flatMap((v) => ['External', 'Internal'].flatMap((k) => safeDirs(join(r.dir, h, v, k)).map((p) => join(r.dir, h, v, k, p))))) : safeDirs(r.dir).map((d) => join(r.dir, d));
        for (const d of dirs) {
          const info = r.kind === 'cep' ? cepInfo(d) : uxpInfo(d);
          if (!info) continue;
          const hosts: string[] = (info as any).hosts || ((info as any).host ? [].concat((info as any).host).map((h: any) => h.app) : []);
          if (a.app && hosts.length && !hosts.some((h) => APP_HOSTS[a.app].includes(String(h).toUpperCase()))) continue;
          if (f && !JSON.stringify(info).toLowerCase().includes(f) && !d.toLowerCase().includes(f)) continue;
          out.push({ kind: r.kind, path: d, disabled: d.endsWith('.disabled'), ...info });
          if (out.length >= limit) break;
        }
      } else {
        for (const p of walk(r.dir, r.exts || [], limit * 2)) {
          if (f && !p.toLowerCase().includes(f)) continue;
          out.push({ kind: r.kind, app: r.app, name: basename(p).replace(/\.disabled$/, ''), path: p, disabled: p.endsWith('.disabled') });
          if (out.length >= limit) break;
        }
      }
      if (out.length >= limit) break;
    }
    return { count: out.length, items: out, roots: roots().map((r) => `${r.app}:${r.kind} ${r.dir}`) };
  } });

function insideRoots(p: string) {
  const full = resolve(p).toLowerCase();
  return roots().some((r) => full.startsWith(resolve(r.dir).toLowerCase() + sep) || full === resolve(r.dir).toLowerCase());
}

tool({ name: 'adobe_pluginFile', toolset: 'adobe',
  description: 'Read or edit the files of an installed extension / script / preset (manifest.xml, panel HTML/JS, host .jsx, UXP manifest.json, scripts...). Actions: list (folder), read, write (makes a .mcpbak backup first), restore (from .mcpbak). Restricted to Adobe plugin/extension/script folders.',
  input: { action: z.enum(['list', 'read', 'write', 'restore']), path: z.string(), content: z.string().optional() },
  handler: async (a) => {
    if (!insideRoots(a.path)) throw new Error('Path is outside the known Adobe plugin/extension/script folders (see adobe_listPlugins roots).');
    if (a.action === 'list') return safeDirs(a.path).map((d) => d + '/').concat(readdirSync(a.path).filter((n) => !statSync(join(a.path, n)).isDirectory()));
    if (a.action === 'read') { const b = readFileSync(a.path); if (b.includes(0)) return { path: a.path, binary: true, bytes: b.length }; return { path: a.path, content: b.toString('utf8') }; }
    if (a.action === 'write') { if (a.content === undefined) throw new Error('content required'); if (existsSync(a.path) && !existsSync(a.path + '.mcpbak')) copyFileSync(a.path, a.path + '.mcpbak'); writeFileSync(a.path, a.content, 'utf8'); return { written: a.path, backup: a.path + '.mcpbak', note: 'Restart the app (or reopen the panel) to load the change.' }; }
    if (!existsSync(a.path + '.mcpbak')) throw new Error('No backup found'); copyFileSync(a.path + '.mcpbak', a.path); return { restored: a.path };
  } });

tool({ name: 'adobe_togglePlugin', toolset: 'adobe',
  description: 'Enable or disable an installed plugin / extension / script by path (renames to/from ".disabled" so the app skips it on next launch). Program Files locations may need the MCP to run as administrator.',
  input: { path: z.string(), enabled: z.boolean() },
  handler: async (a) => {
    if (!insideRoots(a.path) && !insideRoots(a.path.replace(/\.disabled$/, ''))) throw new Error('Not inside a known Adobe plugin folder.');
    const on = a.path.replace(/\.disabled$/, ''), off = on + '.disabled';
    try { if (a.enabled && existsSync(off)) renameSync(off, on); else if (!a.enabled && existsSync(on)) renameSync(on, off); }
    catch (e: any) { throw new Error(`Could not rename (${e.code}). Run as administrator for Program Files plugins.`); }
    return { path: a.enabled ? on : off, enabled: a.enabled, note: 'Restart the app to apply.' };
  } });

const UPIA = 'C:\\Program Files\\Common Files\\Adobe\\Adobe Desktop Common\\RemoteComponents\\UPI\\UnifiedPluginInstallerAgent\\UnifiedPluginInstallerAgent.exe';

tool({ name: 'adobe_installPlugin', toolset: 'adobe',
  description: 'Install an extension/plugin/script/preset from a file or folder: .zxp/.zip/folder CEP extension → user CEP folder; .ccx UXP plugin → Adobe UPIA installer; .jsx/.jsxbin → AE Scripts (or ScriptUI Panels with panel:true); .ffx → AE User Presets; .mogrt → Premiere Essential Graphics; .atn → loaded into Photoshop; .aex/.8bf/.aip/.prm → the app Plug-ins folder (admin may be needed).',
  input: { path: z.string(), app: z.enum(['ae', 'pr', 'ps', 'ai']).optional(), panel: z.boolean().optional() },
  handler: async (a) => {
    const p = a.path, ext = extname(p).toLowerCase();
    if (!existsSync(p)) throw new Error('Not found: ' + p);
    const st = statSync(p);
    if (st.isDirectory() || ext === '.zxp' || ext === '.zip') {
      const name = basename(p).replace(/\.(zxp|zip)$/i, '');
      const dst = join(cepExtensionsDir(), name);
      mkdirSync(dst, { recursive: true });
      if (st.isDirectory()) cpSync(p, dst, { recursive: true, force: true });
      else if (IS_WIN) { const tmp = join(dst, '..', name + '.__tmp.zip'); copyFileSync(p, tmp); await exec('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${tmp.replace(/'/g, "''")}' -DestinationPath '${dst.replace(/'/g, "''")}' -Force; Remove-Item -LiteralPath '${tmp.replace(/'/g, "''")}'`], { windowsHide: true }); }
      else await exec('unzip', ['-o', p, '-d', dst]);
      return { installed: dst, type: 'CEP extension', info: cepInfo(dst), note: 'Unsigned CEP extensions need PlayerDebugMode (adobe_setup). Restart the app; open it from Window > Extensions.' };
    }
    if (ext === '.ccx') {
      if (!IS_WIN || !existsSync(UPIA)) throw new Error('Adobe UPIA not found — double-click the .ccx to install via Creative Cloud.');
      const { stdout } = await exec(UPIA, ['/install', p], { windowsHide: true }); return { installed: p, type: 'UXP plugin', output: stdout };
    }
    const inst = (app: AppId) => { const i = findInstalls(app)[0]; if (!i) throw new Error(app + ' not installed'); return i.root; };
    let dstDir = '';
    if (ext === '.jsx' || ext === '.jsxbin') dstDir = (a.app && a.app !== 'ae') ? join(inst(a.app), 'Presets', 'Scripts') : join(inst('ae'), 'Support Files', 'Scripts', a.panel ? 'ScriptUI Panels' : '');
    else if (ext === '.ffx') { const doc = safeDirs(join(HOMEDIR, 'Documents', 'Adobe')).filter((d) => /After Effects/i.test(d)).sort().pop(); dstDir = doc ? join(HOMEDIR, 'Documents', 'Adobe', doc, 'User Presets') : join(inst('ae'), 'Support Files', 'Presets'); }
    else if (ext === '.mogrt') dstDir = join(inst('pr'), 'Essential Graphics');
    else if (ext === '.aex') dstDir = join(inst(a.app === 'pr' ? 'pr' : 'ae'), a.app === 'pr' ? 'Plug-ins' : 'Support Files\\Plug-ins');
    else if (ext === '.prm') dstDir = join(inst('pr'), 'Plug-ins');
    else if (ext === '.8bf') dstDir = join(inst('ps'), 'Plug-ins');
    else if (ext === '.aip') dstDir = join(inst('ai'), 'Plug-ins');
    else if (ext === '.atn') return { note: 'Load it into Photoshop with ps_runAction {loadAtn:"' + p + '", ...} or adobe_runScript app.load().' };
    else throw new Error('Unknown plugin type: ' + ext);
    mkdirSync(dstDir, { recursive: true });
    const dst = join(dstDir, basename(p));
    try { copyFileSync(p, dst); } catch (e: any) { throw new Error(`Copy to ${dstDir} failed (${e.code}) — Program Files needs administrator rights.`); }
    return { installed: dst, note: 'Restart the app to load it.' };
  } });

tool({ name: 'adobe_extensions', toolset: 'adobe',
  description: 'Talk to CEP extensions/panels LIVE inside a running app (through the Adobe Studio MCP Hub): list loaded extensions, open or close a panel by extension id, dispatch a CSEvent to extensions (many panels listen for events), listen for events and read them back, get host environment. Call a panel\'s ExtendScript functions with adobe_runScript.',
  input: { app: z.enum(['ae', 'pr', 'ps', 'ai']), action: z.enum(['list', 'open', 'close', 'dispatchEvent', 'listen', 'readEvents', 'hostEnv']), id: z.string().optional().describe('extension id (from list / adobe_listPlugins extensionIds)'),
    params: z.string().optional(), eventType: z.string().optional(), eventTypes: z.array(z.string()).optional(), data: z.unknown().optional() },
  handler: async (a) => {
    const op = { list: 'listExtensions', open: 'openExtension', close: 'closeExtension', dispatchEvent: 'dispatchEvent', listen: 'listen', readEvents: 'readEvents', hostEnv: 'hostEnv' }[a.action as string]!;
    return runHubOp(a.app, op, { id: a.id, params: a.params, type: a.eventType, types: a.eventTypes, data: a.data });
  } });
