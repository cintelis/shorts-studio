// node dev/eval.mjs "<js expression using window.__bots / __m>"
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 600000, args: ['--use-angle=d3d11'] });
const p = await b.newPage(); p.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 300)));
await p.goto('http://localhost:8765/templates/x2-factory/dev/audit.html', { waitUntil: 'load' });
await p.waitForFunction('window.__done', { timeout: 300000, polling: 200 });
console.log(await p.evaluate((e) => { const r = eval(e); return typeof r === 'string' ? r : JSON.stringify(r); }, process.argv[2]));
await b.close();
