// node dev/fshot.mjs out-prefix 'json-state' ['json-state' ...]   (each state needs t; optional name)
import puppeteer from 'puppeteer-core';
const [,, out, ...states] = process.argv;
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
const p = await b.newPage(); await p.setViewport({ width: 1080, height: 1920 });
p.on('console', (m) => { if (/rror/.test(m.text())) console.log('console:', m.text().slice(0, 300)); });
p.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 400)));
const t0 = Date.now();
await p.goto('http://localhost:8765/templates/x2-factory/dev/fscene.html', { waitUntil: 'load', timeout: 120000 });
await p.waitForFunction('window.__done', { timeout: 300000, polling: 200 });
console.log(await p.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(window.__geo || {}).map(([k, b]) => [k, [b.min.toArray().map((v) => +v.toFixed(2)), b.max.toArray().map((v) => +v.toFixed(2))]])))));
console.log(await p.evaluate(() => window.__bots.map((b) => b.name + ' shift ' + (b.shift || 0).toFixed(2) + ' ev ' + (b.eventList || []).slice(0, 6).map((e) => (e + (b.shift || 0)).toFixed(1)).join(',')).join(' | ')));
console.log('loaded', ((Date.now() - t0) / 1000).toFixed(1), 's');
for (const [i, st] of states.entries()) {
  const s = JSON.parse(st); const ms = await p.evaluate((s) => window.__render(s), s);
  const f = `${out}-${s.name || i}.png`; await (await p.$('canvas')).screenshot({ path: f }); console.log(f, ms + 'ms');
}
await b.close();
