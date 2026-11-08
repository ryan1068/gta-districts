import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await p.goto('http://127.0.0.1:8017/gta/?autostart', { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 2000));
const a = await p.evaluate(() => ({ ...window.__gta.raf, hero: window.__gta.heroPos, x: window.__gta.x, z: window.__gta.z, type: window.__gta.carType }));
const jump = await p.evaluate(() => window.__gta.jumpToType('跑车'));
await new Promise((r) => setTimeout(r, 1500));
const c = await p.evaluate(() => ({ ...window.__gta.raf, hero: window.__gta.heroPos, x: window.__gta.x, z: window.__gta.z, type: window.__gta.carType, cam: window.__gta.cam }));
console.log(JSON.stringify({ 上手前: a, 跳去: jump, 上手后: c, errs }, null, 1));
await b.close();
