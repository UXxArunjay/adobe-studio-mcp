# Adobe Studio MCP — Windows installer. Usage (PowerShell, in the repo folder):
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 [-NoUpstream] [-NoClaude]
param([switch]$NoUpstream, [switch]$NoClaude)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Error 'Node.js 18+ is required: https://nodejs.org'; exit 1 }
Write-Host '== Installing Adobe Studio MCP' -ForegroundColor Cyan
npm install --no-audit --no-fund
npm run build
if (-not $NoUpstream) { Write-Host '== Building bundled community MCPs' -ForegroundColor Cyan; node scripts/setup-upstream.mjs }
Write-Host '== Configuring Adobe apps' -ForegroundColor Cyan
if ($NoClaude) { node scripts/setup-apps.mjs } else { node scripts/setup-apps.mjs --claude }
Write-Host ''
Write-Host 'Done. Restart After Effects / Premiere Pro / Photoshop / Illustrator and Claude Desktop.' -ForegroundColor Green
Write-Host 'Then ask Claude: "adobe_status"'
