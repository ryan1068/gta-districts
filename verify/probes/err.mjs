import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await p.goto('http://127.0.0.1:8017/gta/?autostart&noshadow', { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));
const state = await p.evaluate(() => ({
  hasDebug: typeof window.__gta !== 'undefined',
  errDiv: document.querySelector('.err')?.textContent || null,
  mode: window.__gta?.mode, cars: window.__gta?.carCount,
}));
console.log(JSON.stringify({ ...state, errs }, null, 1));
await b.close();
