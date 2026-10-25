/* Adobe Studio MCP Hub — CEP bridge (MIT). One background extension per Adobe app.
 * The MCP server drops {id, code} JSON files in ~/.adobe-studio-mcp/hub/<app>/in/,
 * this panel evaluates the ExtendScript in the host and writes the result to out/<id>.json. */
(function () {
  var role = window.HUB_ROLE || 'bg';
  var uid = role + '-' + Math.random().toString(36).slice(2);
  var st = document.getElementById('st'), logEl = document.getElementById('log');
  function log(m) { if (logEl) { logEl.textContent = (new Date().toLocaleTimeString() + ' ' + m + '\n' + logEl.textContent).slice(0, 4000); } }
  var req;
  try { req = window.require || (window.cep_node && window.cep_node.require); } catch (e) {}
  if (!req) { st.innerHTML = '<span class="bad">Node.js is disabled for this panel.</span>'; return; }
  var fs = req('fs'), path = req('path'), os = req('os');
  var cep = window.__adobe_cep__;
  var env = {};
  try { env = JSON.parse(cep.getHostEnvironment()); } catch (e) {}
  var MAP = { AEFT: 'ae', PPRO: 'pr', PHXS: 'ps', PHSP: 'ps', ILST: 'ai' };
  var app = MAP[env.appName] || String(env.appName || 'unknown').toLowerCase();
  var base = process.env.ADOBE_MCP_RUNTIME_DIR || path.join(os.homedir(), '.adobe-studio-mcp');
  var dir = path.join(base, 'hub', app), IN = path.join(dir, 'in'), OUT = path.join(dir, 'out'), WORK = path.join(dir, 'work');
  function mk(p) { try { fs.mkdirSync(p, { recursive: true }); } catch (e) {} }
  mk(IN); mk(OUT); mk(WORK);
  var HB = path.join(dir, 'heartbeat.json');
  var busy = false, served = 0;

  function otherOwner() {
    // the visible panel only serves when the background bridge is not alive
    if (role === 'bg') return false;
    try { var hb = JSON.parse(fs.readFileSync(HB, 'utf8')); return hb.role === 'bg' && hb.pid !== uid && Date.now() - hb.ts < 3000; } catch (e) { return false; }
  }
  function beat() {
    if (otherOwner()) { st.innerHTML = '<span class="ok">Connected</span> — background bridge active for <code>' + app + '</code> (' + env.appVersion + ')'; return; }
    try { fs.writeFileSync(HB, JSON.stringify({ ts: Date.now(), pid: uid, role: role, appName: env.appName, appVersion: env.appVersion, hubVersion: '1.0.0', served: served })); } catch (e) {}
    st.innerHTML = '<span class="ok">Serving</span> <code>' + app + '</code> ' + env.appVersion + ' — ' + served + ' calls · role ' + role;
  }
  function next() {
    if (busy || otherOwner()) return;
    var files;
    try { files = fs.readdirSync(IN).filter(function (f) { return /\.json$/.test(f); }).sort(); } catch (e) { return; }
    if (!files.length) return;
    var f = files[0], work = path.join(WORK, f);
    try { fs.renameSync(path.join(IN, f), work); } catch (e) { return; } // someone else claimed it
    var job;
    try { job = JSON.parse(fs.readFileSync(work, 'utf8')); } catch (e) { try { fs.unlinkSync(work); } catch (x) {} return; }
    busy = true;
    var t0 = Date.now();
    var done = function (res) {
      try { fs.writeFileSync(path.join(OUT, job.id + '.tmp'), res == null ? '' : String(res)); fs.renameSync(path.join(OUT, job.id + '.tmp'), path.join(OUT, job.id + '.json')); } catch (e) { log('write failed ' + e); }
      try { fs.unlinkSync(work); } catch (e) {}
      served++; busy = false; log('call ' + job.id.slice(0, 13) + ' ' + (Date.now() - t0) + 'ms');
      setTimeout(next, 0);
    };
    try {
      if (job.op && job.op !== 'eval') done(JSON.stringify(hubOp(job)));
      else cep.evalScript(job.code, done);
    } catch (e) { done(JSON.stringify({ ok: false, error: String(e) })); }
  }
  /* CEP-level operations: talk to other extensions/plugins living in this host */
  var listeners = {}, inbox = [];
  function hubOp(job) {
    var a = job.args || {};
    if (job.op === 'listExtensions') return { ok: true, result: JSON.parse(cep.getExtensions(JSON.stringify(a.ids || [])) || '[]') };
    if (job.op === 'openExtension') { cep.requestOpenExtension(a.id, a.params || ''); return { ok: true, result: 'requested ' + a.id }; }
    if (job.op === 'closeExtension') { if (a.id) { var ev = { type: 'com.adobe.csxs.events.ExtensionClose', scope: 'APPLICATION', appId: env.appName, extensionId: a.id, data: '' }; cep.dispatchEvent(ev); } return { ok: true, result: 'close event sent' }; }
    if (job.op === 'dispatchEvent') { cep.dispatchEvent({ type: a.type, scope: a.scope || 'APPLICATION', appId: env.appName, extensionId: uid, data: typeof a.data === 'string' ? a.data : JSON.stringify(a.data || '') }); return { ok: true, result: 'dispatched ' + a.type }; }
    if (job.op === 'listen') { (a.types || []).forEach(function (t) { if (!listeners[t]) { listeners[t] = true; cep.addEventListener(t, function (e) { inbox.push({ type: t, data: e && e.data, ts: Date.now() }); if (inbox.length > 500) inbox.shift(); }); } }); return { ok: true, result: Object.keys(listeners) }; }
    if (job.op === 'readEvents') { var out = inbox.splice(0, inbox.length); return { ok: true, result: out }; }
    if (job.op === 'hostEnv') return { ok: true, result: env };
    return { ok: false, error: 'unknown hub op ' + job.op };
  }
  // stale work files from a crash
  try { fs.readdirSync(WORK).forEach(function (f) { try { fs.unlinkSync(path.join(WORK, f)); } catch (e) {} }); } catch (e) {}
  beat(); setInterval(beat, 1000);
  setInterval(next, 60);
  try { fs.watch(IN, function () { next(); }); } catch (e) {}
  log('hub ' + role + ' ready for ' + app + ' — ' + dir);
})();
