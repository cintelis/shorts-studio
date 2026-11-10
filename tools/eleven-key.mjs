// Finds the ElevenLabs API key without ever printing it.
// Order: ELEVENLABS_API_KEY env var, then 11LABS_API_KEY / ELEVENLABS_API_KEY in the repo-root .env (gitignored).
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function elevenKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const envFile = process.env.ELEVEN_ENV || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, 'utf8').match(/^\s*(?:11LABS_API_KEY|ELEVENLABS_API_KEY)\s*=\s*["']?([^"'\r\n]+)/m);
    if (m) return m[1];
  }
  console.error('No ElevenLabs key: set ELEVENLABS_API_KEY or add 11LABS_API_KEY=... to the repo-root .env');
  process.exit(1);
}
