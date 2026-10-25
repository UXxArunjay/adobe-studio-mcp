// App-side setup: Adobe Studio MCP Hub (CEP), PlayerDebugMode, AE scripting prefs, upstream bridges, optional Claude Desktop config.
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, cpSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.ADOBE_MCP_NO_START = '1';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { TOOLS } = await import('../dist/tools/define.js');
await import('../dist/index.js');
const { cepExtensionsDir } = await import('../dist/tools/adobe.js');
const { findInstalls } = await import('../dist/config.js');
const setup = TOOLS.find((t) => t.name === 'adobe_setup');
console.log('Adobe Studio MCP Hub + prefs:', JSON.stringify(await setup.handler({}, {}), null, 2));

const up = join(root, 'upstream');
// pr1: its CEP "MCP Bridge" panel
const prCep = join(up, 'Adobe_Premiere_Pro_MCP', 'cep-plugin');
if (existsSync(prCep)) {
  const m = readFileSync(join(prCep, 'CSXS', 'manifest.xml'), 'utf8');
  const id = (m.match(/ExtensionBundleId="([^"]+)"/) || [])[1] || 'com.premiere.mcp.bridge';
  const dst = join(cepExtensionsDir(), id); mkdirSync(dst, { recursive: true }); cpSync(prCep, dst, { recursive: true, force: true });
  console.log('pr1 CEP bridge →', dst);
}
// ae1: its ScriptUI bridge panel (Program Files: may need admin)
const ae1 = join(up, 'after-effects-mcp', 'build', 'scripts', 'mcp-bridge-auto.jsx');
for (const i of findInstalls('ae')) {
  if (!existsSync(ae1)) break;
  const dst = join(i.root, 'Support Files', 'Scripts', 'ScriptUI Panels');
  try { mkdirSync(dst, { recursive: true }); copyFileSync(ae1, join(dst, 'mcp-bridge-auto.jsx')); console.log('ae1 bridge panel →', dst); }
  catch (e) { console.log(`ae1 bridge panel: copy needs admin (${e.code}). Optional — ae2 + native AE tools need no panel.`); }
}
// Claude Desktop config (only with --claude)
if (process.argv.includes('--claude')) {
  const cfgPath = process.platform === 'win32' ? join(process.env.APPDATA, 'Claude', 'claude_desktop_config.json') : join(process.env.HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  let cfg = {}; if (existsSync(cfgPath)) { copyFileSync(cfgPath, cfgPath + '.bak-adobe-studio'); cfg = JSON.parse(readFileSync(cfgPath, 'utf8')); }
  cfg.mcpServers = cfg.mcpServers || {};
  cfg.mcpServers['adobe-studio'] = { command: process.execPath, args: [join(root, 'dist', 'index.js')], env: { ADOBE_MCP_MODE: 'compact' } };
  mkdirSync(dirname(cfgPath), { recursive: true }); writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  console.log('Claude Desktop config updated:', cfgPath, '(backup .bak-adobe-studio). Restart Claude Desktop.');
}
process.exit(0);
