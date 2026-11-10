import { elevenKey } from './eleven-key.mjs';
// ElevenLabs voiceover with character timestamps -> voice.mp3, voice-alignment.json, words.json ([word, start, end] in seconds)
//   node tools/gen-voice.mjs <project-dir> [voiceId]
// Reads <project-dir>/voice-script.txt. The API key comes from tools/eleven-key.mjs (env var or repo-root .env) and is never printed.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || '.');
const voiceId = process.argv[3] || 'pNInz6obpgDQGcFmaJgB';   // "Adam"
const key = elevenKey();
const text = readFileSync(path.join(dir, 'voice-script.txt'), 'utf8').replace(/\s+/g, ' ').trim();
const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_192`, {
  method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
  body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true, speed: Number(process.env.VOICE_SPEED || 1.0) } }),
});
if (!res.ok) { console.error('FAIL', res.status, (await res.text()).slice(0, 400)); process.exit(1); }
const j = await res.json();
const out = path.join(dir, 'assets', 'voice'); mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'voice.mp3'), Buffer.from(j.audio_base64, 'base64'));
const al = j.alignment;
writeFileSync(path.join(out, 'voice-alignment.json'), JSON.stringify({ text, ...al }));
// group characters into words
const words = []; let cur = '', st = null, en = 0;
al.characters.forEach((c, i) => {
  if (/\s/.test(c)) { if (cur) words.push([cur, st, en]); cur = ''; st = null; return; }
  if (st === null) st = al.character_start_times_seconds[i];
  cur += c; en = al.character_end_times_seconds[i];
});
if (cur) words.push([cur, st, en]);
writeFileSync(path.join(out, 'words.json'), JSON.stringify(words.map(([w, s, e]) => [w, +s.toFixed(3), +e.toFixed(3)])));
console.log('words', words.length, 'duration', en.toFixed(2));
