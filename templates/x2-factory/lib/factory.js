// X2 factory v2: ten AgiBot X2 robots working different stations on one floor. Pure function of the state passed to render(s).
// Robot: AgiBot X2 Ultra omnihand URDF (AgiBot, Mulan PSL v2). CC BY 4.0 models (Sketchfab): warehouse (Nicholas-3D), conveyor (scailman),
// Euro crate (Daniel Rosehill), milling machine + storage racking (Lady Lion Studios), forklift (alban),
// hydraulic press (Scarecrow_original), cardboard boxes (NotAnotherApocalypticCo.). The cobot arm is code-built (lib/cobot.js).
// Lighting: Poly Haven "Empty Warehouse 01" (CC0). Dollies, tables, trays, cart, press controls and floor markings are code-built.
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
import { V3, DEG, clamp, clamp01, ss, Q_BASE, yawQ, rpyQ, fromArr, buildRig, chainOf, fk, solveIK } from './core.js';
import { SP, Bot, dir, right, baseMat, objMat, frontOf, palmDown } from './bots.js';
import { createCobot } from './cobot.js';

const PI = Math.PI;
const BS = 0.85, BELT_Y = 0.714 * BS, CR = [0.602, 0.23, 0.402];   // conveyors at 85% height: boxes and crates are handled at chest height
const CRATE = { halfW: 0.336, gripH: 0.24, gripZ: 0.06, pitch: 0, curl: 0.06, carry: { r: 0.45, h: 0.64 } };
const BOX = { halfW: 0.2, gripH: 0.30, gripZ: 0.08, pitch: 0.35, curl: 0.03, carry: { r: 0.5, h: 0.64 } };
const PART = { halfW: 0.147, gripH: 0.15, gripZ: 0.06, pitch: 0.3, curl: 0.04, carry: { r: 0.37, h: 0.85 } };

export function createFactory(canvas, { width = 1080, height = 1920 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b0d10);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.05, 400);
  const key = new THREE.DirectionalLight(0xfff0dc, 2.2); key.position.set(6, 14, 7); key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096); Object.assign(key.shadow.camera, { left: -13, right: 13, top: 11, bottom: -11, near: 1, far: 50 });
  key.shadow.bias = -0.0003; key.shadow.normalBias = 0.03;
  scene.add(key, key.target); key.target.position.set(1.5, 0, -1);
  const rim = new THREE.DirectionalLight(0x9cc4ff, 0.9); rim.position.set(-8, 6, -10); scene.add(rim);
  const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x2a2622, 0.45); scene.add(hemi);
  const world = new THREE.Group(); scene.add(world);
  const roofClip = new THREE.Plane(V3(0, -1, 0), 1000); renderer.localClippingEnabled = true;
  const shadows = (o) => o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });

  let millDoor = null, cobotArm = null, cobotCycles = [], cobotBot = null, millRuns = [], pressHits = [], inspectJobs = [], scanPlane = null, carryBot = null, cartBot = null;
  let J, robotSrc = {}, M = {}, bots = [], rigs = [], chains = [], objs = [], beltMats = [], pressRod = null, millLamp = null, scanMat = null, cart = null;
  const ANCH = {};
  const AUD = { beltTops: [], boxes: [], virt: [], sups: [], armPts: [] }; let ST = 'prop';
  const loadHDR = (url) => new Promise((res, rej) => { const l = new HDRLoader(); l.setDataType(THREE.FloatType); l.load(url, res, undefined, rej); });

  async function load(base) {
    const gl = new GLTFLoader(), g = (p) => gl.loadAsync(base + 'models/' + p);
    let rg, wh, cv, cr, pa, mill, press, arm, rack, fork, boxes, hdr;
    [J, rg, wh, cv, cr, pa, mill, press, arm, rack, fork, boxes, hdr] = await Promise.all([
      fetch(base + 'models/x2/robot.json').then((r) => r.json()), g('x2/robot.glb'), g('warehouse/scene.gltf'), g('conveyor/scene.gltf'), g('crate.glb'),
      g('pallet/scene.gltf'), g('mill/scene.gltf'), g('press/scene.gltf'), g('arm/scene.gltf'), g('racking/scene.gltf'), g('forklift/scene.gltf'), g('boxes/scene.gltf'),
      loadHDR(base + 'hdri/empty_warehouse_01_2k.hdr')]);
    hdr.mapping = THREE.EquirectangularReflectionMapping; scene.environment = pmrem.fromEquirectangular(hdr).texture; scene.environmentIntensity = 0.55;

    // ---------- robots: shared geometry + materials, ten rigs
    M = {
      white: new THREE.MeshPhysicalMaterial({ color: 0xebebe8, roughness: 0.36, clearcoat: 0.35, clearcoatRoughness: 0.35 }),
      grey: new THREE.MeshStandardMaterial({ color: 0x47494d, roughness: 0.5, metalness: 0.35 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x1c1e21, roughness: 0.42, metalness: 0.45 }),
      orange: new THREE.MeshStandardMaterial({ color: 0xff6c12, roughness: 0.5 }),
      face: new THREE.MeshPhysicalMaterial({ color: 0x0d0e10, roughness: 0.12, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }),
    };
    rg.scene.traverse((o) => { if (o.isMesh) { robotSrc[o.name] = o.geometry; if (o.geometry.attributes.color) o.geometry.deleteAttribute('color'); } });
    const gripT = new THREE.Matrix4().makeTranslation(0.03, 0, 0.058);
    for (let i = 0; i < 10; i++) {
      const rig = buildRig(J, 1, (name, grp) => {
        for (const v of J.links[name] || []) { const geo = robotSrc[v.mesh]; if (!geo) continue; const m = new THREE.Mesh(geo, M[v.col] || M.white); m.position.copy(fromArr(v.xyz)); m.quaternion.copy(rpyQ(v.rpy)); m.castShadow = true; m.receiveShadow = true; grp.add(m); }
      });
      world.add(rig.root); rigs.push(rig);
      chains.push({ ll: chainOf(rig, 'pelvis', 'left_ankle_roll_link'), rl: chainOf(rig, 'pelvis', 'right_ankle_roll_link'), la: chainOf(rig, 'torso_link', 'L_palm', gripT), ra: chainOf(rig, 'torso_link', 'R_palm', gripT) });
    }

    // ---------- building
    const Wh = wh.scene; Wh.scale.setScalar(1.6); Wh.position.set(-12.8 + 3.6, 0, 36.9 - 9.5);
    Wh.traverse((o) => { if (!o.isMesh) return; o.receiveShadow = true; const m = o.material;
      if (m.name === 'WetConcrete') { m.metalness = 0; m.metalnessMap = null; m.roughnessMap = null; m.roughness = 0.85; m.envMapIntensity = 0.3; m.color.setRGB(0.62, 0.62, 0.6); m.needsUpdate = true; }
      if (m.name === 'Emissive') m.emissiveIntensity = 1.5; m.clippingPlanes = [roofClip]; m.clipShadows = false; });
    world.add(Wh);

    // floor markings: walkways and cell outlines
    const markM = new THREE.MeshStandardMaterial({ color: 0xe8b800, roughness: 0.6 }), lineM = new THREE.MeshStandardMaterial({ color: 0xd9dcdf, roughness: 0.6 });
    const mark = (x, z, w, d, m = markM) => { const q = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m); q.rotation.x = -PI / 2; q.position.set(x, 0.003, z); q.receiveShadow = true; world.add(q); };
    const box = (x0, z0, x1, z1, m) => { mark((x0 + x1) / 2, z0, x1 - x0, 0.07, m); mark((x0 + x1) / 2, z1, x1 - x0, 0.07, m); mark(x0, (z0 + z1) / 2, 0.07, z1 - z0, m); mark(x1, (z0 + z1) / 2, 0.07, z1 - z0, m); };
    mark(3, 3.45, 24, 0.09); mark(3, 5.05, 24, 0.09);                      // main walkway (z 3.45..5.05)
    mark(8.45, -5, 0.09, 17); mark(6.9, -5, 0.09, 17);                     // cross aisle (x 6.9..8.45)
    box(-0.6, -2.1, 2.9, 0.1, lineM); box(2.6, -5.2, 6.2, -1.6, lineM); box(2.9, -0.9, 6.2, 2.5, lineM); box(-6.9, 0.6, -0.9, 2.95, lineM); box(-7.3, -7.4, -1.2, -4.6, lineM);

    // ---------- materials for code-built props
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.45, metalness: 0.6 });
    const steelL = new THREE.MeshStandardMaterial({ color: 0x8a9098, roughness: 0.35, metalness: 0.8 });
    const yel = new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.5 });
    const tableTop = new THREE.MeshStandardMaterial({ color: 0x5b6067, roughness: 0.6, metalness: 0.3 });
    const blk = (w, h, d, m, x, y, z, parent = world) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; parent.add(o); AUD.boxes.push({ o, h: [w / 2, h / 2, d / 2], name: ST, parent }); return o; };
    function table(x, z, yaw, w, d, h) {
      const st0 = ST; ST = st0 + '-table';
      const t = new THREE.Group(); t.position.set(x, 0, z); t.rotation.y = yaw; world.add(t);
      blk(w, 0.04, d, tableTop, 0, h - 0.02, 0, t);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) blk(0.05, h - 0.04, 0.05, steel, sx * (w / 2 - 0.05), (h - 0.04) / 2, sz * (d / 2 - 0.05), t);
      blk(w - 0.1, 0.03, 0.04, steel, 0, 0.15, d / 2 - 0.05, t); blk(w - 0.1, 0.03, 0.04, steel, 0, 0.15, -d / 2 + 0.05, t);
      ST = st0; return t;
    }

    // ---------- templates
    const crateT = cr.scene; crateT.traverse((o) => { if (o.isMesh) o.material.roughness = 0.55; }); shadows(crateT);
    const palT = pa.scene; { const b = new THREE.Box3().setFromObject(palT), s = b.getSize(V3()); const k = 1.2 / s.x; palT.scale.setScalar(k); palT.position.y = -b.min.y * k; }
    palT.traverse((o) => { if (o.isMesh) { o.material.roughness = 0.82; o.material.metalness = 0; } }); shadows(palT);
    const palG = new THREE.Group(); palG.add(palT);
    const boxT = {}; boxes.scene.updateMatrixWorld(true);
    boxes.scene.traverse((o) => { if (o.isMesh) { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); g.computeBoundingBox(); const b = g.boundingBox, c = b.getCenter(V3()); g.translate(-c.x, -b.min.y, -c.z); boxT[o.name.split('_Cardboard')[0]] = { g, m: o.material, size: b.getSize(V3()) }; } });
    const mkBox = (name) => { const t = boxT[name] || Object.values(boxT)[0]; const m = new THREE.Mesh(t.g, t.m); m.castShadow = m.receiveShadow = true; world.add(m); return m; };
    const mkCrate = () => { const c = crateT.clone(true); world.add(c); return c; };
    const partM = new THREE.MeshStandardMaterial({ color: 0xaab0b8, roughness: 0.5, metalness: 0.8, envMapIntensity: 0.7 });
    const partG = new THREE.BoxGeometry(0.22, 0.14, 0.14); partG.translate(0, 0.07, 0);
    const mkPart = () => { const m = new THREE.Mesh(partG, partM); m.castShadow = m.receiveShadow = true; world.add(m); return m; };
    const place = (o, Mx) => { o.matrixAutoUpdate = false; o.matrix.copy(Mx); o.matrixWorldNeedsUpdate = true; };

    // ---------- conveyors (scailman model: 2 m segment, belt top 0.714, local z along the belt)
    cv.scene.traverse((o) => { if (o.isMesh && o.material.name === 'Conveyor') { o.material.color.set(0x8a99b0); o.material.roughness = 0.55; o.material.metalness = 0.3; } });
    function conveyor(x0, z0, x1, z1) {   // belt runs from (x0,z0) to (x1,z1); returns direction + length
      const d = V3(x1 - x0, 0, z1 - z0), L = d.length(); d.normalize();
      const n = Math.max(1, Math.round(L / 2)), seg = L / n;   // segments stretched to fit the run exactly
      for (let i = 0; i < n; i++) {
        const c = cv.scene.clone(true); c.scale.set(1, BS, seg / 2);
        c.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; if (o.material.name === 'Belt') { o.material = o.material.clone(); o.material.color.setRGB(0.22, 0.22, 0.23); o.material.roughness = 0.85; if (o.material.map) { o.material.map = o.material.map.clone(); o.material.map.wrapS = o.material.map.wrapT = THREE.RepeatWrapping; o.material.map.needsUpdate = true; } beltMats.push(o.material); } } });
        c.position.set(x0 + d.x * seg * (0.5 + i), 0, z0 + d.z * seg * (0.5 + i)); c.quaternion.setFromUnitVectors(V3(0, 0, -1), d); world.add(c);
        if (!window.__convLocal) { const q = cv.scene.clone(true); q.updateMatrixWorld(true); const bb = new THREE.Box3(); q.traverse((o) => { if (o.isMesh && o.material && o.material.name === 'Belt') bb.expandByObject(o); }); window.__convLocal = { belt: [bb.min.toArray(), bb.max.toArray()], all: new THREE.Box3().setFromObject(q).min.toArray().concat(new THREE.Box3().setFromObject(q).max.toArray()) }; }
        { const M = new THREE.Matrix4().makeRotationY(Math.atan2(d.x, d.z)).setPosition(c.position.x, BELT_Y - 0.07 * BS, c.position.z); AUD.virt.push({ M, h: [0.47, 0.07 * BS, seg / 2], name: 'belt' }); AUD.beltTops.push({ M, hx: 0.325, hz: seg / 2, top: BELT_Y }); }
      }
      return { d, L };
    }

    // ================================================================ STATIONS + ROBOT SCRIPTS
    const T0 = -40, TMAX = 80;
    const nb = (name, x, z, yaw) => { const b = new Bot(name, x, z, yaw, T0); bots.push(b); return b; };

    // ---- R1: crate line end -> two crate dollies (stacks of five)
    { ST = 'line';
      const endX = 1.0, Z = -1.0, v = 0.36;
      conveyor(-9.6, Z, endX, Z);   // through the west wall
      ST = 'line-stop'; blk(0.04, 0.015, 0.16, steel, endX + 0.02, BELT_Y + 0.0075, Z); ST = 'line';   // end stop: crates wait against it, fully on the belt
      const rx = 1.42, b = nb('line', rx, Z, PI); const PICK = rx - (endX - 0.01 - CR[2] / 2);
      const SR = 0.72, SH = 0.28, YS = [PI / 2, -PI / 2, 0];   // one low crate stand on each side of the robot (north / south)
      const EOFF = (yaw) => (Math.abs(Math.cos(yaw)) < 0.5 ? V3(0.12, 0, 0) : V3());   // side stands sit 12 cm east, clear of the belt end
      const stand = (yaw) => { const p = V3(rx, 0, Z).addScaledVector(dir(yaw), SR).add(EOFF(yaw)); const g = new THREE.Group(); g.position.copy(p); g.rotation.y = yaw; world.add(g);
        blk(0.44, 0.04, 0.64, steel, 0, SH - 0.02, 0, g); for (const sx of [-1, 1]) for (const sz of [-1, 1]) blk(0.04, SH - 0.04, 0.04, steel, sx * 0.19, (SH - 0.04) / 2, sz * 0.29, g); };
      stand(YS[0]); stand(YS[1]); stand(YS[2]);
      ANCH.line = V3(rx, 1.0, Z);
      const P = 8.5 / 1.35, ev = [], cyc = []; b.now = -4;
      for (let k = 0; k < 9; k++) {
        const c0 = b.now; cyc.push(c0);
        const W0 = frontOf(rx, Z, PI, PICK, BELT_Y), crate = mkCrate();
        const layer = Math.floor(k / 3), yaw = YS[k % 3], top = SH + layer * 0.232;
        const o = { mesh: crate, ...CRATE }; const arrive = b.now - 0.3;
        b.pick(o, W0, { aim: 1, clear: k % 3 === 2 ? Math.max(BELT_Y + 0.045, SH + (layer + 1) * 0.232) : BELT_Y + 0.045 });   // lift clear of the stop bar (or the side stands) first b.cur.carryH = Math.max(b.cur.carryH, 0.68, top + 0.04);
        b.turnTo(yaw);
        { const Wst = frontOf(rx, Z, yaw, SR, top); Wst.elements[12] += EOFF(yaw).x; b.place(Wst, { aim: 1, near: 0.5 }); }
        b.turnTo(PI); b.wait(Math.max(0, P - (b.now - c0)));
        const job = b.jobs[b.jobs.length - 1]; ev.push(job.tPlace);
        o.pre = (t) => { const s = Math.max(0, (arrive - t) * v); return rx - PICK - s < -9.6 + CR[2] / 2 + 0.012 ? null : frontOf(rx, Z, PI, PICK + s, BELT_Y); };   // appears through the wall fully on the belt
        objs.push({ o, job, bot: b });
      }
      b.finish(TMAX); b.period = P; b.eventList = ev; b.cycles = cyc;
    }

    // ---- R10 + R8: box line. R10 takes boxes off a table onto the belt start; R8 sorts them at the end onto two tables
    { ST = 'box-line';
      const Z = -6.0, x0 = -6.2, x1 = -2.2, v = 0.5, P = 6.2 / SP;
      conveyor(x0, Z, x1, Z); ST = 'box-stop'; blk(0.04, 0.025, 0.2, steel, x1 + 0.02, BELT_Y + 0.0125, Z); ST = 'box-line';
      const startX = x0 + 0.25, endX = x1 - 0.17, travel = (endX - startX) / v;
      const r10 = nb('kit', startX - 0.6, Z, 0), r8 = nb('sort', endX + 0.6, Z, PI); r10.now = window.X2KIT0 ?? -15;
      const SY = [PI / 2 - 0.35, -PI / 2 + 0.35];   // sort tables angled 20 deg away from the belt end
      for (const a of SY) { const c = V3(endX + 0.6, 0, Z).addScaledVector(dir(a), 0.66); table(c.x, c.z, a, 0.6, 1.1, 0.2); }   // low pallet stands: the top layer stays under the elbows
      ANCH.kit = V3(startX - 0.6, 1.0, Z); ANCH.sort = V3(endX + 0.6, 1.0, Z);
      const names = ['290x290x290_1', '290x290x290_2'];
      // infeed belt from the north: boxes queue at its end, R10 lifts each one onto the box line
      const IX = startX - 0.6 - 0.12, IZ = Z - 0.55, vin = 0.45;
      ST = 'box-infeed'; conveyor(IX, Z - 6.33, IX, Z - 0.33); ST = 'box-stop'; blk(0.2, 0.025, 0.04, steel, IX, BELT_Y + 0.0125, Z - 0.31); ST = 'box-infeed'; ST = 'box-line';
      const placedAt = [];
      for (let k = 0; k < 16; k++) {
        const mesh = mkBox(names[k % 2]), o = { mesh, ...BOX };
        const tStart = r10.now; r10.turnTo(PI / 2);
        const arrive = r10.now - 0.3;
        r10.pick(o, frontOf(r10.p0.x, r10.p0.z, PI / 2, 0.485, BELT_Y, -0.12), { aim: true, step: false, clear: BELT_Y + 0.045, liftOnly: true });
        r10.turnTo(0); r10.place(frontOf(r10.p0.x, r10.p0.z, 0, 0.6, BELT_Y), { aim: true, step: false }); placedAt.push(r10.now - 0.6);
        r10.turnTo(PI / 2); r10.wait(Math.max(0, P - (r10.now - tStart)));
        const job = r10.jobs[r10.jobs.length - 1];
        o.pre = (t) => { const sft = Math.max(0, (arrive - t) * vin); return sft > 5.6 ? null : frontOf(r10.p0.x, r10.p0.z - sft, PI / 2, 0.485, BELT_Y, -0.12); };
        objs.push({ o, job, bot: r10, k });
      }
      r10.finish(TMAX);
      // R8: picks box k when it reaches the end; alternate tables
      const first = placedAt[0] + travel + 0.2;
      r8.wait(first - 0.9 - r8.now);
      for (let k = 0; k < 16; k++) {
        const src = objs.find((q) => q.bot === r10 && q.k === k);
        const arrive = placedAt[k] + travel;
        const prevQ = objs.find((q) => q.bot === r10 && q.k === k - 1);
        if (k >= 12) { src.belt = { t0: placedAt[k], t1: arrive, from: startX, to: endX, Z, prev: prevQ }; continue; }   // after the video: rides the belt and waits at its end
        if (r8.now < arrive - 0.6) r8.wait(arrive - 0.6 - r8.now);
        const W0 = frontOf(r8.p0.x, r8.p0.z, PI, 0.6, BELT_Y);
        const o2 = src.o; const tBeltOn = placedAt[k];
        const side = k % 2 ? -1 : 1, yaw = side > 0 ? SY[0] : SY[1];
        r8.pick({ ...o2 }, W0, { aim: 0.75, step: false, clear: BELT_Y + 0.045, liftOnly: true });
        const j8 = r8.jobs[r8.jobs.length - 1]; j8.obj = o2;
        const n = Math.floor(k / 2), east = side > 0 ? 0.36 : -0.36, lat = (n % 2) ? -east : east, layer = Math.floor(n / 2);   // east column first: the turn from the belt never sweeps over a taller stack
        // each box is set down square to the robot (boxes fan towards it), so it can face the box without twisting its wrists
        const Pt = V3().setFromMatrixPosition(frontOf(r8.p0.x, r8.p0.z, yaw, 0.5, 0.2 + layer * 0.29, lat)), by = Math.atan2(-(Pt.z - r8.p0.z), Pt.x - r8.p0.x);
        r8.place(objMat(Pt, by), { aim: 1, step: false });
        r8.turnTo(PI);
        src.belt = { t0: tBeltOn, t1: arrive, from: startX, to: endX, Z, prev: prevQ };
        src.job2 = j8; src.bot2 = r8;
      }
      r8.finish(TMAX);
    }

    // ---------- machines (static models, real scale)
    const put = (gltf, k, x, z, yaw, hide = [], y = 0) => { const o = gltf.scene; o.traverse((m) => { if (hide.some((h) => m.name.includes(h))) m.visible = false; }); o.scale.setScalar(k); const g = new THREE.Group(); g.add(o); g.position.set(x, y, z); g.rotation.y = yaw; shadows(g); world.add(g); return g; };
    const MILL = { x: 4.3, z: -3.5, yaw: 0 }, PRESS = { x: 4.6, z: 0.9, yaw: 0 };
    const millG = put(mill, 0.01, MILL.x, MILL.z, MILL.yaw, ["Object_30"]); window.__millG = millG; window.__THREE = THREE;
    const pressG = put(press, 1, PRESS.x, PRESS.z, PRESS.yaw); window.__pressG = pressG; press.scene.position.y = 1.502;
    pressRod = press.scene.getObjectByName('rod') || null; press.scene.traverse((m) => { if (!pressRod && m.name.startsWith('rod')) pressRod = m; });
    // the fused Han's arm mesh is replaced by the code-built cobot (lib/cobot.js) in the R5 cell
    const rackG = put(rack, 0.01, 13.1, -3.0, 0, ['Sphere']); rack.scene.traverse((m) => { if (m.isMesh) { const q = m.material; q.roughness = Math.max(q.roughness ?? 0.8, 0.8); q.metalness = /Racking/.test(q.name) ? 0.25 : 0; q.metalnessMap = null; q.roughnessMap = null; q.envMapIntensity = 0.35; q.needsUpdate = true; } });
    const forkG = put(fork, 0.142, -7.4, 6.2, 0.5); { const b = new THREE.Box3().setFromObject(forkG); forkG.position.y -= b.min.y; }
    ANCH.mill = V3(MILL.x, 1.0, MILL.z); ANCH.press = V3(PRESS.x, 1.0, PRESS.z); ANCH.arm = V3(-4.6, 1.0, 1.6);
    window.__geo = { mill: new THREE.Box3().setFromObject(millG), press: new THREE.Box3().setFromObject(pressG), rack: new THREE.Box3().setFromObject(rackG), fork: new THREE.Box3().setFromObject(forkG) };


    const statM = (c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0, roughness: 0.4 });
    // an item at frontOf(...) turned to face the robot's standing point (so it can square up to it without twisting its wrists)
    const fanTo = (x, z, yaw, r, h, lat) => { const p = V3().setFromMatrixPosition(frontOf(x, z, yaw, r, h, lat)); return objMat(p, Math.atan2(-(p.z - z), p.x - x)); };
    // ---- R2: CNC mill loader (mill front faces +x; bed ~0.785 m, ~0.3 m inside the door). Cycle 20.7 s.
    { ST = 'mill';
      ST = 'mill-fixture'; blk(0.26, 0.755, 0.36, M.dark, 5.2, 0.3775, MILL.z); blk(0.32, 0.03, 0.42, steelL, 5.2, 0.77, MILL.z); blk(0.03, 0.04, 0.26, M.dark, 5.085, 0.805, MILL.z);   // load fixture just inside the door: pedestal, plate, back stop
      ST = 'mill-door'; for (const dz of [-0.42, 0.42]) blk(0.04, 0.85, 0.04, steel, 5.47, 1.725, MILL.z + dz);   // guide rails above the opening
      millDoor = new THREE.Group(); world.add(millDoor); blk(0.03, 0.75, 0.8, steelL, 5.47, 0, 0, millDoor); { const gl = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.28, 0.5), new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.15, metalness: 0.3 })); gl.position.set(5.47, 0.12, 0); millDoor.add(gl); }
      millDoor.position.set(0, 1.725, MILL.z); millDoor.children.forEach((c) => { c.position.x = 5.47; }); millDoor.position.x = 0; ST = 'mill';
      const rx = 5.85, rz = MILL.z, b = nb('mill', rx, rz, PI / 2); b.now = -36; const P = 20.7 / SP, TH = 0.74, PH_ = 0.14;
      table(rx, rz - 0.66, 0, 0.9, 0.5, TH); table(rx, rz + 0.66, 0, 0.9, 0.5, TH);
      millLamp = statM(0x39ff7a); const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 16), millLamp); lamp.position.set(MILL.x + 1.0, 1.52, MILL.z - 0.75); world.add(lamp);
      blk(0.03, 0.1, 0.03, steel, MILL.x + 1.0, 1.44, MILL.z - 0.75);
      const runs = [], cyc = [], N = 4;   // four cycles fall inside the video
      for (let k = 0; k < N; k++) {
        const c0 = b.now; cyc.push(c0); const part = mkPart(), o = { mesh: part, ...PART };
        const lat = [-0.24, 0.24][k % 2], lvIn = 1 - Math.floor(k / 2), lvOut = Math.floor(k / 2);   // 2 x 2 stacks: grips below shoulder height, room for the hands
        b.turnTo(PI / 2); b.pick(o, fanTo(rx, rz, PI / 2, 0.52, TH + lvIn * PH_, lat), { aim: 1, step: false });
        const Wfix = frontOf(rx, rz, PI, 0.65, 0.785);   // on the fixture plate, inside the door
        const j1 = b.cur; b.turnTo(PI); b.place(Wfix, { aim: true });
        const tRun = b.now; b.wait(8.0 / SP); runs.push([tRun, b.now]);
        b.pick(o, Wfix, { aim: true }); const j2 = b.cur;
        b.place(fanTo(rx, rz, -PI / 2, 0.52, TH + lvOut * PH_, lat), { aim: 1, step: false });
        b.turnTo(PI / 2); b.wait(Math.max(0, P - (b.now - c0)));
        objs.push({ o, job: j1, bot: b, job2: j2, bot2: b });
      }
      b.finish(TMAX); millRuns = runs; b.period = P; b.eventList = runs.map((r) => r[0] - 0.6); b.cycles = cyc;
      ANCH.millBot = V3(rx, 1.0, rz);
    }
    // ---- R3: hydraulic press with two-hand buttons (press front faces +z; bed top ~0.635, rod travel ~0.3). Cycle 16.9 s.
    { ST = 'press';
      const rx = PRESS.x - 0.05, rz = PRESS.z + 0.6, b = nb('press', rx, rz, PI); b.now = -36; const P = 16.9 / SP, TH = 0.7;
      ST = 'press-bolster'; blk(0.5, 0.03, 0.3, M.dark, PRESS.x, 0.605, PRESS.z); ST = 'press';   // bolster plate on the press rails, under the ram
      const BED = 0.62, RAM = V3(PRESS.x, BED, PRESS.z), zBack = rz + 0.35;
      table(rx - 0.6, rz + 0.25, 0, 0.5, 0.5, TH); table(rx + 0.6, rz + 0.25, 0, 0.5, 0.5, TH);
      const btnM = new THREE.MeshStandardMaterial({ color: 0x1f8f3a, roughness: 0.4, emissive: 0x1f8f3a, emissiveIntensity: 0.2 });
      const btn = [];
      ST = 'press-btn';
      for (const sx of [-1, 1]) {
        const bx = rx + sx * 0.52, bz = PRESS.z + 0.16;   // two-hand control posts inside the press frame, either side of the bed
        blk(0.12, 0.16, 0.08, yel, bx, 0.9, bz); blk(0.045, 0.82, 0.045, steel, bx, 0.41, bz); blk(0.2, 0.02, 0.2, steel, bx, 0.01, bz);
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.03, 20), btnM); c.rotation.x = PI / 2; c.position.set(bx, 0.9, bz + 0.055); world.add(c);
        btn.push(V3(bx, 0.9, bz + 0.07 + 0.105));   // palm centre ~10 cm in front of the button: the fingertips stop on the green face
      }
      ST = 'press';
      const hits = [], cyc = [], N = 6;
      for (let k = 0; k < N; k++) {
        const c0 = b.now; cyc.push(c0); const part = mkPart(), o = { mesh: part, ...PART };
        const colIn = k % 3, lvIn = 1 - Math.floor(k / 3), colOut = 2 - (k % 3), lvOut = Math.floor(k / 3), R3 = [0.43, 0.59, 0.75];
        b.turnTo(PI); b.pick(o, frontOf(rx, rz, PI, R3[colIn], TH + lvIn * 0.14, -0.25), { aim: true }); const j1 = b.cur;
        const Wbed = objMat(RAM.clone(), PI / 2);   // centred under the ram
        b.turnTo(PI / 2); b.place(Wbed, { aim: true });
        const hj = b.hands(btn[0], btn[1], 1.9 / SP); hits.push([hj.tPick + 0.1, hj.tPlace]);
        b.pick(o, Wbed, { aim: true }); const j2 = b.cur;
        b.turnTo(0); b.place(frontOf(rx, rz, 0, R3[colOut], TH + lvOut * 0.14 * 0.55, 0.25), { aim: true });
        b.turnTo(PI); b.wait(Math.max(0, P - (b.now - c0)));
        o.squashA = hj.tPick + 0.1; o.squashAt = hj.tPick + 0.55;
        objs.push({ o, job: j1, bot: b, job2: j2, bot2: b });
      }
      b.finish(TMAX); pressHits = hits; b.period = P; b.eventList = hits.map((h) => h[0] - 0.1); b.cycles = cyc;
      ANCH.pressBot = V3(rx, 1.0, rz);
    }
    // ---- R5: feeds parts onto the cobot cell's fixture; the arm (bolted to the table) picks each one and drops it in a tote. Cycle 8.5 s.
    { ST = 'cell';
      const rx = -5.95, rz = 1.6, b = nb('cobot', rx, rz, -PI / 2); b.now = -14; const P = 10.5 / SP, TH = 0.76;
      table(-4.95, rz, 0, 1.3, 0.9, TH);
      blk(0.3, 0.02, 0.24, steelL, -5.5, TH + 0.01, rz);                 // fixture plate (part sits on it at TH + 0.02)
      const FIX = TH + 0.02;
      // input grid tray on the side table: 2 rows x 3, parts stacked two high (top layer first)
      table(rx, rz + 0.66, 0, 0.9, 0.5, 0.66); blk(0.86, 0.01, 0.46, tableTop, rx, 0.665, rz + 0.66);
      const grid = []; for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) grid.push([0.53 + r * 0.23, c ? 0.2 : -0.2]);   // 2 x 2, two high (8 slots; 7 cycles fall in the video)
      // tote on the cell table: 2 x 2 slots, two layers; parts keep their fixture orientation (long side along z)
      const TX = -4.6, TZ = rz + 0.2, toteM = new THREE.MeshStandardMaterial({ color: 0x2a5bd7, roughness: 0.6 });
      ST = 'cell-tote';
      blk(0.46, 0.01, 0.48, toteM, TX, TH + 0.005, TZ);
      for (const [dx, dz, w, d] of [[0.225, 0, 0.01, 0.48], [-0.225, 0, 0.01, 0.48], [0, 0.235, 0.46, 0.01], [0, -0.235, 0.46, 0.01]]) blk(w, 0.2, d, toteM, TX + dx, TH + 0.1, TZ + dz);
      ST = 'cell';
      const slots = []; for (let l = 0; l < 2; l++) for (const dz of [0.115, -0.115]) for (const dx of [0.11, -0.11]) slots.push(V3(TX + dx, TH + 0.01 + l * 0.14, TZ + dz));
      cobotArm = createCobot({ white: M.white, dark: M.dark, steel: steelL });
      cobotArm.root.position.set(-4.8, TH, rz - 0.2); world.add(cobotArm.root);
      ST = 'cell-mount'; blk(0.24, 0.02, 0.24, M.dark, -4.8, TH + 0.01, rz - 0.2); ST = 'cell';
      const ev = [], jobs = [], cyc = [];
      for (let k = 0; k < 8; k++) {
        const c0 = b.now; cyc.push(c0); const part = mkPart(), o = { mesh: part, ...PART };
        const row = Math.floor(k / 4), lv = 1 - (Math.floor(k / 2) % 2), [gr, gl] = grid[row * 2 + (k % 2)];
        b.turnTo(-PI / 2); b.pick(o, fanTo(rx, rz, -PI / 2, gr, 0.67 + lv * 0.14, gl), { aim: 1, clear: 0.67 + (lv + 1) * 0.14 }); const j1 = b.cur;
        b.turnTo(0); b.place(frontOf(rx, rz, 0, 0.45, FIX), { aim: true }); ev.push(j1.tPlace);
        b.turnTo(-PI / 2); b.wait(Math.max(0, P - (b.now - c0)));
        const q = { o, job: j1, bot: b }; objs.push(q); jobs.push(q);
      }
      b.finish(TMAX); b.period = P; b.eventList = ev; b.cycles = cyc; ANCH.cobotBot = V3(rx, 1.0, rz);
      // arm program: after each release, reach, grip, lift, swing to the next free tote slot, set the part down, return home
      const HOME = V3(-4.95, TH + 0.62, rz - 0.15), S = 1 / SP;
      cobotCycles = jobs.map((q, k) => {
        const t0 = q.job.tEnd + 0.15, part = q.job.Wp, pPos = V3().setFromMatrixPosition(part);
        const grip = pPos.clone().add(V3(0, 0.11, 0)), above = grip.clone().add(V3(0, 0.2, 0));
        const slot = slots[Math.min(k, slots.length - 1)], drop = slot.clone().add(V3(0, 0.11, 0)), dropAbove = V3(drop.x, TH + 0.45, drop.z);   // within reach of every slot
        const W = [[0, HOME, 1], [1.1, above, 1], [1.6, grip, 1], [1.9, grip, 0], [2.4, above, 0], [3.5, dropAbove, 0], [3.9, drop, 0], [4.1, drop, 0.3], [4.5, dropAbove, 0.3], [5.6, HOME, 1]].map(([a, p, o]) => [a * S, p, o]);
        return { k, q, t0, W, tGrip: t0 + 1.9 * S, tDrop: t0 + 4.1 * S, slot };
      });
      cobotBot = b;
      // the arm holds the part between grip and drop; afterwards the part stays in its tote slot
      jobs.forEach((q, k) => {
        const cyc = cobotCycles[k];
        q.cobotHeld = (t) => {
          const tl = t - (b.shift || 0);
          if (tl < cyc.tGrip) return null;
          if (tl < cyc.tDrop) return { M: cobotPartM(cyc, tl), held: 'cobot' };
          return { M: objMat(cyc.slot, 0), held: null };
        };
      });
    }
    // ---- R6: inspection: lift each part to the head cameras, tilt it, put it on the PASS tray. Cycle 9 s.
    { ST = 'insp';
      const rx = -2.3, rz = 1.55, b = nb('inspect', rx, rz, 0); b.now = -6; const P = 11.0 / SP, BT = 0.72;
      table(rx + 0.6, rz, 0, 0.5, 1.2, BT);
      scanMat = new THREE.MeshBasicMaterial({ color: 0x5fd8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      scanPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.26), scanMat); world.add(scanPlane);
      const passM = new THREE.MeshStandardMaterial({ color: 0x2bb14c, roughness: 0.5 }), inM = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.5 });
      const at = (lat) => V3().setFromMatrixPosition(frontOf(rx, rz, 0, 0.6, BT + 0.01, lat));
      { const p = at(-0.33); blk(0.48, 0.02, 0.44, inM, p.x, p.y, p.z); } { const p = at(0.33); blk(0.48, 0.02, 0.44, passM, p.x, p.y, p.z); }
      const TT = BT + 0.02, ev = [], cyc = [], N = 6;
      for (let k = 0; k < N; k++) {
        const c0 = b.now; cyc.push(c0); const part = mkPart(), o = { mesh: part, ...PART };
        const si = k % 3, lv = 1 - Math.floor(k / 3), so = 2 - (k % 3), lo = Math.floor(k / 3);
        const pos = (i) => [[0.46, 0.6, 0.74][i], 0];
        b.pick(o, frontOf(rx, rz, 0, pos(si)[0], TT + lv * 0.14, -0.33 + pos(si)[1]), { aim: true, clear: TT + (lv + 1) * 0.14 }); const j = b.cur;
        b.turnTo(0);
        const t0 = b.now; b.wait(4.0 / SP); const t1 = b.now; ev.push(t0);
        j.carryFn = (t) => { const u = ss(t0 - 0.4, t0 + 0.3, t) * (1 - ss(t1 - 0.3, t1 + 0.4, t)), spin = ss(t0, t1 - 0.3, t) * PI;
          return new THREE.Matrix4().makeTranslation(0.36, 0.88 + 0.03 * u, 0).multiply(new THREE.Matrix4().makeRotationZ(Math.sin(spin * 2) * 0.25 * u)).multiply(new THREE.Matrix4().makeBasis(V3(0, 0, 1), V3(0, 1, 0), V3(-1, 0, 0))); };
        b.place(frontOf(rx, rz, 0, pos(so)[0], TT + lo * 0.14, 0.33 + pos(so)[1]), { aim: true, clear: TT + (lo + 1) * 0.14 }); b.turnTo(0);
        b.wait(Math.max(0, P - (b.now - c0)));
        inspectJobs.push([t0, t1, b, j]);
        objs.push({ o, job: j, bot: b });
      }
      b.finish(TMAX); b.period = P; b.eventList = ev; b.cycles = cyc; ANCH.inspectBot = V3(rx, 1.2, rz);
    }
    // ---- R4: shelving: carries boxes from a pallet down the aisle to a steel shelf unit. Cycle 15.9 s.
    { ST = 'shelf';
      const ax = 9.25, zP = 1.0, zS = -0.75, b = nb('shelf', ax, zP, 0); b.now = -2; const P = 15.9 / 1.3;
      table(ax + 0.65, zP, 0, 0.5, 1.2, 0.35);
      const sx = ax + 0.5, shelfH = [0.25, 0.6, 1.2];
      for (const z of [zS - 1.25, zS + 0.85]) for (const d of [0, 0.4]) blk(0.04, 1.6, 0.04, steel, sx + d, 0.8, z);
      for (const h of shelfH) blk(0.44, 0.03, 2.14, tableTop, sx + 0.2, h - 0.015, zS - 0.2);
      const pre = [[2, 0.45], [2, -0.3], [0, -0.4]];
      for (const [i, dz] of pre) { const m = mkBox('290x290x290_' + (1 + (i % 2))); m.position.set(sx + 0.2, shelfH[i], zS + dz); AUD.statItems = AUD.statItems || []; AUD.statItems.push({ mesh: m, h: [0.145, 0.145, 0.145], name: 'shelf-prebox' }); }
      const src = [[1, 0], [1, -0.47], [1, 0.47], [0, 0], [0, -0.47], [0, 0.47]];   // the turn to the aisle sweeps towards -lat: pick that side first
      const levels = [1, 1, 1, 1, 0, 0], dzs = [0.5, 0.04, -0.42, -0.88, 0.4, -0.06]; const ev = [], cyc = [];
      for (let k = 0; k < 6; k++) {
        const c0 = b.now; cyc.push(c0); const [layer, lat] = src[k];
        const o = { mesh: mkBox('290x290x290_' + (1 + (k % 2))), ...BOX };
        const dz = dzs[k];
        const Ps = V3().setFromMatrixPosition(frontOf(ax, zP, 0, 0.55, 0.35 + layer * 0.29, lat)), byS = Math.atan2(-(Ps.z - zP), Ps.x - ax);   // source boxes fan towards the robot
        b.turnTo(0); b.pick(o, objMat(Ps, byS), { aim: 1, above: 0.05, near: 0.55 }); const j = b.cur; j.carryH = 0.66;   // fingers stay under the top shelf board
        b.walkTo(ax, zS + dz, 0.6); b.turnTo(0);
        b.place(objMat(V3(sx + 0.22, shelfH[levels[k]], zS + dz), 0), { aim: true, above: 0.04 }); ev.push(j.tPlace);
        b.walkTo(ax, zP, 0.6); b.turnTo(0); b.wait(Math.max(0, P - (b.now - c0)));
        o.visibleFrom = -1e9; objs.push({ o, job: j, bot: b });
      }
      b.finish(TMAX); b.period = P; b.eventList = ev; b.cycles = cyc; ANCH.shelfBot = V3(ax, 1.0, 0);
    }
    // ---- R7: carries a crate down the main walkway (one long walk through the whole video)
    { ST = 'carry';
      const z = 4.25, b = nb('carry', -8.8, z, 0); b.now = -6;
      const o = { mesh: mkCrate(), ...CRATE };
      b.pick(o, frontOf(-8.8, z, 0, 0.42, 0.8)); const j = b.cur;
      b.walkTo(14.0, z, 0.45 / SP);
      objs.push({ o, job: j, bot: b }); b.finish(TMAX); carryBot = b;
    }
    // ---- R9: pushes a loaded cart along the cross aisle
    { ST = 'cart';
      const x = 7.67, b = nb('cart', x, -15.5, -PI / 2); b.now = -2;
      cart = new THREE.Group(); world.add(cart);
      blk(1.0, 0.04, 0.62, steel, 0.6, 0.26, 0, cart);
      for (const sx of [0.15, 1.05]) for (const sz of [-0.27, 0.27]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 20), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 })); w.rotation.x = PI / 2; w.position.set(sx, 0.07, sz); cart.add(w); blk(0.03, 0.15, 0.03, steel, sx, 0.17, sz, cart); }
      for (const sz of [-0.27, 0.27]) blk(0.03, 0.75, 0.03, steel, 0.12, 0.62, sz, cart);
      blk(0.035, 0.035, 0.6, steelL, 0.12, 0.98, 0, cart);
      for (let i = 0; i < 4; i++) { const c = crateT.clone(true); c.position.set(i < 2 ? 0.4 : 0.82, 0.28 + (i % 2) * 0.232, 0); c.rotation.y = PI / 2; cart.add(c); }
      cart.traverse((m) => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
      b.handsLocal(V3(0.4, 0.98, -0.2), V3(0.4, 0.98, 0.2), TMAX);
      b.walkTo(x, 7.5, 0.45 / SP); b.finish(TMAX); cartBot = b;
    }
    // sync each station's key action to its line in the voiceover (shift = offset applied to that robot's clock)
    const SYNC = window.X2SYNC || {};
    for (const b of bots) { const tg = SYNC[b.name]; if (tg === undefined || !b.eventList) continue;
      let best = null;
      if (b.cycles) { for (const e of b.eventList) { const sh = tg - e, s0 = b.cycles[0] + sh; if (s0 <= 0 && (best === null || s0 > b.cycles[0] + best)) best = sh; } }
      if (best === null) for (const e of b.eventList) { const sh = tg - e; if (best === null || Math.abs(sh) < Math.abs(best)) best = sh; }
      b.shift = best; }
    window.__cycles = bots.filter((b) => b.cycles).map((b) => ({ name: b.name, shift: +(b.shift || 0).toFixed(2), starts: b.cycles.map((c) => +(c + (b.shift || 0)).toFixed(2)) }));
    window.__bots = bots;
    window.__objs = objs;
    // TODO: R2 mill, R3 press, R4 racking, R5 cobot, R6 inspection, R7 carrier, R9 cart
    ANCH.center = V3(0, 0.8, -1);
  }

  // ---------------------------------------------------------------- posing one rig
  const ARMJ = (s) => ['shoulder_pitch', 'shoulder_roll', 'shoulder_yaw', 'elbow', 'wrist_yaw', 'wrist_pitch', 'wrist_roll'].map((n) => `${s}_${n}_joint`);
  const ARM_REL = { l: [0.12, -0.04, 0, -0.1, 0, 0, 0], r: [0.12, 0.04, 0, -0.1, 0, 0, 0] };
  const ARM_SEED = { l: [-0.7, 0.32, -0.25, -1.1, 0, 0, 0], r: [-0.7, -0.32, 0.25, -1.1, 0, 0, 0] };
  const ELBOW_DOWN = { l: [-0.5, 0.12, 0, -1.7, 0, 0, 0], r: [-0.5, -0.12, 0, -1.7, 0, 0, 0] };
  const ARM_ALT = { l: [[-0.9, 0.2, -0.9, -1.4, 0.6, 0, 0], [-0.5, 0.45, 0.3, -0.9, -0.6, 0, 0]], r: [[-0.9, -0.2, 0.9, -1.4, -0.6, 0, 0], [-0.5, -0.45, -0.3, -0.9, 0.6, 0, 0]] };
  const LEG_SEED = [-0.35, 0, 0, 0.7, -0.35, 0];
  const _s = V3();
  function poseBot(rig, ch, P) {
    rig.__ik = 0;
    const fwd = dir(P.pyaw), rgt = right(P.pyaw);
    const pel = V3(P.x, P.ph, P.z).addScaledVector(rgt, P.pshift || 0).addScaledVector(fwd, -(P.pback || 0));
    rig.root.position.copy(pel);
    rig.root.quaternion.copy(yawQ(P.pyaw)).multiply(Q_BASE).multiply(new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), P.pp || 0));
    rig.set('waist_yaw_joint', P.wy || 0); rig.set('waist_pitch_joint', P.wp || 0); rig.set('waist_roll_joint', 0);
    rig.root.updateMatrixWorld(true);
    const base = rig.links.pelvis.matrixWorld.clone();
    for (const [k, side, chn] of [['l', -1, ch.ll], ['r', 1, ch.rl]]) {
      const f = P.feet[k], p = V3(f.x, 0.073 + f.lift, f.z).addScaledVector(right(f.a), side * 0.137).addScaledVector(dir(f.a), -0.015);
      solveIK(rig, chn, base, p, yawQ(f.a + side * 0.05).multiply(Q_BASE), LEG_SEED, { wRot: 0.5, iters: 30 });
    }
    rig.root.updateMatrixWorld(true);
    const torso = rig.links.torso_link.matrixWorld.clone();
    if (P.look) { const lp = P.look.clone().applyMatrix4(torso.clone().invert()); const w = P.lookW ?? 1; rig.set('head_yaw_joint', w * Math.atan2(lp.y, lp.x)); rig.set('head_pitch_joint', 0.08 + w * (Math.atan2(0.4 - lp.z, Math.hypot(lp.x, lp.y)) - 0.08)); }
    else { rig.set('head_yaw_joint', 0); rig.set('head_pitch_joint', 0.1); }
    const swing = P.walk ? Math.sin((P.t || 0) * 6.5) * 0.25 : 0;
    for (const side of ['l', 'r']) {
      const names = ARMJ(side === 'l' ? 'left' : 'right');
      names.forEach((n, i) => rig.set(n, ARM_REL[side][i] + (i === 0 ? swing * (side === "l" ? 1 : -1) + (P.pp || 0) + (P.wp || 0) : 0)));   // arms hang plumb when the body leans
      if (P.w > 0.001 && P.targets) {
        const chn = side === 'l' ? ch.la : ch.ra;
        const q0 = new Map(); chn.vars.forEach((j) => q0.set(j, j.q));
        const M0 = fk(chn, torso, q0, new THREE.Matrix4()); const p0 = V3(), r0 = new THREE.Quaternion(); M0.decompose(p0, r0, _s);
        const T = P.targets[side], w = P.w;
        // two stages: far half travels to a point above the grip (orientation turns), near half drops straight onto the grip
        const out = V3(-1, 0, 0).applyQuaternion(T.q), above = T.p.clone().addScaledVector(out, 0.05).add(V3(0, clamp(1.05 - T.p.y, 0.03, Math.max(0.03, P.above ?? 0.12)), 0));   // approach from above, but not over shoulder height
        let tp, tq;
        if (w < 0.5) {   // rest -> in front of the chest -> above the grip (the same path backwards on release)
          const rel = above.clone().sub(V3(P.x, 0, P.z)), lat = clamp(rel.dot(rgt), -0.38, 0.38);
          const mid = V3(P.x, Math.min(above.y, 0.95), P.z).addScaledVector(fwd, 0.32).addScaledVector(rgt, lat);
          if (w < 0.25) { const y1 = Math.min(mid.y, 0.78); tp = p0.clone().lerp(mid, ss(0.03, 0.12, w)); tp.y = p0.y + (y1 - p0.y) * ss(0, 0.1, w) + (mid.y - y1) * ss(0.12, 0.25, w); }   // rest -> (up to belt height) -> forward -> up to the chest; the same backwards on release
          else tp = mid.clone().lerp(above, ss(0.25, 0.5, w));
          if (tp.clone().sub(V3(P.x, tp.y, P.z)).dot(fwd) > 0.12) tp.y = Math.max(tp.y, Math.min(0.84, above.y));   /* out in front, the hands stay above table and belt height */ tq = r0.clone().slerp(T.q, ss(0, 0.12, w)); }
        else { const e = ss(0.5, 1, w); tp = above.clone().lerp(T.p, e); tq = T.q; }
        solveIK(rig, chn, torso, tp, tq, ARM_SEED[side], { wRot: 0.3, iters: 50, posFinish: 30, alt: globalThis.X2ALT ? ARM_ALT[side] : null });   // extra seeds off: they picked contorted elbow-up poses
        { // elbows down: if this solution lifts the elbow above the shoulder, try an elbows-down start and keep it when the hand still gets there
          const sn = side === 'l' ? 'left' : 'right', shY = V3().setFromMatrixPosition(rig.links[`${sn}_shoulder_roll_link`].matrixWorld).y;
          const fkY = () => { rig.root.updateMatrixWorld(true); return V3().setFromMatrixPosition(rig.links[`${sn}_elbow_link`].matrixWorld).y; };
          const errOf = () => { const qm = new Map(); chn.vars.forEach((j) => qm.set(j, j.q)); return V3().setFromMatrixPosition(fk(chn, torso, qm, new THREE.Matrix4())).distanceTo(tp); };
          if (fkY() > shY - 0.03) {
            const keep = chn.vars.map((j) => j.q), e0 = errOf(), y0 = fkY();
            solveIK(rig, chn, torso, tp, tq, ELBOW_DOWN[side], { wRot: 0.3, iters: 50, posFinish: 30 });
            const e1 = errOf(), y1 = fkY();
            if (!(y1 < y0 - 0.01 && e1 < e0 + 0.02)) chn.vars.forEach((j, i) => rig.set(j.name, keep[i]));
          }
        }
        { const qm = new Map(); chn.vars.forEach((j) => qm.set(j, j.q)); const Mf = fk(chn, torso, qm, new THREE.Matrix4()); const err = V3().setFromMatrixPosition(Mf).distanceTo(tp); if (w > 0.5 && err > (rig.__ik || 0)) { rig.__ik = err; const rel = tp.clone().sub(V3(P.x, 0, P.z)); rig.__ikInfo = `${side} fwd ${rel.dot(dir(P.pyaw)).toFixed(2)} lat ${rel.dot(right(P.pyaw)).toFixed(2)} h ${tp.y.toFixed(2)} w ${w.toFixed(2)} ph ${P.ph.toFixed(2)} pp ${(P.pp || 0).toFixed(2)}`; } }
      }
    }
    const g = P.grip || 0;
    for (const s of ['L', 'R']) {
      for (const f of ['index', 'middle', 'ring', 'pinky']) rig.set(`${s}_${f}_pip_joint`, 0.12 * (1 - g) + g * 1.05 * (P.curl ?? 1));   // straight fingers while squeezing an item
      const tr = window.X2THUMB || [0.17, 0, 1.3, -0.17, 0, 1.3], o = s === 'L' ? [tr[0], tr[1], -tr[2]] : [tr[3], -tr[4], tr[5]];
      rig.set(`${s}_thumb_roll_joint`, o[0]); rig.set(`${s}_thumb_abad_joint`, o[1]); rig.set(`${s}_thumb_mcp_joint`, o[2]);
    }
    rig.applyMimic(); rig.root.updateMatrixWorld(true);
  }

  // where is an object at time t (null = hidden)
  // position along the box belt, queueing 0.30 m behind a box that is still waiting at the stop
  function beltX(q, t) {
    const B = q.belt, u = clamp01((t - B.t0) / (B.t1 - B.t0)); let x = B.from + (B.to - B.from) * u;
    const p = B.prev; if (p && p.belt && t >= p.belt.t0 && !(p.job2 && t >= p.job2.tPick)) { const lim = beltX(p, t) - 0.30; if (lim < x) { x = lim; window.__queued = (window.__queued || 0) + (t < 48.8 ? 1 : 0); } }
    return x;
  }
  function objPose(q, t) {
    const o = q.o; t -= q.bot.shift || 0;
    if (o.visibleFrom !== undefined && t < o.visibleFrom) return null;
    if (q.job2 && t >= q.job2.tR0) return q.bot2.objAt(q.job2, t);
    if (q.belt && t >= q.belt.t0) { return objMat(V3(beltX(q, t), BELT_Y, q.belt.Z), PI); }
    if (t < q.job.tPick && o.pre) return o.pre(t);
    return q.bot.objAt(q.job, t);
  }

  // cobot program: piecewise-smooth tool-tip path between waypoints [time, point, gripperOpen]
  function cobotTarget(tl) {
    for (const c of cobotCycles) {
      const u = tl - c.t0; if (u < 0 || u > c.W[c.W.length - 1][0]) continue;
      for (let i = 0; i < c.W.length - 1; i++) { const [a, pa, oa] = c.W[i], [b2, pb, ob] = c.W[i + 1]; if (u <= b2) { const e = ss(a, b2, u); return [pa.clone().lerp(pb, e), oa + (ob - oa) * e]; } }
    }
    const c0 = cobotCycles[0]; return [c0 ? c0.W[0][1].clone() : V3(), 1];
  }
  function cobotPartM(cyc, tl) { const [p] = cobotTarget(tl); return objMat(V3(p.x, p.y - 0.11, p.z), 0); }
  function objStatus(q, t) {
    const o = q.o, tl = t - (q.bot.shift || 0);
    if (o.visibleFrom !== undefined && tl < o.visibleFrom) return null;
    if (o.hideAfterT !== undefined && t > o.hideAfterT) return null;
    let M = null, held = null, belt = false;
    const hj = (b, j) => { M = b.objAt(j, tl); if (tl >= j.tPick && (!j.Wp || tl < j.tPlace)) held = b.name; };
    if (q.job2 && tl >= q.job2.tR0) hj(q.bot2, q.job2);
    else if (q.belt && tl >= q.belt.t0) { M = objPose(q, t); belt = true; }
    else if (tl < q.job.tPick && o.pre) { M = o.pre(tl); belt = true; }
    else hj(q.bot, q.job);
    if (q.cobotHeld) { const c = q.cobotHeld(t); if (c) { M = c.M; held = c.held; } if (c && c.hidden) return null; }
    if (!M) return null;
    let h = o.halfW > 0.3 ? [0.301, 0.115, 0.201] : o.halfW > 0.15 ? [0.145, 0.145, 0.145] : [0.11, 0.07, 0.07];
    let sq = 1; if (o.squashA !== undefined && tl > o.squashA) sq = tl >= o.squashA + 0.45 ? 0.55 : clamp((0.27 - 0.193 * ss(o.squashA, o.squashA + 0.45, tl)) / 0.14, 0.55, 1);
    const sw = 1 + (1 - sq) * 0.27;
    if (sq < 1) h = [h[0] * sw, h[1] * sq, h[2] * sw];
    const Mb = sq < 1 ? M.clone().multiply(new THREE.Matrix4().makeScale(sw, sq, sw)) : M;
    const Mc = M.clone().multiply(new THREE.Matrix4().makeTranslation(0, h[1], 0));
    return { M: Mc, Mb, h, held, belt };
  }
  function auditCtx() {
    return {
      rigs: rigs.slice(0, bots.length), botNames: bots.map((b) => b.name),
      staticBoxes: () => [...AUD.boxes.filter((b) => b.parent !== cart && b.o.visible).map((b) => { b.o.updateMatrixWorld(true); return { M: b.o.matrixWorld.clone(), h: b.h, name: b.name }; }), ...AUD.virt],
      supports: () => [...AUD.boxes.filter((b) => b.parent !== cart).map((b) => ({ M: b.o.matrixWorld.clone(), h: b.h, name: b.name })), ...AUD.virt, ...AUD.sups],
      items: (t) => { const out = []; objs.forEach((q, i) => { const st = objStatus(q, t); if (st) out.push({ name: `${q.o.halfW > 0.3 ? 'crate' : q.o.halfW > 0.15 ? 'box' : 'part'}#${i}@${q.bot.name}`, mesh: q.o.mesh, ...st }); });
        for (const si of AUD.statItems || []) { si.mesh.updateMatrixWorld(true); out.push({ name: si.name, mesh: si.mesh, M: si.mesh.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(0, si.h[1], 0)), h: si.h, held: null, belt: false }); }
        return out; },
      cobotSamples: () => (cobotArm ? cobotArm.samples() : AUD.armPts),
      beltTops: () => AUD.beltTops,
      // visible meshes that can carry an item (no robots, no cart, no cobot, no items; not the warehouse shell)
      supportMeshes: () => {
        if (!AUD.supMeshes) {
          const skip = new Set(); const mark = (r) => r && r.traverse((o) => skip.add(o));
          rigs.forEach((r) => mark(r.root)); mark(cart); if (cobotArm) mark(cobotArm.root); objs.forEach((q) => mark(q.o.mesh));
          AUD.supMeshes = []; world.updateMatrixWorld(true);
          world.traverse((o) => { if (!o.isMesh || skip.has(o)) return; let v = true, p = o; while (p) { if (!p.visible) v = false; p = p.parent; } if (!v) return;
            if (millDoor) { let p2 = o; while (p2) { if (p2 === millDoor) return; p2 = p2.parent; } }
            const b = new THREE.Box3().setFromObject(o), sz = b.getSize(V3()); if (sz.x * sz.y * sz.z > 150) return; AUD.supMeshes.push({ o, b }); });
        }
        return AUD.supMeshes;
      },
      THREE,
    };
  }

  // ---------------------------------------------------------------- post
  const rt = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt); composer.setPixelRatio(1); composer.setSize(width, height);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new ShaderPass({ uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0); gl_FragColor = clamp(c, 0.0, 64.0); }' }));
  const gtao = new GTAOPass(scene, camera, width, height); gtao.output = GTAOPass.OUTPUT.Default; gtao.blendIntensity = 1.0;
  gtao.updateGtaoMaterial({ radius: 0.3, distanceExponent: 1.5, thickness: 1, scale: 1.1, samples: 16, distanceFallOff: 1.0 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
  composer.addPass(gtao);
  const bokeh = new BokehPass(scene, camera, { focus: 3, aperture: 0.0, maxblur: 0.008 }); composer.addPass(bokeh);
  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.3, 0.5, 2.6); composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function render(s) {
    const t = s.t, tl = (n) => t - (bots.find((b) => b.name === n).shift || 0);
    beltMats.forEach((m) => { if (m.map) m.map.offset.y = -t * 0.36 * (s.beltK ?? 0.5); });
    bots.forEach((b, i) => poseBot(rigs[i], chains[i], b.at(t - (b.shift || 0))));
    for (let i = bots.length; i < rigs.length; i++) rigs[i].root.visible = false;
    if (cobotArm) { const [p, open] = cobotTarget(t - (cobotBot.shift || 0)); cobotArm.solve(p, open); }
    for (const q of objs) { const st = objStatus(q, t), Mx = st ? st.Mb : null; q.o.mesh.visible = !!Mx; if (Mx) { q.o.mesh.matrixAutoUpdate = false; q.o.mesh.matrix.copy(Mx); q.o.mesh.matrixWorldNeedsUpdate = true; } }
    if (millLamp) { const on = millRuns.some(([a, b]) => tl('mill') > a + 0.2 && tl('mill') < b - 0.1); millLamp.emissiveIntensity = on ? 3.0 : 0.15; }
    if (millDoor) { let c = 0; const u = tl('mill'); for (const [a, b] of millRuns) c = Math.max(c, ss(a, a + 0.5, u) * (1 - ss(b - 0.5, b, u))); millDoor.position.y = 1.725 - 0.8 * c; millDoor.updateMatrixWorld(true); }   // guard door down while the mill runs
    if (pressRod) { let d = 0; { const u = tl('press'); for (const [a, b] of pressHits) d = Math.max(d, ss(a, a + 0.45, u) * (1 - ss(b - 0.55, b - 0.1, u))); } pressRod.position.y = -0.193 * d; }
    if (scanPlane) {
      let on = 0, Mx = null;
      { const u = tl('inspect'); for (const [a, b2, bot, j] of inspectJobs) if (u > a && u < b2) { on = Math.sin(PI * clamp01((u - a) / (b2 - a))); Mx = bot.objAt(j, u); } }
      scanMat.opacity = 0.06 * on; scanPlane.visible = on > 0.01;
      if (Mx) { const p = V3().setFromMatrixPosition(Mx); scanPlane.position.copy(p).add(V3(0, 0.05 + 0.08 * Math.sin(t * 9), 0)); scanPlane.rotation.set(-PI / 2, 0, 0); }
    }
    if (cart && cartBot) { const B = cartBot.baseAt(tl('cart')); cart.position.set(B.x, 0, B.z); cart.rotation.y = B.yaw; }
    // camera
    const tgt = V3(s.tx ?? 0, s.ty ?? 0.8, s.tz ?? 0);
    const dist = Math.exp(s.logD ?? Math.log(8)), az = (s.camAz ?? 20) * DEG, el = (s.camEl ?? 25) * DEG;
    camera.fov = s.fov ?? 30; camera.up.set(0, 1, 0);
    camera.position.set(tgt.x + dist * Math.cos(el) * Math.sin(az), tgt.y + dist * Math.sin(el), tgt.z + dist * Math.cos(el) * Math.cos(az));
    camera.lookAt(tgt); camera.rotateZ((s.camRoll || 0) * DEG);
    camera.near = Math.max(0.03, dist * 0.01); camera.far = 250; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    gtao.blendIntensity = s.ao ?? 1;
    bokeh.uniforms.focus.value = s.focus || dist; bokeh.uniforms.aperture.value = s.aperture || 0; bokeh.uniforms.maxblur.value = s.maxblur || 0.008; bokeh.enabled = (s.aperture || 0) > 0;
    roofClip.constant = (s.cut || 0) > 0.5 ? 4.6 : 1000;
    bloom.strength = s.bloom ?? 0.3; renderer.toneMappingExposure = s.exp ?? 1;
    scene.updateMatrixWorld(true);
    if (!s.noDraw) composer.render();
  }
  function project(name) { const p = ANCH[name]; if (!p) return null; const v = p.clone().project(camera); if (v.z > 1) return null; return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height }; }
  return { load, render, project, anchors: ANCH, auditCtx };
}
