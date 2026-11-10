// node dev/audit.mjs [t0] [t1] [dt] -> collision / support report for the composition clock
import puppeteer from 'puppeteer-core';
const [t0 = 0, t1 = 48.8, dt = 0.1] = process.argv.slice(2).map(Number);
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 1800000, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--js-flags=--expose-gc'] });
const p = await b.newPage();
let pageErr = null;
p.on('pageerror', (e) => { pageErr = e.message.slice(0, 400); console.log('AUDIT FAILED pageerror', pageErr); });
await p.goto('http://localhost:8765/templates/x2-factory/dev/audit.html' + (process.env.PITCH ? '?pitch=' + process.env.PITCH : ''), { waitUntil: 'load', timeout: 120000 });
await p.waitForFunction('window.__done', { timeout: 300000, polling: 200 });
if (pageErr) { await b.close(); process.exit(2); }
const { rep, n } = await p.evaluate((a, b2, c) => window.__run(a, b2, c), t0, t1, dt);
const want = Math.floor((t1 - t0) / dt + 1e-6) + 1;
if (pageErr || n !== want) { console.log(`AUDIT FAILED ${pageErr ? 'pageerror ' + pageErr : ''} sampled ${n}/${want} frames`); await b.close(); process.exit(2); }
console.log(`AUDIT ${t0}-${t1}s @${dt}s: ${rep.length} issue groups, sampled ${n}/${want} frames`);
for (const r of rep) console.log(`${(r.max * 100).toFixed(1).padStart(6)} cm  ${String(r.t0).padStart(5)}-${String(r.t1).padEnd(5)}s  n=${String(r.n).padEnd(4)} ${r.key}   run=${r.maxRun} sus=${(r.sus * 100).toFixed(1)} @${r.at} ${r.pos ? JSON.stringify(r.pos) : ''}`);
await b.close();
