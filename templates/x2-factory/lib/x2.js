// AgiBot X2 factory Short: the robot (official URDF, Mulan PSL v2), a see-through human demonstrator (code-built mannequin on the
// same joint tree, scaled 1.3x), a conveyor + pallet station in a warehouse. Pure function of the state passed to render(s).
// Models: AgiBot X2 Ultra omnihand URDF (AgiBot, Mulan PSL v2); "Warehouse FBX Model Free" by Nicholas-3D, "Simple rubber conveyor"
// by scailman, "Euro stacking container 600 x 400 x 230 mm" by Daniel Rosehill, "EUR Pallet .::RAWscan::." by Andrea Spognetta (all CC BY 4.0).
// Lighting: Poly Haven "Empty Warehouse 01" (CC0). Pallet station (lift table, rails), mannequin and overlays are code-built.

import * as THREE from './three.module.js';
import { GLTFLoader } from './jsm/loaders/GLTFLoader.js';
import { HDRLoader } from './jsm/loaders/HDRLoader.js';
import { EffectComposer } from './jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './jsm/postprocessing/RenderPass.js';
import { GTAOPass } from './jsm/postprocessing/GTAOPass.js';
import { BokehPass } from './jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from './jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './jsm/postprocessing/OutputPass.js';
import { ShaderPass } from './jsm/postprocessing/ShaderPass.js';
import { toCreasedNormals } from './jsm/utils/BufferGeometryUtils.js';

const L = window.LAY;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clamp01 = (v) => clamp(v, 0, 1);
const ss = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const Q_BASE = new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), -Math.PI / 2);   // URDF z-up -> three y-up (x stays forward, y-left -> -z)
const yawQ = (a) => new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), a);
const rpyQ = (r) => new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], 'ZYX'));
const fromArr = (a) => V3(a[0], a[1], a[2]);

// ---------------------------------------------------------------- rig (joint tree from robot.json)
function buildRig(J, k, visual) {
  const root = new THREE.Group(), links = {}, joints = {}, parentJoint = {};
  const byParent = {}; J.joints.forEach((j) => { (byParent[j.parent] = byParent[j.parent] || []).push(j); parentJoint[j.child] = j.name; });
  function addLink(name, parent) {
    const g = new THREE.Group(); g.name = name; parent.add(g); links[name] = g; visual(name, g);
    for (const j of byParent[name] || []) {
      const o = new THREE.Group(); o.position.copy(fromArr(j.xyz)).multiplyScalar(k); o.quaternion.copy(rpyQ(j.rpy)); g.add(o);
      const r = new THREE.Group(); o.add(r);
      joints[j.name] = { ...j, o, r, q: 0, ax: fromArr(j.axis).normalize(), M: new THREE.Matrix4().compose(o.position, o.quaternion, V3(1, 1, 1)) };
      addLink(j.child, r);
    }
  }
  addLink('pelvis', root);
  const mimics = J.joints.filter((j) => j.mimic);
  const rig = { root, links, joints, parentJoint, k, mimics };
  rig.set = (name, v) => {
    const j = joints[name]; if (!j || j.type === 'fixed') return;
    v = clamp(v, j.lo, j.hi); j.q = v; j.r.quaternion.setFromAxisAngle(j.ax, v);
  };
  rig.applyMimic = () => { for (const m of mimics) { const src = joints[m.mimic.joint]; if (src) rig.set(m.name, src.q * m.mimic.mult + m.mimic.off); } };
  return rig;
}

// chain from link `from` down to link `to` (joints in order)
function chainOf(rig, from, to, tail) {
  const list = []; let l = to;
  while (l !== from) { const jn = rig.parentJoint[l]; if (!jn) throw new Error('no path ' + from + '->' + to); const j = rig.joints[jn]; list.unshift(j); l = j.parent; }
  return { list, vars: list.filter((j) => j.type !== 'fixed'), tail: tail || new THREE.Matrix4() };
}
const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _q = new THREE.Quaternion();
function fk(chain, base, qmap, out) {
  out.copy(base);
  for (const j of chain.list) {
    out.multiply(j.M);
    if (j.type !== 'fixed') { _q.setFromAxisAngle(j.ax, qmap.get(j) ?? 0); _r.makeRotationFromQuaternion(_q); out.multiply(_r); }
  }
  return out.multiply(chain.tail);
}
function solveLin(A, b, n) {   // Gauss-Jordan, A n x n (array of rows)
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    const d = A[c][c] || 1e-9;
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = A[r][c] / d; if (!f) continue; for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  return b.map((v, i) => v / (A[i][i] || 1e-9));
}
const _p = V3(), _qa = new THREE.Quaternion(), _s = V3();
function poseErr(M, tp, tq, wRot) {
  M.decompose(_p, _qa, _s);
  const e = [tp.x - _p.x, tp.y - _p.y, tp.z - _p.z, 0, 0, 0];
  if (tq) {
    const d = tq.clone().multiply(_qa.clone().invert()); if (d.w < 0) { d.x = -d.x; d.y = -d.y; d.z = -d.z; d.w = -d.w; }
    const s = Math.sqrt(Math.max(0, 1 - d.w * d.w)), ang = 2 * Math.acos(clamp(d.w, -1, 1));
    if (s > 1e-6) { e[3] = d.x / s * ang * wRot; e[4] = d.y / s * ang * wRot; e[5] = d.z / s * ang * wRot; }
  }
  return e;
}
// damped least squares IK; seed = array of joint values; writes the solution into the rig
function solveIK(rig, chain, base, tp, tq, seed, { wRot = 0.4, iters = 40, lambda = 0.06 } = {}) {
  const vars = chain.vars, n = vars.length, q = new Map(); vars.forEach((j, i) => q.set(j, clamp(seed[i], j.lo, j.hi)));
  const M = new THREE.Matrix4(), Mk = new THREE.Matrix4(), h = 1e-4, rows = tq ? 6 : 3;
  for (let it = 0; it < iters; it++) {
    const e = poseErr(fk(chain, base, q, M), tp, tq, wRot);
    const en = Math.hypot(...e.slice(0, rows)); if (en < 2e-4) break;
    const Jc = [];
    for (const j of vars) { const v = q.get(j); q.set(j, v + h); const ek = poseErr(fk(chain, base, q, Mk), tp, tq, wRot); q.set(j, v); Jc.push(e.map((x, r) => (x - ek[r]) / h)); }
    // A = J J^T + l^2 I  (rows x rows)
    const A = []; for (let r = 0; r < rows; r++) { A.push([]); for (let c = 0; c < rows; c++) { let s = 0; for (let k = 0; k < n; k++) s += Jc[k][r] * Jc[k][c]; A[r].push(s + (r === c ? lambda * lambda : 0)); } }
    const y = solveLin(A, e.slice(0, rows), rows);
    vars.forEach((j, k) => { let d = 0; for (let r = 0; r < rows; r++) d += Jc[k][r] * y[r]; d = clamp(d, -0.25, 0.25); q.set(j, clamp(q.get(j) + d, j.lo, j.hi)); });
  }
  vars.forEach((j) => rig.set(j.name, q.get(j)));
  return vars.map((j) => q.get(j));
}

// ---------------------------------------------------------------- materials
function ghostMat(col) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    uniforms: { uOp: { value: 1 }, uBase: { value: 0.1 }, uCol: { value: new THREE.Color(col) } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vY = wp.y; vec4 mv = viewMatrix * wp; vV = -mv.xyz; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uOp, uBase; uniform vec3 uCol; varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); float scan = 0.82 + 0.18 * step(0.5, fract(vY * 55.0));
        float a = (uBase + 0.95 * pow(f, 2.4)) * scan * uOp; gl_FragColor = vec4(uCol * a, 1.0); }`,
  });
}

export function createX2(canvas, ov, { width = 1080, height = 1920 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  const g2 = ov.getContext('2d');

  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b0d10);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.05, 400);
  const key = new THREE.DirectionalLight(0xfff0dc, 2.4); key.position.set(3, 7, 2.5); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -3; key.shadow.camera.right = 3; key.shadow.camera.top = 3; key.shadow.camera.bottom = -3;
  key.shadow.camera.near = 1; key.shadow.camera.far = 20; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 3;
  scene.add(key, key.target); key.target.position.set(0.3, 0, -0.3);
  const rim = new THREE.DirectionalLight(0x9cc4ff, 1.1); rim.position.set(-5, 4, -6); scene.add(rim);
  const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x2a2622, 0.35); scene.add(hemi);

  const world = new THREE.Group(); scene.add(world);
  const clipPlane = new THREE.Plane(V3(0, -1, 0), 99);   // robot reveal: show y < rev

  // ---------- state built at load ----------
  let R = null, H = null, crates = [], ghostCrate = null, beltMats = [], station = null, stationTop = null, robotMats = [], ghostMats = [];
  const CH = {};   // IK chains
  let feetPoly = [];

  const loadHDR = (url) => new Promise((res, rej) => { const l = new HDRLoader(); l.setDataType(THREE.FloatType); l.load(url, res, undefined, rej); });
  async function load(base) {
    const gl = new GLTFLoader();
    const [J, rg, wh, cv, cr, pa, hdr] = await Promise.all([
      fetch(base + 'models/x2/robot.json').then((r) => r.json()),
      gl.loadAsync(base + 'models/x2/robot.glb'), gl.loadAsync(base + 'models/warehouse/scene.gltf'), gl.loadAsync(base + 'models/conveyor/scene.gltf'),
      gl.loadAsync(base + 'models/crate.glb'), gl.loadAsync(base + 'models/pallet/scene.gltf'), loadHDR(base + 'hdri/empty_warehouse_01_2k.hdr')]);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = pmrem.fromEquirectangular(hdr).texture; scene.environmentIntensity = 0.55;

    // --- robot materials (URDF v1.3 colour scheme as PBR)
    const M = {
      white: new THREE.MeshPhysicalMaterial({ color: 0xebebe8, roughness: 0.36, metalness: 0.0, clearcoat: 0.35, clearcoatRoughness: 0.35 }),
      grey: new THREE.MeshStandardMaterial({ color: 0x47494d, roughness: 0.5, metalness: 0.35 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x1c1e21, roughness: 0.42, metalness: 0.45 }),
      orange: new THREE.MeshStandardMaterial({ color: 0xff6c12, roughness: 0.5, metalness: 0.05 }),
      face: new THREE.MeshPhysicalMaterial({ color: 0x0d0e10, roughness: 0.12, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }),
    };
    Object.values(M).forEach((m) => { m.clippingPlanes = [clipPlane]; m.envMapIntensity = 1.0; robotMats.push(m); });
    const meshes = {}; rg.scene.traverse((o) => { if (o.isMesh) meshes[o.name] = o; });
    R = buildRig(J, 1, (name, g) => {
      for (const v of J.links[name] || []) {
        const src = meshes[v.mesh] || rg.scene.getObjectByName(v.mesh); if (!src) continue;
        const geo = src.geometry; if (geo.attributes.color) geo.deleteAttribute('color'); if (!geo.attributes.normal) geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, M[v.col] || M.white); m.position.copy(fromArr(v.xyz)); m.quaternion.copy(rpyQ(v.rpy));
        m.castShadow = true; m.receiveShadow = true; g.add(m);
      }
    });
    R.inert = J.inertia;
    world.add(R.root);

    // --- human demonstrator: same joint tree, 1.3x, translucent mannequin
    const gm = ghostMat(0x5fd8ff); ghostMats.push(gm);
    const k = 1.3;
    const cap = (g, a, b, r, sx = 1, sz = 1) => {
      const A = fromArr(a).multiplyScalar(k), B = fromArr(b).multiplyScalar(k), d = B.clone().sub(A), len = d.length();
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r * k, Math.max(0.001, len), 8, 20), gm);
      m.position.copy(A).add(B).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize()); m.scale.set(sx, 1, sz); g.add(m); return m;
    };
    const ell = (g, c, r) => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), gm); m.position.copy(fromArr(c)).multiplyScalar(k); m.scale.set(r[0] * k, r[1] * k, r[2] * k); g.add(m); return m; };
    H = buildRig(J, k, (name, g) => {
      const n = name;
      if (n === 'pelvis') ell(g, [0, 0, 0.0], [0.1, 0.15, 0.085]);
      else if (/hip_roll_link$/.test(n)) cap(g, [0, 0, -0.02], [-0.008, 0, -0.31], 0.062);
      else if (/knee_link$/.test(n)) cap(g, [0, 0, -0.01], [-0.01, 0, -0.27], 0.047);
      else if (/ankle_roll_link$/.test(n)) cap(g, [-0.045, 0, -0.05], [0.13, 0, -0.055], 0.032, 1, 1.15);
      else if (n === 'waist_pitch_link') ell(g, [0, 0, 0.04], [0.085, 0.12, 0.09]);
      else if (n === 'torso_link') { ell(g, [0.0, 0, 0.17], [0.1, 0.16, 0.15]); cap(g, [0, 0, 0.27], [0.008, 0, 0.33], 0.035); }
      else if (n === 'head_pitch_link') ell(g, [0.012, 0, 0.02], [0.075, 0.065, 0.088]);
      else if (/shoulder_roll_link$/.test(n)) cap(g, [0, 0, 0], [0.012, 0, -0.2], 0.042);
      else if (/elbow_link$/.test(n)) cap(g, [0, 0, 0], [-0.012, 0, -0.19], 0.034);
      else if (/wrist_roll_link$/.test(n)) cap(g, [0, 0, -0.04], [0, 0, -0.14], 0.03, 0.55, 1.15);
    });
    H.inert = J.inertia; world.add(H.root);

    // IK chains (palm tail = grip point on the inner palm)
    const gripT = (kk) => new THREE.Matrix4().makeTranslation(0.03 * kk, 0, 0.058 * kk);
    for (const [rig, nm] of [[R, 'R'], [H, 'H']]) {
      const kk = rig.k;
      CH[nm] = {
        ll: chainOf(rig, 'pelvis', 'left_ankle_roll_link'), rl: chainOf(rig, 'pelvis', 'right_ankle_roll_link'),
        la: chainOf(rig, 'torso_link', 'L_palm', gripT(kk)),
        ra: chainOf(rig, 'torso_link', 'R_palm', gripT(kk)),
      };
    }

    // --- warehouse (scaled 1.6x: 25.6 m wide, 8 m to the arch)
    const W = wh.scene; W.scale.setScalar(1.6); W.position.set(-12.8 + 3.6, 0, 36.9 - 9.5);
    W.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; if (o.material.name === 'WetConcrete') { const m = o.material; m.metalness = 0.0; m.metalnessMap = null; m.roughnessMap = null; m.roughness = 0.85; m.envMapIntensity = 0.3; m.color.setRGB(0.62, 0.62, 0.6); if (m.map) { m.map.repeat.set(1, 1); } m.needsUpdate = true; } if (o.material.name === 'Emissive') o.material.emissiveIntensity = 1.4; } });
    world.add(W);

    // --- conveyor line (3 segments) ending at the station; belt texture scrolls
    const cDir = fromArr(L.dir(L.PHI_C));
    const cvTex = await new THREE.TextureLoader().loadAsync(base + 'models/conveyor/textures/Conveyor_diffuse.png'); cvTex.colorSpace = THREE.SRGBColorSpace; cvTex.flipY = false;
    cv.scene.traverse((o) => { if (o.isMesh && o.material.name === 'Conveyor') { o.material.map = cvTex; o.material.color.set(0xffffff); o.material.roughness = 0.55; o.material.metalness = 0.3; o.material.needsUpdate = true; } });
    for (let i = 0; i < 4; i++) {
      const c = cv.scene.clone(true);
      c.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material.name === 'Belt') { o.material = o.material.clone(); if (o.material.map) { o.material.map = o.material.map.clone(); o.material.map.wrapS = o.material.map.wrapT = THREE.RepeatWrapping; o.material.map.needsUpdate = true; } o.material.color.setRGB(0.22, 0.22, 0.23); o.material.roughness = 0.85; beltMats.push(o.material); } } });
      const d = 0.30 + 1.0 + 2.0 * i;   // segment centre radius (end edge at 0.30)
      c.position.copy(cDir).multiplyScalar(d);
      c.quaternion.setFromUnitVectors(V3(0, 0, 1), cDir.clone().negate());   // local -z towards the robot... orientation only matters for the belt scroll
      world.add(c);
    }
    // end stop bar
    const stop = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.06, 0.03), new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.5 }));
    stop.position.copy(cDir).multiplyScalar(0.285).setY(0.74); stop.quaternion.copy(yawQ(L.PHI_C)); stop.castShadow = true;

    // --- crate template + pallet
    const crateT = cr.scene; crateT.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.material.roughness = 0.55; } });
    const palT = pa.scene; { const b = new THREE.Box3().setFromObject(palT), s = b.getSize(V3()); const kk = 1.2 / s.x; palT.scale.setScalar(kk); palT.position.y = -b.min.y * kk; }
    palT.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.material.roughness = 0.82; o.material.metalness = 0; o.material.envMapIntensity = 0.6; } });
    const palG = new THREE.Group(); palG.add(palT);

    // --- pallet station: floor rails, sliding lift table, turntable top (code-built)
    const steel = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.45, metalness: 0.6 });
    const yel = new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.5, metalness: 0.1 });
    const rails = new THREE.Group(); world.add(rails);
    for (const z of [-0.28, 0.28]) { const r = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.03, 0.06), steel); r.position.set(L.T_X + 0.3, 0.015, z); r.receiveShadow = r.castShadow = true; rails.add(r); }
    station = new THREE.Group(); world.add(station);
    const baseB = new THREE.Mesh(new THREE.BoxGeometry(0.72, L.T_H - 0.04, 1.0), steel); baseB.position.y = (L.T_H - 0.04) / 2 + 0.01; baseB.castShadow = baseB.receiveShadow = true; station.add(baseB);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.724, 0.035, 1.004), yel); band.position.y = L.T_H - 0.07; station.add(band);
    stationTop = new THREE.Group(); stationTop.position.y = L.T_H - 0.03; station.add(stationTop);
    const disk = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.03, 64), new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.8, metalness: 0.2 })); disk.position.y = 0.015; disk.castShadow = disk.receiveShadow = true; stationTop.add(disk);
    const pal = palG.clone(true); pal.position.y = 0.03; pal.rotation.y = Math.PI / 2; stationTop.add(pal);

    // floor safety markings
    const markM = new THREE.MeshStandardMaterial({ color: 0xe8b800, roughness: 0.6 });
    const mark = (x, z, w, d) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), markM); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.002, z); m.receiveShadow = true; world.add(m); };
    mark(0.55, -1.05, 2.3, 0.06); mark(0.55, 1.05, 2.3, 0.06); mark(1.7, 0, 0.06, 2.16); mark(-0.6, 0.5, 0.06, 1.1);

    // crates: 8 work crates + ghost crate
    const mkCrate = () => { const c = crateT.clone(true); c.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); }); world.add(c); return c; };
    for (let i = 0; i < 8; i++) crates.push(mkCrate());
    const gmc = ghostMat(0x5fd8ff); gmc.uniforms.uBase.value = 0.3; gmc.side = THREE.DoubleSide; ghostCrate = crateT.clone(true); ghostCrate.traverse((o) => { if (o.isMesh) { o.material = gmc; o.castShadow = false; } }); world.add(ghostCrate);

    // background: finished pallets and an empty-pallet stack
    const full = (x, z, yaw, n) => {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw; world.add(g); const pp = palG.clone(true); pp.rotation.y = Math.PI / 2; g.add(pp);
      for (let i = 0; i < n; i++) { const c = crateT.clone(true); const l = i >> 2, j = i & 3; c.position.set((j & 2 ? 0.2 : -0.2), L.PAL_H + l * L.LAYER, (j & 1 ? 0.3 : -0.3)); c.rotation.y = Math.PI / 2; g.add(c); }
    };
    full(2.9, -1.6, 0.05, 12); full(2.9, 0.1, -0.03, 12); full(4.3, -1.6, 0.0, 8);
    for (let i = 0; i < 5; i++) { const p = palG.clone(true); p.position.set(4.4, i * L.PAL_H, 0.5); p.rotation.y = Math.PI / 2 + 0.02 * (i % 3); world.add(p); }

    // crate geometry centre for overlays
    feetPoly = [];
  }

  // ---------------------------------------------------------------- posing
  const crateMat = (phi, r, h, lat) => { const p = L.cratePos(phi, r, h, lat); const X = fromArr(L.right(phi)), Y = V3(0, 1, 0), Z = X.clone().cross(Y); return new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(p[0], p[1], p[2]); };
  function handTargets(CM, kk) {
    const X = V3().setFromMatrixColumn(CM, 0), Y = V3().setFromMatrixColumn(CM, 1), Z = V3().setFromMatrixColumn(CM, 2), P = V3().setFromMatrixPosition(CM);
    const fwd = Z.clone().negate();
    const out = {};
    for (const [side, sgn] of [['l', -1], ['r', 1]]) {
      const pos = P.clone().addScaledVector(X, sgn * L.HANDLE[0]).addScaledVector(Y, L.HANDLE[1]);
      const Xp = X.clone().multiplyScalar(-sgn), Zp = fwd.clone(), Yp = Zp.clone().cross(Xp);
      out[side] = { p: pos, q: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(Xp, Yp, Zp)) };
    }
    return out;
  }
  const ARM_REL = { l: [0.12, 0.14, 0, -0.35, 0, 0, 0], r: [0.12, -0.14, 0, -0.35, 0, 0, 0] };
  const ARM_SEED = { l: [-0.7, 0.12, -0.1, -1.1, 0, 0, 0], r: [-0.7, -0.12, 0.1, -1.1, 0, 0, 0] };
  const LEG_SEED = [-0.35, 0, 0, 0.7, -0.35, 0];
  const ARMJ = (s) => ['shoulder_pitch', 'shoulder_roll', 'shoulder_yaw', 'elbow', 'wrist_yaw', 'wrist_pitch', 'wrist_roll'].map((n) => `${s}_${n}_joint`);

  // P: { x, z (root offset), pyaw, ph (pelvis height), pp (pitch), pshift, pback, wy, wp, lfa, rfa, llift, rlift, reach, grip, crate (Matrix4|null), look (V3|null) }
  function poseRig(rig, ch, P) {
    const kk = rig.k, w = L.FEET_W * kk, ank = 0.073 * kk;
    const O = V3(P.x || 0, 0, P.z || 0);
    const fwd = fromArr(L.dir(P.pyaw)), rgt = fromArr(L.right(P.pyaw));
    const pel = O.clone().addScaledVector(rgt, P.pshift || 0).addScaledVector(fwd, -(P.pback || 0)); pel.y = P.ph;
    rig.root.position.copy(pel);
    rig.root.quaternion.copy(yawQ(P.pyaw)).multiply(Q_BASE).multiply(new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), P.pp || 0));
    rig.set('waist_yaw_joint', P.wy || 0); rig.set('waist_pitch_joint', P.wp || 0); rig.set('waist_roll_joint', 0);
    rig.root.updateMatrixWorld(true);
    // legs
    const legT = (a, side, lift) => {
      const r = fromArr(L.right(a)), p = O.clone().addScaledVector(r, side * w).addScaledVector(fromArr(L.dir(a)), -0.015 * kk); p.y = ank + (lift || 0);
      return { p, q: yawQ(a + side * 0.05).multiply(Q_BASE) };
    };
    const base = rig.links.pelvis.matrixWorld.clone();
    const tl = legT(P.lfa, -1, P.llift), tr = legT(P.rfa, 1, P.rlift);
    solveIK(rig, ch.ll, base, tl.p, tl.q, LEG_SEED, { wRot: 0.5, iters: 36 });
    solveIK(rig, ch.rl, base, tr.p, tr.q, LEG_SEED, { wRot: 0.5, iters: 36 });
    // head looks at the target
    rig.root.updateMatrixWorld(true);
    const torso = rig.links.torso_link.matrixWorld.clone();
    if (P.look) {
      const lp = P.look.clone().applyMatrix4(torso.clone().invert());   // in torso frame (x fwd, y left, z up)
      const hz = 0.4 * kk;
      const w = P.lookW ?? 1; rig.set('head_yaw_joint', w * Math.atan2(lp.y, lp.x)); rig.set('head_pitch_joint', 0.08 + w * (Math.atan2(hz - lp.z, Math.hypot(lp.x, lp.y)) - 0.08));
    } else { rig.set('head_yaw_joint', 0); rig.set('head_pitch_joint', 0.08); }
    // arms
    const reach = clamp01(P.reach || 0);
    for (const side of ['l', 'r']) {
      const names = ARMJ(side === 'l' ? 'left' : 'right');
      names.forEach((n, i) => rig.set(n, ARM_REL[side][i] + (P.swing || 0) * (i === 0 ? (side === 'l' ? 1 : -1) * 0.1 : 0)));
      if (reach > 0.001 && P.crate) {
        const chn = side === 'l' ? ch.la : ch.ra;
        const q0 = new Map(); chn.vars.forEach((j) => q0.set(j, j.q));
        const M0 = fk(chn, torso, q0, new THREE.Matrix4()); const p0 = V3(), r0 = new THREE.Quaternion(); M0.decompose(p0, r0, _s);
        const T = handTargets(P.crate, kk)[side];
        const e = reach * reach * (3 - 2 * reach);
        const tp = p0.clone().lerp(T.p, e), tq = r0.clone().slerp(T.q, e);
        solveIK(rig, chn, torso, tp, tq, ARM_SEED[side], { wRot: 0.35, iters: 44 });
      }
    }
    // fingers (robot omnihand)
    const g = clamp01(P.grip || 0);
    for (const s of ['L', 'R']) {
      for (const f of ['index', 'middle', 'ring', 'pinky']) rig.set(`${s}_${f}_pip_joint`, 0.15 + g * 1.05);
      rig.set(`${s}_thumb_roll_joint`, s === 'L' ? -0.3 : 0.3); rig.set(`${s}_thumb_abad_joint`, (s === 'L' ? 1 : -1) * (0.3 + g * 0.5));
      rig.set(`${s}_thumb_mcp_joint`, (s === 'L' ? -1 : 1) * g * 0.45);
    }
    rig.applyMimic();
    rig.root.updateMatrixWorld(true);
  }

  // world positions of tracked keypoints (same names on both rigs)
  const KP = [['head_pitch_link', [0.01, 0, 0.06]], ['torso_link', [0.0, 0, 0.3]], ['left_shoulder_roll_link', [0, 0, 0]], ['right_shoulder_roll_link', [0, 0, 0]],
    ['left_elbow_link', [0, 0, 0]], ['right_elbow_link', [0, 0, 0]], ['left_wrist_pitch_link', [0, 0, 0]], ['right_wrist_pitch_link', [0, 0, 0]],
    ['pelvis', [0, 0, 0]], ['left_hip_roll_link', [0, 0, 0]], ['right_hip_roll_link', [0, 0, 0]], ['left_knee_link', [0, 0, 0]], ['right_knee_link', [0, 0, 0]],
    ['left_ankle_pitch_link', [0, 0, 0]], ['right_ankle_pitch_link', [0, 0, 0]]];
  const BONES = [[0, 1], [1, 2], [1, 3], [2, 4], [4, 6], [3, 5], [5, 7], [1, 8], [8, 9], [8, 10], [9, 11], [11, 13], [10, 12], [12, 14]];
  const keypoints = (rig) => KP.map(([l, o]) => fromArr(o).multiplyScalar(rig.k).applyMatrix4(rig.links[l].matrixWorld));
  // the 30 actuated joints (X2 Ultra: 6 per leg, 3 waist, 7 per arm, 1 neck)
  const RING = ['left_hip_pitch', 'left_hip_roll', 'left_hip_yaw', 'left_knee', 'left_ankle_pitch', 'left_ankle_roll', 'right_hip_pitch', 'right_hip_roll', 'right_hip_yaw', 'right_knee', 'right_ankle_pitch', 'right_ankle_roll',
    'waist_yaw', 'waist_pitch', 'waist_roll', ...ARMJ('left').map((s) => s.replace('_joint', '')), ...ARMJ('right').map((s) => s.replace('_joint', '')), 'head_yaw'].map((s) => s + '_joint');
  const ringOrder = [12, 13, 14, 30 - 1, 15, 22, 16, 23, 17, 24, 18, 25, 19, 26, 20, 27, 21, 28, 0, 6, 1, 7, 2, 8, 3, 9, 4, 10, 5, 11];
  const jointPos = (rig, n) => V3().setFromMatrixPosition(rig.joints[n].o.matrixWorld);
  function com(rig, extra) {
    let m = 0; const c = V3();
    for (const [n, I] of Object.entries(rig.inert)) { const l = rig.links[n]; if (!l) continue; c.addScaledVector(fromArr(I.c).applyMatrix4(l.matrixWorld), I.m); m += I.m; }
    if (extra) { c.addScaledVector(extra.p, extra.m); m += extra.m; }
    return c.multiplyScalar(1 / m);
  }
  function footHull(rig) {
    const pts = [];
    for (const l of ['left_ankle_roll_link', 'right_ankle_roll_link']) for (const [x, y] of [[-0.07, -0.06], [0.15, -0.06], [0.15, 0.06], [-0.07, 0.06]]) { const p = V3(x, y, -0.073).applyMatrix4(rig.links[l].matrixWorld); pts.push([p.x, p.z]); }
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = []; for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of pts.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function polyDist(poly, x, z) {   // signed distance to polygon edge (positive inside)
    let d = 1e9, inside = true;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length]; const ex = b[0] - a[0], ez = b[1] - a[1];
      const t = clamp(((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez), 0, 1); d = Math.min(d, Math.hypot(a[0] + ex * t - x, a[1] + ez * t - z));
      if (ex * (z - a[1]) - ez * (x - a[0]) < 0) inside = false;
    }
    return inside ? d : -d;
  }

  // ---------------------------------------------------------------- post
  const rt = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt); composer.setPixelRatio(1); composer.setSize(width, height);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new ShaderPass({ uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0); gl_FragColor = clamp(c, 0.0, 64.0); }' }));
  const gtao = new GTAOPass(scene, camera, width, height); gtao.output = GTAOPass.OUTPUT.Default; gtao.blendIntensity = 1.0;
  gtao.updateGtaoMaterial({ radius: 0.25, distanceExponent: 1.5, thickness: 1, scale: 1.1, samples: 16, distanceFallOff: 1.0 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
  composer.addPass(gtao);
  const bokeh = new BokehPass(scene, camera, { focus: 3, aperture: 0.0, maxblur: 0.008 }); composer.addPass(bokeh);
  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.3, 0.5, 2.6); composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const hideGhost = (pass) => { const f = pass.render.bind(pass); pass.render = (...a) => { const v = H ? H.root.visible : false, gv = ghostCrate ? ghostCrate.visible : false; if (H) H.root.visible = false; if (ghostCrate) ghostCrate.visible = false; f(...a); if (H) H.root.visible = v; if (ghostCrate) ghostCrate.visible = gv; }; };
  hideGhost(gtao); hideGhost(bokeh);

  // ---------------------------------------------------------------- overlay helpers
  const proj = (v) => { const p = v.clone().project(camera); return { x: (p.x * 0.5 + 0.5) * width, y: (-p.y * 0.5 + 0.5) * height, ok: p.z < 1 && p.z > -1 }; };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const CYAN = [95, 216, 255], LIME = [198, 255, 61], RED = [255, 90, 60], WHITE = [255, 255, 255];
  const mixC = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  function skel(pts, col, a, { r = 8, lw = 5, cols = null } = {}) {
    if (a <= 0.003) return;
    const P = pts.map(proj);
    g2.save(); g2.lineCap = 'round'; g2.shadowBlur = 14;
    for (const [i, j] of BONES) { const c = cols ? cols[i] : col; g2.strokeStyle = rgba(c, 0.85 * a); g2.shadowColor = rgba(c, a); g2.lineWidth = lw; g2.beginPath(); g2.moveTo(P[i].x, P[i].y); g2.lineTo(P[j].x, P[j].y); g2.stroke(); }
    P.forEach((p, i) => { const c = cols ? cols[i] : col; g2.shadowColor = rgba(c, a); g2.fillStyle = rgba(c, a); g2.beginPath(); g2.arc(p.x, p.y, r, 0, 7); g2.fill(); g2.shadowBlur = 0; g2.fillStyle = rgba(WHITE, a); g2.beginPath(); g2.arc(p.x, p.y, r * 0.42, 0, 7); g2.fill(); g2.shadowBlur = 14; });
    g2.restore();
  }
  function ring(p, rad, col, a, lw = 4) { if (a <= 0.003) return; g2.save(); g2.strokeStyle = rgba(col, a); g2.shadowColor = rgba(col, a); g2.shadowBlur = 12; g2.lineWidth = lw; g2.beginPath(); g2.arc(p.x, p.y, rad, 0, 7); g2.stroke(); g2.restore(); }
  function poly(pts, fill, stroke, lw = 3) { g2.beginPath(); pts.forEach((p, i) => (i ? g2.lineTo(p.x, p.y) : g2.moveTo(p.x, p.y))); g2.closePath(); if (fill) { g2.fillStyle = fill; g2.fill(); } if (stroke) { g2.strokeStyle = stroke; g2.lineWidth = lw; g2.stroke(); } }

  const ANCH = {};
  let lastCom = null;

  // ---------------------------------------------------------------- render(state)
  function render(s) {
    const T = s.t;
    // --- belt + crates
    const feed = s.feed || 0;
    beltMats.forEach((m) => { if (m.map) m.map.offset.y = -(feed * L.GAP) * (s.beltK ?? 0.5); });
    const cDir = fromArr(L.dir(L.PHI_C));
    const tx = s.tx ?? L.T_X, tt = s.tt || 0;
    station.position.set(tx, 0, 0); stationTop.rotation.y = tt;
    const stationM = new THREE.Matrix4().makeTranslation(tx, 0, 0).multiply(new THREE.Matrix4().makeRotationY(tt));
    const cid = Math.round(s.cid ?? 0);
    const active = crateMat(s.cphi ?? L.PHI_C, s.cr ?? L.C_R, s.ch ?? L.BELT_Y, s.clat || 0);
    crates.forEach((c, i) => {
      let M;
      if (i < cid) {   // placed: slot pose recorded in the turntable frame at the time it was placed
        const layer = i >> 2, j = i & 1, ang = (i < 2) ? 0 : (i < 6 ? Math.PI : 2 * Math.PI);
        const sl = L.slot(j, layer); const Wp = crateMat(0, sl.r, sl.h, sl.lat);
        const S0 = new THREE.Matrix4().makeTranslation(L.T_X, 0, 0).multiply(new THREE.Matrix4().makeRotationY(ang));
        M = stationM.clone().multiply(S0.invert()).multiply(Wp);
      } else if (i === cid && feed >= i - 1e-4) M = active;
      else { const d = L.C_R + Math.max(0, (i - feed) * L.GAP); M = crateMat(L.PHI_C, d, L.BELT_Y, 0); }
      c.visible = i >= (s.cMin ?? 0) && (i < cid || i === cid || (i - feed) * L.GAP < 7.0);
      c.matrixAutoUpdate = false; c.matrix.copy(M); c.matrixWorldNeedsUpdate = true;
    });
    // ghost crate (human demo)
    const gC = crateMat(s.gphi ?? L.PHI_C, s.gr ?? L.C_R, s.gh ?? L.BELT_Y, s.glat || 0);
    ghostCrate.matrixAutoUpdate = false; ghostCrate.matrix.copy(gC); ghostCrate.matrixWorldNeedsUpdate = true;

    // --- robot
    clipPlane.constant = s.rev ?? 99;
    R.root.visible = (s.rev ?? 99) > 0.001;
    const lookR = V3().setFromMatrixPosition(active).add(V3(0, 0.12, 0));
    poseRig(R, CH.R, { pyaw: s.ryaw ?? 0, ph: s.rph ?? 0.655, pp: s.rpp || 0, pshift: s.rsh || 0, pback: s.rpb || 0, wy: s.rwy || 0, wp: s.rwp || 0,
      lfa: s.rlfa ?? s.ryaw ?? 0, rfa: s.rrfa ?? s.ryaw ?? 0, llift: s.rll || 0, rlift: s.rrl || 0, reach: s.rreach || 0, grip: s.rgrip || 0, crate: active, look: lookR, lookW: s.rlook || 0 });
    // --- human ghost
    const gop = s.ghost ?? 0;
    H.root.visible = gop > 0.003 || (s.cmp || 0) > 0.003;
    ghostMats.forEach((m) => (m.uniforms.uOp.value = gop));
    ghostCrate.visible = (s.gcrate ?? gop) > 0.003; ghostCrate.traverse((o) => { if (o.isMesh) o.material.uniforms && (o.material.uniforms.uOp.value = s.gcrate ?? gop); });
    poseRig(H, CH.H, { x: s.hx || 0, z: s.hz || 0, pyaw: s.hyaw ?? L.PHI_C, ph: s.hph ?? 0.86, pp: s.hpp || 0, pshift: s.hsh || 0, pback: s.hpb || 0, wy: s.hwy || 0, wp: s.hwp || 0,
      lfa: s.hlfa ?? s.hyaw ?? L.PHI_C, rfa: s.hrfa ?? s.hyaw ?? L.PHI_C, llift: s.hll || 0, rlift: s.hrl || 0, reach: s.hreach || 0, grip: 0, crate: gC, look: V3().setFromMatrixPosition(gC), lookW: s.hlook || 0 });

    // --- lights / time of day
    const day = s.day || 0;
    key.color.setHSL(0.09 - 0.03 * day, 0.35 + 0.25 * day, 0.62 - 0.1 * day); key.intensity = 2.4 * (s.key ?? 1);
    key.position.set(3 - 5 * day, 7 - 2.2 * day, 2.5 - 1 * day);

    // --- camera
    const tgt = V3(s.tx_ ?? 0.2, s.ty ?? 0.8, s.tz ?? 0);
    const dist = Math.exp(s.logD ?? Math.log(4)), az = (s.camAz ?? 30) * DEG, el = (s.camEl ?? 8) * DEG;
    camera.fov = s.fov ?? 30; camera.up.set(0, 1, 0);
    camera.position.set(tgt.x + dist * Math.cos(el) * Math.sin(az), tgt.y + dist * Math.sin(el), tgt.z + dist * Math.cos(el) * Math.cos(az));
    camera.lookAt(tgt); camera.rotateZ((s.camRoll || 0) * DEG);
    camera.near = Math.max(0.03, dist * 0.01); camera.far = 200;
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    gtao.blendIntensity = s.ao ?? 1;
    bokeh.uniforms.focus.value = s.focus || dist; bokeh.uniforms.aperture.value = s.aperture || 0; bokeh.uniforms.maxblur.value = s.maxblur || 0.008; bokeh.enabled = (s.aperture || 0) > 0;
    bloom.strength = s.bloom ?? 0.3;
    renderer.toneMappingExposure = s.exp ?? 1;
    composer.render();

    // ---------------------------------------------------------------- overlays (2D)
    g2.clearRect(0, 0, width, height);
    const hk = keypoints(H), rk = keypoints(R);
    // reveal ring
    if ((s.rev ?? 99) < 1.45 && (s.rev ?? 99) > 0.001) {
      const pts = []; for (let i = 0; i <= 48; i++) { const a = i / 48 * Math.PI * 2; pts.push(proj(V3(Math.cos(a) * 0.36, s.rev, Math.sin(a) * 0.36))); }
      g2.save(); g2.shadowColor = rgba(LIME, 1); g2.shadowBlur = 18; poly(pts, rgba(LIME, 0.08), rgba(LIME, 0.9), 4); g2.restore();
    }
    // human skeleton (tracking look)
    skel(hk, CYAN, s.hSk || 0, { r: 9, lw: 5 });
    // mapping: dots travel from the human to the robot, staggered, turning lime
    const map = s.map || 0;
    if (map > 0.001 && (s.mapA ?? 1) > 0.003) {
      const pts = [], cols = [];
      hk.forEach((h, i) => { const u = ss(i * 0.035, i * 0.035 + 0.5, map); pts.push(h.clone().lerp(rk[i], u)); cols.push(mixC(CYAN, LIME, u)); });
      skel(pts, LIME, s.mapA ?? 1, { r: 9, lw: 5, cols });
    }
    skel(rk, LIME, s.rSk || 0, { r: 8, lw: 4 });
    // comparison: a human-proportioned skeleton beside the robot, joint-to-joint mapping lines
    const cmp = s.cmp || 0;
    if (cmp > 0.003) {
      skel(hk, CYAN, cmp, { r: 8, lw: 4 });
      g2.save(); g2.setLineDash([10, 10]); g2.lineWidth = 3;
      hk.forEach((h, i) => { if (i === 1 || i === 8) return; const u = ss(i * 0.05, i * 0.05 + 0.3, s.cmpL || 0); if (u <= 0) return; const a = proj(h), b = proj(rk[i]); g2.strokeStyle = rgba(WHITE, 0.55 * cmp * u); g2.beginPath(); g2.moveTo(a.x, a.y); g2.lineTo(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u); g2.stroke(); });
      g2.restore();
    }
    // 30 actuated joints
    const nr = s.rings || 0;
    if (nr > 0.001 && (s.ringA ?? 1) > 0.003) {
      ringOrder.forEach((ri, k) => { const u = clamp01(nr - k); if (u <= 0) return; const p = proj(jointPos(R, RING[ri])); const pop = 1 + 0.6 * (1 - ss(0, 1, u)) * (u < 1 ? 1 : 0);
        g2.save(); g2.fillStyle = rgba(LIME, 0.9 * (s.ringA ?? 1) * u); g2.shadowColor = rgba(LIME, 1); g2.shadowBlur = 14; g2.beginPath(); g2.arc(p.x, p.y, 7 * pop, 0, 7); g2.fill(); g2.restore();
        ring(p, 15 * pop, LIME, (s.ringA ?? 1) * u, 3); });
    }
    // head cameras: frustums onto the active crate
    const fru = s.fru || 0;
    if (fru > 0.003) {
      const cam = V3(0.075, 0, 0.045).applyMatrix4(R.links.head_pitch_link.matrixWorld);
      const cs = [[-0.30, -0.2], [0.30, -0.2], [0.30, 0.2], [-0.30, 0.2]].map(([x, z]) => V3(x, L.CRATE[1], z).applyMatrix4(active));
      const C = proj(cam), Q = cs.map(proj);
      g2.save();
      for (let i = 0; i < 4; i++) { const a = Q[i], b = Q[(i + 1) % 4]; poly([C, a, b], rgba(CYAN, 0.07 * fru), null); }
      g2.strokeStyle = rgba(CYAN, 0.8 * fru); g2.lineWidth = 2.5; g2.shadowColor = rgba(CYAN, 1); g2.shadowBlur = 10;
      Q.forEach((q) => { g2.beginPath(); g2.moveTo(C.x, C.y); g2.lineTo(q.x, q.y); g2.stroke(); });
      poly(Q, rgba(CYAN, 0.12 * fru), rgba(CYAN, 0.95 * fru), 3);
      g2.restore();
      ANCH.cam = cam;
    }
    // grasp markers at the handles
    const gmk = s.gm || 0;
    if (gmk > 0.003) {
      const ht = handTargets(active, 1);
      for (const k of ['l', 'r']) { const p = proj(ht[k].p); const pop = 1 + 0.5 * (1 - ss(0, 1, gmk));
        ring(p, 24 * pop, LIME, gmk, 4); g2.save(); g2.strokeStyle = rgba(LIME, gmk); g2.lineWidth = 3; g2.beginPath(); g2.moveTo(p.x - 34, p.y); g2.lineTo(p.x - 14, p.y); g2.moveTo(p.x + 14, p.y); g2.lineTo(p.x + 34, p.y); g2.moveTo(p.x, p.y - 34); g2.lineTo(p.x, p.y - 14); g2.moveTo(p.x, p.y + 14); g2.lineTo(p.x, p.y + 34); g2.stroke(); g2.restore(); }
      ANCH.gripR = ht.r.p; ANCH.gripL = ht.l.p;
    }
    // centre of mass over the support polygon
    const cm = com(R, (s.rreach || 0) > 0.5 && (s.rhold || 0) > 0.5 ? { p: V3(0, 0.1, 0).applyMatrix4(active), m: 4 } : null);
    lastCom = cm;
    const comA = s.com || 0;
    const hull = footHull(R);
    const margin = polyDist(hull, cm.x, cm.z);
    if (comA > 0.003) {
      const HP = hull.map(([x, z]) => proj(V3(x, 0.004, z)));
      const warn = ss(0.035, 0.012, margin) * (s.comWarn ?? 1);
      const col = mixC(LIME, RED, warn);
      g2.save(); g2.shadowColor = rgba(col, 1); g2.shadowBlur = 16; poly(HP, rgba(col, 0.16 * comA), rgba(col, 0.9 * comA), 4); g2.restore();
      const top = proj(cm), bot = proj(V3(cm.x, 0.004, cm.z));
      g2.save(); g2.setLineDash([8, 8]); g2.strokeStyle = rgba(WHITE, 0.8 * comA); g2.lineWidth = 3; g2.beginPath(); g2.moveTo(top.x, top.y); g2.lineTo(bot.x, bot.y); g2.stroke(); g2.restore();
      g2.save(); g2.fillStyle = rgba(col, comA); g2.shadowColor = rgba(col, 1); g2.shadowBlur = 20; g2.beginPath(); g2.arc(bot.x, bot.y, 13, 0, 7); g2.fill(); g2.fillStyle = rgba(WHITE, comA); g2.beginPath(); g2.arc(top.x, top.y, 11, 0, 7); g2.fill(); g2.restore();
      ring(top, 20, WHITE, comA, 3);
      ANCH.comTop = cm.clone(); ANCH.comFloor = V3(cm.x, 0, cm.z);
    }
    // height dimension beside the robot
    const dim = s.dim || 0;
    if (dim > 0.003) {
      const side = fromArr(L.right(s.ryaw ?? 0)).multiplyScalar(-0.42);
      const a = proj(V3(side.x, 0, side.z)), b = proj(V3(side.x, 1.31 * ss(0, 1, dim), side.z));
      g2.save(); g2.strokeStyle = rgba(WHITE, 0.95); g2.lineWidth = 4; g2.shadowColor = 'rgba(0,0,0,0.8)'; g2.shadowBlur = 8;
      g2.beginPath(); g2.moveTo(a.x, a.y); g2.lineTo(b.x, b.y); g2.moveTo(a.x - 18, a.y); g2.lineTo(a.x + 18, a.y); if (dim > 0.98) { g2.moveTo(b.x - 18, b.y); g2.lineTo(b.x + 18, b.y); } g2.stroke(); g2.restore();
      ANCH.dimMid = V3(side.x, 0.66, side.z);
    }
    ANCH.robotHead = V3(0, 0.12, 0).applyMatrix4(R.links.head_pitch_link.matrixWorld);
    ANCH.crate = V3(0, 0.23, 0).applyMatrix4(active);
    ANCH.pallet = V3(tx, L.T_H + 0.6, 0);
    ANCH.humanHead = hk[0]; ANCH.hSh = hk[2]; ANCH.hEl = hk[4]; ANCH.hWr = hk[6]; ANCH.hHip = hk[10]; ANCH.hKn = hk[12]; ANCH.rKn = rk[12];
    window.__dbg = { margin: +margin.toFixed(3), com: cm.toArray().map((v) => +v.toFixed(3)), hand: R.joints.left_elbow_joint.q.toFixed(2) };
  }

  function project(name) {
    const p = ANCH[name]; if (!p) return null; const v = p.clone().project(camera); if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height };
  }
  return { load, render, project, rigs: () => ({ R, H }) };
}
