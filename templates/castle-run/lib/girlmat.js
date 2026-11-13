// Fantasy Girl uses KHR_materials_pbrSpecularGlossiness, which three.js no longer reads.
// Rebuild each material as MeshStandardMaterial from the original diffuse / normal / AO / emissive textures.
import * as THREE from './three.module.js';
export async function fixGirlMaterials(gltf, opt = {}) {
  const parser = gltf.parser, J = parser.json, cache = {};
  const tex = async (i, srgb) => { if (i == null) return null; const k = i + (srgb ? 's' : 'l'); if (!cache[k]) { const t = (await parser.getDependency('texture', i)).clone(); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.flipY = false; t.anisotropy = 8; t.needsUpdate = true; cache[k] = t; } return cache[k]; };
  const jobs = [];
  gltf.scene.traverse((o) => { if (!o.isMesh) return; jobs.push((async () => {
    const assoc = parser.associations.get(o.material); const mi = assoc ? assoc.materials : J.materials.findIndex((m) => m.name === o.material.name);
    const jm = J.materials[mi], sg = (jm.extensions || {}).KHR_materials_pbrSpecularGlossiness || {};
    const isArmor = /armor/i.test(jm.name), isHair = /hair/i.test(jm.name);
    const m = new THREE.MeshStandardMaterial({
      name: jm.name, map: await tex(sg.diffuseTexture && sg.diffuseTexture.index, true), side: THREE.DoubleSide,
      roughness: isArmor ? (opt.armorRough ?? 0.42) : isHair ? 0.55 : 0.62, metalness: isArmor ? (opt.armorMetal ?? 0.45) : 0,
      normalMap: await tex(jm.normalTexture && jm.normalTexture.index, false),
      aoMap: await tex(jm.occlusionTexture && jm.occlusionTexture.index, false), aoMapIntensity: 0.8,
      emissiveMap: await tex(jm.emissiveTexture && jm.emissiveTexture.index, true), emissive: jm.emissiveTexture ? new THREE.Color(opt.emissive ?? 0.35, opt.emissive ?? 0.35, opt.emissive ?? 0.35) : new THREE.Color(0),
      vertexColors: false, alphaTest: isHair ? 0.4 : 0, transparent: false,
    });
    o.material = m; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
  })()); });
  await Promise.all(jobs);
}
