// node dev/idx.mjs t1,t2,... outprefix  -> screenshots of index.html at those times (renders via the hf-seek listener)
import puppeteer from 'puppeteer-core';
const [,, times, out] = process.argv;
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
const p = await b.newPage(); await p.setViewport({ width: 1080, height: 1920 });
p.on('console', (m) => { if (/error|Error|warn/i.test(m.text())) console.log('console:', m.text().slice(0, 300)); });
p.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 300)));
const t0 = Date.now();
await p.goto('http://localhost:8765/templates/x2-factory/index.html', { waitUntil: 'load', timeout: 120000 });
await p.evaluate(() => window.__hf.buildReady.x2);
await p.addStyleTag({ content: '.cw,.call,#hook,#end,#endscrim{display:none!important}' + (process.env.NOLAB ? '.lab{display:none!important}' : '') });
console.log('ready in', ((Date.now() - t0) / 1000).toFixed(1), 's');
for (const t of times.split(',').map(Number)) {
  const ms = await p.evaluate((t) => { const a = performance.now(); window.__timelines.main.seek(t); window.dispatchEvent(new CustomEvent('hf-seek', { detail: { time: t } })); return performance.now() - a; }, t);
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await p.screenshot({ path: `${out}-${String(t).replace('.', '_')}.png` });
  const dbg = await p.evaluate(() => JSON.stringify(window.__dbg));
  console.log(t, Math.round(ms) + 'ms', dbg);
}
await b.close();
