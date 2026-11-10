# Converts the AgiBot X2 Ultra (omnihand) URDF into assets/models/x2/robot.glb (one mesh per link visual, in link frame,
# decimated) + robot.json (joint tree, visual origins, colours). Colours follow the v1.3.0 URDF scheme.
import xml.etree.ElementTree as ET, json, os, sys
import numpy as np, trimesh, fast_simplification

import os
SRC = os.environ.get('X2_URDF_DIR', '../../models/agibot-x2/X2_URDF-v1.4.0/')  # clone https://github.com/AgibotTech/agibot_x2_urdf
URDF = SRC + 'X2-Ultra_omnihand.urdf'
OUT = 'assets/models/x2/'
NAME = sys.argv[2] if len(sys.argv) > 2 else 'robot'
os.makedirs(OUT, exist_ok=True)
TARGET = int(sys.argv[1]) if len(sys.argv) > 1 else 30000   # max triangles per link mesh

GREY, WHITE, ORANGE, DARK, FACE = 'grey', 'white', 'orange', 'dark', 'face'
def colour(link):
    n = link.lower()
    if 'ankle_roll' in n: return ORANGE
    if n == 'pelvis' or 'hip_pitch' in n or 'ankle_pitch' in n or n.startswith('waist') or 'shoulder_pitch' in n or 'wrist_pitch' in n: return GREY
    if n == 'head_pitch_link': return FACE
    if 'palm' in n or 'thumb_roll' in n or 'abad' in n: return DARK
    if n.startswith(('l_', 'r_')) and ('pip' in n or 'mcp' in n): return DARK
    if 'imu' in n or 'lidar' in n or 'rgb' in n or 'stereo' in n: return DARK
    return WHITE

r = ET.parse(URDF).getroot()
f3 = lambda s, d='0 0 0': [float(x) for x in (s or d).split()]
links, joints, scene, inert = {}, [], trimesh.Scene(), {}
total = 0
for l in r.findall('link'):
    name = l.get('name'); vis = []
    for k, v in enumerate(l.findall('visual')):
        g = v.find('geometry/mesh')
        if g is None: continue
        fn = g.get('filename').replace('./', SRC)
        if 'agibot.stl' in fn: continue      # logo decal
        o = v.find('origin')
        m = trimesh.load(fn, force='mesh')
        if g.get('scale'): m.apply_scale(f3(g.get('scale')))
        m.merge_vertices()
        nf = len(m.faces)
        if nf > TARGET:
            red = 1 - TARGET / nf
            vv, ff = fast_simplification.simplify(m.vertices.astype(np.float32), m.faces.astype(np.int32), target_reduction=red)
            m = trimesh.Trimesh(vv, ff, process=True)
        m = trimesh.graph.smooth_shade(m, angle=np.radians(35))   # split vertices at hard CAD edges
        total += len(m.faces)
        mid = f'{name}__{k}'
        m.visual = trimesh.visual.ColorVisuals(m)
        scene.add_geometry(m, node_name=mid, geom_name=mid)
        vis.append({'mesh': mid, 'xyz': f3(o.get('xyz') if o is not None else None), 'rpy': f3(o.get('rpy') if o is not None else None), 'col': colour(name)})
    links[name] = vis
    ine = l.find('inertial')
    if ine is not None:
        io = ine.find('origin'); inert[name] = {'m': float(ine.find('mass').get('value')), 'c': f3(io.get('xyz') if io is not None else None)}
for j in r.findall('joint'):
    o = j.find('origin'); a = j.find('axis'); lim = j.find('limit'); mim = j.find('mimic')
    joints.append({'name': j.get('name'), 'type': j.get('type'), 'parent': j.find('parent').get('link'), 'child': j.find('child').get('link'),
                   'xyz': f3(o.get('xyz') if o is not None else None), 'rpy': f3(o.get('rpy') if o is not None else None),
                   'axis': f3(a.get('xyz') if a is not None else None, '1 0 0'),
                   'lo': float(lim.get('lower', 0)) if lim is not None else 0, 'hi': float(lim.get('upper', 0)) if lim is not None else 0,
                   'mimic': {'joint': mim.get('joint'), 'mult': float(mim.get('multiplier', 1)), 'off': float(mim.get('offset', 0))} if mim is not None else None})
open(OUT + NAME + '.glb', 'wb').write(trimesh.exchange.gltf.export_glb(scene, include_normals=True))
json.dump({'links': links, 'joints': joints, 'inertia': inert}, open(OUT + 'robot.json', 'w'), indent=0)
print('links', len(links), 'joints', len(joints), 'tris', total, 'glb MB', round(os.path.getsize(OUT + NAME + '.glb') / 1e6, 1))
