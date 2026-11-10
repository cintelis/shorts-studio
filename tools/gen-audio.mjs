import { elevenKey } from './eleven-key.mjs';
// Generates music and sound effects with ElevenLabs for a video project.
//   node tools/gen-audio.mjs <project-dir>
// Reads <project-dir>/audio.json:
//   { "music": [{ "file", "plan" | "prompt", "length_ms" }], "sfx": [{ "file", "text", "seconds", "influence", "loop" }] }
// The API key comes from tools/eleven-key.mjs (env var or repo-root .env) and is never printed.
// Existing files are skipped, so re-running only fills in what's missing.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const projectDir = path.resolve(process.argv[2] || '.');
const key = elevenKey();

const spec = JSON.parse(readFileSync(path.join(projectDir, 'audio.json'), 'utf8'));
const outDir = path.join(projectDir, 'assets', 'audio');
mkdirSync(outDir, { recursive: true });

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

let failed = 0;
for (const m of spec.music || []) {
  const out = path.join(outDir, m.file);
  if (existsSync(out)) { console.log(`skip  ${m.file} (exists)`); continue; }
  try {
    const body = m.plan
      ? { composition_plan: m.plan, model_id: 'music_v1' }
      : { prompt: m.prompt, music_length_ms: m.length_ms, model_id: 'music_v1', force_instrumental: true };
    const buf = await post('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192', body);
    writeFileSync(out, buf);
    console.log(`music ${m.file} ${(buf.length / 1024).toFixed(0)} KB`);
  } catch (e) { failed++; console.error(`FAIL  ${m.file}: ${e.message.slice(0, 400)}`); }
}
for (const s of spec.sfx || []) {
  const out = path.join(outDir, s.file);
  if (existsSync(out)) { console.log(`skip  ${s.file} (exists)`); continue; }
  try {
    const buf = await post('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_192', {
      text: s.text,
      duration_seconds: s.seconds,
      prompt_influence: s.influence ?? 0.5,
      loop: !!s.loop,
      model_id: 'eleven_text_to_sound_v2',
    });
    writeFileSync(out, buf);
    console.log(`sfx   ${s.file} ${(buf.length / 1024).toFixed(0)} KB`);
  } catch (e) { failed++; console.error(`FAIL  ${s.file}: ${e.message.slice(0, 400)}`); }
}
process.exit(failed ? 1 : 0);
