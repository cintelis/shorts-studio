# Shorts Studio

Templates and tools for the Nick Stein YouTube Shorts: 3D scenes built in code (three.js r184) with real
free 3D models, rendered to vertical video with [HyperFrames](https://hyperframes.heygen.com), with an
ElevenLabs voiceover, music and sound effects.

## Templates

| Folder | What it's good for |
| --- | --- |
| `templates/a380` | A vehicle or machine as the hero: model shots on a runway or in the sky, a to-scale comparison of two models, number and map overlays, word captions, voiceover, music and SFX mix. **Start here for most videos.** |
| `templates/x2-factory` | Several animated robots (URDF humanoids with IK) doing tasks in a scene with props, plus the collision, pose and support **audit** tools (`dev/audit*.mjs`, `lib/audit.js`) that catch floating objects and clipping. |

## Setup on a new machine

1. Install **Node 20+**, **Python 3.11+** (with `pip install pillow`), **ffmpeg** (on PATH) and **Google Chrome**.
2. Clone and install:
   ```bash
   git clone https://github.com/cintelis/shorts-studio.git
   cd shorts-studio
   npm install
   ```
3. Create the API key file: copy `.env.example` to `.env` and set `11LABS_API_KEY=...`.
   `.env` is gitignored, so never commit it. Alternatively, set the `ELEVENLABS_API_KEY` environment variable.
4. If Chrome isn't at `C:/Program Files/Google/Chrome/Application/chrome.exe`, set `CHROME_PATH`.

HyperFrames runs through `npx` at a pinned version (`hyperframes@0.8.226`); nothing to install.

## Making a new video

1. Copy a template: `cp -r templates/a380 templates/my-topic`, and change `meta.json` (id/name).
2. Put your models (GLB/glTF) in `assets/models/`, with a credit line in `CREDITS.md`. Use the tools in
   `tools/shrink-glb.py` and `tools/strip-glb.py` to make heavy models lighter.
3. Write `voice-script.txt`, then generate the voice and word timings:
   `node tools/gen-voice.mjs templates/my-topic`
4. Describe the music and SFX in `audio.json`, then generate them: `node tools/gen-audio.mjs templates/my-topic`
5. Edit the scene in `lib/*.js` and the shot list, captions and audio placement in `build.py`, then run
   `python build.py`. That writes `index.html`.
6. Preview: `npx hyperframes@0.8.226 preview` (inside the template folder).
   For the dev pages and audits, run `npm run serve` from the repo root (port 8765).
7. Render: `npx hyperframes@0.8.226 render --workers 1 -o renders/raw.mp4`
8. Mix and normalise loudness: `python mix.py renders/raw.mp4 ../out/<name>.mp4`
   (target about −14.5 LUFS, with the end card not quieter than the rest).

## Production rules that work

- **Real 3D models only**, free and allowed for commercial use (CC BY, CC0, Sketchfab Free Standard, NASA public domain).
  No NonCommercial/NoDerivs licences and no game rips. Pick topics only where a good model exists.
- **Hook:** action at frame 0, one huge headline, works muted, no "01/04" counters.
- **Look:** Poly Haven HDRI lighting, ACES, GTAO, DOF, bloom, close framing; word-by-word captions
  (Montserrat Black, key word `#C6FF3D`).
- **Voice:** ElevenLabs "Adam" at speed 1.0 (about 145–150 wpm). Trim the script instead of speeding it up. Keep SFX minimal.
- **End card:** one short line plus an unofficial-visualisation note. Full credits go in the YouTube description.
- **Physical correctness:** nothing floats, nothing passes through anything, items rest on visible surfaces,
  nothing overhangs a belt end, parts fed to a machine go inside it, and robot poses look human.
  Run the audit (`templates/x2-factory/dev/audit-all.sh`) and review contact sheets
  (`ffmpeg -i out.mp4 -vf "fps=1,scale=300:533,tile=8x3" sheet%d.jpg`) before calling a video done.
- **Every version gets a new file name** (`-v2`, `-v3`, and so on).
- **YouTube Studio:** title, description (story, unofficial note, full credits, hashtags), about 20 tags,
  category Science & Technology, AI use "No" for code-built videos.

## Tools

| File | What it does |
| --- | --- |
| `tools/gen-voice.mjs` | ElevenLabs voiceover with character timestamps, giving `voice.mp3` and `words.json` |
| `tools/gen-audio.mjs` | ElevenLabs music and SFX from `audio.json` (skips files that already exist) |
| `tools/eleven-key.mjs` | Finds the API key (env var or `.env`) without printing it |
| `tools/shrink-glb.py`, `tools/strip-glb.py` | Make heavy GLB models smaller |
| `tools/fetch-refs.mjs`, `tools/make-banner.py` | Reference images and the channel banner |
