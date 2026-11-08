// 肩宽整改后的行人特写:站到人跟前 1.8 米、四分之三侧脸,fov 30 两张
import puppeteer from 'puppeteer-core';
const URL = 'http://127.0.0.1:8017/gta/?autostart&noshadow';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 640, height: 480 });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await sleep(3500);
await page.evaluate(() => { window.__gta.fov = 30; });
for (const [name, off] of [['front', [1.3, 1.2]], ['back', [-1.3, -1.2]]]) {
  const q = await page.evaluate((o) => {
    const G = window.__gta, p = G.nearestPed();
    if (!p) return null;
    const tx = p.side % 2 === 0 ? 1 : 0, tz = p.side % 2 === 0 ? 0 : 1;
    const px = p.x + p.ox * o[0] + tx * o[1], pz = p.z + p.oz * o[0] + tz * o[1];
    G.standAt(px, pz, Math.atan2(p.x - px, p.z - pz));
    return { x: p.x, z: p.z };
  }, off);
  if (!q) { console.log('没人'); break; }
  await sleep(1200);
  await page.screenshot({ path: import.meta.dirname + `/../shots/p7b-${name}.png` });
}
await browser.close();
