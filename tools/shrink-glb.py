# Downscale/re-encode the embedded images of a .glb (geometry untouched) and optionally clean textures.
#   python shrink-glb.py in.glb out.glb [maxsize=2048] [--clean-red-text <materialName>...]
import json, struct, sys, io
from PIL import Image
import numpy as np
src, dst = sys.argv[1], sys.argv[2]
maxs = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3].isdigit() else 2048
clean = sys.argv[sys.argv.index('--clean-red-text') + 1:] if '--clean-red-text' in sys.argv else []
data = open(src, 'rb').read()
jl = struct.unpack('<I', data[12:16])[0]; j = json.loads(data[20:20 + jl])
bo = 20 + jl; bl = struct.unpack('<I', data[bo:bo + 4])[0]; blob = data[bo + 8:bo + 8 + bl]
img_mats = {}
for m in j.get('materials', []):
    for t in [m.get('pbrMetallicRoughness', {}).get('baseColorTexture')]:
        if t: img_mats.setdefault(j['textures'][t['index']]['source'], []).append(m['name'])
newimg = {}
for i, im in enumerate(j.get('images', [])):
    v = j['bufferViews'][im['bufferView']]; off = v.get('byteOffset', 0)
    I = Image.open(io.BytesIO(blob[off:off + v['byteLength']]))
    if I.mode == 'P': I = I.convert('RGBA')
    has_a = I.mode in ('RGBA', 'LA') and np.asarray(I.getchannel('A')).min() < 250
    if max(I.size) > maxs:
        s = maxs / max(I.size); I = I.resize((max(1, round(I.width * s)), max(1, round(I.height * s))), Image.LANCZOS)
    if any(n in clean for n in img_mats.get(i, [])):
        a = np.asarray(I.convert('RGBA')).astype(np.int16).copy()
        red = (a[..., 0] - np.maximum(a[..., 1], a[..., 2]) > 45) | ((a[..., 0] > 150) & (a[..., 1] > 150) & (a[..., 2] > 150))
        base = np.median(a[~red][:, :3], axis=0) if (~red).any() else np.array([30, 30, 30])
        a[red, :3] = base; I = Image.fromarray(a.clip(0, 255).astype(np.uint8), 'RGBA')
        print('cleaned text on', img_mats[i])
    buf = io.BytesIO()
    if has_a: I.convert('RGBA').save(buf, 'PNG', optimize=True); mt = 'image/png'
    else: I.convert('RGB').save(buf, 'JPEG', quality=90); mt = 'image/jpeg'
    newimg[im['bufferView']] = (buf.getvalue(), mt); im['mimeType'] = mt
new = bytearray(); views = []
for i, v in enumerate(j['bufferViews']):
    v = dict(v); off = v.get('byteOffset', 0)
    chunk = newimg[i][0] if i in newimg else blob[off:off + v['byteLength']]
    while len(new) % 4: new.append(0)
    v['byteOffset'] = len(new); v['byteLength'] = len(chunk); v['buffer'] = 0
    views.append(v); new += chunk
j['bufferViews'] = views
while len(new) % 4: new.append(0)
j['buffers'] = [{'byteLength': len(new)}]
js = json.dumps(j, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(new)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(new), 0x004E4942) + bytes(new)
open(dst, 'wb').write(out); print(src, '->', dst, round(len(data) / 1e6, 1), '->', round(len(out) / 1e6, 1), 'MB')
