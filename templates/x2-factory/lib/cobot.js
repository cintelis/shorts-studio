// Code-built 6-axis-style collaborative robot arm (UR-like proportions) with an analytic IK that keeps the gripper pointing
// straight down. Pose is a pure function of the tool-tip target, so it is seek-safe.
import * as THREE from './three.module.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const H1 = 0.17, L2 = 0.43, L3 = 0.39, LT = 0.21;   // shoulder height, upper arm, forearm, wrist-to-fingertip

export function createCobot({ white, dark, steel }) {
  const root = new THREE.Group();          // placed at the mount point on the table, yaw = 0 faces +x
  const yawG = new THREE.Group(); root.add(yawG);
  const cyl = (r, h, m, axis = 'y') => { const g = new THREE.CylinderGeometry(r, r, h, 40); if (axis === 'z') g.rotateX(Math.PI / 2); if (axis === 'x') g.rotateZ(Math.PI / 2); const o = new THREE.Mesh(g, m); o.castShadow = o.receiveShadow = true; return o; };
  // base (fixed) + turret (yaw)
  const plate = cyl(0.11, 0.02, dark); plate.position.y = 0.01; root.add(plate);
  const base = cyl(0.075, 0.1, white); base.position.y = 0.07; root.add(base);
  const ring = cyl(0.077, 0.015, dark); ring.position.y = 0.12; root.add(ring);
  const turret = cyl(0.068, 0.06, white); turret.position.y = 0.15; yawG.add(turret);
  // shoulder
  const sh = new THREE.Group(); sh.position.y = H1; yawG.add(sh);
  const shHousing = cyl(0.07, 0.17, white, 'z'); sh.add(shHousing);
  for (const s of [-1, 1]) { const c = cyl(0.071, 0.012, dark, 'z'); c.position.z = s * 0.09; sh.add(c); }
  const upper = cyl(0.05, L2, white); upper.position.y = L2 / 2; sh.add(upper);
  const el = new THREE.Group(); el.position.y = L2; sh.add(el);
  const elHousing = cyl(0.06, 0.14, white, 'z'); el.add(elHousing);
  for (const s of [-1, 1]) { const c = cyl(0.061, 0.012, dark, 'z'); c.position.z = s * 0.075; el.add(c); }
  const fore = cyl(0.042, L3, white); fore.position.y = L3 / 2; el.add(fore);
  const wr = new THREE.Group(); wr.position.y = L3; el.add(wr);
  const wrHousing = cyl(0.048, 0.11, white, 'z'); wr.add(wrHousing);
  for (const s of [-1, 1]) { const c = cyl(0.049, 0.01, dark, 'z'); c.position.z = s * 0.06; wr.add(c); }
  const wlink = cyl(0.04, 0.09, white); wlink.position.y = 0.045; wr.add(wlink);
  const flange = cyl(0.042, 0.02, dark); flange.position.y = 0.1; wr.add(flange);
  const rollG = new THREE.Group(); wr.add(rollG);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.05, 0.07), dark); grip.position.y = 0.135; grip.castShadow = true; rollG.add(grip);
  const fingers = [];
  for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.075, 0.05), steel); f.castShadow = true; f.position.set(s * 0.1, 0.195, 0); rollG.add(f); fingers.push([f, s]); }
  const tip = new THREE.Object3D(); tip.position.y = LT; wr.add(tip);

  // tool tip target (world) -> joint angles; also sets the pose
  function solve(target, open = 1) {
    root.updateMatrixWorld(true);
    const local = target.clone().applyMatrix4(root.matrixWorld.clone().invert());
    const yaw = Math.atan2(-local.z, local.x);
    const r = Math.hypot(local.x, local.z), h = local.y + LT - H1;
    const d = Math.min(L2 + L3 - 1e-4, Math.hypot(r, h));
    const c = (d * d - L2 * L2 - L3 * L3) / (2 * L2 * L3), g = Math.acos(Math.max(-1, Math.min(1, c)));
    const phi = Math.atan2(r, h), a2 = phi - Math.atan2(L3 * Math.sin(g), L2 + L3 * Math.cos(g));   // elbow up
    yawG.rotation.y = yaw; sh.rotation.z = -a2; el.rotation.z = -g; wr.rotation.z = -(Math.PI - a2 - g);
    for (const [f, s] of fingers) f.position.x = s * (0.08 + 0.03 * open);
    // wrist roll: finger axis along world x
    const ax = () => { root.updateMatrixWorld(true); const v = V3(1, 0, 0).transformDirection(rollG.matrixWorld); let a = Math.atan2(-v.z, v.x); while (a > Math.PI / 2) a -= Math.PI; while (a <= -Math.PI / 2) a += Math.PI; return a; };
    rollG.rotation.y = 0; const a0 = ax(); rollG.rotation.y = a0; if (Math.abs(ax()) > 1e-3) rollG.rotation.y = -a0;
    root.updateMatrixWorld(true);
    return { yaw, a2, g };
  }
  // sample points along each link for the collision audit: [point, radius, label]
  function samples() {
    root.updateMatrixWorld(true);
    const out = [];
    const seg = (obj, y0, y1, r, label) => { for (let y = y0; y <= y1 + 1e-6; y += 0.03) out.push([V3(0, y, 0).applyMatrix4(obj.matrixWorld), r, label]); };
    seg(upper.parent, 0, L2, 0.05, 'cobot-upper'); seg(el, 0, L3, 0.042, 'cobot-fore'); seg(wr, 0.0, 0.12, 0.045, 'cobot-wrist');
    for (const [f] of fingers) out.push([V3(0, 0, 0).applyMatrix4(f.matrixWorld), 0.012, 'cobot-finger']);
    return out;
  }
  return { root, solve, tip, wr, samples };
}
