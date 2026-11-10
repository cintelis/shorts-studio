import re
p = 'lib/factory.js'; s = open(p, encoding='utf-8').read()

def sub(a, b, cnt=1):
    global s
    assert a in s, a[:80]
    s = s.replace(a, b, cnt)

# registry
sub("  const ANCH = {};", "  const ANCH = {};\n  const AUD = { boxes: [], virt: [], sups: [], armPts: [] }; let ST = 'prop';")
# blk registers every box it makes
sub("    const blk = (w, h, d, m, x, y, z, parent = world) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; parent.add(o); return o; };",
    "    const blk = (w, h, d, m, x, y, z, parent = world) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; parent.add(o); AUD.boxes.push({ o, h: [w / 2, h / 2, d / 2], name: ST, parent }); return o; };")
# tables: tag them
sub("    function table(x, z, yaw, w, d, h) {\n", "    function table(x, z, yaw, w, d, h) {\n      const st0 = ST; ST = st0 + '-table';\n")
sub("      return t;\n    }\n", "      ST = st0; return t;\n    }\n")
# conveyor belt bodies (solid + support)
sub("        c.position.set(x0 + d.x * (1 + 2 * i), 0, z0 + d.z * (1 + 2 * i)); c.quaternion.setFromUnitVectors(V3(0, 0, -1), d); world.add(c);",
    "        c.position.set(x0 + d.x * (1 + 2 * i), 0, z0 + d.z * (1 + 2 * i)); c.quaternion.setFromUnitVectors(V3(0, 0, -1), d); world.add(c);\n        { const M = new THREE.Matrix4().makeRotationY(Math.atan2(d.x, d.z)).setPosition(c.position.x, 0.644, c.position.z); AUD.virt.push({ M, h: [0.47, 0.07, 1.0], name: 'belt' }); }")
# station tags
for tag, marker in [('line', '// ---- R1:'), ('box-line', '// ---- R10 + R8:'), ('mill', '// ---- R2:'), ('press', '// ---- R3:'), ('cell', '// ---- R5:'), ('insp', '// ---- R6:'), ('shelf', '// ---- R4:'), ('carry', '// ---- R7:'), ('cart', '// ---- R9:')]:
    i = s.index(marker); j = s.index('{', i); s = s[:j + 1] + f" ST = '{tag}';" + s[j + 1:]
open(p, 'w', encoding='utf-8').write(s)
print('ok')
