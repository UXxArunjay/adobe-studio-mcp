// ES3 syntax check of every generated ExtendScript program (ExtendScript = ECMAScript 3).
import * as acorn from 'acorn';
import { TOOLS, JSX_BODIES } from '../dist/tools/define.js';
import { wrapJsx } from '../dist/jsx/wrap.js';
import { TEST_HOOK } from '../dist/transport/runner.js';
await import('../dist/index.js?nostart').catch(() => {});
let bad = 0, n = 0;
function check(label, code) {
  n++;
  try { acorn.parse(code, { ecmaVersion: 3, allowReserved: false }); }
  catch (e) {
    bad++; const lines = code.split('\n'); const ln = e.loc?.line || 0;
    console.log(`✗ ${label}: ${e.message}\n   ${lines[ln - 1]?.trim().slice(Math.max(0, (e.loc?.column || 0) - 60), (e.loc?.column || 0) + 60)}`);
  }
}
for (const b of JSX_BODIES) check(b.name, wrapJsx(b.app, b.jsx, {}, { undo: 'x' }));
// inline scripts inside handlers (xapp_, adobe_): run handlers in capture mode with plausible args
TEST_HOOK.capture = (app, code) => { check('inline/' + app, code); return 'C:/x/y.aep'; };
const samples = {
  xapp_bridgeTalk: { target: 'photoshop', script: '1+1', from: 'ae' }, xapp_aeCompToPremiere: { track: 'V1' }, xapp_premiereToAE: {}, xapp_photoshopToAE: {},
  xapp_illustratorToAE: {}, adobe_runScript: { app: 'ae', code: 'return 1;' }, adobe_quitApp: { app: 'ps' },
};
const ctx = { call: async () => ({}) };
for (const [name, args] of Object.entries(samples)) { const t = TOOLS.find((x) => x.name === name); if (!t) continue; try { await t.handler(args, ctx); } catch (e) { /* non-script errors ok */ } }
console.log(`${n - bad}/${n} ExtendScript programs parse as ES3`);
process.exit(bad ? 1 : 0);
