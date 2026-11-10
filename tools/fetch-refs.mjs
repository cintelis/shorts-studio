// Downloads reference videos and pulls still frames from them, for modelling a look
// (a car, a place, a style). Frames are private references: never publish the footage.
//
//   node tools/fetch-refs.mjs <refs-dir>
//
// Reads <refs-dir>/refs.json:
//   {
//     "every": 2,                       // default: one frame every N seconds (optional)
//     "videos": [
//       { "prefix": "petersen", "url": "https://youtube.com/shorts/pCFX7kFUy28",
//         "channel": "Pushing Pistons", "group": "real",
//         "times": [20.5, 21.5] },      // exact seconds; or "every": 1; or neither = top-level every
//       { "prefix": "axeno", "url": "...", "group": "fan-cgi" }
//     ]
//   }
//
// Writes:
//   source/<video-id>.mp4               the download (skipped if already there)
//   frames/<group>/<prefix>-020.5s.jpg  the frames (skipped if already there)
//   sheets/<prefix>.jpg                 a contact sheet of each video's frames
//   SOURCES.md                          where every frame came from
//
// Needs yt-dlp (python -m yt_dlp) and ffmpeg on PATH.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || '.');
const spec = JSON.parse(readFileSync(path.join(dir, 'refs.json'), 'utf8'));
const defaultEvery = spec.every ?? 2;
for (const sub of ['source', 'frames', 'sheets']) mkdirSync(path.join(dir, sub), { recursive: true });

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ytdlp = (args) => run('python', ['-m', 'yt_dlp', ...args]);

function download(url) {
  const id = ytdlp(['--no-warnings', '--print', 'id', url]);
  const file = path.join(dir, 'source', `${id}.mp4`);
  if (!existsSync(file)) {
    // Best quality up to 1080p, merged to mp4 so ffmpeg seeks it reliably.
    ytdlp(['--no-warnings', '--no-playlist', '-f', 'bv*[height<=1080]+ba/b[height<=1080]/b',
      '--merge-output-format', 'mp4', '-o', file, url]);
  }
  return { id, file };
}

const duration = (file) => Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]));
const stamp = (t) => `${t.toFixed(1).padStart(5, '0')}s`;

const rows = [];
let failed = 0;
for (const v of spec.videos) {
  const group = v.group || 'all';
  try {
    const { id, file } = download(v.url);
    const len = duration(file);
    let times = v.times;
    if (!times) {
      const every = v.every ?? defaultEvery;
      times = [];
      for (let t = 0; t < len - 0.05; t += every) times.push(Math.round(t * 10) / 10);
    }
    times = times.filter((t) => t < len);

    const outDir = path.join(dir, 'frames', group);
    mkdirSync(outDir, { recursive: true });
    let made = 0;
    for (const t of times) {
      const out = path.join(outDir, `${v.prefix}-${stamp(t)}.jpg`);
      if (existsSync(out)) continue;
      run('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', file, '-frames:v', '1', '-q:v', '2', out]);
      made++;
    }

    // Contact sheet: every frame of this video, 5 across, labelled with its time.
    const sheet = path.join(dir, 'sheets', `${v.prefix}.jpg`);
    const frames = readdirSync(outDir).filter((f) => f.startsWith(`${v.prefix}-`) && f.endsWith('.jpg')).sort();
    if (frames.length) {
      const cols = Math.min(5, frames.length);
      const rowsN = Math.ceil(frames.length / cols);
      // A concat list rather than a glob: Windows ffmpeg builds have no glob support.
      const list = path.join(dir, 'sheets', `${v.prefix}.txt`);
      writeFileSync(list, frames.map((f) => `file '${path.join(outDir, f).replace(/\\/g, '/')}'`).join('\n') + '\n');
      run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list,
        '-vf', `scale=320:-2,tile=${cols}x${rowsN}:padding=4:color=black`, '-frames:v', '1', sheet]);
    }

    rows.push({ ...v, id, group, count: times.length });
    console.log(`ok    ${v.prefix} (${id}) ${len.toFixed(1)} s, ${made} new of ${times.length} frames -> frames/${group}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${v.prefix} ${v.url}\n      ${String(err.stderr || err.message).split('\n').filter(Boolean).slice(-2).join(' | ')}`);
  }
}

// SOURCES.md: credit and provenance for every frame set.
const groups = [...new Set(rows.map((r) => r.group))];
let md = `# Reference frames\n\nFrames pulled from public videos for private modelling reference only.\nThey are NOT used in any published video. The footage belongs to the channels below.\n`;
for (const g of groups) {
  md += `\n## ${g}\n| File prefix | Video | Channel | Frames |\n|---|---|---|---|\n`;
  for (const r of rows.filter((x) => x.group === g)) md += `| ${r.prefix}-* | ${r.url} | ${r.channel || ''} | ${r.count} |\n`;
}
if (rows.length) writeFileSync(path.join(dir, 'SOURCES.md'), md);

console.log(failed ? `${failed} video(s) failed` : 'done');
process.exit(failed ? 1 : 0);
