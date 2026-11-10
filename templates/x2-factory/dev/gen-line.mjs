import { elevenKey } from '../../../tools/eleven-key.mjs';
// node dev/gen-line.mjs "<text>" out.mp3 "<previous>" "<next>"  -> one line in the same Adam voice + word timings
import { readFileSync, writeFileSync } from 'node:fs';
const [text, out, prev, next] = process.argv.slice(2);
const key = elevenKey();
const res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/pNInz6obpgDQGcFmaJgB/with-timestamps?output_format=mp3_44100_192', {
  method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
  body: JSON.stringify({ text, previous_text: prev, next_text: next, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true, speed: 1.0 } }) });
if (!res.ok) { console.error('FAIL', res.status, (await res.text()).slice(0, 300)); process.exit(1); }
const j = await res.json(); writeFileSync(out, Buffer.from(j.audio_base64, 'base64'));
const al = j.alignment, words = []; let cur = '', st = null, en = 0;
al.characters.forEach((c, i) => { if (/\s/.test(c)) { if (cur) words.push([cur, st, en]); cur = ''; st = null; return; } if (st === null) st = al.character_start_times_seconds[i]; cur += c; en = al.character_end_times_seconds[i]; });
if (cur) words.push([cur, st, en]);
writeFileSync(out.replace(/\.mp3$/, '.json'), JSON.stringify(words.map(([w, s, e]) => [w, +s.toFixed(3), +e.toFixed(3)])));
console.log(JSON.stringify(words.map(([w, s, e]) => [w, +s.toFixed(3), +e.toFixed(3)])));
