// RS-25 "the engine NASA used twice", for a HyperFrames Short. Units: metres, +Y up. Pure function of the state passed to render().
// Real 3D models: "RS-25" by MartianDays (CC BY 4.0), "Orbiter Space Shuttle OV-103 Discovery" by the Smithsonian Institution (CC0),
// "NASA SLS Block 1 Crew V4" by Clarence365 (CC BY 4.0). Lighting: Poly Haven "Studio Small 09" and "Kloofendal 48d Partly Cloudy (Pure Sky)" (CC0).
// Plumes, ocean, splash and floor are code-built.

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
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export const E_H = 4.27;            // RS-25 length ~4.3 m (NASA)
// Shuttle aft: nozzle exits measured on the Smithsonian scan (orbiter-local, aft = -z)
const SH_EXITS = [[0.08, 1.63, -16.2, 1.06], [1.63, -1.17, -17.0, 1.12], [-1.52, -1.17, -17.0, 1.12]];
// SLS core-stage engines (model-local): exit centres, radius
const SLS_EXITS = [[2.06, 0.45, 1.945], [2.06, 0.45, -1.945], [-2.06, 0.45, 1.945], [-2.06, 0.45, -1.945]];
const SLS_ER = 1.3;
const SRB_EXITS = [[0.04, 0.2, 6.07], [0.04, 0.2, -6.07]];
// 16-engine grid
const GRID_DX = 4.4, GRID_DZ = 4.8;

export function createRS25(canvas, { width = 1080, height = 1920 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const BG = new THREE.Color(0x07080b);
  scene.background = BG;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.05, 5000);
  const key = new THREE.DirectionalLight(0xfff1e0, 2.0); key.position.set(4, 6, 8); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 1.6); rim.position.set(-6, 3, -6); scene.add(rim);
  const plumeLight = new THREE.PointLight(0xffd2b0, 0, 0, 1.3); scene.add(plumeLight);

  const heroG = new THREE.Group(), shuttleG = new THREE.Group(), slsG = new THREE.Group(), oceanG = new THREE.Group(), gridG = new THREE.Group();
  scene.add(heroG, shuttleG, slsG, oceanG, gridG);

  // ---------- plumes ----------
  const plumeGeo = new THREE.CylinderGeometry(1, 1, 1, 64, 64, true);
  // Hydrogen/oxygen: nearly clear blue-violet body with bright shock diamonds near the nozzle.
  function hydroloxMat(seed) {
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uI: { value: 0 }, uL: { value: 8 }, uR0: { value: 1 }, uR1: { value: 1.6 }, uT: { value: 0 }, uSeed: { value: seed }, uSp: { value: 0.075 },
        uCD: { value: new THREE.Color(1.0, 0.82, 0.62) }, uCB: { value: new THREE.Color(0.45, 0.55, 1.0) } },
      vertexShader: `uniform float uL, uR0, uR1; varying float vS; varying vec3 vN; varying vec3 vV;
        void main(){ float s = 0.5 - position.y; vS = s;
          float r = mix(uR0, uR1, pow(s, 0.9)) * (1.0 - 0.13 * sin(min(s / 0.22, 1.0) * 3.14159));
          vec3 p = vec3(position.x * r, -s * uL, position.z * r); vec4 mv = modelViewMatrix * vec4(p, 1.0); vV = -mv.xyz;
          vN = normalize(normalMatrix * vec3(position.x, 0.0, position.z)); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uI, uT, uSeed, uSp; uniform vec3 uCD, uCB; varying float vS; varying vec3 vN; varying vec3 vV;
        void main(){ float f = abs(dot(normalize(vN), normalize(vV))); float s = vS;
          float fade = smoothstep(0.0, 0.01, s) * (1.0 - smoothstep(0.55, 1.0, s));
          float n = 0.88 + 0.08 * sin(uT * 43.0 + s * 29.0 + uSeed) + 0.04 * sin(uT * 71.0 - s * 47.0 + uSeed * 2.3);
          float body = (pow(f, 2.5) * 0.22 + pow(f, 0.6) * 0.03) * exp(-s * 2.4);
          float dia = 0.0;
          for (int k = 0; k < 6; k++) { float sk = 0.03 + float(k) * uSp; float w = 0.010 + float(k) * 0.005; float d = (s - sk) / w;
            dia += exp(-d * d) * (k == 0 ? 1.8 : 1.0) * exp(-float(k) * 0.5); }
          dia *= pow(f, 9.0) * 1.6 + pow(f, 3.0) * 0.15;
          vec3 c = uCB * body + uCD * dia * 1.6 + vec3(0.9, 0.85, 1.0) * pow(f, 5.0) * exp(-s * 12.0) * 0.7;
          gl_FragColor = vec4(c * fade * n * uI, 1.0); }`,
    });
  }
  // Solid-rocket booster: bright orange-white with a smoky edge
  function srbMat(seed) {
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uI: { value: 0 }, uL: { value: 40 }, uR0: { value: 1.6 }, uR1: { value: 6 }, uT: { value: 0 }, uSeed: { value: seed } },
      vertexShader: `uniform float uL, uR0, uR1; varying float vS; varying vec3 vN; varying vec3 vV;
        void main(){ float s = 0.5 - position.y; vS = s; float r = mix(uR0, uR1, pow(s, 0.7));
          vec3 p = vec3(position.x * r, -s * uL, position.z * r); vec4 mv = modelViewMatrix * vec4(p, 1.0); vV = -mv.xyz;
          vN = normalize(normalMatrix * vec3(position.x, 0.0, position.z)); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uI, uT, uSeed; varying float vS; varying vec3 vN; varying vec3 vV;
        void main(){ float f = abs(dot(normalize(vN), normalize(vV))); float s = vS;
          float a = smoothstep(0.0, 0.01, s) * (1.0 - smoothstep(0.5, 1.0, s)) * exp(-s * 1.4);
          float n = 0.8 + 0.12 * sin(uT * 37.0 + s * 19.0 + uSeed) + 0.08 * sin(uT * 59.0 - s * 33.0);
          vec3 c = mix(vec3(1.0, 0.92, 0.75), vec3(1.0, 0.45, 0.1), smoothstep(0.0, 0.5, s));
          gl_FragColor = vec4(c * (pow(f, 1.2) * 1.3 + pow(f, 0.4) * 0.2) * a * n * uI, 1.0); }`,
    });
  }
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgb(255,255,255)'); gr.addColorStop(0.4, 'rgb(230,225,255)'); gr.addColorStop(0.8, 'rgb(150,140,255)'); gr.addColorStop(1, 'rgb(20,10,40)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const discMat = () => new THREE.MeshBasicMaterial({ color: 0x000000, map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const HOT = new THREE.Color(2.4, 2.3, 3.0);

  // A plume unit: hydrolox plume + glowing exit disc, aligned to the local -Y axis of `holder`.
  const PL = [];
  function addPlume(holder, x, y, z, r, len, seed, kind = 'h') {
    const g = new THREE.Group(); g.position.set(x, y, z); holder.add(g);
    const mesh = new THREE.Mesh(plumeGeo, kind === 'h' ? hydroloxMat(seed) : srbMat(seed)); mesh.renderOrder = 6; mesh.position.y = -0.03; g.add(mesh);
    const u = mesh.material.uniforms; u.uR0.value = r * (kind === 'h' ? 0.95 : 0.9); u.uR1.value = r * (kind === 'h' ? 1.55 : 3.0); u.uL.value = len;
    let disc = null;
    if (kind === 'h') { disc = new THREE.Mesh(new THREE.CircleGeometry(r * 0.93, 48), discMat()); disc.rotation.x = Math.PI / 2; disc.position.y = 0.04; disc.renderOrder = 5; g.add(disc); }
    const p = { g, mesh, disc, r, len, kind, I: 0 }; PL.push(p); return p;
  }
  function setPlume(p, I, T, lenK = 1) {
    p.I = I; const on = I > 0.004; p.mesh.visible = on; if (p.disc) p.disc.visible = on;
    const u = p.mesh.material.uniforms; u.uI.value = I; u.uT.value = T; u.uL.value = p.len * lenK * (0.97 + 0.03 * Math.sin(T * 9 + u.uSeed.value));
    if (p.disc) p.disc.material.color.copy(HOT).multiplyScalar(I * 0.8);
  }

  // ---------- floor (hero + grid) ----------
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.42, metalness: 0.2 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(400, 96), floorMat); floor.rotation.x = -Math.PI / 2; gridG.add(floor);

  const ANCH = {};
  let engineSrc = null, heroEng = null, heroPl = null;
  const SHP = [], SLSP = [], SRBP = [], GRID = [];
  let coreFall = null, splash = null, foam = null, ocean = null, skyEnv = null, studioEnv = null, skyBg = null;
  let slsStack = null;

  const loadHDR = (url) => new Promise((res, rej) => { const l = new HDRLoader(); l.setDataType(THREE.FloatType); l.load(url, res, undefined, rej); });
  async function load(base) {
    const [eg, sg, lg, hdr, sky] = await Promise.all([
      new GLTFLoader().loadAsync(base + 'models/rs25/scene.gltf'),
      new GLTFLoader().loadAsync(base + 'models/shuttle/scene.gltf'),
      new GLTFLoader().loadAsync(base + 'models/sls/scene.gltf'),
      loadHDR(base + 'hdri/studio_small_09_2k.hdr'),
      loadHDR(base + 'hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr')]);
    hdr.mapping = THREE.EquirectangularReflectionMapping; studioEnv = pmrem.fromEquirectangular(hdr).texture;
    sky.mapping = THREE.EquirectangularReflectionMapping; skyEnv = pmrem.fromEquirectangular(sky).texture; skyBg = sky;
    scene.environment = studioEnv; scene.environmentIntensity = 0.9;

    // --- RS-25 hero: scale to 4.27 m, nozzle exit on y = 0, axis on the origin
    const e = eg.scene; const eb = new THREE.Box3().setFromObject(e), es = eb.getSize(V3());
    const k = E_H / es.y; e.scale.setScalar(k); e.updateMatrixWorld(true);
    // exit rim centre from the lowest vertices
    const rimP = []; let ymn = 1e9;
    e.traverse((o) => { if (!o.isMesh) return; const P = o.geometry.attributes.position; for (let i = 0; i < P.count; i++) { const v = V3(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(o.matrixWorld); rimP.push(v); ymn = Math.min(ymn, v.y); } });
    const lip = rimP.filter((v) => v.y < ymn + 0.03); let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    lip.forEach((v) => { x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z); });
    const exitR = Math.max(x1 - x0, z1 - z0) / 2;
    e.position.set(-(x0 + x1) / 2, -ymn, -(z0 + z1) / 2);
    e.traverse((o) => { if (o.isMesh && o.material) { o.material.envMapIntensity = 1.15; } });
    engineSrc = new THREE.Group(); engineSrc.add(e);
    heroEng = engineSrc.clone(true); heroG.add(heroEng);
    heroPl = addPlume(heroG, 0, 0, 0, exitR * 0.97, 11, 1);
    ANCH.heroTop = V3(0, E_H + 0.2, 0); ANCH.heroChamber = V3(0, E_H * 0.62, 0); ANCH.heroExit = V3(0, 0, 0);
    window.__eng = `k ${k.toFixed(3)} exitR ${exitR.toFixed(3)} size ${es.toArray().map((v) => (v * k).toFixed(2))}`;

    // --- Shuttle: vertical, nose up (aft -z -> -y). Plumes along local -z.
    const sh = sg.scene; sh.traverse((o) => { if (o.isMesh && o.material) o.material.envMapIntensity = 1.0; });
    const shHold = new THREE.Group(); shHold.rotation.x = -Math.PI / 2; shHold.add(sh); shuttleG.add(shHold);
    SH_EXITS.forEach(([x, y, z, r], i) => {
      const a = new THREE.Group(); a.position.set(x, y, z); a.rotation.x = Math.PI / 2; shHold.add(a);   // local -y of `a` = orbiter -z (aft)
      SHP.push(addPlume(a, 0, 0, 0, r, 10, 3 + i));
    });
    ANCH.shTop = V3(0, 20, 0);

    // --- SLS: whole stack; plus a separate copy of the core stage for the ocean fall
    const sl = lg.scene; slsStack = sl; slsG.add(sl);
    sl.traverse((o) => { if (o.isMesh && o.material) o.material.envMapIntensity = 1.0; });
    SLS_EXITS.forEach(([x, y, z], i) => SLSP.push(addPlume(slsG, x, y, z, SLS_ER, 11, 10 + i)));
    SRB_EXITS.forEach(([x, y, z], i) => SRBP.push(addPlume(slsG, x, y, z, 1.5, 55, 20 + i, 's')));
    const core = new THREE.Group(); sl.updateMatrixWorld(true);
    sl.traverse((o) => { if (!o.isMesh) return; const b = new THREE.Box3().setFromObject(o); const c = b.getCenter(V3());
      if (b.max.y <= 68.2 && b.min.y < 60.4 && Math.abs(c.z) < 4.5) { const m = o.clone(); m.applyMatrix4(o.matrixWorld); m.material = o.material.clone(); core.add(m); } });
    // pivot the core about its middle
    const cb = new THREE.Box3().setFromObject(core), cc = cb.getCenter(V3());
    core.children.forEach((m) => m.position.sub(cc));
    coreFall = new THREE.Group(); coreFall.add(core); oceanG.add(coreFall);
    coreFall.userData.half = cb.getSize(V3()).y / 2;
    core.traverse((o) => { if (o.isMesh) { o.material.transparent = false; } });
    // engine "lost" tint on the core's engines (bells)
    coreFall.userData.engMats = [];
    core.traverse((o) => { if (o.isMesh && /Material\.(374|378|351|344|336|373|379|417)/.test(o.material.name) && o.position.y + cc.y < 6) { o.material.emissive = new THREE.Color(1, 0.12, 0.05); o.material.emissiveIntensity = 0; coreFall.userData.engMats.push(o.material); } });

    // --- Ocean
    const nTex = (() => { const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'); const im = g.createImageData(N, N);
      const W = [[3, 1, 0.9, 0.3], [1, 4, 0.6, 1.7], [5, -2, 0.4, 2.1], [-2, 7, 0.3, 0.7], [9, 4, 0.18, 1.1], [-7, 11, 0.12, 2.9]];
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let dx = 0, dy = 0;
        for (const [a, b, amp, ph] of W) { const s = Math.cos((a * x + b * y) / N * 2 * Math.PI + ph) * amp; dx += s * a * 0.05; dy += s * b * 0.05; }
        const i = (y * N + x) * 4; im.data[i] = 128 + 127 * Math.max(-1, Math.min(1, dx)); im.data[i + 1] = 128 + 127 * Math.max(-1, Math.min(1, dy)); im.data[i + 2] = 255; im.data[i + 3] = 255; }
      g.putImageData(im, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(90, 90); return t; })();
    ocean = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: 0x06222e, roughness: 0.08, metalness: 0.0, normalMap: nTex, normalScale: new THREE.Vector2(0.45, 0.45), envMapIntensity: 1.0 }));
    ocean.rotation.x = -Math.PI / 2; oceanG.add(ocean);
    // splash: spray particles + foam ring
    const NP = 2600, pos = new Float32Array(NP * 3), seed = new Float32Array(NP * 4);
    for (let i = 0; i < NP; i++) { const r1 = Math.sin(i * 12.9898) * 43758.5453, r2 = Math.sin(i * 78.233) * 12345.678, r3 = Math.sin(i * 39.425) * 9876.54, r4 = Math.sin(i * 7.31) * 4567.1;
      seed[i * 4] = r1 - Math.floor(r1); seed[i * 4 + 1] = r2 - Math.floor(r2); seed[i * 4 + 2] = r3 - Math.floor(r3); seed[i * 4 + 3] = r4 - Math.floor(r4); }
    const sg2 = new THREE.BufferGeometry(); sg2.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg2.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    const dotTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(240,248,255,0.6)'); gr.addColorStop(1, 'rgba(240,248,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
    splash = new THREE.Points(sg2, new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
      uniforms: { uP: { value: 0 }, uMap: { value: dotTex }, uScale: { value: height / 2 } },
      vertexShader: `attribute vec4 seed; uniform float uP, uScale; varying float vA;
        void main(){ float t = uP * (0.7 + 0.6 * seed.w); float a = seed.x * 6.2832; float sp = 6.0 + 26.0 * seed.y; float up = 14.0 + 40.0 * seed.z * seed.z;
          vec3 p = vec3(cos(a) * sp * t, up * t - 22.0 * t * t, sin(a) * sp * t); p.y = max(p.y, 0.0);
          vA = (1.0 - smoothstep(0.55, 1.0, uP)) * step(0.001, uP);
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = (1.6 + 4.0 * seed.y) * uScale / -mv.z; }`,
      fragmentShader: `uniform sampler2D uMap; varying float vA; void main(){ vec4 c = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vec3(0.95, 0.97, 1.0), c.a * vA * 0.85); }` }));
    splash.frustumCulled = false; oceanG.add(splash);
    const ringTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); const gr = g.createRadialGradient(128, 128, 40, 128, 128, 128);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.8, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c); })();
    foam = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, color: 0xdfe8ee }));
    foam.rotation.x = -Math.PI / 2; foam.position.y = 0.05; oceanG.add(foam);

    // --- 16-engine grid (4 flights x 4 engines), rows along z, first row nearest the camera (+z)
    for (let row = 0; row < 4; row++) for (let c = 0; c < 4; c++) {
      const g = engineSrc.clone(true); const mats = [];
      g.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.emissive = new THREE.Color(0, 0, 0); mats.push(o.material); } });
      g.position.set((c - 1.5) * GRID_DX, 0, (1.5 - row) * GRID_DZ); g.rotation.y = 0.35; gridG.add(g);
      GRID.push({ g, mats, row, c });
    }
    for (let row = 0; row < 4; row++) ANCH['row' + row] = V3(-1.5 * GRID_DX - 2.2, 2.2, (1.5 - row) * GRID_DZ);
    // the new engine that rises in front
    const ng = engineSrc.clone(true); const nm = []; ng.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0, 0, 0); nm.push(o.material); } });
    ng.position.set(0, 0, 2.5 * GRID_DZ + 1.5); gridG.add(ng); GRID.newE = { g: ng, mats: nm };
    ANCH.newTop = V3(0, E_H + 0.4, 2.5 * GRID_DZ + 1.5);
  }

  // ---------- post ----------
  const rt = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt); composer.setPixelRatio(1); composer.setSize(width, height);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new ShaderPass({ uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0); gl_FragColor = clamp(c, 0.0, 64.0); }' }));
  const gtao = new GTAOPass(scene, camera, width, height); gtao.output = GTAOPass.OUTPUT.Default; gtao.blendIntensity = 1.0;
  gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1, scale: 1.2, samples: 16, distanceFallOff: 1.0 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
  composer.addPass(gtao);
  const bokeh = new BokehPass(scene, camera, { focus: 10, aperture: 0.0, maxblur: 0.01 }); composer.addPass(bokeh);
  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.35, 0.5, 1.6); composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const fx = () => [...PL.map((p) => p.mesh), ...PL.filter((p) => p.disc).map((p) => p.disc), ...(splash ? [splash, foam] : [])];
  const wrapHide = (pass) => { const f = pass.render.bind(pass); pass.render = (...a) => { const L = fx(), v = L.map((o) => o.visible); L.forEach((o) => (o.visible = false)); f(...a); L.forEach((o, i) => (o.visible = v[i])); }; };
  wrapHide(gtao); wrapHide(bokeh);

  // ---------- render(state) ----------
  // modes: 0 hero engine, 1 shuttle, 2 SLS stack, 3 ocean fall, 4 engine grid
  function render(s) {
    if (!heroEng) return;
    const T = s.t, mode = Math.round(s.mode || 0);
    heroG.visible = mode === 0; shuttleG.visible = mode === 1; slsG.visible = mode === 2; oceanG.visible = mode === 3; gridG.visible = mode === 4;
    floor.visible = mode === 4;
    if (mode === 3) { scene.environment = skyEnv; scene.background = skyBg; scene.backgroundIntensity = 0.85; scene.environmentIntensity = 1.0; scene.backgroundRotation.y = 1.2; scene.environmentRotation.y = 1.2; }
    else { scene.environment = studioEnv; scene.background = BG; scene.environmentIntensity = 0.9; }
    PL.forEach((p) => setPlume(p, 0, T));
    let pl = null;
    if (mode === 0) {
      heroEng.rotation.y = (s.heroRot || 0) * DEG;
      setPlume(heroPl, s.fire || 0, T, s.len ?? 1); pl = [0, -1.5, 0];
      key.position.set(4, 6, 8); rim.position.set(-6, 3, -6);
    } else if (mode === 1) {
      shuttleG.rotation.y = (s.shRot || 0) * DEG;
      SHP.forEach((p, i) => setPlume(p, (s.shFire || 0) * (0.92 + 0.08 * Math.sin(i * 2.1)), T, s.len ?? 1)); pl = [0, -22, 0];
      key.position.set(10, 8, 14); rim.position.set(-12, 6, -10);
    } else if (mode === 2) {
      SLSP.forEach((p, i) => setPlume(p, clamp01((s.slsLit || 0) - i) * 0.9, T, s.len ?? 1));
      SRBP.forEach((p) => setPlume(p, s.srb || 0, T));
      pl = [0, -4, 0]; key.position.set(30, 40, 60); rim.position.set(-40, 20, -40);
    } else if (mode === 3) {
      const f = s.fall || 0, half = coreFall.userData.half;
      // falls along a steep line, tilted ~55 deg, slowly rotating; contact when the low end reaches the water
      const tilt = (55 + 8 * f) * DEG;
      const low = half * Math.cos(tilt);
      const y = low + (1 - f) * 95 - (s.sink || 0) * 14;
      coreFall.position.set(-40 * (1 - f) + 6, y, -20 * (1 - f));
      coreFall.rotation.set(0, 0.6 + f * 0.25, tilt); // engines end down-left
      coreFall.userData.engMats.forEach((m) => (m.emissiveIntensity = (s.lost || 0) * (0.6 + 0.4 * Math.sin(T * 8))));
      splash.material.uniforms.uP.value = s.splash || 0;
      const fp = s.splash || 0; foam.visible = fp > 0.001; foam.scale.setScalar(10 + 70 * Math.sqrt(fp)); foam.material.opacity = (1 - smooth(0.4, 1.0, fp)) * 0.9;
      coreFall.updateMatrixWorld(true); const lowP = coreFall.localToWorld(V3(0, -half * 0.97, 0)); foam.position.x = splash.position.x = lowP.x; foam.position.z = splash.position.z = lowP.z; ANCH.impact = V3(lowP.x, 0, lowP.z); ANCH.stageLow = lowP.clone();
      ocean.material.normalMap.offset.set(T * 0.004, T * 0.002);
      key.position.set(-80, 120, 60); rim.position.set(60, 40, -80);
    } else if (mode === 4) {
      const rows = s.rows || 0, gone = s.gone || 0;
      GRID.forEach(({ g, mats, row }) => { const hi = clamp01(rows - row), go = clamp01(gone - row);
        mats.forEach((m) => { m.emissive.setRGB(0, 0, 0); m.emissiveIntensity = 0; m.opacity = 1 - 0.88 * go; m.depthWrite = go < 0.5; });
        g.position.y = -0.6 * go; });
      const ne = GRID.newE, nu = s.newE || 0; ne.g.visible = nu > 0.001; ne.g.position.y = -E_H * (1 - smooth(0, 1, nu)); ne.g.rotation.y = (s.newRot || 0) * DEG;
      key.position.set(8, 14, 16); rim.position.set(-10, 8, -12);
    }
    if (pl) { plumeLight.position.set(...pl); const mx = Math.max(...PL.map((p) => p.I)); plumeLight.intensity = mx * (mode === 1 ? 60 : mode === 2 ? 6 : 8); }

    // camera
    const tgt = V3(s.tx || 0, s.ty || 0, s.tz || 0);
    const dist = Math.exp(s.logD), az = s.camAz * DEG, el = s.camEl * DEG;
    camera.fov = s.fov; camera.up.set(0, 1, 0);
    camera.position.set(tgt.x + dist * Math.cos(el) * Math.sin(az), tgt.y + dist * Math.sin(el), tgt.z + dist * Math.cos(el) * Math.cos(az));
    camera.lookAt(tgt); camera.rotateZ((s.camRoll || 0) * DEG);
    camera.near = Math.max(0.03, dist * 0.01); camera.far = Math.max(500, dist * 60);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    key.intensity = 2.0 * (s.key ?? 1) * (mode === 3 ? 1.6 : 1); rim.intensity = 1.6 * (s.rim ?? 1);
    gtao.blendIntensity = s.ao ?? 1;
    bokeh.uniforms.focus.value = s.focus || dist; bokeh.uniforms.aperture.value = s.aperture || 0; bokeh.uniforms.maxblur.value = s.maxblur || 0.01;
    bokeh.enabled = (s.aperture || 0) > 0;
    bloom.strength = s.bloom ?? 0.35;
    renderer.toneMappingExposure = s.exp ?? 1;
    composer.render();
  }

  function project(name) {
    const p = ANCH[name]; if (!p) return null;
    const v = p.clone().project(camera); if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height };
  }
  return { load, render, project };
}
