// Physical-correctness audit for the castle run. Pure measurements on the posed scene (no rendering).
import * as THREE from './three.module.js';
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DIRS = []; for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) DIRS.push(V3(x, y, z).normalize());
const BODY = ['hip_07', 'abdomen_08', 'pecho_09', 'cuello_010', 'Cabeza_011', 'frente_013', 'clavicula_l_055', 'brazo_l_056', 'antebrazo_l_057', 'mano_l_058', 'dedomedio_l003_067',
  'clavicula_r_076', 'brazo_r_077', 'antebrazo_r_078', 'mano_r_079', 'dedomedio_r002_088', 'pierna_l_097', 'pantorrilla_l_098', 'Talon_l_099', 'puntapie_l_0101', 'pierna_r_0103', 'pantorrilla_r_0104', 'Talon_r_00', 'puntapie_r_0105'];
export function auditRange(m, t0, t1, dt = 1 / 30) {
  const ray = new THREE.Raycaster(); const girl = m.girl(); m.floorsHall;  const bones = BODY.map((n) => girl.getObjectByName(n));
  const out = { frames: 0, expected: Math.round((t1 - t0) / dt), slipMax: 0, slipAt: null, floorMis: 0, floorAt: null, pen: 0, penAt: null, penBone: '', camMin: 1e9, camAt: null, soleMin: 1e9, soleAt: null, events: [], plantSlideMax: 0, plantSlideAt: null, plantRuns: 0, plantRunsOver1cm: 0 };
  const runs = {};   // per joint: planted run (joint within 2 cm of the floor) -> horizontal slide from where it planted
  const closeRun = (key, t) => { const r = runs[key]; if (!r) return; out.plantRuns++; if (r.max > 0.01) { out.plantRunsOver1cm++; out.events.push(`${r.t0.toFixed(3)}-${t.toFixed(3)} planted ${key} slid ${(r.max * 100).toFixed(1)} cm`); } delete runs[key]; };
  let prev = null;
  for (let k = 0; k < out.expected; k++) {
    const t = t0 + k * dt; const c = m.poseAt(t); const floors = c.set === 'ext' ? m.floorsExt : m.floorsHall;
    const feet = {};
    for (const side of ['l', 'r']) {
      const leg = m.LEG[side]; const p = m.footPt(leg);
      ray.set(V3(p.x, p.y + 0.6, p.z), V3(0, -1, 0)); ray.far = 3; const h = ray.intersectObjects(floors, true)[0];
      const fy = h ? h.point.y : -99; const sole = m.soleH(leg, fy);
      feet[side] = { p, sole, fy };
      if (sole < out.soleMin) { out.soleMin = sole; out.soleAt = t; }
      if (sole < 0.02 && Math.abs(fy - c.floor) > out.floorMis) { out.floorMis = Math.abs(fy - c.floor); out.floorAt = t; }   // planted foot over a different floor height = floating / sunk
      const hj = leg.heel.getWorldPosition(V3()), tj = leg.toe.getWorldPosition(V3());
      feet[side].hj = hj; feet[side].tj = tj; feet[side].hh = hj.y - leg.heelOff - fy; feet[side].th = tj.y - leg.toeOff - fy;
      for (const [j, hk, nm] of [['hj', 'hh', 'heel'], ['tj', 'th', 'toe']]) {
        const key = side + '.' + nm, pos = feet[side][j];
        if (feet[side][hk] < 0.02 && !(prev && prev.shot !== m.shotAt(t).i)) {
          if (!runs[key]) runs[key] = { start: pos.clone(), max: 0, t0: t };
          const d = Math.hypot(pos.x - runs[key].start.x, pos.z - runs[key].start.z); runs[key].max = Math.max(runs[key].max, d);
          if (d > out.plantSlideMax) { out.plantSlideMax = d; out.plantSlideAt = t; }
        } else closeRun(key, t);
      }
      if (prev && Math.abs(prev.t - (t - dt)) < 1e-6 && prev.shot === m.shotAt(t).i) {
        for (const [j, hk] of [['hj', 'hh'], ['tj', 'th']]) {
          if (feet[side][hk] < 0.012 && prev.feet[side][hk] < 0.012) {
            const a = feet[side][j], b = prev.feet[side][j]; const d = Math.hypot(a.x - b.x, a.z - b.z) / dt;
            if (d > out.slipMax) { out.slipMax = d; out.slipAt = t; }
            
          }
        }
      }
    }
    // body inside geometry: segment from the hip to each bone must be clear
    const hip = bones[0].getWorldPosition(V3());
    for (let i = 1; i < bones.length; i++) { const b = bones[i].getWorldPosition(V3()); const d = b.clone().sub(hip); const L = d.length(); ray.set(hip, d.normalize()); ray.far = L; const h = ray.intersectObjects(floors, true)[0];
      if (h) { const depth = L - h.distance; if (depth > out.pen) { out.pen = depth; out.penAt = t; out.penBone = BODY[i]; } if (depth > 0.01) out.events.push(`${t.toFixed(3)} ${BODY[i]} ${(depth * 100).toFixed(1)} cm past ${h.object.type}:${h.object.name || (h.object.material && h.object.material.name)}@${h.point.toArray().map((v) => v.toFixed(2))}`); } }
    // sword + flag pole: sample points must not be inside the scene or inside her body (capsules round the limb bones)
    const props = [];
    if (m.SWORD && m.SWORD.samples.length) for (const o of m.SWORD.samples) props.push(['sword', o.getWorldPosition(V3()), 0.012]);
    const F = m.FLAG && m.FLAG(); if (F && c.set === 'hall') { F.pole.updateMatrixWorld(true); for (let k = 0; k <= 12; k++) props.push(['pole', V3(0, F.poleL * k / 12, 0).applyMatrix4(F.pole.matrixWorld), F.poleR]); }
    const caps = [['hip_07', 'pecho_09', 0.13], ['pecho_09', 'cuello_010', 0.12], ['cuello_010', 'frente_013', 0.1], ['pierna_l_097', 'pantorrilla_l_098', 0.075], ['pantorrilla_l_098', 'Talon_l_099', 0.055], ['pierna_r_0103', 'pantorrilla_r_0104', 0.075], ['pantorrilla_r_0104', 'Talon_r_00', 0.055],
      ['brazo_l_056', 'antebrazo_l_057', 0.05], ['brazo_r_077', 'antebrazo_r_078', 0.05], ['antebrazo_r_078', 'mano_r_079', 0.04]].map(([a, b, r]) => [girl.getObjectByName(a).getWorldPosition(V3()), girl.getObjectByName(b).getWorldPosition(V3()), r, a]);
    { const back = V3(0, 0, -1).applyQuaternion(m.holder.quaternion).multiplyScalar(0.13);   // cape: a slab hanging behind her back
      caps.push([girl.getObjectByName('pecho_09').getWorldPosition(V3()).add(back), girl.getObjectByName('hip_07').getWorldPosition(V3()).add(back).add(V3(0, -0.25, 0)), 0.09, 'cape']); }
    const segD = (p, a, b) => { const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())); return p.distanceTo(a.clone().add(ab.multiplyScalar(t))); };
    out.propSamples = (out.propSamples || 0) + props.length;
    for (const [nm, p, r] of props) {
      for (const [a, b, cr, an] of caps) { const d = segD(p, a, b) - cr - r; if (d < -0.01) { out.propBody = Math.min(out.propBody ?? 0, d); out.events.push(`${t.toFixed(3)} ${nm} into body (${an}) ${(-d * 100).toFixed(1)} cm`); } }
      // inside scene geometry: odd number of hits along +Y (closed meshes) or below the floor
      ray.set(p, V3(0, 1, 0)); ray.far = 30; const hits = ray.intersectObjects(floors.filter((o) => !(F && F.standMeshes.includes(o))), true).length;
      ray.set(V3(p.x, p.y + 0.6, p.z), V3(0, -1, 0)); ray.far = 3; const fh = ray.intersectObjects(floors, true)[0];
      if (fh && p.y - r < fh.point.y - 0.005 && !(nm === 'pole' && F && p.distanceTo(F.standPos) < 0.5)) { out.events.push(`${t.toFixed(3)} ${nm} below floor ${((fh.point.y - p.y + r) * 100).toFixed(1)} cm`); out.propFloor = (out.propFloor || 0) + 1; }
    }
    // right-hand fingers round the sword grip: joints must stay outside the grip surface
    if (m.SWORD && m.SWORD.root) { const R = m.SWORD.root; const a0 = V3(0, 0, 0).applyMatrix4(R.matrixWorld), ax = V3(0, 1, 0).applyMatrix4(R.matrixWorld).sub(a0).normalize(); const gr = m.SWORD.gripR * m.SWORD.sp;
      let mn = 1e9; for (const f of m.HANDS.r.fingers) for (const b of f.slice(1)) { const d = b.getWorldPosition(V3()).sub(a0); mn = Math.min(mn, d.sub(ax.clone().multiplyScalar(d.dot(ax))).length()); }
      out.swordFingerMin = Math.min(out.swordFingerMin ?? 1e9, mn); if (mn < gr + 0.006) out.events.push(`${t.toFixed(3)} finger into sword grip ${((gr + 0.006 - mn) * 1000).toFixed(1)} mm`); }
    // fingers wrapped round the pole: every left finger joint must stay outside the pole surface (with ~6 mm finger half-thickness)
    if (F && c.set === 'hall' && t >= F.t.grab) { const a0 = V3(0, 0, 0).applyMatrix4(F.pole.matrixWorld), a1 = V3(0, 1, 0).applyMatrix4(F.pole.matrixWorld), ax = a1.sub(a0).normalize();
      let mn = 1e9, mx = 0; for (const f of m.HANDS.l.fingers) for (const b of f.slice(1)) { const d = b.getWorldPosition(V3()).sub(a0); const r = d.sub(ax.clone().multiplyScalar(d.dot(ax))).length(); mn = Math.min(mn, r); mx = Math.max(mx, r); }
      out.poleFingerMin = Math.min(out.poleFingerMin ?? 1e9, mn); out.poleFingerMax = Math.max(out.poleFingerMax ?? 0, mx); if (mn < F.poleR + 0.006) out.events.push(`${t.toFixed(3)} finger into pole ${((F.poleR + 0.006 - mn) * 1000).toFixed(1)} mm`); }
    // camera clearance
    const cs = m.cameraAt(t); let cmin = 1e9; for (const d of DIRS) { ray.set(cs.pos, d); ray.far = 2; const h = ray.intersectObjects(floors, true)[0]; if (h && h.distance < cmin) cmin = h.distance; }
    if (cmin < out.camMin) { out.camMin = cmin; out.camAt = t; }
    prev = { t, feet, shot: m.shotAt(t).i }; out.frames++;
  }
  for (const k of Object.keys(runs)) closeRun(k, t1);
  return out;
}
