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
