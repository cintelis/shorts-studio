// Scripted X2 workers. Each Bot is built once (a list of base moves + carry jobs on a global clock) and is then a pure
// function of time: pose(t) gives feet, pelvis, waist, hands and the world pose of whatever it carries.
// Feet only move while lifted (turns and walks are made of steps), so there is no foot sliding.
import * as THREE from './three.module.js';
import { V3, clamp, clamp01, ss } from './core.js';

const PI = Math.PI;
export const dir = (a) => V3(Math.cos(a), 0, -Math.sin(a));
export const right = (a) => V3(Math.sin(a), 0, Math.cos(a));
const wrap = (a) => { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; };
const lerp = (a, b, t) => a + (b - a) * t;
const W = 0.137, PH = 0.655, STEP_H = 0.05;

// base frame: local +x forward, +y up, +z right
export const baseMat = (x, z, yaw) => new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z);
// object frame: X across the hands (robot's right), Y up, Z towards the robot; origin at the bottom centre
export function objMat(pos, facing) { const X = right(facing), Y = V3(0, 1, 0), Z = X.clone().cross(Y); return new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(pos); }
// place an object in front of a base pose: forward r, lateral lat (+ right), bottom at height h, facing yaw
export const frontOf = (x, z, yaw, r, h, lat = 0, dyaw = 0) => objMat(V3(x, h, z).addScaledVector(dir(yaw), r).addScaledVector(right(yaw), lat), yaw + dyaw);

export class Bot {
  constructor(name, x, z, yaw, t0 = -30) {
    this.name = name; this.p0 = { x, z, yaw }; this.pose = { x, z, yaw }; this.now = t0; this.t0 = t0;
    this.segs = []; this.jobs = []; this.cur = null;
  }
  wait(d) { this.segs.push({ type: 'stand', t0: this.now, t1: this.now + d, A: { ...this.pose } }); this.now += d; return this; }
  turnTo(yaw, per90 = 1.15) {
    let delta = wrap(yaw - this.pose.yaw);
    const n = Math.ceil(Math.abs(delta) / (PI / 2 + 0.1));
    for (let i = 0; i < n; i++) {
      const a0 = this.pose.yaw, a1 = a0 + delta / n, d = Math.max(0.75, Math.abs(delta / n) / (PI / 2) * per90);
      this.segs.push({ type: 'turn', t0: this.now, t1: this.now + d, A: { ...this.pose }, a0, a1 });
      this.now += d; this.pose = { ...this.pose, yaw: a1 };
    }
    return this;
  }
  walkTo(x, z, speed = 0.5, keepFacing = false) {
    const dx = x - this.pose.x, dz = z - this.pose.z, dist = Math.hypot(dx, dz);
    if (dist < 1e-3) return this;
    const hd = Math.atan2(-dz, dx);
    if (!keepFacing) this.turnTo(hd);
    const n = Math.max(2, Math.ceil(dist / 0.32) + 1), d = dist / speed;
    this.segs.push({ type: 'walk', t0: this.now, t1: this.now + d, A: { ...this.pose }, B: { x, z, yaw: this.pose.yaw }, n });
    this.now += d; this.pose = { ...this.pose, x, z };
    return this;
  }
  // carry jobs. obj = { mesh, halfW, gripH, carry: {r, h} }, W = world Matrix4 of the object (bottom centre)
  aimAt(W) { const c = V3().setFromMatrixPosition(W), b = Math.atan2(-(c.z - this.pose.z), c.x - this.pose.x); if (Math.abs(wrap(b - this.pose.yaw)) > 0.12) this.turnTo(b, 1.5); return this; }
  // short step towards an item that is still out of comfortable reach; returns a function that steps back
  stepIn(W, near = 0.45) {
    const c = V3().setFromMatrixPosition(W), d = Math.hypot(c.x - this.pose.x, c.z - this.pose.z), st = Math.min(0.22, d - near);
    if (st < 0.04) return () => this;
    const x0 = this.pose.x, z0 = this.pose.z, f = dir(this.pose.yaw);
    this.walkTo(x0 + f.x * st, z0 + f.z * st, 0.3, true);
    return () => this.walkTo(x0, z0, 0.3, true);
  }
  pick(obj, W, { reach = 0.9, lift = 0.55, aim = false, step = true } = {}) {
    let back = null; if (aim) { this.aimAt(W); if (step) back = this.stepIn(W); }
    const j = { obj, W0: W.clone(), tR0: this.now, tPick: this.now + reach, tLift: this.now + reach + lift, base0: { ...this.pose } };
    this.jobs.push(j); this.cur = j; this.now += reach + lift; if (back) back(); return this;
  }
  place(W, { lower = 0.8, release = 0.6, aim = false, step = true } = {}) {
    let back = null; if (aim) { this.aimAt(W); if (step) back = this.stepIn(W); }
    const j = this.cur; j.Wp = W.clone(); j.carryH = Math.max(j.carryH ?? j.obj.carry.h, W.elements[13] + 0.04); j.tLow = this.now; j.tPlace = this.now + lower; j.tEnd = this.now + lower + release; j.baseP = { ...this.pose };
    this.now += lower + release; this.cur = null; if (back) back(); return this;
  }
  // both hands to fixed world points (e.g. two-hand press buttons), palms down, fingers forward
  hands(pl, pr, hold, { reach = 0.6, back = 0.5 } = {}) {
    const j = { hands: [pl.clone(), pr.clone()], tR0: this.now, tPick: this.now + reach, tPlace: this.now + reach + hold, tEnd: this.now + reach + hold + back, base0: { ...this.pose } };
    this.jobs.push(j); this.now = j.tEnd; return j;
  }
  // both hands on points fixed in the robot's own frame (e.g. a cart handle) from now until t1
  handsLocal(pl, pr, t1, { reach = 0.6 } = {}) {
    const j = { handsLocal: [pl.clone(), pr.clone()], tR0: this.now - reach, tPick: this.now, tPlace: t1, tEnd: t1 + 0.5, base0: { ...this.pose } };
    this.jobs.push(j); return j;
  }
  finish(tMax = 120) { this.segs.push({ type: 'stand', t0: this.now, t1: tMax, A: { ...this.pose } }); this.jobs.sort((a, b) => a.tR0 - b.tR0); return this; }

  // ---------------- evaluation
  baseAt(t) {
    let s = null; for (const g of this.segs) { if (g.t0 <= t) s = g; else break; }
    const stand = (P) => ({ x: P.x, z: P.z, yaw: P.yaw, feet: { l: { a: P.yaw, x: P.x, z: P.z, lift: 0 }, r: { a: P.yaw, x: P.x, z: P.z, lift: 0 } }, shift: 0, walk: 0 });
    if (!s) return stand(this.p0);
    const d = s.t1 - s.t0, p = clamp01((t - s.t0) / d);
    if (s.type === 'stand') return stand(s.A);
    if (s.type === 'turn') {
      const first = s.a1 > s.a0 ? 'l' : 'r', sg = first === 'l' ? 1 : -1;
      const sA = clamp01((p - 0.1) / 0.38), sB = clamp01((p - 0.54) / 0.38);
      const fa = (u) => lerp(s.a0, s.a1, ss(0, 1, u)), lift = (u) => (u > 0 && u < 1 ? Math.sin(PI * u) * STEP_H : 0);
      const F = { [first]: { a: fa(sA), lift: lift(sA) }, [first === 'l' ? 'r' : 'l']: { a: fa(sB), lift: lift(sB) } };
      for (const k of ['l', 'r']) { F[k].x = s.A.x; F[k].z = s.A.z; }
      const sh = 0.032;
      const shift = p < 0.46 ? sg * sh * ss(0, 0.12, p) : p < 0.56 ? sg * sh * (1 - 2 * ss(0.46, 0.56, p)) : -sg * sh * (1 - ss(0.9, 1, p));
      return { x: s.A.x, z: s.A.z, yaw: lerp(s.a0, s.a1, ss(0.05, 0.95, p)), feet: F, shift, walk: 0 };
    }
    // walk: n steps, alternating feet (left first); footprint fractions k/(n-1); last step closes the stance
    const n = s.n, ds = 1 / n;
    const fr = { l: 0, r: 0 }, lift = { l: 0, r: 0 };
    let shift = 0;
    for (let k = 0; k < n; k++) {
      const foot = k % 2 === 0 ? 'l' : 'r';
      const target = k < n - 1 ? (k + 1) / (n - 1) : 1;
      const u = clamp01((p - k * ds) / ds), su = clamp01((u - 0.12) / 0.76);
      if (u <= 0) break;
      const from = fr[foot];
      fr[foot] = lerp(from, target, ss(0, 1, su));
      if (su > 0 && su < 1) lift[foot] = Math.sin(PI * su) * STEP_H * 0.9;
      if (u < 1) shift = (foot === 'l' ? 1 : -1) * 0.028 * Math.sin(PI * u);
    }
    const P = (f) => ({ x: lerp(s.A.x, s.B.x, f), z: lerp(s.A.z, s.B.z, f) });
    const F = {}; for (const k of ['l', 'r']) { const q = P(fr[k]); F[k] = { a: s.A.yaw, x: q.x, z: q.z, lift: lift[k] }; }
    const c = P((fr.l + fr.r) / 2);
    return { x: c.x, z: c.z, yaw: s.A.yaw, feet: F, shift, walk: 1 };
  }
  // world matrix of a job's object at time t
  objAt(j, t) {
    const o = j.obj;
    if (t < j.tPick) return j.W0;
    if (j.Wp && t >= j.tPlace) return j.Wp;
    const B = this.baseAt(t), Bm = baseMat(B.x, B.z, B.yaw);
    const carry = j.carryFn ? j.carryFn(t) : new THREE.Matrix4().makeBasis(V3(0, 0, 1), V3(0, 1, 0), V3(-1, 0, 0)).setPosition(o.carry.r, j.carryH ?? o.carry.h, 0);
    const L0 = baseMat(j.base0.x, j.base0.z, j.base0.yaw).invert().multiply(j.W0);
    let L;
    if (!j.Wp || t < j.tLow) { const u = clamp01((t - j.tPick) / (j.tLift - j.tPick)); L = blend(L0, carry, 0, 0, u); }
    else { const Lp = baseMat(j.baseP.x, j.baseP.z, j.baseP.yaw).invert().multiply(j.Wp); const u = clamp01((t - j.tLow) / (j.tPlace - j.tLow)); L = blend(carry, Lp, 0, 0, u); }
    return Bm.multiply(L);
  }
  // full pose for the rig at time t (P for poseBot) + list of [object, matrix]
  at(t) {
    const B = this.baseAt(t);
    let j = null; for (const q of this.jobs) if (q.tR0 <= t && t <= (q.tEnd ?? 1e9)) j = q;
    const P = { x: B.x, z: B.z, pyaw: B.yaw, pshift: B.shift, feet: B.feet, ph: PH - 0.012 * B.walk, pp: 0.02 * B.walk, pback: 0, wy: 0, wp: 0, w: 0, grip: 0, targets: null, look: null, walk: B.walk, t };
    if (j) {
      const tA = Math.max(j.tR0 + 0.2, j.tPick - 0.3), w = j.Wp || j.hands || j.handsLocal ? ss(j.tR0, tA, t) * (1 - ss(j.tPlace + 0.3, j.tEnd, t)) : ss(j.tR0, tA, t);
      P.w = w; P.grip = ss(j.tPick - 0.3, j.tPick, t) * (1 - ss(j.tPlace, j.tPlace + 0.25, t));
      P.curl = j.obj ? (j.obj.curl ?? 1) : 0.25;
      if (j.hands) P.targets = { l: { p: j.hands[0], q: palmDown(B.yaw) }, r: { p: j.hands[1], q: palmDown(B.yaw) } };
      else if (j.handsLocal) { const Bm = baseMat(B.x, B.z, B.yaw); P.targets = { l: { p: j.handsLocal[0].clone().applyMatrix4(Bm), q: palmDown(B.yaw) }, r: { p: j.handsLocal[1].clone().applyMatrix4(Bm), q: palmDown(B.yaw) } }; }
      else if (!j.handsLocal) P.targets = handTargets(this.objAt(j, t), j.obj);
      // automatic bend from the hand height and reach
      const mid = P.targets.l.p.clone().add(P.targets.r.p).multiplyScalar(0.5);
      const rel = mid.clone().sub(V3(B.x, 0, B.z)), fwd = rel.dot(dir(B.yaw)), lat = rel.dot(right(B.yaw)), hh = mid.y;
      const drop = clamp((0.92 - hh) * 0.4, 0, 0.2), lean = clamp(Math.max(0, (0.92 - hh) * 0.6) + Math.max(0, fwd - 0.36) * 1.3, 0, 0.45);
      P.ph = PH - drop * w; P.pp = lean * w; P.wp = clamp((0.85 - hh) * 0.35, 0, 0.24) * w; P.pback = drop * 0.3 * w;
      P.wy = -Math.atan2(lat, Math.max(0.2, fwd)) * 0.8 * w;
      P.look = mid; P.lookW = clamp01(w * 1.4);
    }
    return P;
  }
  objects(t) { return this.jobs.filter((j) => j.obj).map((j) => [j, this.objAt(j, t)]); }
}
// move an item from A to B: rise to a clear height, travel, then settle (never sweeps through what is under it)
function blend(A, B, _uy, _uxz, u) {
  const pa = V3(), pb = V3(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), s = V3();
  A.decompose(pa, qa, s); B.decompose(pb, qb, s);
  const hc = Math.max(pa.y, pb.y) + 0.1;
  const up = ss(0, 0.3, u), mv = ss(0.25, 0.75, u), dn = ss(0.7, 1, u);
  const y = pa.y + (hc - pa.y) * up - (hc - pb.y) * dn;
  const p = V3(lerp(pa.x, pb.x, mv), y, lerp(pa.z, pb.z, mv));
  return new THREE.Matrix4().compose(p, qa.slerp(qb, mv), V3(1, 1, 1));
}
// palm frame: +x = inner palm, +z = fingers
export function palmDown(yaw) { const Xp = V3(0, -1, 0), Zp = dir(yaw), Yp = Zp.clone().cross(Xp); return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(Xp, Yp, Zp)); }
export function handTargets(M, o) {
  const X = V3().setFromMatrixColumn(M, 0), Y = V3().setFromMatrixColumn(M, 1), Z = V3().setFromMatrixColumn(M, 2), P = V3().setFromMatrixPosition(M);
  const fwd = Z.clone().negate(), out = {};
  for (const [side, sg] of [['l', -1], ['r', 1]]) {
    const p = P.clone().addScaledVector(X, sg * o.halfW).addScaledVector(Y, o.gripH);
    const Xp = X.clone().multiplyScalar(-sg), Zp = fwd.clone(), Yp = Zp.clone().cross(Xp);
    out[side] = { p, q: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(Xp, Yp, Zp)) };
  }
  return out;
}
