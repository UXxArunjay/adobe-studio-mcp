// Dev helper: run Audition code that may open a dialog, list dialogs after N s. node scripts/au-dlgtest.mjs "<code>" [waitSec] [pressButton]
process.env.ADOBE_MCP_NO_START = '1';
process.env.ADOBE_MCP_DIALOG_WATCH = '0';
const r = await import('../dist/transport/runner.js');
const d = await import('../dist/transport/dialogs.js');
const [, , code, wait = '6', press] = process.argv;
const p = r.runJsxResult('au', code, {}, { timeoutMs: 60000 }).then((x) => console.log('RES', JSON.stringify(x))).catch((e) => console.log('ERR', e.message));
await new Promise((s) => setTimeout(s, Number(wait) * 1000));
const ds = await d.listDialogs('au');
console.log('DLG', JSON.stringify(ds, null, 1));
if (press && ds[0]) console.log('PRESS', JSON.stringify(await d.pressDialog(ds[0].hwnd, press)));
await p;
process.exit(0);
