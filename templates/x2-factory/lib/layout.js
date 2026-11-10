// Shared station layout (classic script: used by the timeline script and by lib/x2.js). Units: metres, three.js world (+Y up).
// The robot pivots in place at the origin. Heading angle a: forward = (cos a, 0, -sin a), right = (sin a, 0, cos a).
(function () {
  const D = Math.PI / 180;
  const L = {
    D,
    PHI_C: 130 * D,          // conveyor end, back-left of the pallet
    PHI_P: 0,                // pallet straight ahead
    C_R: 0.50,               // crate centre radius at the belt end
    BELT_Y: 0.714,           // belt surface (scailman conveyor, real scale)
    CRATE: [0.602, 0.23, 0.402],
    HANDLE: [0.316, 0.165],  // grip point: x = +-0.316 (outside the short ends), y above the crate base
    T_X: 0.70, T_X_OUT: 1.02, // pallet station centre: working position / retracted for rotating
    T_H: 0.20, PAL_H: 0.144, LAYER: 0.232,
    GAP: 0.78,               // crate spacing on the belt
    FEET_W: 0.137,           // half stance width
  };
  L.dir = (a) => [Math.cos(a), 0, -Math.sin(a)];
  L.right = (a) => [Math.sin(a), 0, Math.cos(a)];
  // crate pose from torso-polar parameters: centre = dir(phi)*r + right(phi)*lat, bottom at y = h, facing phi
  L.cratePos = (phi, r, h, lat) => { const f = L.dir(phi), g = L.right(phi); return [f[0] * r + g[0] * lat, h, f[2] * r + g[2] * lat]; };
  // near-row slot (j = 0 left, 1 right) for a layer, with the station at T_X, facing PHI_P = 0
  L.slot = (j, layer) => ({ r: L.T_X - 0.2, lat: j ? 0.3 : -0.3, h: L.T_H + L.PAL_H + layer * L.LAYER });
  window.LAY = L;
})();
