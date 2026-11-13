p = 'lib/castle.js'
s = open(p, encoding='utf-8').read()

flag = r"""
  // ----- the flag: stand + pole + banner (code-built), grabbed with the left hand and raised overhead -----
  function bannerTex() {
    return canvasTex(512, 768, (g, w, h) => {
      g.fillStyle = '#8e1016'; g.fillRect(0, 0, w, h);
      const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(0,0,0,0.25)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.06)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#d9a63a'; g.lineWidth = 18; g.strokeRect(26, 26, w - 52, h - 150);
      // swallow-tail cut drawn as background colour (alpha) at the bottom
      g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.moveTo(0, h); g.lineTo(w / 2, h - 110); g.lineTo(w, h); g.closePath(); g.fill(); g.globalCompositeOperation = 'source-over';
      // emblem: a gold sun with rays and a sword
      g.save(); g.translate(w / 2, h * 0.4); g.fillStyle = '#e8b84a';
      for (let k = 0; k < 16; k++) { g.rotate(Math.PI / 8); g.beginPath(); g.moveTo(-14, 70); g.lineTo(0, 150); g.lineTo(14, 70); g.closePath(); g.fill(); }
      g.beginPath(); g.arc(0, 0, 72, 0, Math.PI * 2); g.fill(); g.fillStyle = '#8e1016'; g.beginPath(); g.arc(0, 0, 52, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e8b84a'; g.fillRect(-7, -60, 14, 120); g.fillRect(-30, 18, 60, 12); g.restore();
      for (let i = 0; i < 9000; i++) { const x = hash(i, 71) * w, y = hash(i, 72) * h; g.fillStyle = `rgba(0,0,0,${hash(i, 73) * 0.06})`; g.fillRect(x, y, 2, 2); }
    }, [1, 1]);
  }
  function buildFlag() {
    const F = { group: new THREE.Group(), pole: new THREE.Group() };
    const iron = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.45, metalness: 0.85 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xc9a043, roughness: 0.3, metalness: 1.0 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.6, metalness: 0 });
    // stand: round foot + three short feet + socket tube (open on top, the pole drops into it)
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.06, 32), iron); foot.position.y = 0.03; F.group.add(foot);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 8, 40), gold); ring.rotation.x = Math.PI / 2; ring.position.y = 0.06; F.group.add(ring);
    const socketH = 0.34; const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.042, socketH, 24, 1, true), iron); socket.position.y = 0.06 + socketH / 2; F.group.add(socket);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.037, 0.008, 8, 24), gold); lip.rotation.x = Math.PI / 2; lip.position.y = 0.06 + socketH; F.group.add(lip);
    F.socketTop = 0.06 + socketH; F.socketBottom = 0.07;
    // pole (local origin at its bottom end, +Y up)
    const poleL = 2.35, poleR = 0.019; const pole = new THREE.Mesh(new THREE.CylinderGeometry(poleR, poleR * 1.08, poleL, 20), wood); pole.position.y = poleL / 2; F.pole.add(pole);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.034, 20, 14), gold); cap.position.y = poleL + 0.02; F.pole.add(cap);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.14, 16), gold); tip.position.y = poleL + 0.12; F.pole.add(tip);
    const barW = 0.78, barY = poleL - 0.1; const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, barW, 12), gold); bar.rotation.z = Math.PI / 2; bar.position.set(barW / 2 - 0.04, barY, 0); F.pole.add(bar);
    // banner hanging from the crossbar (cloth: 0.72 x 1.1 m, waves with time only)
    const bw = 0.72, bh = 1.1, geo = new THREE.PlaneGeometry(bw, bh, 24, 36);
    const tex = bannerTex(); const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.85, metalness: 0, alphaTest: 0.5 }));
    cloth.position.set(bw / 2 + 0.0, barY - bh / 2 - 0.015, 0); F.pole.add(cloth);
    F.cloth = cloth; F.base = geo.attributes.position.array.slice(); F.bw = bw; F.bh = bh;
    F.poleL = poleL; F.poleR = poleR; F.barY = barY;
    for (const m of [foot, ring, socket, lip, pole, cap, tip, bar, cloth]) { m.castShadow = true; m.receiveShadow = true; }
    F.poleMeshes = [pole, cap, tip, bar, cloth]; F.standMeshes = [foot, ring, socket, lip];
    hall.add(F.group); hall.add(F.pole);
    return F;
  }
  function waveCloth(t) {
    const F = FLAG, pos = F.cloth.geometry.attributes.position, b = F.base;
    for (let i = 0; i < pos.count; i++) { const x = b[i * 3], y = b[i * 3 + 1]; const fx = (x + F.bw / 2) / F.bw, fy = (F.bh / 2 - y) / F.bh;   // 0 at pole / top
      const amp = 0.035 * fx + 0.02 * fy * fx; const z = amp * Math.sin(t * 2.6 - fx * 5.0 + fy * 1.3) + 0.012 * Math.sin(t * 4.1 - fx * 9.0 + 1.7);
      pos.setXYZ(i, x - 0.012 * fx * (1 + Math.sin(t * 2.6 - fx * 5.0)) * 0.5, y, z); }
    pos.needsUpdate = true; F.cloth.geometry.computeVertexNormals();
  }
  // arm IK chain for the left hand + the left-hand grip tunnel (in hand-local space)
  function leftGripFrame() {   // tunnel centre/axis/palm normal of the fully gripped left hand, expressed in the hand's frame
    const H = HANDS.l, wp = (b) => b.getWorldPosition(V3()); const tipOf = (b) => { const ch = b.children.find((x) => x.isBone); return ch ? wp(ch) : wp(b); };
    const bases = H.fingers.map((f) => wp(f[0])), ax = bases[0].clone().sub(bases[3]).normalize();
    const ring = []; for (const f of H.fingers) ring.push(wp(f[1]), wp(f[2]), tipOf(f[2]));
    const o = bases[0].clone().add(bases[3]).multiplyScalar(0.5); const u = ring[0].clone().sub(o); u.sub(ax.clone().multiplyScalar(u.dot(ax))).normalize(); const v = ax.clone().cross(u);
    const P2 = ring.map((p) => { const d = p.clone().sub(o); return [d.dot(u), d.dot(v)]; });
    let Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0, Sz = 0; const n = P2.length;
    for (const [x, y] of P2) { const z = x * x + y * y; Sx += x; Sy += y; Sxx += x * x; Syy += y * y; Sxy += x * y; Sxz += x * z; Syz += y * z; Sz += z; }
    const sol = V3(Sxz, Syz, Sz).applyMatrix3(new THREE.Matrix3().set(Sxx, Sxy, Sx, Sxy, Syy, Sy, Sx, Sy, n).invert());
    const cx = sol.x / 2, cy = sol.y / 2, R = Math.sqrt(Math.max(0, sol.z + cx * cx + cy * cy));
    const center = o.clone().add(u.clone().multiplyScalar(cx)).add(v.clone().multiplyScalar(cy));
    const palmN = center.clone().sub(o); palmN.sub(ax.clone().multiplyScalar(palmN.dot(ax))).normalize();
    const hq = H.hand.getWorldQuaternion(new THREE.Quaternion()), hp = wp(H.hand), inv = hq.clone().invert();
    return { centerL: center.clone().sub(hp).applyQuaternion(inv), axisL: ax.applyQuaternion(inv), palmL: palmN.applyQuaternion(inv), R };
  }
  function planFlag() {
    const F = buildFlag(); FLAG = F;
    const fwd = V3(0, 0, -1), left = V3(-1, 0, 0);
    // stand on the carpet to her left, just short of the first dais step
    F.standPos = V3(AISLE_X - 0.6, AISLE_Y, STOP_Z - 0.18); F.group.position.copy(F.standPos);
    F.inStand = new THREE.Matrix4().makeTranslation(F.standPos.x, F.standPos.y + F.socketBottom, F.standPos.z);
    F.gripH = 1.02;                                   // grip height on the pole (from the pole's bottom)
    const tEnd = STEP ? STEP.t0 + STEP.d : T_DECEL + 1.2;
    F.t = { reach0: tEnd + 0.25, grab: tEnd + 0.95, lift0: tEnd + 1.05, lift1: tEnd + 1.5, raise1: tEnd + 2.3 };
    F.curlL = (t) => smooth((t - (F.t.grab - 0.22)) / 0.22);
    // left-hand grip frame (fingers fully gripped)
    const saveW = HP.wL; HP.wL = 1.0; setPose(F.t.reach0, charAt(F.t.reach0)); holder.updateMatrixWorld(true); F.gf = leftGripFrame(); HP.wL = saveW;
    // desired hand orientation on the pole: pinky->index along +Y (thumb up), palm facing the pole (toward her left)
    const Ml = new THREE.Matrix4().makeBasis(F.gf.palmL, F.gf.axisL, F.gf.palmL.clone().cross(F.gf.axisL).normalize());
    const Mw = new THREE.Matrix4().makeBasis(left, V3(0, 1, 0), left.clone().cross(V3(0, 1, 0)).normalize());
    F.qHand = new THREE.Quaternion().setFromRotationMatrix(Mw.multiply(Ml.transpose()));
    F.arm = { up: girl.getObjectByName('brazo_l_056'), fore: girl.getObjectByName('antebrazo_l_057'), hand: HANDS.l.hand };
    // pole bottom in world as a function of time (before the grab it sits in the socket)
    const bottom0 = V3(F.standPos.x, F.standPos.y + F.socketBottom, F.standPos.z);
    F.bottomAt = (t) => { const p = bottom0.clone();
      if (t > F.t.lift0) p.y += 0.42 * smooth((t - F.t.lift0) / (F.t.lift1 - F.t.lift0));                         // up out of the socket
      if (t > F.t.lift1) { const k = smooth((t - F.t.lift1) / (F.t.raise1 - F.t.lift1)); p.y += 0.62 * k; p.x += 0.12 * k; p.z += 0.06 * k; }   // raised overhead
      return p; };
    INFO.flag = { stand: F.standPos.toArray().map((v) => +v.toFixed(2)), t: Object.fromEntries(Object.entries(F.t).map(([k, v]) => [k, +v.toFixed(2)])), gripR: +(F.gf.R * 1000).toFixed(1) };
  }
  function applyFlag(t) {
    const F = FLAG; if (!F) return;
    waveCloth(t);
    const bottom = F.bottomAt(t); const grip = bottom.clone().add(V3(0, F.gripH, 0));
    F.pole.position.copy(bottom); F.pole.quaternion.identity(); F.pole.updateMatrixWorld(true);
    if (t < F.t.reach0) return;
    // reach: blend the animated hand toward the grip pose on the pole
    const A = F.arm, w = t >= F.t.grab ? 1 : smooth((t - F.t.reach0) / (F.t.grab - F.t.reach0));
    const handP = A.hand.getWorldPosition(V3()), handQ = A.hand.getWorldQuaternion(new THREE.Quaternion());
    const tgtP = grip.clone().sub(F.gf.centerL.clone().applyQuaternion(F.qHand));
    const P = handP.clone().lerp(tgtP, w), Q = handQ.clone().slerp(F.qHand, w);
    for (const b of [A.up, A.fore, A.hand]) IKSAVE.push([b, b.quaternion.clone()]);
    twoBoneIK(A.up, A.fore, A.hand, P, V3(0, -0.4, 1).applyQuaternion(holder.quaternion).normalize());
    const pq = A.hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert(); A.hand.quaternion.copy(pq.multiply(Q)); A.hand.updateMatrixWorld(true);
    // fingers wrap the pole from the grab on (handled by handCurlL); the pole follows the hand exactly once gripped
    if (t >= F.t.grab) {
      const hp = A.hand.getWorldPosition(V3()); const c = hp.add(F.gf.centerL.clone().applyQuaternion(A.hand.getWorldQuaternion(new THREE.Quaternion())));
      F.pole.position.copy(c.sub(V3(0, F.gripH, 0))); F.pole.updateMatrixWorld(true);
    }
  }
"""
s = s.replace("  // ----- build -----", flag + "\n  // ----- build -----", 1)
# twoBoneIK: optional pole hint for the straight-limb fallback
s = s.replace("function twoBoneIK(A, B, C, target) {", "function twoBoneIK(A, B, C, target, hint) {")
s = s.replace("if (axis0.length() < 0.02 * ca.length() * ba.length()) axis0 = ca.clone().cross(V3(0, 0, 1).applyQuaternion(holder.quaternion));",
              "if (axis0.length() < 0.02 * ca.length() * ba.length()) axis0 = ca.clone().cross(hint || V3(0, 0, 1).applyQuaternion(holder.quaternion));")
s = s.replace("    fitSword();\n", "    fitSword();\n    planFlag();\n")
s = s.replace("  function poseAt(t) { const sh = shotAt(t), c = charAt(t); ext.visible = sh.set === 'ext'; hall.visible = sh.set === 'hall';\n    applyIK(t, c); holder.updateMatrixWorld(true); return c; }",
              "  function poseAt(t) { const sh = shotAt(t), c = charAt(t); ext.visible = sh.set === 'ext'; hall.visible = sh.set === 'hall';\n    applyIK(t, c); if (sh.set === 'hall') applyFlag(t); holder.updateMatrixWorld(true); return c; }")
s = s.replace("return { SWORD, HP, HANDS,", "return { FLAG: () => FLAG, SWORD, HP, HANDS,")
open(p, 'w', encoding='utf-8').write(s)
print('ok', s.count('applyFlag(t)'))
