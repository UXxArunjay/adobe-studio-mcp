#!/usr/bin/env bash
# Adobe Studio MCP — macOS installer:  bash scripts/install-macos.sh [--no-upstream] [--no-claude]
set -e
cd "$(dirname "$0")/.."
command -v node >/dev/null || { echo "Node.js 18+ required (https://nodejs.org)"; exit 1; }
npm install --no-audit --no-fund && npm run build
[[ " $* " == *" --no-upstream "* ]] || node scripts/setup-upstream.mjs
if [[ " $* " == *" --no-claude "* ]]; then node scripts/setup-apps.mjs; else node scripts/setup-apps.mjs --claude; fi
echo "Done. Restart the Adobe apps and Claude Desktop."
