// Generates docs/TOOLS.md from the live tool registry.
import { writeFileSync, mkdirSync } from 'node:fs';
process.env.ADOBE_MCP_NO_START = '1';
const { TOOLS } = await import('../dist/tools/define.js');
await import('../dist/index.js');
const { LIBRARIES } = await import('../dist/hub/upstream.js');
const SETS = { adobe: 'Studio, apps, plugins & extensions', ae: 'After Effects', pr: 'Premiere Pro', ps: 'Photoshop', ai: 'Illustrator', xapp: 'Cross-app, YouTube & Pixabay', hub: 'Community catalog gateway' };
let md = `# Tool reference\n\n${TOOLS.length} native tools + every tool of the bundled community MCPs through the catalog.\n\n`;
for (const [k, title] of Object.entries(SETS)) {
  const ts = TOOLS.filter((t) => t.toolset === k);
  md += `## ${title} (${ts.length})\n\n| Tool | What it does |\n|---|---|\n`;
  for (const t of ts) md += `| \`${t.name}\` | ${t.description.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |\n`;
  md += '\n';
}
md += `## Bundled community MCPs (catalog)\n\n| id | Library | Notes |\n|---|---|---|\n` + LIBRARIES.map((l) => `| ${l.id} | [${l.name}](${l.repo}) | ${l.notes} |`).join('\n') + '\n';
mkdirSync('docs', { recursive: true }); writeFileSync('docs/TOOLS.md', md); console.log('docs/TOOLS.md', TOOLS.length, 'tools'); process.exit(0);
