# 3D models (not in the repo)

The model files are too big for GitHub (45–129 MB each), so they aren't committed. Download them from
Sketchfab (free account, "Download 3D Model") and put them here with these exact names. All are
CC BY 4.0, so keep the credits in the video description (see `../../credits.txt`). The files are used unmodified.

| Put it here | Model | Author | Download as | Link |
| --- | --- | --- | --- | --- |
| `girl.glb` | Fantasy Girl | loriserio | GLB | https://sketchfab.com/3d-models/fantasy-girl-1ca6d15fe2f34bd199252bf73d896e13 |
| `castle/scene.gltf` + `castle/scene.bin` + `castle/textures/` | Medieval Pentagon Castle | Sereib | glTF (unzip the folder and rename it `castle`) | https://sketchfab.com/3d-models/medieval-pentagon-castle-aa352f61de1646209a36f634e6b6dc27 |
| `sword.glb` | Stylized Sword | Agata Wilczek | GLB | https://sketchfab.com/3d-models/stylized-sword-28897cc3c47a452ebd5624c758b6dce4 |
| `throne.glb` | Throne Room | Uğur Yakışık | GLB | https://sketchfab.com/3d-models/throne-room-247c37e6a9694ae891398911876f0c14 |

Expected layout:

```
assets/models/
  girl.glb
  sword.glb
  throne.glb
  castle/
    scene.gltf
    scene.bin
    textures/   (89 images)
```

`preview/` holds a few downscaled texture images from each model, so you can see what they look like
without downloading. They aren't used by the scene.

Code-built parts (cobbles, hall entrance wall, torch flames, banner and stand) are in `lib/castle.js`, and
the girl's PBR materials are rebuilt in `lib/girlmat.js`, so nothing else needs downloading. The sky HDRI
(Poly Haven "Belfast Sunset", CC0) and the ElevenLabs audio are in `assets/hdri` and `assets/audio`.

## Re-rendering on another machine (Windows or macOS)

1. From the repo root: `npm install`, then `npm run serve` (serves the repo on port 8765 for the audits).
2. Download the four models above into `assets/models/`.
3. In `templates/castle-run`: `./dev/final.sh` runs the chunked audit, footfalls and footsteps, render and
   loudness mix into `templates/out/79-castle-run-v2.mp4`. Use `SKIP_AUDIT=1 ./dev/final.sh` to skip the audit.
4. Needs Node 20+, Python 3 with Pillow, ffmpeg and Google Chrome. On macOS Chrome is found in
   `/Applications`; elsewhere set `CHROME_PATH`. `timeout` is optional (`brew install coreutils` gives `gtimeout`).
