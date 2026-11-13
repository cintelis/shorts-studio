import puppeteer from 'puppeteer-core';
const [,, url, out] = process.argv;
const CHROME = process.env.CHROME_PATH || {
  win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
}[process.platform] || '/usr/bin/google-chrome';
const ANGLE = { win32: 'd3d11', darwin: 'metal' }[process.platform];
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 3600000, args: [...(ANGLE ? [`--use-angle=${ANGLE}`] : []), '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const p = await b.newPage(); await p.setViewport({ width: +(process.env.W || 1080), height: +(process.env.H || 1080) });
p.on('console', (m) => { if (/error|Error/.test(m.text())) console.log('console:', m.text().slice(0, 300)); });
p.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 300)));
await p.goto(url, { waitUntil: 'load', timeout: 120000 });
await p.waitForFunction('window.__done', { timeout: 3600000, polling: 1000 });
console.log(await p.evaluate(() => window.__info || ''));
await p.screenshot({ path: out, clip: { x: 0, y: 0, width: +(process.env.W || 1080), height: +(process.env.H || 1080) } });
await b.close();
