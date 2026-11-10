// node dev/shotstates.mjs -> JSON list of camera states at the start / end of each shot (for stills)
import fs from 'fs';
const html = fs.readFileSync('index.html', 'utf8');
const TL = JSON.parse(html.match(/TL = ({[^;]*?})[,;]/)[1]), DUR = +html.match(/DUR = ([0-9.]+)/)[1];
const lines = fs.readFileSync('index.tpl.part', 'utf8').split('\n').filter((l) => /^\s*shot\(/.test(l));
const r7x = (t) => -8.8 + 0.45 * (t + 4.55), r9z = (t) => -15.5 + 0.45 * (t + 2);
const out = []; let prev = { tx: 1.2, ty: 0, tz: -1.2, camAz: -35, camEl: 44, D: 17, fov: 44 };
const shot = (t0, t1, a, b) => { const A = { ...prev, fov: 32, ...a }, B = { ...A, ...b }; prev = B; out.push({ t0, t1, A, B }); };
for (const l of lines) eval(l.trim());
const states = [];
out.forEach((s, i) => { for (const [k, st, t] of [['a', s.A, s.t0 + 0.15], ['b', s.B, s.t1 - 0.15]]) { const { ...rest } = st; states.push({ name: `${String(i).padStart(2, '0')}${k}-${t.toFixed(1)}`, t: +t.toFixed(2), ...rest, ao: 1, bloom: 0.3, exp: 1, maxblur: 0.006 }); } });
console.log(JSON.stringify(states));
