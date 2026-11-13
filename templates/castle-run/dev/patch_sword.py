p = 'lib/castle.js'
s = open(p, encoding='utf-8').read()
fit = r"""
  // ----- sword: fitted into the right hand's grip -----
  const SWORD = { root: null, model: null, meshes: [], len: 0, gripR: 0, tunnelR: 0, scale: 1, samples: [] };
  function pca(pts) {   // principal axis by power iteration on the covariance
    const c = V3(); pts.forEach((p) => c.add(p)); c.multiplyScalar(1 / pts.length);
    const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const p of pts) { const d = [p.x - c.x, p.y - c.y, p.z - c.z]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j]; }
    let v = [1, 0.3, 0.2]; for (let k = 0; k < 60; k++) { const w = [0, 1, 2].map((i) => C[i][0] * v[0] + C[i][1] * v[1] + C[i][2] * v[2]); const L = Math.hypot(...w); v = w.map((x) => x / L); }
    return { c, a: V3(...v) };
  }
  async function loadSword(gl, base) {
    const g = await gl.loadAsync(base + 'models/sword.glb'); const model = g.scene; model.updateMatrixWorld(true);
    const pts = []; model.traverse((m) => { if (!m.isMesh) return; SWORD.meshes.push(m); m.castShadow = true; m.receiveShadow = true; if (m.material.map) m.material.map.anisotropy = 16;
      const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i += 3) pts.push(V3().fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld)); });
    const { c, a } = pca(pts); let lo = 1e9, hi = -1e9; for (const p of pts) { const s = p.clone().sub(c).dot(a); lo = Math.min(lo, s); hi = Math.max(hi, s); }
    const N = 50, wid = Array(N).fill(0); const perp = (p) => { const d = p.clone().sub(c); return d.sub(a.clone().multiplyScalar(d.dot(a))); };
    for (const p of pts) { const k = Math.min(N - 1, Math.floor((p.clone().sub(c).dot(a) - lo) / (hi - lo) * N)); wid[k] = Math.max(wid[k], perp(p).length()); }
    const kg = wid.indexOf(Math.max(...wid)); const axis = a.clone(); let s0 = lo, s1 = hi; if (kg > N / 2) { axis.negate(); s0 = -hi; s1 = -lo; }   // axis now points pommel -> tip
    const L = s1 - s0;
    const kgf = (kg > N / 2 ? N - 1 - kg : kg) / N;   // guard position along the length
    const proj = (p) => (p.clone().sub(c).dot(axis) - s0) / L;
    const perpA = (p) => { const d = p.clone().sub(c); return d.sub(axis.clone().multiplyScalar(d.dot(axis))); };
    // grip section: from 5% to just before the guard; radius = 85th percentile of the distance from the section's own centre line
    const g0 = 0.05, g1 = Math.max(0.08, kgf - 0.04); const gs = [];
    for (const p of pts) { const f = proj(p); if (f > g0 && f < g1) gs.push(p); }
    const gc = V3(); gs.forEach((p) => gc.add(p)); gc.multiplyScalar(1 / Math.max(1, gs.length));
    const rs = gs.map((p) => { const d = p.clone().sub(gc); return d.sub(axis.clone().multiplyScalar(d.dot(axis))).length(); }).sort((x, y) => x - y);
    const gripR = rs[Math.floor(rs.length * 0.85)] || 0.02;
    // guard spread direction (perpendicular to the axis)
    let gd = V3(1, 0, 0), best = 0; for (const p of pts) { const f = proj(p); if (Math.abs(f - kgf) < 0.03) { const d = perpA(p); if (d.length() > best) { best = d.length(); gd = d.clone().normalize(); } } }
    gd.sub(axis.clone().multiplyScalar(gd.dot(axis))).normalize();
    SWORD.model = model; SWORD.len = L; SWORD.gripR = gripR; SWORD.guardF = kgf; SWORD.gripF = [g0, g1]; SWORD.gc = gc;
    SWORD.basis = { gc, axis, guard: gd, third: gd.clone().cross(axis).normalize() };
    INFO.swordModel = { len: +L.toFixed(3), gripR: +gripR.toFixed(4), guardAt: +kgf.toFixed(2), grip: [g0, +g1.toFixed(2)] };
  }
  function fitSword() {   // place the sword so its grip runs through the tunnel of the curled right-hand fingers
    setPose(1.0, charAt(1.0)); holder.updateMatrixWorld(true);
    const H = HANDS.r, wp = (b) => b.getWorldPosition(V3()); const tipOf = (b) => { const ch = b.children.find((x) => x.isBone); return ch ? wp(ch) : wp(b); };
    const bases = H.fingers.map((f) => wp(f[0])), ax = bases[0].clone().sub(bases[3]).normalize();   // pinky -> index (thumb side)
    const ring = []; for (const f of H.fingers) ring.push(wp(f[1]), wp(f[2]), tipOf(f[2]));
    const o = bases[0].clone().add(bases[3]).multiplyScalar(0.5); const u = ring[0].clone().sub(o); u.sub(ax.clone().multiplyScalar(u.dot(ax))).normalize(); const v = ax.clone().cross(u);
    const P2 = ring.map((p) => { const d = p.clone().sub(o); return [d.dot(u), d.dot(v)]; });
    let Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0, Sz = 0; const n = P2.length;
    for (const [x, y] of P2) { const z = x * x + y * y; Sx += x; Sy += y; Sxx += x * x; Syy += y * y; Sxy += x * y; Sxz += x * z; Syz += y * z; Sz += z; }
    const M = new THREE.Matrix3().set(Sxx, Sxy, Sx, Sxy, Syy, Sy, Sx, Sy, n); const sol = V3(Sxz, Syz, Sz).applyMatrix3(M.clone().invert());
    const cx = sol.x / 2, cy = sol.y / 2, R = Math.sqrt(Math.max(0, sol.z + cx * cx + cy * cy));
    const center = o.clone().add(u.clone().multiplyScalar(cx)).add(v.clone().multiplyScalar(cy));
    const fingerR = 0.009; SWORD.tunnelR = R - fingerR; SWORD.fitR = R;
    const sLen = 0.98 / SWORD.len, sFit = SWORD.tunnelR / SWORD.gripR; SWORD.scale = Math.min(sLen, sFit * 0.97);
    const palmN = center.clone().sub(o); palmN.sub(ax.clone().multiplyScalar(palmN.dot(ax))).normalize();
    const B = SWORD.basis; const Rm = new THREE.Matrix4().makeBasis(B.guard, B.axis, B.third).transpose();
    const modelM = new THREE.Matrix4().makeScale(SWORD.scale, SWORD.scale, SWORD.scale).multiply(Rm).multiply(new THREE.Matrix4().makeTranslation(-B.gc.x, -B.gc.y, -B.gc.z));
    SWORD.model.matrixAutoUpdate = false; SWORD.model.matrix.copy(modelM);
    const z = palmN.clone().cross(ax).normalize(); const desired = new THREE.Matrix4().makeBasis(palmN, ax, z).setPosition(center);
    const root = new THREE.Group(); root.add(SWORD.model); root.matrixAutoUpdate = false;
    H.hand.updateMatrixWorld(true); root.matrix.copy(H.hand.matrixWorld.clone().invert().multiply(desired)); H.hand.add(root); SWORD.root = root;
    root.updateMatrixWorld(true);
    // sample points along the sword axis (canonical frame: +Y from the grip centre toward the tip)
    const yPommel = -(SWORD.gc.clone().sub(SWORD.basis.gc).length() + 0.09 * SWORD.len), yTip = 0.9 * SWORD.len;
    for (let k = 0; k <= 16; k++) { const ob = new THREE.Object3D(); ob.position.set(0, lerp(-0.08 * SWORD.len, yTip, k / 16) * SWORD.scale, 0); root.add(ob); SWORD.samples.push(ob); }
    INFO.sword = { scale: +SWORD.scale.toFixed(3), lengthM: +(SWORD.len * SWORD.scale).toFixed(3), gripRmm: +(SWORD.gripR * SWORD.scale * 1000).toFixed(1), tunnelRmm: +(SWORD.tunnelR * 1000).toFixed(1), fitRmm: +(R * 1000).toFixed(1) };
  }
"""
s = s.replace("  // ----- build -----", fit + "\n  // ----- build -----", 1)
s = s.replace("    buildContacts(); planStep();\n", "    buildContacts(); planStep();\n    fitSword();\n")
s = s.replace("    const gg = await gl.loadAsync(base + 'models/girl.glb');", "    await loadSword(gl, base);\n    const gg = await gl.loadAsync(base + 'models/girl.glb');")
s = s.replace("return { HP, HANDS,", "return { SWORD, HP, HANDS,")
open(p, 'w', encoding='utf-8').write(s)
print('patched')
