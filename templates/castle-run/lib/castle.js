// Castle run: a stylised heroine sprinting through a medieval castle, for HyperFrames (1080x1920).
// Real models (all CC BY 4.0, Sketchfab):
//   "Fantasy Girl" by loriserio, "Medieval Pentagon Castle" by Sereib, "Throne Room" by Ugur Yakisik.
// Code-built: ground, courtyard cobbles, the hall's entrance wall + doorway, torch flames.
// Everything on screen is a pure function of the time t passed to render(t).
// Units: metres, +Y up. The heroine's run cycle is phase-locked to the distance she covers, so her feet never slide.

import * as THREE from './three.module.js';
import { GLTFLoader } from './jsm/loaders/GLTFLoader.js';
import { HDRLoader } from './jsm/loaders/HDRLoader.js';
import { EffectComposer } from './jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './jsm/postprocessing/OutputPass.js';
import { SMAAPass } from './jsm/postprocessing/SMAAPass.js';
import { fixGirlMaterials } from './girlmat.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const lerp = (a, b, k) => a + (b - a) * k;
const hash = (x, s = 0) => { const v = Math.sin(x * 127.1 + s * 311.7) * 43758.5453; return v - Math.floor(v); };
const noise1 = (x, s = 0) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash(i, s), hash(i + 1, s), u); };

// ---------------- plan ----------------
export const HEIGHT = 1.66;               // heroine's standing height (top of head, without the hair tuft), metres
export const RATE = 1.0;                  // run cycle at its native speed (0.8 s cycle); ground speed comes from the measured stride
export const WALL_Y = 10.0;               // west wall-walk deck
export const WALK_X = -22.27;             // wall-walk centreline (deck spans x -23.2 .. -21.35)
export const HALL_S = 0.1;                // Throne Room model units -> metres
export const GATE_A = 36 * DEG;           // gate passage direction from the castle centre
// Courtyard route: through the gate, round the north side of the keep, towards the west wall (x, z)
const P1 = [[25.5, 18.5], [21.0, 15.26], [13.8, 10.0], [7.0, 11.4], [0.0, 13.2], [-7.0, 12.4], [-13.0, 9.0], [-16.5, 5.0], [-18.5, 1.0]];

// Shots: [start, set, name]. Durations follow from the next start.
export const SHOTS = [
  [0.0, 'ext', 'gate'],
  [3.3, 'ext', 'yard'],
  [7.4, 'ext', 'wallFront'],
  [10.0, 'ext', 'wallSide'],
  [12.3, 'hall', 'door'],
  [15.8, 'hall', 'stop'],
  [18.6, 'hall', 'grab'],
  [21.4, 'hall', 'victory'],
];
export const DUR = 27.5;
export const shotAt = (t) => { let k = 0; for (let i = 0; i < SHOTS.length; i++) if (t >= SHOTS[i][0] - 1e-6) k = i; return { i: k, t0: SHOTS[k][0], t1: k + 1 < SHOTS.length ? SHOTS[k + 1][0] : DUR, set: SHOTS[k][1], name: SHOTS[k][2] }; };

function canvasTex(w, h, draw, repeat = [1, 1], srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = 16; return t;
}
function normalFromCanvas(src, strength = 3) {
  const w = src.width, h = src.height, g = src.getContext('2d'), d = g.getImageData(0, 0, w, h).data;
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g2 = c.getContext('2d'), out = g2.createImageData(w, h);
  const H = (x, y) => d[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const n = V3(-dx, dy, 1).normalize(), i = (y * w + x) * 4;
    out.data[i] = (n.x * 0.5 + 0.5) * 255; out.data[i + 1] = (n.y * 0.5 + 0.5) * 255; out.data[i + 2] = (n.z * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  g2.putImageData(out, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 16; return t;
}

// cobblestones: tileable Voronoi setts (colour + height canvases), seeded hash
function cobbles(N = 1024, cells = 14) {
  const col = document.createElement('canvas'), hgt = document.createElement('canvas'); col.width = hgt.width = col.height = hgt.height = N;
  const gc = col.getContext('2d'), gh = hgt.getContext('2d'); const ci = gc.createImageData(N, N), hi = gh.createImageData(N, N);
  const P = []; for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) P.push([(i + 0.15 + hash(i * 31 + j, 1) * 0.7) / cells, (j + 0.15 + hash(i + j * 57, 2) * 0.7) / cells, 0.7 + hash(i * 3 + j * 7, 3) * 0.55, hash(i * 11 + j, 4)]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, gi = Math.floor(u * cells), gj = Math.floor(v * cells); let d1 = 9, d2 = 9, k1 = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = gi + di, jj = gj + dj, wi = (ii + cells) % cells, wj = (jj + cells) % cells; const p = P[wj * cells + wi];
      const px = p[0] + (ii - wi) / cells, py = p[1] + (jj - wj) / cells; const d = Math.hypot(px - u, py - v);
      if (d < d1) { d2 = d1; d1 = d; k1 = wj * cells + wi; } else if (d < d2) d2 = d;
    }
    const e = (d2 - d1) * cells;                          // 0 at the joints
    const dome = Math.min(1, e / 0.22), top = Math.sqrt(Math.max(0, dome)) * (1 - d1 * cells * 0.35);
    const p = P[k1], n = hash(x * 0.37 + y * 1.13, 7) * 0.08; const joint = e < 0.06;
    const tone = joint ? 0.38 : p[2] * (0.86 + top * 0.18 + n);
    const warm = p[3];
    const o = (y * N + x) * 4;
    ci.data[o] = Math.min(255, (118 + warm * 22) * tone); ci.data[o + 1] = Math.min(255, (110 + warm * 10) * tone); ci.data[o + 2] = Math.min(255, (100 - warm * 8) * tone); ci.data[o + 3] = 255;
    const hv = joint ? 0 : Math.min(255, 70 + top * 185); hi.data[o] = hi.data[o + 1] = hi.data[o + 2] = hv; hi.data[o + 3] = 255;
  }
  gc.putImageData(ci, 0, 0); gh.putImageData(hi, 0, 0);
  return { col, hgt };
}
// dressed stone blocks for the hall's entrance wall (3.2 m tile)
function ashlar(N = 1024) {
  const c = document.createElement('canvas'), h = document.createElement('canvas'); c.width = h.width = c.height = h.height = N;
  const g = c.getContext('2d'), gh = h.getContext('2d'); g.fillStyle = '#2b2925'; g.fillRect(0, 0, N, N); gh.fillStyle = '#000'; gh.fillRect(0, 0, N, N);
  const rows = 8, rh = N / rows;
  for (let r = 0; r < rows; r++) { let x = -hash(r, 5) * N * 0.2; let k = 0;
    while (x < N) { const w = N * (0.16 + hash(r * 17 + k, 6) * 0.14); const v = 0.75 + hash(r * 7 + k * 3, 7) * 0.4;
      for (const ox of [0, N]) { const xx = x + ox - (x + w > N ? N : 0) * 0;
        g.fillStyle = `rgb(${Math.round(92 * v)},${Math.round(88 * v)},${Math.round(82 * v)})`; g.fillRect(x + 3, r * rh + 3, w - 6, rh - 6);
        gh.fillStyle = '#ccc'; gh.fillRect(x + 3, r * rh + 3, w - 6, rh - 6); }
      x += w; k++; } }
  for (let i = 0; i < 26000; i++) { const x = hash(i, 51) * N, y = hash(i, 52) * N, v = hash(i, 53); g.fillStyle = `rgba(${v < 0.5 ? 20 : 140},${v < 0.5 ? 18 : 132},${v < 0.5 ? 16 : 120},${0.06 + hash(i, 54) * 0.08})`; g.fillRect(x, y, 2 + v * 5, 2 + v * 4); gh.fillStyle = `rgba(${v < 0.5 ? 0 : 255},${v < 0.5 ? 0 : 255},${v < 0.5 ? 0 : 255},0.06)`; gh.fillRect(x, y, 2 + v * 5, 2 + v * 4); }
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 16;
  const normal = normalFromCanvas(h, 2.5); return { map, normal };
}
function grassCanvas(N = 1024) {
  const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
  g.fillStyle = '#4c5a2c'; g.fillRect(0, 0, N, N);
  for (let k = 0; k < 60000; k++) { const x = hash(k, 21) * N, y = hash(k, 22) * N, v = hash(k, 23); g.strokeStyle = v < 0.5 ? `rgba(${70 + v * 60},${88 + v * 50},${38},0.55)` : `rgba(${44 + v * 30},${60 + v * 20},${26},0.5)`; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (hash(k, 24) - 0.5) * 5, y - 4 - hash(k, 25) * 8); g.stroke(); }
  for (let k = 0; k < 40; k++) { const x = hash(k, 31) * N, y = hash(k, 32) * N, r = 30 + hash(k, 33) * 90; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(95,84,60,0.35)'); gr.addColorStop(1, 'rgba(95,84,60,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
  return c;
}
function dirtCanvas(N = 1024) {
  const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
  g.fillStyle = '#6b5a44'; g.fillRect(0, 0, N, N);
  for (let k = 0; k < 30000; k++) { const x = hash(k, 41) * N, y = hash(k, 42) * N, v = hash(k, 43); g.fillStyle = `rgba(${80 + v * 70},${66 + v * 56},${48 + v * 40},0.5)`; g.fillRect(x, y, 1 + v * 4, 1 + v * 3); }
  return c;
}

export function createCastle(canvas, { width = 1080, height = 1920 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1); renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.05, 900);
  const pmrem = new THREE.PMREMGenerator(renderer);

  const ext = new THREE.Group(), hall = new THREE.Group(); scene.add(ext, hall);
  const holder = new THREE.Group(); scene.add(holder);   // the heroine (scaled to metres)
  let girl = null, mixer = null, acts = {}, RUN = null;
  let castle = null, throne = null, envExt = null, envHall = null, skyTex = null;
  const floorsExt = [], floorsHall = [];
  const flames = [];   // { mesh, light, base, seed }

  // ----- lights -----
  const sun = new THREE.DirectionalLight(0xffc68a, 3.2); sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  const sc = sun.shadow.camera; sc.near = 1; sc.far = 160; sc.left = sc.bottom = -16; sc.right = sc.top = 16;
  ext.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xfff0e0, 0.4); scene.add(fill, fill.target);
  const hemi = new THREE.HemisphereLight(0xbcc8e0, 0x4a3e30, 0.35); ext.add(hemi);
  const hallAmb = new THREE.HemisphereLight(0x9aa0b8, 0x3a2a1c, 0.55); hall.add(hallAmb);
  const doorLight = new THREE.SpotLight(0xffc88a, 90, 40, 24 * DEG, 0.6, 1.6); doorLight.castShadow = true; doorLight.shadow.mapSize.set(2048, 2048); doorLight.shadow.bias = -0.0005;
  hall.add(doorLight, doorLight.target);

  // ----- post -----
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(width / 2, height / 2), 0.35, 0.6, 0.85); composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(new SMAAPass(width, height));

  // ----- paths -----
  let pathYard = null, pathYardLen = 0;
  const yardPt = (s) => { const u = clamp(s / pathYardLen, 0, 1); const p = pathYard.getPointAt(u), d = pathYard.getTangentAt(u); return { p: V3(p.x, 0, p.z), dir: V3(d.x, 0, d.z).normalize() }; };

  // Character timing per segment: distance along the path as a function of shot time.
  const SPEED = { v: 5 };   // filled in at load from the run clip
  // Segments: [tStart, tEnd, kind, params]
  function charAt(t) {
    const sh = shotAt(t), v = SPEED.v;
    if (sh.name === 'gate' || sh.name === 'yard') {
      const s = S_GATE0 + v * t; const { p, dir } = yardPt(s);
      return { set: 'ext', p, dir, dist: s, mode: 'run', floor: 0 };
    }
    if (sh.name === 'wallFront' || sh.name === 'wallSide') {
      const t0 = SHOTS[2][0]; const s = (t - t0) * v; const z = WALL_Z0 - s;
      return { set: 'ext', p: V3(WALK_X, WALL_Y, z), dir: V3(0, 0, -1), dist: s, mode: 'run', floor: WALL_Y };
    }
    // hall: run down the aisle, decelerate, stop, idle
    const t0 = SHOTS[4][0], tStop = T_DECEL, D = DECEL_D;
    let s;
    if (t < tStop) s = (t - t0) * v; else { const k = Math.min(t - tStop, D); s = (tStop - t0) * v + v * k - v * k * k / (2 * D); }
    const z = HALL_Z0 - s;
    return { set: 'hall', p: V3(AISLE_X, AISLE_Y, z), dir: V3(0, 0, -1), dist: s, mode: t < tStop ? 'run' : 'stop', tStop, floor: AISLE_Y };
  }
  // tuned after the run speed is known (see load)
  let S_GATE0 = 0, WALL_Z0 = 10.6, HALL_Z0 = 17.6, AISLE_X = 0.05, AISLE_Y = 2.07, T_DECEL = 16.0, DECEL_D = 0.9, STOP_Z = -1.0;
  const BLEND0 = 0.55, BLEND_D = 0.4;   // run -> idle blend starts 0.55 s into the stop (speed ~1.7 m/s)

  // ----- pose -----
  function runPhaseT(dist) {   // clip time whose root-motion distance matches dist (mod one cycle)
    const r = ((dist % RUN.L) + RUN.L) % RUN.L, D = RUN.Dc; let lo = 0, hi = RUN.N;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (D[mid] <= r) lo = mid; else hi = mid; }
    const f = D[hi] > D[lo] ? (r - D[lo]) / (D[hi] - D[lo]) : 0; return (lo + f) / RUN.N * RUN.T;
  }
  const W = { run: 0, idle: 0 };
  // three's PropertyMixer only writes a bone when its animated value changes, so IK edits would leak into the next pose:
  // remember each bone's pre-IK rotation and put it back before the mixer runs.
  const IKSAVE = [];
  const HANDS = { l: null, r: null };
  // Hands use poses the author made: right = the weapon grip from BattleMode_generic, left = relaxed (45% from open idle toward that grip).
  const HP = { open: null, grip: null, wR: 1.0, wL: 0.7 };
  const handBones = (sd) => [...HANDS[sd].fingers.flat(), ...HANDS[sd].thumb];
  function handCurlL(t) { return FLAG && FLAG.wGrip != null ? HP.wL + (FLAG.wGrip - HP.wL) * FLAG.curlL(t) : HP.wL; }
  function applyHands(t) {
    if (!HP.grip) return;
    for (const sd of ['l', 'r']) { const bs = handBones(sd), w = sd === 'r' ? HP.wR : handCurlL(t);
      bs.forEach((b, k) => { IKSAVE.push([b, b.quaternion.clone()]); b.quaternion.copy(HP.open[sd][k]).slerp(HP.grip[sd][k], w); }); }
  }
  function setPose(t, c) {
    for (const [b, q] of IKSAVE) b.quaternion.copy(q); IKSAVE.length = 0;
    for (const a of Object.values(acts)) { a.enabled = true; a.setEffectiveWeight(0); }
    const runT = runPhaseT(c.dist);
    let wRun = 1, idleT = 0;
    if (c.mode === 'stop') { const k = t - c.tStop; wRun = 1 - smooth((k - BLEND0) / BLEND_D); idleT = Math.max(0, k - BLEND0); }
    acts.run.time = runT; acts.run.setEffectiveWeight(wRun);
    // idle: the look-around clip once, then a breathing loop (cross-faded)
    const d4 = acts.idle.getClip().duration, d2 = acts.idle2.getClip().duration, x0 = d4 - 0.45;
    const w2 = smooth((idleT - x0) / 0.4);
    acts.idle.time = Math.min(idleT, d4 - 0.001); acts.idle.setEffectiveWeight((1 - wRun) * (1 - w2));
    acts.idle2.time = Math.max(0, idleT - x0) % d2; acts.idle2.setEffectiveWeight((1 - wRun) * w2);
    W.run = wRun; W.idle = 1 - wRun;
    mixer.update(0);
    holder.position.copy(c.p); holder.rotation.set(0, Math.atan2(c.dir.x, c.dir.z), 0);
    holder.updateMatrixWorld(true);
    applyHands(t); holder.updateMatrixWorld(true);
  }

  // ----- foot IK lock (used while she stops) -----
  const LEG = { l: null, r: null };
  const _a = V3(), _b = V3(), _c = V3(), _t = V3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
  function twoBoneIK(A, B, C, target, hint) {
    A.getWorldPosition(_a); B.getWorldPosition(_b); C.getWorldPosition(_c);
    const lab = _b.distanceTo(_a), lcb = _b.distanceTo(_c), lat = clamp(target.distanceTo(_a), 0.01, lab + lcb - 0.002);
    const ca = _c.clone().sub(_a), ba = _b.clone().sub(_a), ab = _a.clone().sub(_b), cb = _c.clone().sub(_b), ta = target.clone().sub(_a);
    const ac_ab_0 = Math.acos(clamp(ca.clone().normalize().dot(ba.clone().normalize()), -1, 1));
    const ba_bc_0 = Math.acos(clamp(ab.clone().normalize().dot(cb.clone().normalize()), -1, 1));
    const ac_at_0 = Math.acos(clamp(ca.clone().normalize().dot(ta.clone().normalize()), -1, 1));
    const ac_ab_1 = Math.acos(clamp((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat), -1, 1));
    const ba_bc_1 = Math.acos(clamp((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb), -1, 1));
    let axis0 = ca.clone().cross(ba); const axis1 = ca.clone().cross(ta);
    if (axis0.length() < 0.02 * ca.length() * ba.length()) axis0 = ca.clone().cross(hint || V3(0, 0, 1).applyQuaternion(holder.quaternion));   // straight leg: knee bends toward her forward
    axis0.normalize();
    const a_gr = A.getWorldQuaternion(new THREE.Quaternion()), b_gr = B.getWorldQuaternion(new THREE.Quaternion());
    const r0 = new THREE.Quaternion().setFromAxisAngle(axis0.clone().applyQuaternion(a_gr.clone().invert()), ac_ab_1 - ac_ab_0);
    const r1 = new THREE.Quaternion().setFromAxisAngle(axis0.clone().applyQuaternion(b_gr.clone().invert()), ba_bc_1 - ba_bc_0);
    let r2 = new THREE.Quaternion();
    if (axis1.lengthSq() > 1e-12) r2.setFromAxisAngle(axis1.normalize().applyQuaternion(a_gr.clone().invert()), ac_at_0);
    A.quaternion.multiply(r0.multiply(r2)); B.quaternion.multiply(r1);
    A.updateMatrixWorld(true);
  }
  const footPt = (leg) => leg.heel.getWorldPosition(V3()).add(leg.toe.getWorldPosition(V3())).multiplyScalar(0.5);
  const soleH = (leg, floorY) => Math.min(leg.heel.getWorldPosition(V3()).y - leg.heelOff, leg.toe.getWorldPosition(V3()).y - leg.toeOff) - floorY;
  // Foot locking: whenever a raw (un-IK'd) foot is within 2.5 cm of the floor it is pinned (horizontally) where it touched down;
  // after it lifts, the pin offset fades out over 0.12 s. Stateless: contact start/end are found by scanning back in time.
  const LOCK_H = 0.025, RELEASE = 0.12, SCAN = 1 / 60, IK_FROM = () => T_DECEL - 0.4;
  function rawFoot(t, side) { const c = charAt(t); setPose(t, c); const leg = LEG[side]; return { on: soleH(leg, c.floor) < LOCK_H, mid: footPt(leg) }; }
  // Foot pinning, whole film. Per joint (heel, toe) contact timeline on a 1/60 s grid: a joint is planted while it is within
  // PLANT_H of the floor in the raw (un-IK'd) pose. The lowest planted joint of each foot is pinned where it touched down;
  // when a foot lifts, its offset fades out over RELEASE s. Results are memoised per grid index (pure functions of t).
  const PLANT_H = 0.02, JN = ['heel', 'toe'];
  const CT = { n: 0, raw: { l: [], r: [] }, on: {}, start: {}, memo: { l: new Map(), r: new Map() } };
  function rawJoints(t, side) { const c = charAt(t); setPose(t, c); const leg = LEG[side];
    const h = leg.heel.getWorldPosition(V3()), o = leg.toe.getWorldPosition(V3());
    return { heel: { p: h, h: h.y - leg.heelOff - c.floor }, toe: { p: o, h: o.y - leg.toeOff - c.floor }, shot: shotAt(t).i }; }
  function buildContacts() {
    CT.n = Math.ceil(DUR / SCAN) + 2;
    for (const side of ['l', 'r']) { const raw = []; for (let i = 0; i < CT.n; i++) raw.push(rawJoints(i * SCAN, side)); CT.raw[side] = raw;
      for (const j of JN) { const on = [], st = []; let cur = -1;
        for (let i = 0; i < CT.n; i++) { const ok = raw[i][j].h < PLANT_H && (i === 0 || raw[i - 1].shot === raw[i].shot || cur < 0); const isOn = raw[i][j].h < PLANT_H;
          if (isOn) { if (cur < 0 || raw[i - 1].shot !== raw[i].shot) cur = i; } else cur = -1; on.push(isOn); st.push(cur); }
        CT.on[side + j] = on; CT.start[side + j] = st; } }
  }
  const footOn = (side, i) => i >= 0 && i < CT.n && (CT.on[side + 'heel'][i] || CT.on[side + 'toe'][i]);
  function offsetAt(side, i) {     // horizontal pin offset (V3) for grid index i
    if (i < 0) return V3(); const memo = CT.memo[side]; if (memo.has(i)) return memo.get(i).clone();
    const raw = CT.raw[side]; let res;
    if (!footOn(side, i)) {
      let k = i; while (k > 0 && !footOn(side, k) && (i - k) * SCAN < RELEASE && raw[k].shot === raw[i].shot) k--;
      res = footOn(side, k) && raw[k].shot === raw[i].shot ? offsetAt(side, k).multiplyScalar(1 - clamp((i - k) * SCAN / RELEASE, 0, 1)) : V3();
    } else {
      let j = null; for (const jj of JN) if (CT.on[side + jj][i] && (j == null || raw[i][jj].h < raw[i][j].h)) j = jj;
      const s0 = CT.start[side + j][i];
      const before = s0 > 0 && raw[s0 - 1].shot === raw[s0].shot ? offsetAt(side, s0 - 1) : V3();   // where the foot actually was just before this joint planted
      const P = raw[s0][j].p.clone().add(before);
      res = V3(P.x - raw[i][j].p.x, 0, P.z - raw[i][j].p.z);
    }
    memo.set(i, res.clone()); return res;
  }
  const rawMid = (sd, i) => { const r = CT.raw[sd][Math.min(i, CT.n - 1)]; return r.heel.p.clone().add(r.toe.p).multiplyScalar(0.5).setY(0); };
  let STEP = null; let FLAG = null;
  function planStep() {   // after both feet have planted at the stop, which foot trails and when it steps up
    const ic = Math.round((T_DECEL + 1.0) / SCAN); if (!footOn('l', ic) || !footOn('r', ic)) { INFO.step = 'no double stance'; return; }
    const st = (sd) => Math.max(...JN.map((j) => CT.start[sd + j][ic]));
    const i0 = Math.max(st('l'), st('r')); const t0 = i0 * SCAN + 0.15;
    const ol = offsetAt('l', i0), or = offsetAt('r', i0); const fwd = V3(0, 0, -1);
    // a foot pinned ahead of where the idle pose wants it has offset along her forward direction
    const front = ol.dot(fwd) > or.dot(fwd) ? 'l' : 'r', back = front === 'l' ? 'r' : 'l';
    const iT = Math.round(t0 / SCAN);
    STEP = { t0, d: 0.42, front, back, frontOff: offsetAt(front, iT), backOff: offsetAt(back, iT) };
    INFO.step = { t0: +t0.toFixed(3), front, gap: +(STEP.frontOff.distanceTo(STEP.backOff) * 100).toFixed(1) };
  }
  function lockOffset(t, side) { const i = Math.round(t / SCAN); const o = offsetAt(side, i); return o.lengthSq() > 1e-10 ? o : null; }
  function applyIK(t, c) {
    const offs = { l: lockOffset(t, 'l'), r: lockOffset(t, 'r') };
    setPose(t, c);
    if (c.mode === 'stop') {
      let sh = V3();
      if (STEP && t >= STEP.t0) {
        // the trailing foot steps up beside the front one; the body settles over the front foot
        const u = smooth((t - STEP.t0) / STEP.d), uu = clamp((t - STEP.t0) / STEP.d, 0, 1);
        const of = offs[STEP.front] || V3(), ob = STEP.backOff;
        sh = ob.clone().add(STEP.frontOff).multiplyScalar(0.5).lerp(of, u);
        offs[STEP.front] = of.clone().sub(sh);
        let back;
        if (uu < 1) { back = ob.clone().sub(sh).multiplyScalar(1 - u); back.y = 0.08 * Math.sin(Math.PI * uu); }
        else {   // landed: pinned where it came down
          const i = Math.round(t / SCAN), iE = Math.round((STEP.t0 + STEP.d) / SCAN);
          const land = rawMid(STEP.back, iE).add(offsetAt(STEP.front, iE)); back = land.sub(rawMid(STEP.back, i)).sub(sh); back.y = 0;
        }
        offs[STEP.back] = back.lengthSq() > 1e-10 ? back : null;
      } else {   // body settles over whichever feet are planted
        let nOn = 0; for (const sd of ['l', 'r']) if (offs[sd]) { sh.add(offs[sd]); nOn++; } if (nOn) sh.multiplyScalar(1 / nOn);
        for (const sd of ['l', 'r']) if (offs[sd]) offs[sd] = offs[sd].clone().sub(sh);
      }
      holder.position.add(sh); holder.updateMatrixWorld(true); c.p = holder.position.clone();
    }
    for (const side of ['l', 'r']) {
      const off = offs[side]; if (!off || off.lengthSq() < 1e-8) continue; const leg = LEG[side];
      const q = leg.ankle.getWorldQuaternion(new THREE.Quaternion()); const target = leg.ankle.getWorldPosition(V3()).add(off);
      for (const b of [leg.thigh, leg.shin, leg.ankle]) IKSAVE.push([b, b.quaternion.clone()]);
      twoBoneIK(leg.thigh, leg.shin, leg.ankle, target); INFO['ik_' + side] = [target.distanceTo(leg.ankle.getWorldPosition(V3())), leg.thigh.getWorldPosition(V3()).distanceTo(target), leg.thigh.getWorldPosition(V3()).distanceTo(leg.shin.getWorldPosition(V3())) + leg.shin.getWorldPosition(V3()).distanceTo(leg.ankle.getWorldPosition(V3()))].map((v) => +(v * 100).toFixed(1));
      const pq = leg.ankle.parent.getWorldQuaternion(new THREE.Quaternion()).invert(); leg.ankle.quaternion.copy(pq.multiply(q)); leg.ankle.updateMatrixWorld(true);
    }
  }


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
    const g0 = 0.05, g1 = Math.max(0.08, kgf - 0.12); const gs = [];
    for (const p of pts) { const f = proj(p); if (f > g0 && f < g1) gs.push(p); }
    const gc = V3(); gs.forEach((p) => gc.add(p)); gc.multiplyScalar(1 / Math.max(1, gs.length));
    const rs = gs.map((p) => { const d = p.clone().sub(gc); return d.sub(axis.clone().multiplyScalar(d.dot(axis))).length(); }).sort((x, y) => x - y);
    const gripR = rs[Math.floor(rs.length * 0.9)] || 0.02;
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
    // refine the centre: the point (within 15 mm) farthest from every finger joint, still enclosed by the fingers
    { const pts = ring.concat(H.fingers.map((f) => wp(f[1]))); const score = (cc) => { let mn = 1e9, mx = 0; for (const p of pts) { const d = p.clone().sub(cc); const r = d.sub(ax.clone().multiplyScalar(d.dot(ax))).length(); mn = Math.min(mn, r); mx = Math.max(mx, r); } return { mn, mx }; };
      let best = null; for (let i = -15; i <= 15; i++) for (let j = -15; j <= 15; j++) { const cc = center.clone().add(u.clone().multiplyScalar(i / 1000)).add(v.clone().multiplyScalar(j / 1000)); const sc = score(cc); if (sc.mx > 0.036) continue; if (!best || sc.mn > best.mn) best = { ...sc, cc }; }
      if (best) { center.copy(best.cc); SWORD.jointMin = best.mn; SWORD.jointMax = best.mx; } }
    const fingerR = 0.0065; SWORD.tunnelR = (SWORD.jointMin ?? R) - fingerR; SWORD.fitR = R;
    const sLen = 0.98 / SWORD.len, sFit = SWORD.tunnelR / SWORD.gripR; SWORD.scale = sLen; SWORD.sp = Math.min(sLen, sFit);   // long axis to 0.98 m; cross-section slimmed so the grip fits inside her fingers
    const palmN = center.clone().sub(o); palmN.sub(ax.clone().multiplyScalar(palmN.dot(ax))).normalize();
    const B = SWORD.basis; const Rm = new THREE.Matrix4().makeBasis(B.guard, B.axis, B.third).transpose();
    const modelM = new THREE.Matrix4().makeScale(SWORD.sp, SWORD.scale, SWORD.sp).multiply(Rm).multiply(new THREE.Matrix4().makeTranslation(-B.gc.x, -B.gc.y, -B.gc.z));
    SWORD.model.matrixAutoUpdate = false; SWORD.model.matrix.copy(modelM);
    const z = palmN.clone().cross(ax).normalize(); const desired = new THREE.Matrix4().makeBasis(palmN, ax, z).setPosition(center);
    const root = new THREE.Group(); root.add(SWORD.model); root.matrixAutoUpdate = false;
    H.hand.updateMatrixWorld(true); root.matrix.copy(H.hand.matrixWorld.clone().invert().multiply(desired)); H.hand.add(root); SWORD.root = root;
    root.updateMatrixWorld(true);
    // sample points along the sword axis (canonical frame: +Y from the grip centre toward the tip)
    const yPommel = -(SWORD.gc.clone().sub(SWORD.basis.gc).length() + 0.09 * SWORD.len), yTip = 0.9 * SWORD.len;
    for (let k = 0; k <= 16; k++) { const ob = new THREE.Object3D(); ob.position.set(0, lerp(-0.08 * SWORD.len, yTip, k / 16) * SWORD.scale, 0); root.add(ob); SWORD.samples.push(ob); }
    INFO.sword = { scale: +SWORD.scale.toFixed(3), lengthM: +(SWORD.len * SWORD.scale).toFixed(3), gripRmm: +(SWORD.gripR * SWORD.sp * 1000).toFixed(1), crossScale: +(SWORD.sp / SWORD.scale).toFixed(2), tunnelRmm: +(SWORD.tunnelR * 1000).toFixed(1), jointMinMm: +((SWORD.jointMin || 0) * 1000).toFixed(1), jointMaxMm: +((SWORD.jointMax || 0) * 1000).toFixed(1) };
  }


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
    const socketH = 0.34; const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.034, socketH, 24, 1, true), iron); socket.position.y = 0.06 + socketH / 2; F.group.add(socket);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.027, 0.007, 8, 24), gold); lip.rotation.x = Math.PI / 2; lip.position.y = 0.06 + socketH; F.group.add(lip);
    F.socketTop = 0.06 + socketH; F.socketBottom = 0.07;
    // pole (local origin at its bottom end, +Y up)
    const poleL = 2.35, poleR = 0.012; const pole = new THREE.Mesh(new THREE.CylinderGeometry(poleR, poleR * 1.08, poleL, 20), wood); pole.position.y = poleL / 2; F.pole.add(pole);
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
    F.poleR = 0.012;
    // left-hand grip frame (fingers fully gripped)
    // grip weight: the tightest authored grip whose finger joints stay >= 7 mm clear of the pole surface
    const saveW = HP.wL; F.wGrip = null; let pick = null;
    for (let w = 1.0; w >= 0.5; w -= 0.05) { HP.wL = w; setPose(F.t.reach0, charAt(F.t.reach0)); holder.updateMatrixWorld(true); const gf = leftGripFrame();
      const hq = HANDS.l.hand.getWorldQuaternion(new THREE.Quaternion()), hp = HANDS.l.hand.getWorldPosition(V3()); const c = hp.clone().add(gf.centerL.clone().applyQuaternion(hq)), a = gf.axisL.clone().applyQuaternion(hq);
      const pts = []; for (const f of HANDS.l.fingers) for (const b of f.slice(1)) pts.push(b.getWorldPosition(V3())); { const tb = HANDS.l.fingers.map((f) => f[2].children.find((x) => x.isBone)).filter(Boolean); for (const b of tb) pts.push(b.getWorldPosition(V3())); }
      const u = pts[0].clone().sub(c); u.sub(a.clone().multiplyScalar(u.dot(a))).normalize(); const v = a.clone().cross(u);
      const score = (cc) => { let mn = 1e9, mx = 0; for (const p of pts) { const d = p.clone().sub(cc); const r = d.sub(a.clone().multiplyScalar(d.dot(a))).length(); mn = Math.min(mn, r); mx = Math.max(mx, r); } return { mn, mx }; };
      let best = null; for (let i = -15; i <= 15; i++) for (let j = -15; j <= 15; j++) { const cc = c.clone().add(u.clone().multiplyScalar(i / 1000)).add(v.clone().multiplyScalar(j / 1000)); const sc = score(cc); if (sc.mx > 0.034) continue; if (!best || sc.mn > best.mn) best = { ...sc, cc }; }
      if (best && best.mn >= F.poleR + 0.006) { gf.centerL = best.cc.clone().sub(hp).applyQuaternion(hq.clone().invert()); pick = { w, gf, mn: best.mn, mx: best.mx }; break; } }
    HP.wL = saveW; if (!pick) throw new Error('no left grip fits the pole');
    F.gf = pick.gf; F.wGrip = pick.w; INFO.leftGrip = { w: +pick.w.toFixed(2), minJointMm: +(pick.mn * 1000).toFixed(1), maxJointMm: +(pick.mx * 1000).toFixed(1) };
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
    F.pole.position.copy(bottom); F.pole.quaternion.setFromAxisAngle(V3(0, 1, 0), Math.PI); F.pole.updateMatrixWorld(true);   // banner flies on the outer (left) side
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

  // ----- build -----
  async function load(base = 'assets/') {
    const gl = new GLTFLoader();
    const hdr = await new Promise((res, rej) => { const l = new HDRLoader(); l.setDataType(THREE.FloatType); l.load(base + 'hdri/belfast_sunset_puresky_2k.hdr', res, undefined, rej); });
    hdr.mapping = THREE.EquirectangularReflectionMapping; skyTex = hdr;
    envExt = pmrem.fromEquirectangular(hdr).texture;
    // brightest pixel of the HDRI = sun direction (in HDRI space)
    { const d = hdr.image.data, w = hdr.image.width, h = hdr.image.height; let best = -1, bi = 0; for (let i = 0; i < w * h; i++) { const L = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]; if (L > best) { best = L; bi = i; } }
      const u = (bi % w) / w, v = Math.floor(bi / w) / h; const phi = u * Math.PI * 2, th = v * Math.PI;
      // three's equirect: direction = (-cos(phi)·sin(th)?)... computed empirically below via SUN_U
      SUNUV.u = u; SUNUV.v = v; }

    // castle
    const cg = await gl.loadAsync(base + 'models/castle/scene.gltf'); castle = cg.scene;
    castle.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; const m = o.material; if (m.map) m.map.anisotropy = 16; m.envMapIntensity = 0.9; floorsExt.push(o); } });
    ext.add(castle);
    // courtyard cobbles (pentagon, slightly larger than the inner wall faces) + outer meadow + path to the gate
    const cb = cobbles(1024, 14); const cobCol = new THREE.CanvasTexture(cb.col); cobCol.colorSpace = THREE.SRGBColorSpace; cobCol.wrapS = cobCol.wrapT = THREE.RepeatWrapping; cobCol.anisotropy = 16;
    const cobN = normalFromCanvas(cb.hgt, 4);
    const rep = 1 / 3.2; cobCol.repeat.set(rep, rep); cobN.repeat.set(rep, rep);
    const pent = new THREE.Shape(); for (let k = 0; k <= 5; k++) { const a = k * 72 * DEG, R = 27.5; const x = Math.cos(a) * R, z = Math.sin(a) * R; if (k === 0) pent.moveTo(x, -z); else pent.lineTo(x, -z); }
    const yard = new THREE.Mesh(new THREE.ShapeGeometry(pent), new THREE.MeshStandardMaterial({ map: cobCol, normalMap: cobN, normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.82, metalness: 0 }));
    yard.rotation.x = -Math.PI / 2; yard.position.y = 0.002; yard.receiveShadow = true; ext.add(yard); floorsExt.push(yard);
    // gate passage + approach: cobbled strip
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(5.0, 16), yard.material);
    strip.rotation.set(-Math.PI / 2, Math.atan2(Math.cos(GATE_A), Math.sin(GATE_A)), 0, 'YXZ'); strip.position.set(Math.cos(GATE_A) * 29, 0.001, Math.sin(GATE_A) * 29); strip.receiveShadow = true; ext.add(strip); floorsExt.push(strip);
    const grass = new THREE.CanvasTexture(grassCanvas(1024)); grass.colorSpace = THREE.SRGBColorSpace; grass.wrapS = grass.wrapT = THREE.RepeatWrapping; grass.repeat.set(80, 80); grass.anisotropy = 16;
    const meadow = new THREE.Mesh(new THREE.CircleGeometry(400, 64), new THREE.MeshStandardMaterial({ map: grass, roughness: 0.95, metalness: 0 }));
    meadow.rotation.x = -Math.PI / 2; meadow.position.y = -0.002; meadow.receiveShadow = true; ext.add(meadow); floorsExt.push(meadow);

    // hall
    const tg = await gl.loadAsync(base + 'models/throne.glb'); throne = tg.scene; throne.scale.setScalar(HALL_S);
    throne.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; const m = o.material; if (m.map) m.map.anisotropy = 16; floorsHall.push(o);
      if (/glass/i.test(m.name)) { m.emissive = new THREE.Color(1, 1, 1); m.emissiveMap = m.map; m.emissiveIntensity = 0.7; } } });
    hall.add(throne);
    // entrance wall with an arched doorway at the open end of the hall (z = 16.12 m)
    const hb = new THREE.Box3().setFromObject(throne); HALL.box = hb;
    const ash = ashlar(1024);
    const wallMat = new THREE.MeshStandardMaterial({ map: ash.map, normalMap: ash.normal, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.88, metalness: 0 });
    const endW = hb.max.x - hb.min.x + 2, endH = hb.max.y - hb.min.y + 2;
    const sh = new THREE.Shape(); sh.moveTo(-endW / 2, 0); sh.lineTo(endW / 2, 0); sh.lineTo(endW / 2, endH); sh.lineTo(-endW / 2, endH); sh.lineTo(-endW / 2, 0);
    const dw = 1.7, dh = 3.4, hole = new THREE.Path(); hole.moveTo(-dw, 0); hole.lineTo(-dw, dh); hole.absarc(0, dh, dw, Math.PI, 0, true); hole.lineTo(dw, 0); hole.lineTo(-dw, 0); sh.holes.push(hole);
    const eg = new THREE.ExtrudeGeometry(sh, { depth: 0.8, bevelEnabled: false }); const uv = eg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3.2, uv.getY(i) / 3.2);
    const endWall = new THREE.Mesh(eg, wallMat); endWall.position.set((hb.max.x + hb.min.x) / 2, hb.min.y - 0.2, hb.max.z - 0.05); endWall.castShadow = endWall.receiveShadow = true; hall.add(endWall); floorsHall.push(endWall);
    HALL.doorZ = hb.max.z;
    // floor through the doorway and outside
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(6, 8), new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 0.9 })); outside.rotation.x = -Math.PI / 2; outside.position.set(AISLE_X, 0, hb.max.z + 4); HALL.outsideMesh = outside; hall.add(outside); floorsHall.push(outside);
    // bright sunset glow beyond the door
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(14, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.74, 0.46).multiplyScalar(0.95), toneMapped: false })); glow.position.set(AISLE_X, 4, hb.max.z + 7.5); glow.rotation.y = Math.PI; hall.add(glow);
    HALL.glow = glow; HALL.outside = outside;

    // torches on the pillars: flame sprites + warm point lights (found as the model's wall sconces)
    const flameTex = canvasTex(128, 256, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h * 0.7, 2, w / 2, h * 0.62, w * 0.5); gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.3, 'rgba(255,190,80,0.9)'); gr.addColorStop(0.7, 'rgba(230,90,20,0.35)'); gr.addColorStop(1, 'rgba(120,30,0,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(w / 2, h * 0.62, w * 0.42, h * 0.38, 0, 0, Math.PI * 2); g.fill(); });
    HALL.flameTex = flameTex;

    // girl
    await loadSword(gl, base);
    const gg = await gl.loadAsync(base + 'models/girl.glb'); await fixGirlMaterials(gg); girl = gg.scene; holder.add(girl);
    mixer = new THREE.AnimationMixer(girl);
    const clip = (n) => gg.animations.find((a) => a.name === n);
    acts.run = mixer.clipAction(clip('sold_fem|Run_shield_shAxeSP')); acts.gripRef = mixer.clipAction(clip('sold_fem|BattleMode_generic')); acts.openRef = mixer.clipAction(clip('sold_fem|idle_noweapon02')); acts.idle = mixer.clipAction(clip('sold_fem|idle_noweapon04')); acts.idle2 = mixer.clipAction(clip('sold_fem|idle_noweapon02'));
    for (const a of Object.values(acts)) { a.play(); a.paused = false; }
    const B = (n) => girl.getObjectByName(n);
    LEG.l = { thigh: B('pierna_l_097'), shin: B('pantorrilla_l_098'), ankle: B('Talon_l_099'), heel: B('Talon_l_099'), toe: B('puntapie_l_0101') };
    const BS = (n) => { if (!/ique_/.test(n)) return B(n); const suf = n.slice(n.indexOf('ique_')); let f = null; girl.traverse((o) => { if (!f && o.isBone && o.name.endsWith(suf)) f = o; }); return f; };
    const FN = (side) => { const L = side === 'l'; const ch = (names) => names.map(BS).filter(Boolean);
      return { hand: B(L ? 'mano_l_058' : 'mano_r_079'),
        fingers: L ? [ch(['dedoindice_l002_062', 'dedoindice_l001_063', 'dedoindice_l003_064']), ch(['dedomedio_l002_065', 'dedomedio_l001_066', 'dedomedio_l003_067']), ch(['dedoanu_l002_068', 'dedoanu_l001_069', 'dedoanu_l003_070']), ch(['meñique_l002_071', 'meñique_l001_072', 'meñique_l003_073'])]
                   : [ch(['dedoindice_r_083', 'dedoindice_r001_084', 'dedoindice_r002_085']), ch(['dedomedio_r_086', 'dedomedio_r001_087', 'dedomedio_r002_088']), ch(['dedoanu_r_089', 'dedoanu_r001_090', 'dedoanu_r002_091']), ch(['meñique_r_092', 'meñique_r001_093', 'meñique_r002_094'])],
        thumb: L ? ch(['dedoGordo_l002_059', 'dedoGordo_l001_060', 'dedoGordo_l003_061']) : ch(['dedoGordo_r_080', 'dedoGordo_r001_081', 'dedoGordo_r002_082']) }; };
    HANDS.l = FN('l'); HANDS.r = FN('r'); INFO.fingerBones = ['l', 'r'].map((sd) => HANDS[sd].fingers.map((f) => f.length).join('') + '/' + HANDS[sd].thumb.length);
    LEG.r = { thigh: B('pierna_r_0103'), shin: B('pantorrilla_r_0104'), ankle: B('Talon_r_00'), heel: B('Talon_r_00'), toe: B('puntapie_r_0105') };
    // authored hand poses
    { const sample = (a, tt) => { for (const x of Object.values(acts)) x.setEffectiveWeight(0); a.setEffectiveWeight(1); a.time = tt; mixer.update(0); const m = {}; for (const sd of ['l', 'r']) m[sd] = handBones(sd).map((b) => b.quaternion.clone()); a.setEffectiveWeight(0); return m; };
      HP.grip = sample(acts.gripRef, 0.3); HP.open = sample(acts.openRef, 0.3); }
    // scale: standing height from the idle pose
    holder.position.set(0, 0, 0); holder.rotation.set(0, 0, 0); holder.scale.setScalar(1);
    for (const a of Object.values(acts)) a.setEffectiveWeight(0); acts.idle.setEffectiveWeight(1); acts.idle.time = 0; mixer.update(0); holder.updateMatrixWorld(true);
    const hb0 = new THREE.Box3(); INFO.meshes = {}; girl.traverse((o) => { if (o.isSkinnedMesh) { const b = new THREE.Box3(); b.setFromObject(o, true); INFO.meshes[o.name] = [b.min.y, b.max.y].map((v) => +v.toFixed(1)); hb0.union(b); } });
    INFO.hip = +B('hip_07').getWorldPosition(V3()).y.toFixed(1); INFO.headBone = +B('Cabeza_011').getWorldPosition(V3()).y.toFixed(1);
    let headTop = 0; girl.traverse((o) => { if (o.isSkinnedMesh && /personaje/i.test(o.material.name)) headTop = new THREE.Box3().setFromObject(o, true).max.y; });
    const S = HEIGHT / (headTop - hb0.min.y); INFO.headTop = headTop; holder.scale.setScalar(S); holder.updateMatrixWorld(true);
    // sole offsets of heel/toe joints in the idle pose
    for (const leg of [LEG.l, LEG.r]) { leg.heelOff = leg.heel.getWorldPosition(V3()).y; leg.toeOff = leg.toe.getWorldPosition(V3()).y; }
    // root motion from the run clip: at every phase the ground speed equals the speed of whichever heel/toe is on the floor
    for (const a of Object.values(acts)) a.setEffectiveWeight(0); acts.run.setEffectiveWeight(1);
    const T = acts.run.getClip().duration, N = 400, smp = [];
    for (let i = 0; i <= N; i++) { acts.run.time = T * i / N; mixer.update(0); holder.updateMatrixWorld(true);
      const r = []; for (const leg of [LEG.l, LEG.r]) { const h = leg.heel.getWorldPosition(V3()), o = leg.toe.getWorldPosition(V3()); r.push([h.y - leg.heelOff, h.z], [o.y - leg.toeOff, o.z]); } smp.push(r); }
    const vel = new Array(N).fill(null);
    // per foot: velocity of its lowest grounded joint; if both feet touch, split the difference
    for (let i = 0; i < N; i++) { const per = [];
      for (const f of [0, 2]) { let best = null, bh = 0.012; for (const k of [f, f + 1]) { const a = smp[i][k], b = smp[i + 1][k]; const h = Math.max(a[0], b[0]); if (h < bh) { bh = h; best = -(b[1] - a[1]) / (T / N); } } if (best != null) per.push(best); }
      vel[i] = per.length ? per.reduce((x, y) => x + y, 0) / per.length : null; }
    // flight frames: interpolate between neighbouring stance speeds (cyclic)
    for (let i = 0; i < N; i++) if (vel[i] == null) { let a = i, b = i, da = 0, db = 0; while (vel[(a + N) % N] == null && da < N) { a--; da++; } while (vel[b % N] == null && db < N) { b++; db++; } vel[i] = lerp(vel[(a + N) % N], vel[b % N], da / (da + db)); }
    const Dc = [0]; for (let i = 0; i < N; i++) Dc.push(Dc[i] + Math.max(0, vel[i]) * T / N);
    RUN = { T, N, Dc, L: Dc[N], phase0: 0 };
    SPEED.v = RUN.L / T * RATE;
    RUN.solMin = 0; INFO.vMinMax = [Math.min(...vel), Math.max(...vel)].map((v) => +(v * RATE).toFixed(2));

    INFO.scale = S; INFO.v = SPEED.v; INFO.T = T; INFO.height = hb0.max.y - hb0.min.y;

    // courtyard path
    pathYard = new THREE.CatmullRomCurve3(P1.map(([x, z]) => V3(x, 0, z)), false, 'centripetal'); pathYardLen = pathYard.getLength();
    // she is inside the gate passage (r = 23.6 m from the centre) at t = 0
    { let best = 0, bd = 1e9; for (let s = 0; s < 12; s += 0.02) { const { p } = yardPt(s); const r = Math.hypot(p.x, p.z); if (Math.abs(r - 23.0) < bd) { bd = Math.abs(r - 23.0); best = s; } } S_GATE0 = best; }
    INFO.yardLen = pathYardLen; INFO.yardUsed = S_GATE0 + SPEED.v * SHOTS[2][0];
    // wall walk: start so she ends ~1 m short of the north-west annex
    WALL_Z0 = 10.2;
    INFO.wallEnd = WALL_Z0 - (SHOTS[4][0] - SHOTS[2][0]) * SPEED.v;
    // hall: aisle height + where to stop (just before the first dais step)
    AISLE_Y = hallFloor(AISLE_X, 8) ?? 2.07; HALL.outsideMesh.position.y = AISLE_Y - 0.004; HALL.glow.position.y = AISLE_Y + 3.5; HALL_Z0 = HALL.doorZ + 1.2;
    STOP_Z = -1.0; const distRun = HALL_Z0 - STOP_Z - SPEED.v * DECEL_D / 2; T_DECEL = SHOTS[4][0] + distRun / SPEED.v;
    INFO.aisleY = AISLE_Y; INFO.tDecel = T_DECEL; INFO.doorZ = HALL.doorZ;
    // torches: place at the model's sconces (search by name), else at the pillar line
    placeTorches();
    scene.environment = envExt;
    setSun(52, 24);
    buildContacts(); planStep();
    fitSword();
    planFlag();
    scene.updateMatrixWorld(true);
  }

  const HALL = {}; const INFO = {}; const SUNUV = { u: 0, v: 0 };
  const ray = new THREE.Raycaster();
  function hallFloor(x, z) { ray.set(V3(x, 5, z), V3(0, -1, 0)); ray.far = 20; const h = ray.intersectObjects(floorsHall, true)[0]; return h ? h.point.y : null; }
  // cluster the world-space vertices of a merged mesh into separate objects (grid flood fill on x/z)
  function clusters(mesh, cell = 0.25) {
    mesh.updateMatrixWorld(true); const pos = mesh.geometry.attributes.position, v = V3(), cells = new Map();
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld); const k = Math.round(v.x / cell) + ',' + Math.round(v.z / cell); let c = cells.get(k); if (!c) { c = { min: v.clone(), max: v.clone() }; cells.set(k, c); } c.min.min(v); c.max.max(v); }
    const seen = new Set(), out = [];
    for (const k of cells.keys()) { if (seen.has(k)) continue; const st = [k], box = new THREE.Box3(); seen.add(k);
      while (st.length) { const kk = st.pop(), c = cells.get(kk); box.expandByPoint(c.min); box.expandByPoint(c.max); const [x, z] = kk.split(',').map(Number);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const n = (x + dx) + ',' + (z + dz); if (cells.has(n) && !seen.has(n)) { seen.add(n); st.push(n); } } }
      out.push(box); }
    return out;
  }
  function placeTorches() {
    const pts = [], chand = [];
    throne.updateMatrixWorld(true);
    throne.traverse((o) => { if (!o.isMesh) return; const n = o.material.name;
      if (/^Torch/i.test(n)) for (const b of clusters(o)) { const c = b.getCenter(V3()); pts.push(V3(c.x, b.max.y, c.z)); }
      if (/^Chandelier/i.test(n)) for (const b of clusters(o, 0.5)) chand.push(b); });
    INFO.torches = pts.map((p) => p.toArray().map((v) => +v.toFixed(2))); INFO.chand = chand.map((b) => b.getCenter(V3()).toArray().map((v) => +v.toFixed(2)));
    pts.forEach((p, k) => {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: HALL.flameTex, color: new THREE.Color(1.6, 1.25, 0.9), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      m.scale.set(0.2, 0.38, 1); m.position.copy(p).add(V3(0, 0.12, 0)); hall.add(m);
      const L = new THREE.PointLight(0xff9440, 7, 11, 1.6); L.position.copy(p).add(V3(0, 0.3, 0)); hall.add(L);
      flames.push({ m, L, base: p.clone(), seed: k * 3.7 });
    });
    for (const b of chand) { const c = b.getCenter(V3()); const L = new THREE.PointLight(0xffb066, 14, 16, 1.5); L.position.set(c.x, b.min.y + 0.4, c.z); hall.add(L); }
  }

  // ----- cameras -----
  const camState = { pos: V3(), look: V3(), fov: 40 };
  function cameraAt(t) {
    const sh = shotAt(t), u = (t - sh.t0) / (sh.t1 - sh.t0), c = charAt(t);
    const hip = c.p.clone().add(V3(0, 0.95, 0));
    let pos, look, fov = 40;
    if (sh.name === 'gate') {
      // low dolly ahead of her, backing away as she bursts out of the gate passage
      const ahead = yardPt(c.dist + lerp(7.2, 3.6, smooth(u))); const side = V3(-ahead.dir.z, 0, ahead.dir.x);
      pos = ahead.p.clone().add(side.multiplyScalar(0.9)).add(V3(0, lerp(0.7, 0.42, smooth(u)), 0)); look = hip.clone().add(V3(0, lerp(1.0, 0.25, smooth(u)), 0)); fov = lerp(58, 46, smooth(u));
    } else if (sh.name === 'yard') {
      // high over the gatehouse, panning with her across the courtyard
      const back = yardPt(c.dist - lerp(5.5, 7.5, u)); const side = V3(-back.dir.z, 0, back.dir.x);
      pos = back.p.clone().add(side.multiplyScalar(-1.6)).add(V3(0, lerp(2.6, 5.5, smooth(u)), 0)); look = yardPt(c.dist + 6).p.add(V3(0, lerp(1.6, 0.6, u), 0)); fov = 48;
    } else if (sh.name === 'wallFront') {
      // just off the inner edge of the wall walk, ahead of her, looking back up the walk
      pos = V3(-20.75, WALL_Y + 1.05, c.p.z - lerp(4.4, 3.6, u)); look = V3(WALK_X + 0.15, WALL_Y + 1.1, c.p.z); fov = 44;
    } else if (sh.name === 'wallSide') {
      // drone over the courtyard tracking alongside: the drop below, the battlements behind her
      pos = V3(-14.2, WALL_Y + 2.4, c.p.z - 1.2 - u * 0.6); look = V3(WALK_X, WALL_Y + 0.6, c.p.z - 0.6); fov = 38;
    } else if (sh.name === 'door') {
      // low on the aisle near the dais, she bursts in through the glowing doorway and runs at the lens
      pos = V3(AISLE_X + 0.25, AISLE_Y + 0.55, lerp(4.2, 3.0, u)); look = V3(AISLE_X, AISLE_Y + 1.1, c.p.z); fov = 50;
    } else if (sh.name === 'stop') {
      // up on the dais looking back down the hall: she runs at us, pulls up two metres away and looks around
      const k = smooth((t - (T_DECEL - 1.2)) / 2.2), k2 = smooth((t - (T_DECEL + 0.6)) / 4.0);   // timed from when she starts to pull up
      const fz = Math.max(c.p.z, STOP_Z);
      pos = V3(AISLE_X + lerp(0.35, 0.75, k2), AISLE_Y + lerp(1.7, 1.5, k2), STOP_Z - lerp(2.6, 2.15, k2) ); look = V3(AISLE_X + 0.05, AISLE_Y + lerp(1.15, 1.42, k), fz + 0.2); fov = lerp(44, 34, k);
    } else if (sh.name === 'grab') {
      // three-quarter view from her front-left: the hand closing on the pole and lifting it out of the stand
      const k = smooth((t - sh.t0) / (sh.t1 - sh.t0)); const r = c.p;
      pos = V3(r.x - lerp(1.55, 1.75, k), AISLE_Y + lerp(1.55, 1.35, k), r.z - lerp(2.05, 2.3, k)); look = V3(r.x - 0.32, AISLE_Y + lerp(1.2, 1.6, k), r.z - 0.15); fov = lerp(42, 46, k);
    } else if (sh.name === 'victory') {
      // low hero angle from the front, slowly circling: banner overhead, sword at her side
      const k = smooth((t - sh.t0) / (sh.t1 - sh.t0)); const r = c.p; const a = lerp(-0.35, 0.25, k);
      pos = V3(r.x - 0.15 + Math.sin(a) * 2.1, AISLE_Y + lerp(1.4, 1.3, k), r.z - Math.cos(a) * 2.1); look = V3(r.x - 0.2, AISLE_Y + lerp(1.6, 1.8, k), r.z); fov = lerp(48, 42, k);
    } else {
      // pull back and up the hall: her small at the foot of the throne, stained glass blazing
      pos = V3(AISLE_X, AISLE_Y + lerp(1.6, 4.2, smooth(u)), STOP_Z + lerp(4.0, 9.0, smooth(u))); look = V3(AISLE_X, AISLE_Y + lerp(1.3, 2.6, smooth(u)), STOP_Z - 3); fov = 50;
    }
    if (sh.set === 'hall') {   // never let a hall camera sink into the dais / floor: keep >= 0.45 m above whatever is below it
      ray.set(V3(pos.x, pos.y + 0.3, pos.z), V3(0, -1, 0)); ray.far = 6; const h = ray.intersectObjects(floorsHall, true)[0];
      if (h && pos.y < h.point.y + 0.45) pos.y = h.point.y + 0.45; }
    camState.pos.copy(pos); camState.look.copy(look); camState.fov = fov; return camState;
  }

  function poseAt(t) { const sh = shotAt(t), c = charAt(t); ext.visible = sh.set === 'ext'; hall.visible = sh.set === 'hall';
    applyIK(t, c); if (sh.set === 'hall') applyFlag(t); holder.updateMatrixWorld(true); return c; }
  function render(t) {
    const sh = shotAt(t), c = charAt(t);
    ext.visible = sh.set === 'ext'; hall.visible = sh.set === 'hall';
    poseAt(t);
    const cs = cameraAt(t); if (window.__cam) { const [px, py, pz, lx, ly, lz, f] = window.__cam(c); cs.pos.set(px, py, pz); cs.look.set(lx, ly, lz); cs.fov = f; } camera.position.copy(cs.pos); camera.fov = cs.fov; camera.updateProjectionMatrix(); camera.lookAt(cs.look);
    if (sh.set === 'ext') {
      scene.background = skyTex; scene.environment = envExt; scene.backgroundRotation.set(0, ENVROT.y, 0); scene.environmentRotation.set(0, ENVROT.y, 0);
      scene.backgroundIntensity = sh.name === 'gate' ? EXT.bg * 0.45 : EXT.bg; scene.environmentIntensity = EXT.env; renderer.toneMappingExposure = EXT.exp; sun.intensity = EXT.sun; bloom.threshold = 1.2;
      scene.fog = new THREE.Fog(0xd9a77a, 70, 420);
      // sun follows the HDRI's sun; shadow box centred on her
      sun.position.copy(c.p).add(SUNDIR.clone().multiplyScalar(80)); sun.target.position.copy(c.p); sun.target.updateMatrixWorld();
      bloom.strength = 0.28;
    } else {
      scene.background = new THREE.Color(0x050403); scene.environment = envExt; scene.environmentIntensity = 0.12; renderer.toneMappingExposure = 1.05;
      scene.fog = new THREE.Fog(0x120c08, 18, 60);
      doorLight.position.set(AISLE_X, AISLE_Y + 3.6, HALL.doorZ + 3.5); doorLight.target.position.set(AISLE_X, AISLE_Y, HALL.doorZ - 10); doorLight.target.updateMatrixWorld();
      for (const f of flames) { const n = noise1(t * 7 + f.seed, 1), n2 = noise1(t * 11 + f.seed, 2); f.m.scale.set(0.2 + n2 * 0.05, 0.36 + n * 0.12, 1); f.L.intensity = 7.5 + n * 3.5; }
      bloom.strength = 0.42; bloom.threshold = 0.85;
    }
    // soft fill from the camera side so her face reads against bright backgrounds
    const fk = { gate: 2.2, yard: 0.5, wallFront: 0.9, wallSide: 0.5, door: 1.1, stop: 0.6, wide: 0.3 }[sh.name] ?? 0.4;
    fill.intensity = fk; fill.position.copy(cs.pos).add(V3(0, 1.5, 0)); fill.target.position.copy(c.p).add(V3(0, 1, 0)); fill.target.updateMatrixWorld();
    composer.render();
  }

  // sun direction in world (set from the HDRI sun pixel + the chosen rotation)
  const EXT = { bg: 0.36, env: 0.3, exp: 0.85, sun: 3.0 };
  const ENVROT = { y: 0 }; const SUNDIR = V3(0.6, 0.35, 0.7).normalize();
  function setSun(azDeg, elDeg) {
    // rotate the HDRI so its sun sits at the requested azimuth (radians around +Y, 0 = +X toward +Z)
    const phi = SUNUV.u * Math.PI * 2, th = SUNUV.v * Math.PI;
    // three.js equirect lookup: u = atan2(dir.z, dir.x) / (2π) + 0.5, v = asin(dir.y)/π + 0.5 (flipY); empirical, see dev check
    const srcAz = (SUNUV.u - 0.5) * Math.PI * 2; ENVROT.y = -(azDeg * DEG - srcAz);
    const el = (0.5 - SUNUV.v) * Math.PI; const e = elDeg != null ? elDeg * DEG : el;
    SUNDIR.set(Math.cos(azDeg * DEG) * Math.cos(e), Math.sin(e), Math.sin(azDeg * DEG) * Math.cos(e)).normalize();
    INFO.sunEl = el / DEG;
  }

  function project(v) { const p = v.clone().project(camera); return { x: (p.x * 0.5 + 0.5) * width, y: (-p.y * 0.5 + 0.5) * height, z: p.z }; }
  return { FLAG: () => FLAG, SWORD, HP, HANDS, dbgRaw: (t, side) => { const r = CT.raw[side][Math.round(t / SCAN)]; return [r.heel.p, r.toe.p].map((p) => [p.x, p.y, p.z].map((v) => +(v * 100).toFixed(1))); }, dbgOff: (t, side) => { const i = Math.round(t / SCAN); const o = offsetAt(side, i); const r = CT.raw[side][i]; return [+(o.x * 100).toFixed(1), +(o.z * 100).toFixed(1), +(r.heel.h * 100).toFixed(1), +(r.toe.h * 100).toFixed(1), CT.start[side + 'heel'][i], CT.start[side + 'toe'][i]]; }, EXT, poseAt, ext, hall, load, render, charAt, cameraAt, setPose, applyIK, setSun, project, INFO, LEG, SPEED, floorsExt, floorsHall, girl: () => girl, holder, camera, scene, soleH, footPt, hallFloor, HALL, shotAt };
}
