p = 'lib/bots.js'; s = open(p, encoding='utf-8').read()
a = "  finish(tMax = 120)"
add = """  // both hands on points fixed in the robot's own frame (e.g. a cart handle) from now until t1
  handsLocal(pl, pr, t1, { reach = 0.6 } = {}) {
    const j = { handsLocal: [pl.clone(), pr.clone()], tR0: this.now - reach, tPick: this.now, tPlace: t1, tEnd: t1 + 0.5, base0: { ...this.pose } };
    this.jobs.push(j); return j;
  }
"""
assert a in s; s = s.replace(a, add + a)
a = "      if (j.hands) P.targets = { l: { p: j.hands[0], q: palmDown(B.yaw) }, r: { p: j.hands[1], q: palmDown(B.yaw) } };"
assert a in s
s = s.replace(a, a + """
      else if (j.handsLocal) { const Bm = baseMat(B.x, B.z, B.yaw); P.targets = { l: { p: j.handsLocal[0].clone().applyMatrix4(Bm), q: palmDown(B.yaw) }, r: { p: j.handsLocal[1].clone().applyMatrix4(Bm), q: palmDown(B.yaw) } }; }""")
s = s.replace("      if (j.hands) P.targets", "      if (j.hands) P.targets", 1)
a = "const w = j.Wp || j.hands ? ss("; assert a in s
s = s.replace(a, "const w = j.Wp || j.hands || j.handsLocal ? ss(")
# fix: 'else' after the if must attach to the if/else chain
s = s.replace("""      else if (j.handsLocal) {""", """      else if (j.handsLocal) {""")
s = s.replace("""      else P.targets = handTargets(this.objAt(j, t), j.obj);""", """      else if (!j.handsLocal) P.targets = handTargets(this.objAt(j, t), j.obj);""")
open(p, 'w', encoding='utf-8').write(s)

p = 'lib/factory.js'; s = open(p, encoding='utf-8').read()
i = s.find("    { // height probes")
if i >= 0:
    k = s.index("    window.__bots = bots;"); s = s[:i] + s[k:]
a = "    window.__bots = bots;"
add = open('dev/stations.js.part', encoding='utf-8').read()
assert a in s; s = s.replace(a, add + a)
s = s.replace("let J, robotSrc = {},", "let millRuns = [], pressHits = [], inspectJobs = [], scanPlane = null, carryBot = null, cartBot = null;\n  let J, robotSrc = {},")
a = "    // camera\n"; assert a in s
s = s.replace(a, open('dev/renderhooks.js.part', encoding='utf-8').read() + a, 1)
a = "    for (const q of objs) { const Mx = objPose(q, t);"; assert a in s
s = s.replace(a, "    for (const q of objs) { let Mx = objPose(q, t); if (Mx && q.o.hideAfterT !== undefined && t > q.o.hideAfterT) Mx = null; if (Mx && q.o.squashAt !== undefined && t > q.o.squashAt) Mx = Mx.clone().multiply(new THREE.Matrix4().makeScale(1.12, 0.55, 1.12));")
s = s.replace("rackG = put(rack, 0.01, 12.3, -3.0, 0, ['Sphere']);", "rackG = put(rack, 0.01, 12.3, -3.0, 0, ['Sphere']); rack.scene.traverse((m) => { if (m.isMesh && /Racking/.test(m.material.name)) { m.material.roughness = 0.6; m.material.metalness = 0.4; m.material.envMapIntensity = 0.5; } });", 1)
open(p, 'w', encoding='utf-8').write(s)
print('ok')
