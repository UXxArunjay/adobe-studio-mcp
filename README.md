# Adobe Studio MCP

**One free, open-source MCP server that lets Claude (or any MCP client) drive After Effects, Premiere Pro, Photoshop and Illustrator — together.**

- **182 native tools** — full Filmit-style motion-graphics & editing toolset (same tool names, `ae_` / `pr_` prefix), plus advanced extras: 3D cameras & lights, camera moves, text animators, expression rigs, markers, time-remap, MOGRT / Essential Graphics, render queue & **Adobe Media Encoder**, Premiere auto-reframe, scene-edit detection, speed, captions, XML/AAF export…
- **+501 community tools** from the 5 best Adobe MCPs on GitHub, bundled and served through the same connection (searchable catalog, or flat).
- **Cross-app workflows** — Dynamic Link (AE comps → Premiere, live), Premiere → AE, PSD → layered AE comp, Illustrator → AE shape layers, frames → Photoshop, PS/AI → Premiere, AE → MOGRT → Premiere, BridgeTalk messaging between apps.
- **Launch / open / quit apps by command** — no computer-use or clicking.
- **Plugins & extensions** — discover every installed effect plugin, CEP panel, UXP plugin, script, preset, MOGRT and action; use them (any third-party effect, any script, any menu command), read/edit their files, enable/disable, install new ones, and talk to open CEP panels live.
- **Media** — download from YouTube (and 1000+ sites) with **yt-dlp** as MP4 (edit-friendly H.264), MOV, MKV, WebM, MP3, WAV, M4A, FLAC…; search & download **Pixabay** photos, illustrations, vectors and videos with the official API — and drop them straight into any app.
- **Nothing is out of reach** — raw ExtendScript (`adobe_runScript`), AE menu commands, Photoshop Action Manager (batchPlay-style JSON → every PS command and plugin filter), Illustrator menu commands & Live Effects, Premiere QE DOM.

> Not affiliated with Adobe. Windows first-class, macOS supported.

## Install (Windows)

Requirements: Node.js 18+, Git, Adobe apps (2022 or newer recommended).

```powershell
git clone --recurse-submodules https://github.com/UXxArunjay/adobe-studio-mcp.git
cd adobe-studio-mcp
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
```

The installer builds the server and the 5 bundled MCPs, installs the **Adobe Studio MCP Hub** (one hidden CEP extension that loads in all four apps), enables unsigned CEP extensions, turns on After Effects *Allow Scripts to Write Files and Access Network*, and adds `adobe-studio` to Claude Desktop (backup kept). Restart the Adobe apps and Claude Desktop, then ask: **"adobe_status"**.

macOS: `bash scripts/install-macos.sh`.

### Other MCP clients

```json
{ "mcpServers": { "adobe-studio": { "command": "node", "args": ["C:/path/to/adobe-studio-mcp/dist/index.js"] } } }
```

Claude Code: `claude mcp add adobe-studio -- node C:/path/to/adobe-studio-mcp/dist/index.js`

## How it connects

| App | Transport (first available) | Needs |
|---|---|---|
| After Effects | Hub (CEP) → `AfterFX.exe -r` script + result file | Hub, or the AE scripting pref (installer sets it) |
| Premiere Pro | Hub (CEP) | Hub (auto-starts; Window › Extensions › Adobe Studio MCP Hub shows status) |
| Photoshop | Hub (CEP) → Windows COM | nothing |
| Illustrator | Hub (CEP) → Windows COM | nothing |

Every call is serialized per app, wrapped in an undo group (AE), Unicode-safe (Hindi etc.), and returns JSON or an image (`*_exportFrame`, `ps_preview`, `xapp_preview`) so the model can check its own work.

## Configuration (env vars)

| Variable | Default | Purpose |
|---|---|---|
| `ADOBE_MCP_MODE` | `compact` | `compact`: community tools via `adobe_catalog_*`; `full`: all ~680 tools listed flat; `off`: native only |
| `ADOBE_MCP_TOOLSETS` | `all` | Limit native toolsets, e.g. `ae,pr,xapp` (smaller tool list = fewer tokens) |
| `ADOBE_MCP_TIMEOUT_MS` | `120000` | Default per-call timeout |
| `PIXABAY_API_KEY` | – | Pixabay key (or `adobe_config {"set":{"pixabayKey":"…"}}`) — free at pixabay.com/api/docs |
| `ADOBE_MCP_MEDIA_DIR` | `~/.adobe-studio-mcp/media` | Where downloads go |
| `ADOBE_MCP_AE_EXE` / `_PR_EXE` / `_PS_EXE` / `_AI_EXE` | auto | Custom app paths |

## Tools

Full list with descriptions: **[docs/TOOLS.md](docs/TOOLS.md)**. Highlights:

- **Studio**: `adobe_status`, `adobe_launchApp`, `adobe_openFile`, `adobe_quitApp`, `adobe_runScript`, `adobe_batch`, `adobe_setup`, `adobe_config`
- **Plugins**: `adobe_listPlugins`, `adobe_pluginFile`, `adobe_togglePlugin`, `adobe_installPlugin`, `adobe_extensions`, `ae_listEffects`, `pr_findEffects`, `ae_applyPreset`, `ae_runScriptFile`, `ps_runAction`, `ai_runAction`
- **After Effects** (72): comps, text/shape/solid/null/adjustment/camera/light layers, masks, effects, keyframes & easing, expressions & templates, track mattes, parenting, precompose, 3D, camera moves, markers, time remap, render queue, AME, MOGRT…
- **Premiere Pro** (39): project/sequence state, place/insert, razor, ripple range removal, trim, move, speed, Motion/Opacity/Volume keyframes, effects & transitions, MOGRT titles, captions, markers, tracks, export via AME, XML, auto-reframe, scene detection, `pr_applyEditPlan`
- **Photoshop** (22) / **Illustrator** (16): documents, layers, text, shapes, filters, adjustment layers, selections (Select Subject/Sky), Remove Background, content-aware fill, layer styles, smart objects, artboards, image trace, exports, Action Manager / menu commands
- **Cross-app** (16): `xapp_aeCompToPremiere`, `xapp_premiereToAE`, `xapp_photoshopToAE`, `xapp_illustratorToAE`, `xapp_frameToPhotoshop`, `xapp_toPremiere`, `xapp_mogrtToPremiere`, `xapp_renderAEToPremiere`, `xapp_bridgeTalk`, `xapp_preview`, `media_youtubeDownload`, `media_info`, `media_tools`, `media_import`, `pixabay_search`, `pixabay_download`
- **Catalog**: `adobe_catalog_search` → `adobe_catalog_describe` → `adobe_catalog_call` over ae1 / ae2 / pr1 / ps1 / ai1

## Bundled community MCPs

| id | Project | Tools |
|---|---|---|
| ae1 | [Dakkshin/after-effects-mcp](https://github.com/Dakkshin/after-effects-mcp) | 13 |
| ae2 | [kumoproductions/mcp-aftereffects](https://github.com/kumoproductions/mcp-aftereffects) | 11 (+ dozens of `do` operations) |
| pr1 | [hetpatel-11/Adobe_Premiere_Pro_MCP](https://github.com/hetpatel-11/Adobe_Premiere_Pro_MCP) | 283 |
| ps1 | [alisaitteke/photoshop-mcp](https://github.com/alisaitteke/photoshop-mcp) | 128 (incl. Firefly generative fill/expand) |
| ai1 | [ie3jp/illustrator-mcp-server](https://github.com/ie3jp/illustrator-mcp-server) | 66 |

All MIT — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Update them with `node scripts/setup-upstream.mjs --pull`.

## Troubleshooting

- **Run `adobe_status` first** — it tells you, per app, whether it is installed, running and connected, and what to do next.
- **Launch apps with `adobe_launchApp`.** On Windows it starts them through the Windows shell, so their CEP engine (and the hub) loads even when the MCP runs inside a sandboxed agent.
- **Photoshop 2026 without the Creative Cloud desktop service** may not start CEP at all (`PlugPlugSetup` error in `%TEMP%\CEP12-PHXS.log`). Nothing to do — Photoshop is driven through COM automatically.
- **After Effects frame export** uses `saveFrameToPng` and falls back to a one-frame Render Queue render (needs ffmpeg, auto-installed). AE renders only while its window is not minimised and the PC is unlocked.
- **Premiere built-in titles** (Basic Title…) keep their text in a binary format that scripting can't edit in Premiere 2026. For editable text use an After Effects MOGRT (`xapp_mogrtToPremiere`) or `pr_addCaptions`.
- **Premiere effect parameter names** differ between versions (e.g. 2026 *Gaussian Blur* uses `Amount`); a wrong name returns the list of available parameters.
- **YouTube errors**: `media_tools {"action":"update"}` updates yt-dlp, which fixes most extraction problems.

## Development

```bash
npm install && npm run build
npm test          # ES3 syntax check of all 150+ generated ExtendScript programs + MCP smoke test
npm run docs      # regenerate docs/TOOLS.md
```

Add a tool: `jsxTool({ name, toolset, app, description, input: { …zod… }, jsx: String.raw\`…ExtendScript body…\` })` in `src/tools/*.ts`. Helpers available inside every script are in `src/jsx/prelude.ts`.

## Responsible use

Download only media you own or are licensed to use (your own uploads, Creative Commons, permission from the owner). Respect YouTube's Terms of Service and creators' copyright. Pixabay content is free under the Pixabay Content License; credit is appreciated.

## License

MIT © 2026 Arunjay Patel.
