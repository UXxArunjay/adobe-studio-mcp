// Clones (if missing), installs and builds the bundled community MCP servers into ./upstream.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const up = process.env.ADOBE_MCP_UPSTREAM_DIR || join(root, 'upstream');
const LIBS = [
  { dir: 'after-effects-mcp', repo: 'https://github.com/Dakkshin/after-effects-mcp.git', build: 'npm run build' },
  { dir: 'mcp-aftereffects', repo: 'https://github.com/kumoproductions/mcp-aftereffects.git', build: 'npm run build' },
  { dir: 'Adobe_Premiere_Pro_MCP', repo: 'https://github.com/hetpatel-11/Adobe_Premiere_Pro_MCP.git', build: 'npm run build' },
  { dir: 'photoshop-mcp', repo: 'https://github.com/alisaitteke/photoshop-mcp.git', build: 'npm run build:server' },
  { dir: 'illustrator-mcp-server', repo: 'https://github.com/ie3jp/illustrator-mcp-server.git', build: 'npm run build' },
];
const only = process.argv.slice(2);
mkdirSync(up, { recursive: true });
const sh = (cmd, cwd) => { console.log(`  $ ${cmd}`); execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, DO_NOT_TRACK: '1' } }); };
let failed = 0;
for (const l of LIBS) {
  if (only.length && !only.includes(l.dir)) continue;
  const d = join(up, l.dir);
  console.log(`\n== ${l.dir}`);
  try {
    if (!existsSync(join(d, 'package.json'))) sh(`git clone --depth 1 ${l.repo} "${d}"`, up);
    if (process.argv.includes('--pull')) sh('git pull --ff-only', d);
    sh('npm install --no-audit --no-fund --ignore-scripts', d);
    sh(l.build, d);
  } catch (e) { failed++; console.error(`  ✗ ${l.dir} failed: ${e.message}`); }
}
console.log(failed ? `\n${failed} library build(s) failed — the rest work; native tools are unaffected.` : '\nAll upstream libraries built.');
