/** Media acquisition: YouTube / 1000+ sites via yt-dlp (+ffmpeg), Pixabay API (photos, illustrations, vectors, videos), and one-call import into AE / Premiere / Photoshop / Illustrator. */
import { z } from 'zod';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { rmSync, existsSync, mkdirSync, createWriteStream, readFileSync, writeFileSync, chmodSync, readdirSync, renameSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { tool } from './define.js';
import { IS_WIN, IS_MAC, RUNTIME_DIR } from '../config.js';
import { readConfig, mediaDir } from '../store.js';

const exec = promisify(execFile);
const BIN = join(RUNTIME_DIR, 'bin');
const EXE = IS_WIN ? '.exe' : '';

async function download(url: string, dest: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'adobe-studio-mcp', ...headers } });
  if (!res.ok || !res.body) throw new Error(`Download failed ${res.status} ${res.statusText}: ${url}`);
  const tmp = dest + '.part';
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(tmp));
  renameSync(tmp, dest);
  return dest;
}

async function which(cmd: string): Promise<string | null> {
  try { const { stdout } = await exec(IS_WIN ? 'where' : 'which', [cmd], { windowsHide: true }); return stdout.split(/\r?\n/)[0].trim() || null; } catch { return null; }
}

/** yt-dlp: the most capable, actively maintained downloader (github.com/yt-dlp/yt-dlp). Auto-installed to ~/.adobe-studio-mcp/bin. */
export async function ensureYtDlp(): Promise<string> {
  const local = join(BIN, 'yt-dlp' + EXE);
  if (existsSync(local)) return local;
  const sys = await which('yt-dlp');
  if (sys) return sys;
  mkdirSync(BIN, { recursive: true });
  const asset = IS_WIN ? 'yt-dlp.exe' : IS_MAC ? 'yt-dlp_macos' : 'yt-dlp';
  await download(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`, local);
  if (!IS_WIN) chmodSync(local, 0o755);
  return local;
}

/** ffmpeg (merging, mp3/wav conversion, H.264 transcodes). Uses PATH, else downloads yt-dlp/FFmpeg-Builds (Windows). */
export async function ensureFfmpeg(): Promise<string> {
  const local = join(BIN, 'ffmpeg' + EXE);
  if (existsSync(local)) return local;
  const sys = await which('ffmpeg');
  if (sys) return sys;
  if (!IS_WIN) throw new Error('ffmpeg not found — install it (brew install ffmpeg / apt install ffmpeg).');
  mkdirSync(BIN, { recursive: true });
  const zip = join(BIN, 'ffmpeg.zip');
  await download('https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip', zip);
  const out = join(BIN, 'ffmpeg-x');
  await exec('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${out}' -Force`], { windowsHide: true, timeout: 600000 });
  const sub = readdirSync(out).find((d) => d.startsWith('ffmpeg'))!;
  for (const f of ['ffmpeg.exe', 'ffprobe.exe']) renameSync(join(out, sub, 'bin', f), join(BIN, f));
  rmSync(out, { recursive: true, force: true }); rmSync(zip, { force: true });
  return local;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let out = '', err = '';
    const t = setTimeout(() => p.kill(), timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; if (err.length > 200000) err = err.slice(-100000); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? -1, out, err }); });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: String(e) }); });
  });
}

const VIDEO = ['mp4', 'mov', 'mkv', 'webm'];
const AUDIO = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'opus', 'ogg'];

async function probeCodec(file: string): Promise<string> {
  const probe = join(BIN, 'ffprobe' + EXE);
  const cmd = existsSync(probe) ? probe : (await which('ffprobe')) || 'ffprobe';
  try { const { stdout } = await exec(cmd, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file], { windowsHide: true }); return stdout.trim(); } catch { return ''; }
}

tool({ name: 'media_youtubeDownload', toolset: 'xapp',
  description: 'Download video or audio from YouTube (videos, Shorts, playlists) — and 1000+ other sites — with yt-dlp. Formats: mp4 (default, edit-friendly H.264+AAC for AE/Premiere), mov, mkv, webm, mp3, wav, m4a, aac, flac, opus, ogg. quality: best|2160|1440|1080|720|480|360. Clip only a section with start/end. Subtitles (.srt), thumbnail, playlist. Optionally import straight into an Adobe app. Only download content you own or have permission/licence to use.',
  input: { url: z.string(), format: z.enum(['mp4', 'mov', 'mkv', 'webm', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'opus', 'ogg']).optional(), quality: z.string().optional(),
    start: z.union([z.number(), z.string()]).optional().describe('section start (s or HH:MM:SS)'), end: z.union([z.number(), z.string()]).optional(), outputDir: z.string().optional(), filename: z.string().optional().describe('yt-dlp template, default "%(title).80B [%(id)s].%(ext)s"'),
    playlist: z.boolean().optional(), maxItems: z.number().int().optional(), subtitles: z.array(z.string()).optional().describe('languages e.g. ["en","hi"]; "auto" adds auto-captions'), thumbnail: z.boolean().optional(),
    editFriendly: z.boolean().optional().describe('default true: make sure video is H.264 (transcodes VP9/AV1 with ffmpeg) so AE/Premiere import it'), cookiesFromBrowser: z.enum(['chrome', 'edge', 'firefox', 'brave', 'opera']).optional(),
    importTo: z.object({ app: z.enum(['ae', 'pr', 'ps', 'ai']), compositionName: z.string().optional(), addToComp: z.boolean().optional(), sequence: z.string().optional(), track: z.string().optional(), time: z.number().optional(), bin: z.string().optional() }).optional() },
  handler: async (a, ctx) => {
    const ytdlp = await ensureYtDlp();
    const ffmpeg = await ensureFfmpeg();
    const fmt = a.format || 'mp4';
    const dir = a.outputDir || mediaDir('youtube');
    mkdirSync(dir, { recursive: true });
    const q = a.quality && a.quality !== 'best' ? Number(String(a.quality).replace(/p$/i, '')) : 0;
    const args = ['--ffmpeg-location', ffmpeg, '-P', dir, '-o', a.filename || '%(title).80B [%(id)s].%(ext)s', '--windows-filenames', '--no-mtime', '--newline', '--print', 'after_move:filepath', '--no-simulate', '--no-progress'];
    args.push(a.playlist ? '--yes-playlist' : '--no-playlist');
    if (a.maxItems) args.push('--playlist-items', `1:${a.maxItems}`);
    if (VIDEO.includes(fmt)) {
      const h = q ? `[height<=${q}]` : '';
      args.push('-f', `bv*${h}+ba/b${h}`, '-S', `res${q ? ':' + q : ''},vcodec:h264,acodec:m4a`, '--merge-output-format', fmt === 'webm' ? 'webm' : fmt);
    } else {
      args.push('-f', 'ba/b', '-x', '--audio-format', fmt === 'ogg' ? 'vorbis' : fmt, '--audio-quality', '0');
    }
    if (a.start !== undefined || a.end !== undefined) args.push('--download-sections', `*${a.start ?? 0}-${a.end ?? 'inf'}`, '--force-keyframes-at-cuts');
    if (a.subtitles?.length) { args.push('--write-subs', '--sub-langs', a.subtitles.filter((s: string) => s !== 'auto').join(',') || 'en', '--convert-subs', 'srt'); if (a.subtitles.includes('auto')) args.push('--write-auto-subs'); }
    if (a.thumbnail) args.push('--write-thumbnail', '--convert-thumbnails', 'jpg');
    if (a.cookiesFromBrowser) args.push('--cookies-from-browser', a.cookiesFromBrowser);
    const extra = readConfig().ytdlpArgs; if (extra) args.push(...extra.split(' ').filter(Boolean));
    args.push(a.url);
    const r = await run(ytdlp, args, 3 * 3600 * 1000);
    let files = r.out.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && existsSync(s));
    if (!files.length) throw new Error('yt-dlp failed: ' + r.err.split(/\r?\n/).filter((l) => /ERROR|WARNING/.test(l)).slice(-6).join(' | ') + ' (try: media_tools {action:"update"})');
    const transcoded: string[] = [];
    if (VIDEO.includes(fmt) && fmt !== 'webm' && a.editFriendly !== false) {
      for (let i = 0; i < files.length; i++) {
        const codec = await probeCodec(files[i]);
        if (codec && codec !== 'h264') {
          const out = files[i].replace(/\.[^.]+$/, '') + ' (H264).' + (fmt === 'mov' ? 'mov' : 'mp4');
          const t = await run(ffmpeg, ['-y', '-i', files[i], '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart', out], 6 * 3600 * 1000);
          if (t.code === 0 && existsSync(out)) { transcoded.push(`${basename(files[i])}: ${codec} → h264`); files[i] = out; }
        }
      }
    }
    const extras = readdirSync(dir).filter((n) => /\.(srt|jpg)$/i.test(n)).map((n) => join(dir, n)).filter((f) => files.some((v) => basename(f).startsWith(basename(v).replace(/( \(H264\))?\.[^.]+$/, '').slice(0, 40))));
    const res: any = { files, extras, transcoded, folder: dir };
    if (a.importTo) res.imported = await ctx.call('media_import', { paths: files, ...a.importTo });
    return res;
  } });

tool({ name: 'media_info', toolset: 'xapp', readOnly: true,
  description: 'Inspect a YouTube (or other) URL without downloading — title, channel, duration, available resolutions/formats, chapters, subtitles, playlist entries.',
  input: { url: z.string(), playlist: z.boolean().optional() },
  handler: async (a) => {
    const ytdlp = await ensureYtDlp();
    const r = await run(ytdlp, ['-J', a.playlist ? '--flat-playlist' : '--no-playlist', a.url], 300000);
    if (r.code !== 0) throw new Error('yt-dlp: ' + r.err.slice(-600));
    const j = JSON.parse(r.out);
    if (j._type === 'playlist') return { playlist: j.title, count: j.entries?.length, entries: (j.entries || []).slice(0, 200).map((e: any) => ({ title: e.title, url: e.url, duration: e.duration })) };
    const heights = [...new Set((j.formats || []).filter((f: any) => f.height).map((f: any) => f.height))].sort((x: any, y: any) => y - x);
    return { title: j.title, channel: j.channel || j.uploader, duration: j.duration, uploadDate: j.upload_date, heights, fps: j.fps, chapters: j.chapters, subtitles: Object.keys(j.subtitles || {}), autoCaptions: Object.keys(j.automatic_captions || {}).slice(0, 30), license: j.license, thumbnail: j.thumbnail };
  } });

tool({ name: 'media_tools', toolset: 'xapp',
  description: 'Manage the media helper tools: status (yt-dlp/ffmpeg paths & versions), install, update (yt-dlp -U — fixes most YouTube errors), or convert a local file with ffmpeg (to mp4 H.264 / mov ProRes / mp3 / wav / gif / extract audio).',
  input: { action: z.enum(['status', 'install', 'update', 'convert']), input: z.string().optional(), to: z.enum(['mp4', 'prores', 'mp3', 'wav', 'gif', 'm4a']).optional(), output: z.string().optional() },
  handler: async (a) => {
    if (a.action === 'install' || a.action === 'status') {
      const y = a.action === 'install' ? await ensureYtDlp() : (existsSync(join(BIN, 'yt-dlp' + EXE)) ? join(BIN, 'yt-dlp' + EXE) : await which('yt-dlp'));
      const f = a.action === 'install' ? await ensureFfmpeg() : (existsSync(join(BIN, 'ffmpeg' + EXE)) ? join(BIN, 'ffmpeg' + EXE) : await which('ffmpeg'));
      const yv = y ? (await run(y, ['--version'], 30000)).out.trim() : null;
      return { ytdlp: y, ytdlpVersion: yv, ffmpeg: f };
    }
    if (a.action === 'update') { const y = await ensureYtDlp(); const r = await run(y, ['-U'], 300000); return { output: (r.out + r.err).trim().slice(-800) }; }
    if (!a.input || !existsSync(a.input)) throw new Error('input file not found');
    const ff = await ensureFfmpeg(); const to = a.to || 'mp4';
    const ext = { mp4: 'mp4', prores: 'mov', mp3: 'mp3', wav: 'wav', gif: 'gif', m4a: 'm4a' }[to as string]!;
    const out = a.output || a.input.replace(/\.[^.]+$/, '') + ` (${to}).${ext}`;
    const P: Record<string, string[]> = { mp4: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '320k'], prores: ['-c:v', 'prores_ks', '-profile:v', '3', '-c:a', 'pcm_s16le'],
      mp3: ['-vn', '-c:a', 'libmp3lame', '-q:a', '0'], wav: ['-vn', '-c:a', 'pcm_s24le'], gif: ['-vf', 'fps=15,scale=720:-1:flags=lanczos'], m4a: ['-vn', '-c:a', 'aac', '-b:a', '320k'] };
    const r = await run(ff, ['-y', '-i', a.input, ...P[to], out], 6 * 3600 * 1000);
    if (r.code !== 0) throw new Error('ffmpeg failed: ' + r.err.slice(-600));
    return { output: out };
  } });

/* ---------------- Pixabay ---------------- */
const PB_CACHE = join(RUNTIME_DIR, 'cache', 'pixabay');

async function pixabay(path: '' | 'videos/', params: Record<string, unknown>) {
  const key = readConfig().pixabayKey;
  if (!key) throw new Error('No Pixabay API key. Get a free key at https://pixabay.com/api/docs/ and save it with adobe_config {"set":{"pixabayKey":"..."}} (or env PIXABAY_API_KEY).');
  const qs = new URLSearchParams({ key });
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const url = `https://pixabay.com/api/${path}?${qs}`;
  // Pixabay terms: cache API responses for 24h
  mkdirSync(PB_CACHE, { recursive: true });
  const cf = join(PB_CACHE, createHash('sha1').update(url).digest('hex') + '.json');
  if (existsSync(cf) && Date.now() - statSync(cf).mtimeMs < 24 * 3600 * 1000) return JSON.parse(readFileSync(cf, 'utf8'));
  const res = await fetch(url);
  if (res.status === 429) throw new Error('Pixabay rate limit (100 requests/min) — wait a minute.');
  if (!res.ok) throw new Error(`Pixabay ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  writeFileSync(cf, JSON.stringify(j));
  return j;
}

const zPbType = z.enum(['photo', 'illustration', 'vector', 'image', 'video', 'film', 'animation']).describe('photo/illustration/vector/image(all images) or video/film/animation');

function trimHit(h: any, isVideo: boolean) {
  if (isVideo) return { id: h.id, type: h.type, tags: h.tags, duration: h.duration, page: h.pageURL, user: h.user, sizes: Object.fromEntries(Object.entries(h.videos || {}).map(([k, v]: any) => [k, { w: v.width, h: v.height, mb: +(v.size / 1048576).toFixed(1) }])), thumbnail: h.videos?.medium?.thumbnail || h.videos?.tiny?.thumbnail };
  return { id: h.id, type: h.type, tags: h.tags, page: h.pageURL, user: h.user, width: h.imageWidth, height: h.imageHeight, preview: h.webformatURL, hasVector: !!h.vectorURL, hasFullRes: !!h.imageURL };
}

tool({ name: 'pixabay_search', toolset: 'xapp', readOnly: true,
  description: 'Search Pixabay (free licence stock) through the official developer API — photos, illustrations, vectors, videos (film/animation). Filters: orientation, category, colors, min size, editors choice, order popular|latest, safesearch, page/perPage, lang. Returns ids, tags, sizes, previews. (The public API has no music or sound effects.)',
  input: { query: z.string(), type: zPbType.optional(), orientation: z.enum(['all', 'horizontal', 'vertical']).optional(), category: z.string().optional().describe('backgrounds, fashion, nature, science, education, feelings, health, people, religion, places, animals, industry, computer, food, sports, transportation, travel, buildings, business, music'),
    colors: z.string().optional().describe('comma list: grayscale, transparent, red, orange, yellow, green, turquoise, blue, lilac, pink, white, gray, black, brown'), minWidth: z.number().int().optional(), minHeight: z.number().int().optional(),
    editorsChoice: z.boolean().optional(), order: z.enum(['popular', 'latest']).optional(), safesearch: z.boolean().optional(), page: z.number().int().optional(), perPage: z.number().int().optional(), lang: z.string().optional() },
  handler: async (a) => {
    const t = a.type || 'photo'; const isVideo = ['video', 'film', 'animation'].includes(t);
    const p: Record<string, unknown> = { q: a.query.slice(0, 100), orientation: a.orientation, category: a.category, colors: a.colors, min_width: a.minWidth, min_height: a.minHeight, editors_choice: a.editorsChoice, order: a.order, safesearch: a.safesearch ?? true, page: a.page, per_page: Math.min(200, Math.max(3, a.perPage || 20)), lang: a.lang };
    if (isVideo) p.video_type = t === 'video' ? 'all' : t; else p.image_type = t === 'image' ? 'all' : t;
    const j = await pixabay(isVideo ? 'videos/' : '', p);
    return { total: j.totalHits, results: (j.hits || []).map((h: any) => trimHit(h, isVideo)), attribution: 'Content from Pixabay (pixabay.com) — free under the Pixabay Content License.' };
  } });

tool({ name: 'pixabay_download', toolset: 'xapp',
  description: 'Download Pixabay assets by id (from pixabay_search) to disk — images at the best size your key allows (large 1280px, or full-res / vector SVG/AI with full API access), videos at large (4K/1080p) | medium | small | tiny — then optionally import them into AE / Premiere / Photoshop / Illustrator.',
  input: { ids: z.array(z.number().int()), type: z.enum(['image', 'video']).optional(), size: z.enum(['large', 'medium', 'small', 'tiny', 'full', 'vector', 'web']).optional(), outputDir: z.string().optional(),
    importTo: z.object({ app: z.enum(['ae', 'pr', 'ps', 'ai']), compositionName: z.string().optional(), addToComp: z.boolean().optional(), sequence: z.string().optional(), track: z.string().optional(), time: z.number().optional(), bin: z.string().optional() }).optional() },
  handler: async (a, ctx) => {
    const isVideo = a.type === 'video';
    const dir = a.outputDir || mediaDir(isVideo ? 'pixabay/videos' : 'pixabay/images');
    mkdirSync(dir, { recursive: true });
    const files: string[] = [], info: unknown[] = [];
    for (const id of a.ids) {
      const j = await pixabay(isVideo ? 'videos/' : '', { id });
      const h = j.hits?.[0]; if (!h) { info.push({ id, error: 'not found' }); continue; }
      let url: string; let ext: string;
      if (isVideo) { const pick = a.size && h.videos[a.size]?.url ? a.size : h.videos.large?.url ? 'large' : 'medium'; url = h.videos[pick].url; ext = '.mp4'; }
      else {
        const s = a.size || 'full';
        url = (s === 'vector' && h.vectorURL) || ((s === 'full' || s === 'vector') && (h.imageURL || h.fullHDURL)) || (s === 'web' ? h.webformatURL : h.largeImageURL);
        ext = extname(new URL(url).pathname) || '.jpg';
      }
      const name = `pixabay-${id}-${String(h.tags || '').split(',')[0].trim().replace(/[^\w-]+/g, '_').slice(0, 30)}${ext}`;
      const dest = join(dir, name);
      if (!existsSync(dest)) await download(url, dest);
      files.push(dest); info.push({ id, file: dest, page: h.pageURL, user: h.user });
    }
    const res: any = { files, info, attribution: 'Pixabay Content License — credit appreciated (pixabay.com).' };
    if (a.importTo && files.length) res.imported = await ctx.call('media_import', { paths: files, ...a.importTo });
    return res;
  } });

tool({ name: 'media_import', toolset: 'xapp',
  description: 'Import downloaded/local media into an Adobe app in one call: ae (project + optional add to comp), pr (bin + optional place on track at time, one after another), ps (place as smart objects in the active doc, or open), ai (place into the active doc, or open).',
  input: { paths: z.array(z.string()), app: z.enum(['ae', 'pr', 'ps', 'ai']), compositionName: z.string().optional(), addToComp: z.boolean().optional(), sequence: z.string().optional(), track: z.string().optional(), time: z.number().optional(), bin: z.string().optional() },
  handler: async (a, ctx) => {
    const out: unknown[] = [];
    if (a.app === 'ae') {
      if (a.addToComp) for (const p of a.paths) out.push(await ctx.call('ae_importImage', { path: p, compositionName: a.compositionName, folder: a.bin || 'Downloads' }));
      else out.push(await ctx.call('ae_importFile', { paths: a.paths, folder: a.bin || 'Downloads' }));
    } else if (a.app === 'pr') {
      out.push(await ctx.call('pr_importFiles', { paths: a.paths, bin: a.bin || 'Downloads' }));
      if (a.track) { let t = a.time ?? 0; for (const p of a.paths) { const r: any = await ctx.call('pr_placeClip', { item: basename(p), sequence: a.sequence, track: a.track, time: t }); out.push(r); if (r?.placed?.end) t = r.placed.end; } }
    } else {
      const st: any = await ctx.call(a.app === 'ps' ? 'ps_getState' : 'ai_getState', {});
      const hasDoc = (st.documents || []).length > 0;
      for (const p of a.paths) out.push(hasDoc ? await ctx.call(a.app === 'ps' ? 'ps_placeFile' : 'ai_placeFile', { path: p }) : await ctx.call(a.app === 'ps' ? 'ps_openFile' : 'ai_openFile', { paths: [p] }));
    }
    return out;
  } });
