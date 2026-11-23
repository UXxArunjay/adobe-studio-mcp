// Live test of the Audition (au_*) tools through a real MCP connection. Needs Audition running with the hub.
// node scripts/test-audition.mjs [folder]   (default ~/Documents/AuditionMCPTest)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, existsSync, copyFileSync } from 'node:fs';
const dir = (process.argv[2] || join(homedir(), 'Documents', 'AuditionMCPTest')).replace(/\\/g, '/');
const T = dir + '/T2';
mkdirSync(T, { recursive: true });
const c = new Client({ name: 'au-test', version: '1' });
await c.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))] }));
let pass = 0, fail = 0;
async function call(name, args, check) {
  const t0 = Date.now();
  const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 30 * 60 * 1000 });
  const text = r.content.map((p) => p.text || '').join('\n');
  let ok = !r.isError, data = null;
  try { data = JSON.parse(r.content[0].text); } catch { /* text */ }
  let why = '';
  if (ok && check) { try { const v = check(data, text); if (v !== true && v !== undefined) { ok = false; why = String(v); } } catch (e) { ok = false; why = e.message; } }
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${Date.now() - t0}ms ${why}\n   ${text.replace(/\s+/g, ' ').slice(0, ok ? 260 : 1200)}`);
  return data;
}
const tone = dir + '/tone440.wav', pink = dir + '/pink.wav';
await call('adobe_status', {}, (d) => d.apps.au.transport === 'hub' || 'au not connected');
await call('au_closeDocument', { all: true, mode: 'discard' });
await call('au_newAudioFile', { path: T + '/gen-tone.wav', duration: 3, content: 'tone', frequency: 1000, levelDb: -12, bitDepth: '24' }, (d) => d.opened && d.opened.duration === 3 || 'bad duration');
await call('au_newAudioFile', { path: T + '/gen-noise51.wav', duration: 2, content: 'pinkNoise', channels: '5.1', open: false }, (d) => d.channels === 6 || 'not 6ch');
await call('au_newSession', { path: T + '/s.sesx', overwrite: true, tracks: [{ name: 'VO', files: [tone, tone], time: 0.5 }, { name: 'Music', files: [pink] }, { name: 'Bus A', kind: 'bus' }] }, (d) => d.placed.length === 2 || 'clips not placed');
await call('au_tracks', { action: 'add', names: ['FX 1', 'FX 2'], channels: 'mono' }, (d) => d.added.length === 2 || 'no add');
await call('au_tracks', { action: 'mute', tracks: ['FX 1'] }, (d) => d.now.find((t) => t.name === 'FX 1').mute === true || 'not muted');
await call('au_tracks', { action: 'rename', tracks: ['FX 2'], name: 'Foley' });
await call('au_tracks', { action: 'remove', tracks: ['FX 1'] }, (d) => !d.now.find((t) => t.name === 'FX 1') || 'not removed');
await call('au_clips', { action: 'list' }, (d) => d.find((t) => t.track === 'VO').clips.length === 2 || 'expected 2 VO clips');
await call('au_clips', { action: 'move', track: 'VO', clip: 2, time: 10 }, (d) => d.clips[0].start === 10 || 'not moved');
await call('au_clips', { action: 'move', track: 'VO', clip: 2, toTrack: 'Foley' }, (d) => d.clips[0].track === 'Foley' || 'not moved across');
await call('au_clips', { action: 'add', track: 'Foley', files: [pink], time: 20 }, (d) => d.added[0].start === 20 || 'bad start');
await call('au_clips', { action: 'select', track: 'Music', clip: 1 });
await call('au_clips', { action: 'clearSelection' });
await call('au_markers', { action: 'add', markers: [{ time: 1, name: 'Intro' }, { time: 3, duration: 2, name: 'Chorus', type: 'cue', description: 'range' }] }, (d) => d.added === 2 || 'markers');
await call('au_markers', { action: 'exportCsv', path: T + '/markers.csv' }, (d) => d.count >= 2 || 'csv');
await call('au_transport', { action: 'seek', time: 4.5 }, (d) => Math.abs(d.playhead - 4.5) < 0.01 || 'seek');
await call('au_transport', { action: 'status' });
await call('au_panner', { mode: 'minusXdbCenter', centerGain: -3 });
await call('au_preferences', { action: 'get', key: 'nonexistent.test.key', type: 'number' });
await call('au_command', { action: 'list', filter: 'mixdown' }, (d) => d.count > 3 || 'commands');
await call('au_command', { action: 'status', command: 'Multitrack.MixdownAllToNewFile' }, (d) => d.enabled === true || 'disabled');
await call('au_dictionary', { class: 'TickTime' }, (d) => d.staticMethods.length > 3 || 'dict');
await call('au_effects', { action: 'list', query: 'pro-' }, (d) => d.length >= 1 || 'no plugins');
await call('au_effects', { action: 'info', effect: 'Parametric Equalizer' }, (d) => d.params.length > 20 || 'params');
await call('au_effects', { action: 'info', effect: 'Single-band Compressor', discover: true }, (d) => d.loaded === true || 'plugin not loaded');
await call('au_effects', { action: 'racks', query: 'arunjay' }, (d) => d.length >= 1 || 'no user racks');
await call('au_mix', { ops: [
  { op: 'setTrack', track: 'Music', volumeDb: -14, output: 'Bus A' },
  { op: 'applyRackPreset', track: 'VO', rackPreset: 'Podcast Voice' },
  { op: 'addEffect', track: 'Bus A', effect: 'Studio Reverb' },
  { op: 'setEffect', track: 'Bus A', slot: 1, params: { Decay: 0.3 } },
  { op: 'setClip', track: 'VO', clip: 1, fadeIn: { duration: 0.3, type: 'linear' }, fadeOut: { duration: 0.5 }, gainDb: 2 },
  { op: 'volumeAutomation', track: 'Music', points: [{ time: 0, value: -6 }, { time: 1, value: -20 }, { time: 4, value: -6 }] },
  { op: 'panAutomation', track: 'VO', points: [{ time: 0, value: -50 }, { time: 3, value: 50 }] },
  { op: 'duplicateClip', track: 'Music', clip: 1, at: 6 },
  { op: 'setSession', selectionStart: 0, selectionEnd: 3 },
] }, (d) => d.results.length === 9 || 'ops');
await call('au_sessionInfo', { track: 'VO' }, (d) => d.tracks[0].effects.length === 5 && d.tracks[0].clips[0].fadeIn.type === 'log' || 'VO state');
await call('au_mixdown', { path: T + '/mix-yt.mp3', mp3Kbps: 320, loudness: { targetLufs: -14, truePeak: -1 } }, (d) => Math.abs(d.after.integratedLufs + 14) < 1 || 'lufs ' + JSON.stringify(d.after));
await call('au_mixdown', { path: T + '/mix-sel.wav', what: 'selection', bitDepth: 24 }, (d) => d.bytes > 100000 || 'sel');
await call('au_mixdown', { path: T + '/mix-range.flac', range: { start: 1, end: 3 } }, (d) => d.bytes > 10000 || 'range');
await call('au_exportSession', { kind: 'session', path: T + '/export/s-copy.sesx', copyMedia: true });
await call('au_saveDocument', {});
await call('au_processFile', { inputs: [tone], output: T + '/tone-vocalchain.wav', rackPreset: 'Arunjay Vocal DOCUM', bitDepth: 24 }, (d) => d[0].bytes > 100000 || 'proc');
await call('au_processFile', { inputs: [pink], outputDir: T, suffix: '_verb', effects: [{ effect: 'Studio Reverb' }], tailSec: 2, format: 'mp3' }, (d) => d[0].bytes > 10000 || 'proc2');
const w = T + '/fav-test.wav'; if (!existsSync(w)) copyFileSync(pink, w);
await call('au_favorites', { action: 'list' }, (d) => d.length > 5 || 'favs');
await call('au_favorites', { action: 'apply', name: 'Normalize to -3 dB', path: w, save: true }, (d) => !!d.saved || 'not saved');
await call('au_loudness', { action: 'analyze', path: w }, (d) => d.truePeakDbtp > -4 && d.truePeakDbtp < -1 || 'normalize -3 not applied ' + d.truePeakDbtp);
await call('au_saveDocument', { document: 'fav-test', path: T + '/fav-test-48k-mono.mp3', asCopy: true, mp3Kbps: 192, channels: 'mono' }, (d) => d.bytes > 1000 || 'export');
await call('au_loudness', { action: 'normalize', path: tone, output: T + '/tone-16lufs.wav', targetLufs: -16 }, (d) => Math.abs(d.after.integratedLufs + 16) < 1 || 'norm');
await call('au_mix', { path: T + '/s.sesx', ops: [{ op: 'setTrack', track: 1, name: 'VO' }] });
await call('adobe_runScript', { app: 'au', code: 'return app.documents.length;' });
await call('au_closeDocument', { all: true, mode: 'discard' });
console.log(`\n${pass} passed, ${fail} failed`);
await c.close(); process.exit(fail ? 1 : 0);
