/** Audition ExtendScript (ES3) helpers. API units: seconds; DOM units: samples (doc.sampleRate). */
export const AU_PRELUDE_BODY = `
function __isMT(d) { try { return d && d.reflect && d.reflect.name === 'MultitrackDocument'; } catch (e) { return false; } }
function __isWave(d) { try { return d && d.reflect && d.reflect.name === 'WaveDocument'; } catch (e) { return false; } }
function __dkind(d) { try { return d.reflect.name === 'MultitrackDocument' ? 'multitrack' : (d.reflect.name === 'WaveDocument' ? 'waveform' : d.reflect.name); } catch (e) { return '?'; } }
function __np(p) { return String(p || '').replace(/\\\\/g, '/').toLowerCase(); }
function __adoc(ref, kind) {
  var d = null, i;
  if (ref !== undefined && ref !== null && ref !== '') {
    for (i = 0; i < app.documents.length; i++) { var x = app.documents[i]; if (x.displayName === ref || x.id === ref || (x.path && __np(x.path) === __np(ref))) { d = x; break; } }
    if (!d) for (i = 0; i < app.documents.length; i++) { var y = app.documents[i]; if (y.displayName.toLowerCase() === String(ref).toLowerCase()) { d = y; break; } }
    if (!d) { var names = []; for (i = 0; i < app.documents.length; i++) names.push(app.documents[i].displayName); throw new Error('Document not open: ' + ref + ' (open: ' + names.join(', ') + ')'); }
  } else {
    d = app.activeDocument;
    if (kind && d && __dkind(d) !== kind) { d = null; for (i = 0; i < app.documents.length; i++) if (__dkind(app.documents[i]) === kind) { d = app.documents[i]; break; } }
    if (!d) throw new Error(kind ? 'No ' + kind + ' document is open. Open one with au_openFile or create one with au_newSession / au_newAudioFile.' : 'No document is open in Audition.');
  }
  if (kind && __dkind(d) !== kind) throw new Error('"' + d.displayName + '" is a ' + __dkind(d) + ' document; this needs a ' + kind + ' document.');
  return d;
}
function __mt(ref) { return __adoc(ref, 'multitrack'); }
function __mtSave(d) { var p = new MultitrackSaveParameter(); p.copyReferencedDocuments = false; return d.saveDocument(p); }
function __discard(d) { try { if (d.dirty) d.dirty = false; } catch (e) {} return d.closeDocument(); }
function __wv(ref) { return __adoc(ref, 'waveform'); }
function __smp(d, sec) { return Math.round(Number(sec || 0) * d.sampleRate); }
function __sec(d, s) { return Math.round(Number(s || 0) / d.sampleRate * 1000000) / 1000000; }
function __tlist(mt, withMix) {
  var o = [], at = mt.audioTracks;
  for (var i = 0; i < at.length; i++) { var t = at[i]; if (!withMix && t.type === AudioTrack.AUDIOTRACKTYPE_MIX) continue; if (!withMix && t.type === AudioTrack.AUDIOTRACKTYPE_MASTER) continue; o.push(t); }
  return o;
}
function __trk(mt, ref) {
  if (ref === undefined || ref === null || ref === '') { var l0 = __tlist(mt, false); for (var s = 0; s < l0.length; s++) if (l0[s].selected) return l0[s]; if (l0.length) return l0[0]; throw new Error('Session has no tracks.'); }
  if (/^(mix|master)$/i.test(String(ref))) return mt.audioTracks.mixTrack;
  var l = __tlist(mt, false);
  if (typeof ref === 'number' || /^\\d+$/.test(String(ref))) { var n = Number(ref); if (n < 1 || n > l.length) throw new Error('Track ' + n + ' does not exist (session has ' + l.length + ' tracks).'); return l[n - 1]; }
  for (var i = 0; i < l.length; i++) if (l[i].name === ref || String(l[i].id) === String(ref).replace(/^id:/i, '')) return l[i];
  for (var j = 0; j < l.length; j++) if (l[j].name.toLowerCase() === String(ref).toLowerCase()) return l[j];
  var names = []; for (var k = 0; k < l.length; k++) names.push(l[k].name);
  throw new Error('Track not found: ' + ref + ' (tracks: ' + names.join(', ') + ')');
}
function __tkind(t) { var y = t.type; return y === AudioTrack.AUDIOTRACKTYPE_BUS ? 'bus' : ((y === AudioTrack.AUDIOTRACKTYPE_MIX || y === AudioTrack.AUDIOTRACKTYPE_MASTER) ? 'mix' : 'audio'); }
function __clist(t) { var o = []; try { var c = t.audioClips; for (var i = 0; i < c.length; i++) o.push(c[i]); } catch (e) {} o.sort(function (a, b) { return a.startTime - b.startTime; }); return o; }
function __clp(mt, t, ref) {
  var cs = __clist(t);
  if (ref && typeof ref === 'object' && ref.at !== undefined) { var s = __smp(mt, ref.at); for (var a = 0; a < cs.length; a++) if (cs[a].startTime <= s && cs[a].startTime + cs[a].duration > s) return cs[a]; throw new Error('No clip at ' + ref.at + 's on ' + t.name); }
  if (typeof ref === 'number' || /^\\d+$/.test(String(ref))) { var n = Number(ref); if (n < 1 || n > cs.length) throw new Error('Clip ' + n + ' not on ' + t.name + ' (' + cs.length + ' clips)'); return cs[n - 1]; }
  for (var i = 0; i < cs.length; i++) if (cs[i].name === ref || cs[i].id === ref) return cs[i];
  throw new Error('Clip not found on ' + t.name + ': ' + ref);
}
function __layout(ch) {
  var L = AudioChannelLayout, k = String(ch || 'stereo').toLowerCase();
  var m = { mono: L.CHANNELLAYOUT_MONO, stereo: L.CHANNELLAYOUT_STEREO, '5.1': L.CHANNELLAYOUT_51, '7.1': L.CHANNELLAYOUT_7_1, quad: L.CHANNELLAYOUT_QUADRAPHONIC };
  if (m[k] === undefined) throw new Error('channels must be mono, stereo, 5.1, 7.1 or quad');
  return L.createCommonAudioChannelLayout(m[k]);
}
function __fmtInfo(af) { try { return { sampleRate: af.sampleRate, bitDepth: af.bitDepth, channels: af.channelLayout.length, layout: af.channelLayout.description }; } catch (e) { return null; } }
function __clipInfo(mt, c, i) {
  var o = { index: i + 1, id: c.id, name: c.name, start: __sec(mt, c.startTime), end: __sec(mt, c.startTime + c.duration), duration: __sec(mt, c.duration), selected: c.selected };
  try { if (c.link && c.link.path) o.file = c.link.path; } catch (e) {}
  return o;
}
function __trackInfo(mt, t, i, deep) {
  var o = { index: i, id: t.id, name: t.name, kind: __tkind(t), mute: t.mute, solo: t.solo, armed: t.armed, selected: t.selected };
  try { o.visible = t.visible; } catch (e) {}
  var f = __fmtInfo(t.audioFormat); if (f) o.channels = f.layout;
  if (o.kind === 'audio') { var cs = __clist(t); o.clipCount = cs.length; if (deep) { o.clips = []; for (var k = 0; k < cs.length; k++) o.clips.push(__clipInfo(mt, cs[k], k)); } }
  return o;
}
function __markers(d) { var o = []; try { var m = d.markers; for (var i = 0; i < m.length; i++) o.push({ name: m[i].name, start: __sec(d, m[i].start), duration: __sec(d, m[i].length), type: m[i].type, description: m[i].description }); } catch (e) {} return o; }
function __docInfo(d, deep) {
  var o = { name: d.displayName, kind: __dkind(d), path: d.path || null, id: d.id };
  try { o.dirty = d.dirty; } catch (e) {}
  try { o.sampleRate = d.sampleRate; o.duration = __sec(d, d.duration); o.playhead = __sec(d, d.playheadPosition); } catch (e2) {}
  if (__isWave(d)) { var f = __fmtInfo(d.audioFormat); if (f) { o.bitDepth = f.bitDepth; o.channels = f.layout; } try { o.fileFormat = d.fileFormat.title; } catch (e3) {} try { o.busy = d.isBusy; } catch (e4) {} }
  if (__isMT(d) && deep) { var tl = __tlist(d, false); o.tracks = []; for (var i = 0; i < tl.length; i++) o.tracks.push(__trackInfo(d, tl[i], i + 1, deep)); try { o.mix = { name: d.audioTracks.mixTrack.name, mute: d.audioTracks.mixTrack.mute, channels: __fmtInfo(d.audioTracks.mixTrack.audioFormat).layout }; } catch (e5) {} try { o.panner = { mode: d.pannerSettings.mode === PannerSettings.MODE_LOGARITHMICCUT ? 'logarithmic' : 'minusXdbCenter', centerGain: d.pannerSettings.gain }; } catch (e6) {} }
  if (deep) o.markers = __markers(d);
  return o;
}
var __FMT = { wav: 'FORMAT_WAVE_PCM', bwf: 'FORMAT_WAVE_PCM', mp3: 'FORMAT_MP3_AUDIO', flac: 'FORMAT_FLAC_FREE_LOSSLESS_AUDIO_CODEC', aif: 'FORMAT_AIFF', aiff: 'FORMAT_AIFF', ogg: 'FORMAT_XIPH_OGG_CONTAINER', aac: 'FORMAT_MPEG_2AAC', m4a: 'FORMAT_MPEG_2AAC', mp2: 'FORMAT_MP2_AUDIO', wma: 'FORMAT_WINDOWS_MEDIA_FOUNDATION_WMA', ape: 'FORMAT_MONKEYS_AUDIO_APE', au: 'FORMAT_LIBSNDFILE_AU' };
function __fileFormat(fmt, kbps) {
  if (!fmt) return null;
  var key = __FMT[String(fmt).toLowerCase().replace('.', '')];
  if (!key) throw new Error('Unsupported format ' + fmt + ' (wav, mp3, flac, aiff, ogg, aac/m4a, mp2, wma, ape, au)');
  var id = AudioFileFormat[key];
  if (kbps && /BitsPerSecond:0:\\d+/.test(id)) id = id.replace(/BitsPerSecond:0:\\d+/, 'BitsPerSecond:0:' + Math.round(kbps * 1000));
  return new AudioFileFormat(id);
}
function __stc(o) {
  if (!o || (!o.sampleRate && !o.bitDepth && !o.channels)) return null;
  var st = new SampleTypeConvertParameters();
  st.sampleRate = o.sampleRate ? Number(o.sampleRate) : st.SOURCE_SAMPLE_RATE;
  st.bitDepth = o.bitDepth ? Number(o.bitDepth) : st.SOURCE_BIT_DEPTH;
  st.channelLayout = o.channels ? __layout(o.channels) : st.SOURCE_CHANNEL_LAYOUT;
  if (o.dither) { st.useDithering = true; st.ditherType = st.DITHERTYPE_TRIANGULAR; }
  return st;
}
`;
