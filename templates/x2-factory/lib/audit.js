// Collision / support audit for the factory scene. Run per frame after the scene is posed.
//  - robot link vertices (sampled) vs props and carried items (except the gripping hand vs its own held item)
//  - item vs item, item vs props (penetration deeper than TOL)
//  - items that are not held and not on a belt must rest on a surface (gap > TOL is "floating")
//  - cobot / arm sample points vs props
import * as THREE from './three.module.js';

const TOL = 0.01;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _inv = new THREE.Matrix4(), _p = V3();

// box = { M (world matrix of the box centre), h: [hx, hy, hz], name }
function depthInside(pLocal, h) { const dx = h[0] - Math.abs(pLocal.x), dy = h[1] - Math.abs(pLocal.y), dz = h[2] - Math.abs(pLocal.z); return Math.min(dx, dy, dz); }

export function createAudit(ctx) {
  // ctx: { rigs, botNames, staticBoxes(), items(t) -> [{ name, M, h, held: botName|'cobot'|null, belt: bool, kind }], supports() -> [{ M, h, name }], cobotSamples() }
  const robotPts = ctx.rigs.map((rig) => {
    const list = [];
    rig.root.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position, stride = Math.max(1, Math.floor(pos.count / 120));
      const pts = []; for (let i = 0; i < pos.count; i += stride) pts.push(V3(pos.getX(i), pos.getY(i), pos.getZ(i)));
      let link = o.parent; while (link && !link.name) link = link.parent;
      const n = link ? link.name : '?';
      const hand = /^(L_|R_)|wrist|palm|thumb|index|middle|ring|pinky/.test(n);
      list.push({ o, pts, name: n, hand });
    });
    return list;
  });
  // self-collision boxes: every mesh's local bounding box, tagged by body part
  const selfBoxes = ctx.rigs.map((rig) => {
    const out = [];
    rig.root.traverse((o) => {
      if (!o.isMesh) return; let l = o.parent; while (l && !l.name) l = l.parent; const n = l ? l.name : '';
      const part = /head/.test(n) ? 'head' : /torso|waist|pelvis/.test(n) ? 'body' : /^(left_(elbow|wrist)|L_)/.test(n) ? 'L' : /^(right_(elbow|wrist)|R_)/.test(n) ? 'R' : null;
      if (!part) return; o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox;
      const B = { o, name: n, part, c: bb.getCenter(V3()), h: bb.getSize(V3()).multiplyScalar(0.5) };
      if (part === 'head' || part === 'body') {   // slices along the mesh's longest axis: per 1 cm band, the outline's min/max on the other two axes
        const P = o.geometry.attributes.position, ax = ['x', 'y', 'z'].sort((a, b) => B.h[b] - B.h[a])[0], oth = ['x', 'y', 'z'].filter((a) => a !== ax), lo = bb.min[ax], bins = new Map();
        for (let i = 0; i < P.count; i++) { const v = { x: P.getX(i), y: P.getY(i), z: P.getZ(i) }, k = Math.floor((v[ax] - lo) / 0.01); let r = bins.get(k); if (!r) bins.set(k, (r = [9, -9, 9, -9])); r[0] = Math.min(r[0], v[oth[0]]); r[1] = Math.max(r[1], v[oth[0]]); r[2] = Math.min(r[2], v[oth[1]]); r[3] = Math.max(r[3], v[oth[1]]); }
        B.slices = { ax, oth, lo, bins };
      }
      out.push(B);
    });
    return out;
  });
  const P = (rig, n) => V3().setFromMatrixPosition(rig.links[n].matrixWorld);
  const issues = new Map();
  const DT = 0.1 + 1e-3;
  const endRun = (e) => { if (e.run >= 2) e.sus = Math.max(e.sus, e.runMax); };
  const note = (key, t, depth, pos) => {
    let e = issues.get(key);
    if (!e) { issues.set(key, { key, t0: t, t1: t, n: 1, max: depth, at: t, pos, last: t, run: 1, runMax: depth, maxRun: 1, sus: 0 }); return; }
    e.t1 = t; e.n++; if (depth > e.max) { e.max = depth; e.at = t; e.pos = pos; }
    if (t - e.last <= DT) { e.run++; e.runMax = Math.max(e.runMax, depth); } else { endRun(e); e.run = 1; e.runMax = depth; }
    e.maxRun = Math.max(e.maxRun, e.run); e.last = t;
  };

  function check(t) {
    const boxes = ctx.staticBoxes(), items = ctx.items(t), sups = ctx.supports();
    const near = (M, h, p, pad) => { _inv.copy(M).invert(); _p.copy(p).applyMatrix4(_inv); return Math.abs(_p.x) < h[0] + pad && Math.abs(_p.y) < h[1] + pad && Math.abs(_p.z) < h[2] + pad; };
    const ctr = (M) => V3().setFromMatrixPosition(M);
    // world points of every robot (computed once per frame)
    const rWorld = robotPts.map((list) => list.map((L) => ({ ...L, w: L.pts.map((p) => p.clone().applyMatrix4(L.o.matrixWorld)) })));
    const robotCentres = ctx.rigs.map((rig) => V3().setFromMatrixPosition(rig.root.matrixWorld));
    const vsBox = (box, label, skip) => {
      const inv = box.M.clone().invert(), c = ctr(box.M), R = Math.hypot(...box.h) + 1.2;
      rWorld.forEach((list, ri) => {
        if (robotCentres[ri].distanceTo(c) > R) return;
        let worst = 0, wl = '', wp = null;
        for (const L of list) { if (skip && skip(ri, L)) continue; for (const p of L.w) { const d = depthInside(p.clone().applyMatrix4(inv), box.h); if (d > worst) { worst = d; wl = L.name; wp = p; } } }
        if (worst > TOL) note(`robot ${ctx.botNames[ri]} ${wl} in ${label}`, t, worst, wp && wp.toArray().map((v) => +v.toFixed(2)));
      });
    };
    ctx.rigs.forEach((rig, ri) => { if ((rig.__ik || 0) > 0.015) note(`IK miss ${ctx.botNames[ri]}`, t, rig.__ik, rig.__ikInfo); });
    // 0) self-collision and pose sanity
    rWorld.forEach((list, ri) => {
      const rig = ctx.rigs[ri], bn = ctx.botNames[ri];
      for (const side of ['L', 'R']) {
        const other = side === 'L' ? 'R' : 'L', mine = list.filter((L) => (side === 'L' ? /^(left_(elbow|wrist)|L_)/ : /^(right_(elbow|wrist)|R_)/).test(L.name));
        let worst = 0, wl = '', wb = '';
        for (const B of selfBoxes[ri]) {
          if (B.part === side) continue; const inv = B.o.matrixWorld.clone().invert();
          for (const L of mine) for (const p of L.w) {
            const ql = p.clone().applyMatrix4(inv); let d;
            if (B.slices) { const S = B.slices, r = S.bins.get(Math.floor((ql[S.ax] - S.lo) / 0.01)); d = r ? Math.min(ql[S.oth[0]] - r[0], r[1] - ql[S.oth[0]], ql[S.oth[1]] - r[2], r[3] - ql[S.oth[1]]) : -1; }
            else { const q = ql.sub(B.c); d = Math.min(B.h.x - Math.abs(q.x), B.h.y - Math.abs(q.y), B.h.z - Math.abs(q.z)); }
            if (d > worst) { worst = d; wl = L.name; wb = B.name; } }
        }
        if (worst > TOL) note(`self ${bn} ${wl} in ${wb}`, t, worst);
      }
      const T = P(rig, 'torso_link'), e = rig.links.torso_link.matrixWorld.elements, F = V3(e[0], 0, e[2]).normalize();
      const head = P(rig, 'head_pitch_link').add(V3(0, 0.08, 0));
      for (const [s, S] of [['left', 'L'], ['right', 'R']]) {
        const sh = P(rig, `${s}_shoulder_roll_link`), el = P(rig, `${s}_elbow_link`), wr = P(rig, `${s}_wrist_yaw_link`), hand = P(rig, `${S}_palm`);
        const fwd = (p) => p.clone().sub(T).dot(F);
        if (hand.y > sh.y - 0.25 && fwd(hand) < 0.2) note(`pose ${bn} ${S} hand not in front of chest`, t, 0.2 - fwd(hand));
        const reach = fwd(wr) >= 0.35, lim = sh.y + (reach ? 0.2 : 0.05);
        if (wr.y > lim + TOL) note(`pose ${bn} ${S} wrist above shoulder${reach ? ' (reach)' : ''}`, t, wr.y - lim);
        if (el.y > sh.y + (fwd(hand) >= 0.2 ? 0.11 : TOL)) note(`pose ${bn} ${S} elbow raised${fwd(hand) >= 0.2 ? ' (reach)' : ''}`, t, el.y - sh.y);
        const seg = wr.clone().sub(el), u = Math.max(0, Math.min(1, head.clone().sub(el).dot(seg) / seg.lengthSq())), dh = el.clone().addScaledVector(seg, u).distanceTo(head);
        if (dh < 0.13) note(`pose ${bn} ${S} forearm at helmet`, t, 0.13 - dh);
      }
    });
    // 1) robots vs static props
    for (const b of boxes) vsBox(b, b.name, null);
    // 2) robots vs items (the gripping hand may touch its own held item)
    for (const it of items) { vsBox({ M: it.M, h: it.h }, it.name, (ri, L) => it.held === ctx.botNames[ri] && L.hand);
      // the gripping hand itself: fingers may touch but not sink in more than TOL
      const ri = ctx.botNames.indexOf(it.held); if (ri >= 0) { const inv = it.M.clone().invert(); let worst = 0, wl = '', wp = null;
        for (const L of rWorld[ri]) { if (!L.hand) continue; for (const p of L.w) { const d = depthInside(p.clone().applyMatrix4(inv), it.h); if (d > worst) { worst = d; wl = L.name; wp = p; } } }
        if (worst > TOL) note(`grip ${it.held} ${wl} in ${it.name}`, t, worst, wp && wp.toArray().map((v) => +v.toFixed(2))); } }
    // 3) items vs props and items vs items (corner + face-centre samples)
    const samplePts = (it) => { const out = []; const [a, b, c] = it.h; for (const sx of [-1, 0, 1]) for (const sy of [-1, 0, 1]) for (const sz of [-1, 0, 1]) out.push(V3(sx * a * 0.98, sy * b * 0.98, sz * c * 0.98).applyMatrix4(it.M)); return out; };
    for (const it of items) {
      const pts = samplePts(it), c0 = ctr(it.M);
      for (const b of boxes) { if (ctr(b.M).distanceTo(c0) > Math.hypot(...b.h) + 1) continue; const inv = b.M.clone().invert(); let w = 0; for (const p of pts) w = Math.max(w, depthInside(p.clone().applyMatrix4(inv), b.h)); if (w > TOL) note(`${it.name} in ${b.name}`, t, w); }
      for (const o of items) { if (o === it || ctr(o.M).distanceTo(c0) > 1.2) continue; const inv = o.M.clone().invert(); let w = 0; for (const p of pts) w = Math.max(w, depthInside(p.clone().applyMatrix4(inv), o.h)); if (w > TOL) note(`${it.name} overlaps ${o.name}`, t, w, [c0.toArray().map((v) => +v.toFixed(2)), ctr(o.M).toArray().map((v) => +v.toFixed(2))]); }
      // 4) support
      // on a belt: every bottom corner inside a belt surface (1 cm inset) and the bottom within 1 cm of the belt top
      if (it.belt && !it.held) {
        let out = 0;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const c = V3(sx * it.h[0], -it.h[1], sz * it.h[2]).applyMatrix4(it.M); let ok = false;
          for (const B of ctx.beltTops()) { const q = c.clone().applyMatrix4(B.M.clone().invert()); if (Math.abs(q.x) <= B.hx - 0.01 && Math.abs(q.z) <= B.hz + 0.001 && Math.abs(c.y - B.top) <= 0.01) { ok = true; break; } }
          if (!ok) out++;
        }
        if (out) note(`${it.name} off the belt surface (${out} corners)`, t, 0.02 * out);
      }
      if (!it.held && !it.belt && !it.noSupport) {   // resting: something real and visible must be under it (raycast onto rendered meshes)
        const T3 = ctx.THREE, rc = new T3.Raycaster(); rc.far = 0.032;
        const cands = [...ctx.supportMeshes(), ...items.filter((o) => o !== it && o.mesh).map((o) => ({ o: o.mesh, b: new T3.Box3().setFromObject(o.mesh) }))];
        let hits = 0, centre = false, gapC = 9;
        [[0, 0], [-0.95, -0.95], [0.95, -0.95], [-0.95, 0.95], [0.95, 0.95]].forEach(([a, c], pi) => {
          const p = V3(a * it.h[0], -it.h[1], c * it.h[2]).applyMatrix4(it.M), o = p.clone().add(V3(0, 0.02, 0));
          const list = cands.filter((m) => p.x >= m.b.min.x - 1e-3 && p.x <= m.b.max.x + 1e-3 && p.z >= m.b.min.z - 1e-3 && p.z <= m.b.max.z + 1e-3 && m.b.max.y >= p.y - 0.013 && m.b.min.y <= p.y + 0.02).map((m) => m.o);
          rc.set(o, V3(0, -1, 0)); const h = list.length ? rc.intersectObjects(list, true)[0] : null; const gap = h ? p.y - h.point.y : 9;
          const ok = gap <= 0.012; if (ok) hits++; if (pi === 0) { centre = ok; gapC = gap; }
        });
        // or resting on another (rendered) item: its top within 1 cm under our bottom centre
        let onItem = false; const bc = V3(0, -it.h[1], 0).applyMatrix4(it.M);
        for (const o of items) { if (o === it) continue; const q = bc.clone().applyMatrix4(o.M.clone().invert()); if (Math.abs(q.x) <= o.h[0] && Math.abs(q.z) <= o.h[2] && Math.abs(q.y - o.h[1]) <= 0.01) { onItem = true; break; } }
        if (!centre && hits < 3 && !onItem) note(`${it.name} floating (nothing visible under it)`, t, Math.min(gapC, 0.5));
      }
    }
    // 5) cobot / arm samples vs props and items (sphere of radius r around each sample)
    for (const [p, r, label] of ctx.cobotSamples()) {
      for (const b of boxes) { if (b.name.startsWith('cell-mount')) continue; const d = depthInside(p.clone().applyMatrix4(b.M.clone().invert()), b.h) + r; if (d > TOL) note(`${label} in ${b.name}`, t, d); }
      for (const it of items) {  const d = depthInside(p.clone().applyMatrix4(it.M.clone().invert()), it.h) + r; if (d > TOL) note(`${label} in ${it.name}`, t, d); }
    }
  }
  return { check, report: () => { for (const e of issues.values()) endRun(e); return [...issues.values()].sort((a, b) => b.max - a.max); } };
}
