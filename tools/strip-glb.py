# Strip textures/images from a .glb and compact its binary buffer (geometry + materials only).
#   python strip-glb.py in.glb out.glb
import json, struct, sys

src, dst = sys.argv[1], sys.argv[2]
data = open(src, 'rb').read()
jl = struct.unpack('<I', data[12:16])[0]
j = json.loads(data[20:20 + jl])
binoff = 20 + jl
bl = struct.unpack('<I', data[binoff:binoff + 4])[0]
blob = data[binoff + 8:binoff + 8 + bl]

for m in j.get('materials', []):
    pbr = m.get('pbrMetallicRoughness', {})
    for k in ('baseColorTexture', 'metallicRoughnessTexture'): pbr.pop(k, None)
    for k in ('normalTexture', 'occlusionTexture', 'emissiveTexture'): m.pop(k, None)
    m.pop('extensions', None)
for k in ('images', 'textures', 'samplers'): j.pop(k, None)
j.pop('extensionsUsed', None); j.pop('extensionsRequired', None)

used = sorted({a['bufferView'] for a in j['accessors'] if 'bufferView' in a})
new = bytearray(); remap = {}
views = []
for i in used:
    v = dict(j['bufferViews'][i]); off = v.get('byteOffset', 0)
    while len(new) % 4: new.append(0)
    chunk = blob[off:off + v['byteLength']]
    v['byteOffset'] = len(new); v['buffer'] = 0
    remap[i] = len(views); views.append(v); new += chunk
for a in j['accessors']:
    if 'bufferView' in a: a['bufferView'] = remap[a['bufferView']]
j['bufferViews'] = views
while len(new) % 4: new.append(0)
j['buffers'] = [{'byteLength': len(new)}]
js = json.dumps(j, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(new)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(new), 0x004E4942) + bytes(new)
open(dst, 'wb').write(out)
print(src, '->', dst, round(len(data) / 1e6, 1), '->', round(len(out) / 1e6, 2), 'MB')
