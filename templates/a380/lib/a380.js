// Airbus A380 Short for HyperFrames. Units: metres, +Y up. A pure function of the state passed to render().
// Real 3D models: "Airbus-A380" by davidmarton1987 (CC BY 4.0) and "Boeing 777-300ER Model" by hakai315 (CC BY 4.0), both on Sketchfab.
// Lighting: Poly Haven "Kloofendal 48d Partly Cloudy (Pure Sky)" (CC0). The runway, apron, grass and dimension bars are code-built.

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

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DEG = Math.PI / 180;

// Real dimensions (Airbus / Boeing): A380-800 72.72 m long, 79.75 m span; 777-300ER 73.86 m long, 64.80 m span.
export const A_SPAN = 79.75, A_LEN = 72.72, B_LEN = 73.86, B_SPAN = 64.8;
export const RUNWAY_W = 60, APRON_X = 220;

// Deterministic value noise for canvas textures
const hash = (x, y, s = 0) => { const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
function canvasTex(w, h, draw, repeat = [1, 1], aniso = 8) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = aniso; return t;
}
function speckle(g, w, h, base, amp, n, seed) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) { const x = hash(i, 1, seed) * w, y = hash(i, 2, seed) * h, r = 0.5 + hash(i, 3, seed) * 1.6, l = (hash(i, 4, seed) - 0.5) * amp;
    g.fillStyle = l > 0 ? `rgba(255,255,255,${l})` : `rgba(0,0,0,${-l})`; g.fillRect(x, y, r, r); }
}

export function createA380(canvas, { width = 1080, height = 1920 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.5, 20000);
  const sun = new THREE.DirectionalLight(0xfff3e2, 3.0); sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6; sun.shadow.radius = 2;
  scene.add(sun, sun.target);
  const fill = new THREE.HemisphereLight(0xcfe0ff, 0x6a6458, 0.35); scene.add(fill);

  const world = new THREE.Group(); scene.add(world);
  const HAZE = new THREE.Color(0.66, 0.7, 0.77); scene.fog = new THREE.FogExp2(HAZE, 0.00022);
  const groundG = new THREE.Group(); world.add(groundG);
  const ANCH = {};
  let A = null, B = null, skyBg = null, skyEnv = null;
  const AL = {}, BL = {};   // local landmarks (plane-local, metres): nose, tail, tips, engines, decks
  const dims = [];

  // ---------- ground: grass, runway (along z at x = 0), apron (concrete, x > APRON_X - 120) ----------
  const grassTex = canvasTex(512, 512, (g, w, h) => { speckle(g, w, h, '#46522f', 0.25, 26000, 1);
    for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(${90 + hash(i, 5) * 40},${95 + hash(i, 6) * 30},${50 + hash(i, 7) * 20},0.07)`; g.beginPath(); g.ellipse(hash(i, 8) * w, hash(i, 9) * h, 20 + hash(i, 10) * 60, 10 + hash(i, 11) * 40, hash(i, 12) * 3, 0, 7); g.fill(); } }, [180, 180]);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95, metalness: 0 }));
  grass.rotation.x = -Math.PI / 2; grass.position.y = -0.04; grass.receiveShadow = true; groundG.add(grass);
  // runway: 60 m wide, texture covers 60 x 120 m and repeats along z
  const rwTex = canvasTex(512, 1024, (g, w, h) => {
    speckle(g, w, h, '#3a3c3f', 0.18, 60000, 2);
    for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(20,20,22,${0.08 + hash(i, 3) * 0.1})`; g.fillRect(w * (0.32 + hash(i, 4) * 0.36), hash(i, 5) * h, 8 + hash(i, 6) * 30, 60 + hash(i, 7) * 200); }  // tyre marks
    const m = w / 60; g.fillStyle = '#e9e9e4';
    g.fillRect(1.0 * m, 0, 0.9 * m, h); g.fillRect(w - 1.9 * m, 0, 0.9 * m, h);           // edge lines
    for (let k = 0; k < 2; k++) g.fillRect(w / 2 - 0.45 * m, (k * 60 + 10) * m, 0.9 * m, 30 * m);   // centreline 30 m stripes, 30 m gaps
  }, [1, 30]);
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(RUNWAY_W, 3600), new THREE.MeshStandardMaterial({ map: rwTex, roughness: 0.82, metalness: 0 }));
  runway.rotation.x = -Math.PI / 2; runway.position.set(0, 0, -1200); runway.receiveShadow = true; groundG.add(runway);
  // shoulders
  for (const sx of [-1, 1]) { const sh = new THREE.Mesh(new THREE.PlaneGeometry(10, 3600), new THREE.MeshStandardMaterial({ color: 0x55574f, roughness: 0.9 }));
    sh.rotation.x = -Math.PI / 2; sh.position.set(sx * (RUNWAY_W / 2 + 5), -0.01, -1200); sh.receiveShadow = true; groundG.add(sh); }
  // apron: concrete slabs 5 m, with yellow lead-in lines along z every 90 m in x
  const apTex = canvasTex(1024, 1024, (g, w, h) => {
    speckle(g, w, h, '#7d7b74', 0.12, 50000, 3);
    const m = w / 90; g.strokeStyle = 'rgba(60,58,52,0.55)'; g.lineWidth = 2;
    for (let k = 0; k <= 18; k++) { g.beginPath(); g.moveTo(k * 5 * m, 0); g.lineTo(k * 5 * m, h); g.stroke(); g.beginPath(); g.moveTo(0, k * 5 * m); g.lineTo(w, k * 5 * m); g.stroke(); }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(70,66,58,${0.05 + hash(i, 9) * 0.08})`; g.fillRect(hash(i, 10) * w, hash(i, 11) * h, 20 + hash(i, 12) * 90, 20 + hash(i, 13) * 90); }
    g.fillStyle = '#e8b820'; g.fillRect(w / 2 - 0.1 * m, 0, 0.2 * m * 1.5, h);
  }, [10, 10]);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ map: apTex, roughness: 0.78, metalness: 0 }));
  apron.rotation.x = -Math.PI / 2; apron.position.set(APRON_X + 330, 0.005, 0); apron.receiveShadow = true; groundG.add(apron);

  // ---------- dimension bars (glowing lime, flat on the ground) ----------
  const dimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.78, 1.0, 0.24).multiplyScalar(1.4), toneMapped: false });
  const dimMatB = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.85, 0.87, 0.9), toneMapped: false });
  function makeDim(mat) {   // unit bar along local +x from 0..1 with end ticks
    const g = new THREE.Group(); const bar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 0.9), mat); bar.position.x = 0.5; g.add(bar);
    const t0 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 7), mat), t1 = t0.clone(); g.add(t0, t1); g.userData = { bar, t0, t1 }; world.add(g); dims.push(g); return g;
  }
  function setDim(g, a, b, p) {   // from point a to b (ground), grown by p
    g.visible = p > 0.002; if (!g.visible) return;
    const d = b.clone().sub(a), L = d.length(); g.position.copy(a); g.position.y = 0.06; g.rotation.set(0, -Math.atan2(d.z, d.x), 0);
    g.userData.bar.scale.x = L * p; g.userData.bar.position.x = L * p / 2; g.userData.t1.position.x = L * p; g.userData.t1.visible = p > 0.98;
  }

  const loadHDR = (url) => new Promise((res, rej) => { const l = new HDRLoader(); l.setDataType(THREE.FloatType); l.load(url, res, undefined, rej); });
  // Normalise a plane: nose to -z, wheels on y = 0, centred on x; origin at the main-gear contact (z) so pitching keeps the gear on the ground.
  function prepPlane(root, { scale, rotY = 0, mainGearZ, tune }) {
    const inner = new THREE.Group(); inner.add(root); root.rotation.y = rotY; inner.scale.setScalar(scale); inner.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(inner, true);
    inner.position.set(-(b.min.x + b.max.x) / 2, -b.min.y, 0); inner.updateMatrixWorld(true);
    const g = new THREE.Group(); g.add(inner);
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (tune) tune(o); } });
    const b2 = new THREE.Box3().setFromObject(g, true);
    inner.position.z -= mainGearZ(b2); g.updateMatrixWorld(true);
    return { g, box: new THREE.Box3().setFromObject(g, true) };
  }

  async function load(base) {
    const [ag, bg, sky] = await Promise.all([
      new GLTFLoader().loadAsync(base + 'models/a380/airbus-a380.glb'),
      new GLTFLoader().loadAsync(base + 'models/b777/b777.glb'),
      loadHDR(base + 'hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr')]);
    sky.mapping = THREE.EquirectangularReflectionMapping; skyBg = sky; skyEnv = pmrem.fromEquirectangular(sky).texture;
    scene.background = skyBg; scene.environment = skyEnv;

    // A380: model is 25.34 units wide (span) -> 79.75 m; nose at model -z. Main body gear sits ~38% back from the nose.
    const ka = A_SPAN / 25.34;
    const pa = prepPlane(ag.scene, { scale: ka, mainGearZ: (b) => b.min.z + (b.max.z - b.min.z) * 0.535,
      tune: (o) => { const m = o.material; if (!m) return; m.envMapIntensity = 1.0; if (/glass/i.test(m.name)) { m.roughness = 0.08; m.metalness = 0.6; } } });
    A = pa.g; world.add(A); window.__A = A;
    // 777: model runs along x; length 48.9 units -> 73.86 m. Rotation chosen so the nose points to -z (checked in the probe).
    const kb = B_LEN / 48.9;
    const pb = prepPlane(bg.scene, { scale: kb, rotY: Number(window.B_ROT ?? -Math.PI / 2), mainGearZ: (b) => b.min.z + (b.max.z - b.min.z) * 0.56,
      tune: (o) => { const m = o.material; if (!m) return; m.envMapIntensity = 1.0; } });
    B = pb.g; world.add(B); window.__B = B;
    const land = (box, L) => { L.nose = box.min.z; L.tail = box.max.z; L.halfSpan = (box.max.x - box.min.x) / 2; L.top = box.max.y; };
    land(pa.box, AL); land(pb.box, BL);
    window.__info = `A box ${pa.box.min.toArray().map((v) => v.toFixed(1))} .. ${pa.box.max.toArray().map((v) => v.toFixed(1))} | B box ${pb.box.min.toArray().map((v) => v.toFixed(1))} .. ${pb.box.max.toArray().map((v) => v.toFixed(1))}`;
    makeDim(dimMat); makeDim(dimMat); makeDim(dimMatB); makeDim(dimMatB);
  }

  // ---------- post ----------
  const rt = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt); composer.setPixelRatio(1); composer.setSize(width, height);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new ShaderPass({ uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0); gl_FragColor = clamp(c, 0.0, 64.0); }' }));
  const gtao = new GTAOPass(scene, camera, width, height); gtao.output = GTAOPass.OUTPUT.Default; gtao.blendIntensity = 1.0;
  gtao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.5, thickness: 2, scale: 1.0, samples: 16, distanceFallOff: 1.0 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
  composer.addPass(gtao);
  const bokeh = new BokehPass(scene, camera, { focus: 100, aperture: 0.0, maxblur: 0.008 }); composer.addPass(bokeh);
  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.12, 0.4, 2.2); composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const hideDims = (pass) => { const f = pass.render.bind(pass); pass.render = (...a) => { const v = dims.map((o) => o.visible); dims.forEach((o) => (o.visible = false)); f(...a); dims.forEach((o, i) => (o.visible = v[i])); }; };
  hideDims(gtao);

  const place = (g, p) => { g.position.set(p.x || 0, p.y || 0, p.z || 0); g.rotation.set(0, 0, 0); g.rotateY((p.yaw || 0) * DEG); g.rotateX((p.pitch || 0) * DEG); g.rotateZ((p.roll || 0) * DEG); g.updateMatrixWorld(true); };
  const wpt = (g, x, y, z) => g.localToWorld(V3(x, y, z));

  // ---------- render(state) ----------
  // state: a {x,y,z,yaw,pitch,roll,on}, b {...}, ground (0/1), camera (tx,ty,tz,camAz,camEl,logD,fov,camRoll), sun (sunAz, sunEl), envRot, exp, bloom, dim* grow 0..1
  function render(s) {
    if (!A) return;
    A.visible = (s.aOn ?? 1) > 0.5; B.visible = (s.bOn ?? 0) > 0.5;
    place(A, { x: s.ax, y: s.ay, z: s.az, yaw: s.aYaw, pitch: s.aPitch, roll: s.aRoll });
    place(B, { x: s.bx, y: s.by, z: s.bz, yaw: s.bYaw, pitch: s.bPitch, roll: s.bRoll });
    groundG.visible = (s.ground ?? 1) > 0.5;
    const er = (s.envRot ?? 0) * DEG; scene.backgroundRotation.y = er; scene.environmentRotation.y = er;
    scene.backgroundIntensity = s.bgI ?? 1; scene.environmentIntensity = 0.62 * (s.envI ?? 1);

    // landmarks for labels
    // landmarks (plane-local metres, measured on the models): deck window rows, engine intakes, nose, tail
    const side = s.labSide ?? -1;   // which side of the fuselage the deck labels sit on (-1 = left/-x)
    ANCH.aUpper = wpt(A, side * 3.5, 9.4, AL.nose + 22); ANCH.aMain = wpt(A, side * 3.5, 6.6, AL.nose + 22);
    [[-25.8, 4.8, -9], [-14.8, 4.0, -17], [14.8, 4.0, -17], [25.8, 4.8, -9]].forEach(([x, y, z], i) => (ANCH['aE' + i] = wpt(A, x, y, z)));
    [[-9.5, 3.6, -16], [9.5, 3.6, -16]].forEach(([x, y, z], i) => (ANCH['bE' + i] = wpt(B, x, y, z)));
    ANCH.aNose = wpt(A, 0, 8, AL.nose); ANCH.aTail = wpt(A, 0, AL.top, AL.tail - 6);
    ANCH.bNose = wpt(B, 0, 6, BL.nose); ANCH.aCentre = wpt(A, 0, 10, -8); ANCH.bCentre = wpt(B, 0, 8, -8);
    ANCH.aTop = wpt(A, 0, AL.top + 4, AL.tail - 5); ANCH.bTop = wpt(B, 0, BL.top + 4, BL.tail - 5);
    // dimension bars: length beside each plane (outboard side), span across the wing line
    const dA = s.dimA || 0, dB = s.dimB || 0, sA = s.spanA || 0, sB = s.spanB || 0;
    if (dims.length) {
      setDim(dims[0], wpt(A, -AL.halfSpan - 6, 0, AL.tail), wpt(A, -AL.halfSpan - 6, 0, AL.nose), dA); dims[0].position.y = 0.08;
      setDim(dims[2], wpt(B, BL.halfSpan + 6, 0, BL.tail), wpt(B, BL.halfSpan + 6, 0, BL.nose), dB);
      setDim(dims[1], wpt(A, -AL.halfSpan, 0, AL.tail + 6), wpt(A, AL.halfSpan, 0, AL.tail + 6), sA);
      setDim(dims[3], wpt(B, -BL.halfSpan, 0, BL.tail + 6), wpt(B, BL.halfSpan, 0, BL.tail + 6), sB);
      ANCH.aLen = wpt(A, -AL.halfSpan - 6, 0, (AL.tail + AL.nose) / 2); ANCH.bLen = wpt(B, BL.halfSpan + 6, 0, (BL.tail + BL.nose) / 2);
      ANCH.aSpan = wpt(A, AL.halfSpan * 0.55, 0, AL.tail + 6); ANCH.bSpan = wpt(B, -BL.halfSpan * 0.55, 0, BL.tail + 6);
    }

    // camera
    const tgt = V3(s.tx || 0, s.ty || 0, s.tz || 0);
    const dist = Math.exp(s.logD), az = s.camAz * DEG, el = s.camEl * DEG;
    camera.fov = s.fov || 30; camera.up.set(0, 1, 0);
    camera.position.set(tgt.x + dist * Math.cos(el) * Math.sin(az), tgt.y + dist * Math.sin(el), tgt.z + dist * Math.cos(el) * Math.cos(az));
    if (groundG.visible) camera.position.y = Math.max(camera.position.y, 0.6);
    camera.lookAt(tgt); camera.rotateZ((s.camRoll || 0) * DEG);
    camera.near = Math.max(0.3, dist * 0.01); camera.far = 20000;
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();

    // sun follows the action so the shadow map stays tight
    const sAz = (s.sunAz ?? 140) * DEG, sEl = (s.sunEl ?? 42) * DEG, sc = (s.shadowR ?? 70);
    const focus = V3(s.sfx ?? s.ax ?? 0, 0, s.sfz ?? s.az ?? 0);
    sun.target.position.copy(focus); sun.position.copy(focus).add(V3(Math.cos(sEl) * Math.sin(sAz), Math.sin(sEl), Math.cos(sEl) * Math.cos(sAz)).multiplyScalar(400));
    sun.target.updateMatrixWorld();
    const sc0 = sun.shadow.camera; sc0.left = -sc; sc0.right = sc; sc0.top = sc; sc0.bottom = -sc; sc0.near = 10; sc0.far = 900; sc0.updateProjectionMatrix();
    sun.intensity = 4.6 * (s.sunI ?? 1); sun.color.setRGB(1, s.sunG ?? 0.95, s.sunB ?? 0.88); fill.intensity = 0.2 * (s.fillI ?? 1);
    gtao.blendIntensity = s.ao ?? 1;
    bokeh.uniforms.focus.value = s.focus || dist; bokeh.uniforms.aperture.value = s.aperture || 0; bokeh.uniforms.maxblur.value = s.maxblur || 0.008;
    bokeh.enabled = (s.aperture || 0) > 0;
    bloom.strength = s.bloom ?? 0.12;
    renderer.toneMappingExposure = 0.82 * (s.exp ?? 1);
    scene.fog.density = groundG.visible ? (s.fogD ?? 0.00042) : 0;
    composer.render();
  }

  function project(name) {
    const p = ANCH[name]; if (!p) return null;
    const v = p.clone().project(camera); if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height };
  }
  return { load, render, project, ANCH, AL, BL };
}
