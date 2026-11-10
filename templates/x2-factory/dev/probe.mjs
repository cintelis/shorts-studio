// node dev/probe.mjs bot t -> hand link extents in the held item's frame
import puppeteer from 'puppeteer-core';
const [bot, t] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 600000, args: ['--use-angle=d3d11'] });
const p = await b.newPage(); p.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 300)));
await p.goto('http://localhost:8765/templates/x2-factory/dev/audit.html', { waitUntil: 'load' });
await p.waitForFunction('window.__done', { timeout: 300000, polling: 200 });
const out = await p.evaluate((bot, t) => {
  const m = window.__m; m.render({ t, noDraw: 1 }); const c = m.auditCtx(); const it = c.items(t).find((i) => i.held === bot); if (!it) return 'no held item';
  const ri = c.botNames.indexOf(bot), inv = it.M.clone().invert(), res = {};
  c.rigs[ri].root.traverse((o) => { if (!o.isMesh) return; let l = o.parent; while (l && !l.name) l = l.parent; const n = l.name; if (!/thumb_pip|thumb_mcp|_dip|_pip|palm|wrist_yaw/.test(n)) return;
    const V = o.position.constructor, P = o.geometry.attributes.position; const r = res[n] || (res[n] = { x: [9, -9], y: [9, -9], z: [9, -9] });
    for (let i = 0; i < P.count; i += 3) { const q = new V(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
      for (const k of ['x', 'y', 'z']) { r[k][0] = Math.min(r[k][0], +q[k].toFixed(3)); r[k][1] = Math.max(r[k][1], +q[k].toFixed(3)); } } });
  return { name: it.name, h: it.h, res };
}, bot, +t);
console.log(out.name, JSON.stringify(out.h)); for (const [k, v] of Object.entries(out.res || {})) console.log(k.padEnd(16), JSON.stringify(v)); await b.close();
