// node dev/cycles.mjs -> per-station cycle starts (video time) and box-line place times
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 600000, args: ['--use-angle=d3d11'] });
const p = await b.newPage(); p.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 300)));
await p.goto('http://localhost:8765/templates/x2-factory/dev/audit.html' + (process.env.KIT0 ? '?kit0=' + process.env.KIT0 : ''), { waitUntil: 'load' });
await p.waitForFunction('window.__done', { timeout: 300000, polling: 200 });
const r = await p.evaluate(() => {
  const out = window.__cycles.map((c) => `${c.name.padEnd(8)} shift ${c.shift}  starts ${c.starts.join(' ')}`);
  for (const n of ['kit', 'sort', 'carry', 'cart']) { const bt = window.__bots.find((x) => x.name === n); out.push(`${n.padEnd(8)} places ${bt.jobs.filter((j) => j.Wp).map((j) => +(j.tPlace + (bt.shift || 0)).toFixed(1)).join(' ')}  end ${bt.segs.length ? +bt.segs[bt.segs.length - 2]?.t1?.toFixed(1) : ''}`); }
  return out.join('\n');
});
console.log(r); await b.close();
