import * as THREE from './three.module.js';
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
function solveIK(rig, chain, base, tp, tq, seed, { wRot = 0.4, iters = 40, lambda = 0.06, posFinish = 0, alt = null } = {}) {
  const vars = chain.vars, n = vars.length, q = new Map(); vars.forEach((j, i) => q.set(j, clamp(seed[i], j.lo, j.hi)));
  const M = new THREE.Matrix4(), Mk = new THREE.Matrix4(), h = 1e-4;
  const run = (its, tqq, lam, step) => {
    const rows = tqq ? 6 : 3;
    for (let it = 0; it < its; it++) {
      const e = poseErr(fk(chain, base, q, M), tp, tqq, wRot);
      const en = Math.hypot(...e.slice(0, rows)); if (en < 2e-4) break;
      const Jc = [];
      for (const j of vars) { const v = q.get(j); q.set(j, v + h); const ek = poseErr(fk(chain, base, q, Mk), tp, tqq, wRot); q.set(j, v); Jc.push(e.map((x, r) => (x - ek[r]) / h)); }
      const A = []; for (let r = 0; r < rows; r++) { A.push([]); for (let c = 0; c < rows; c++) { let s = 0; for (let k = 0; k < n; k++) s += Jc[k][r] * Jc[k][c]; A[r].push(s + (r === c ? lam * lam : 0)); } }
      const y = solveLin(A, e.slice(0, rows), rows);
      vars.forEach((j, k) => { let d = 0; for (let r = 0; r < rows; r++) d += Jc[k][r] * y[r]; d = clamp(d, -step, step); q.set(j, clamp(q.get(j) + d, j.lo, j.hi)); });
    }
  };
  run(iters, tq, lambda, 0.3);
  if (posFinish) run(posFinish, null, 0.03, 0.2);   // nail the position, letting the orientation give a little
  if (alt && tq) {   // other starting poses: keep the solution with the smallest position + orientation error
    const score = () => { const e = poseErr(fk(chain, base, q, M), tp, tq, 1); return Math.hypot(e[0], e[1], e[2]) + 0.12 * Math.hypot(e[3], e[4], e[5]); };
    let best = score(), bq = vars.map((j) => q.get(j));
    for (const s of alt) { vars.forEach((j, i) => q.set(j, clamp(s[i], j.lo, j.hi))); run(iters, tq, lambda, 0.3); if (posFinish) run(posFinish, null, 0.03, 0.2); const sc = score(); if (sc < best - 1e-4) { best = sc; bq = vars.map((j) => q.get(j)); } }
    vars.forEach((j, i) => q.set(j, bq[i]));
  }
  vars.forEach((j) => rig.set(j.name, q.get(j)));
  return vars.map((j) => q.get(j));
}


export { V3, DEG, clamp, clamp01, ss, Q_BASE, yawQ, rpyQ, fromArr, buildRig, chainOf, fk, solveIK };
