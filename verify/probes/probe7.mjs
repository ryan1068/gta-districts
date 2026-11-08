// 行人新模观感:步行特写(fov32)+ 车里平视 + 俯视街上行群,三张图
import puppeteer from 'puppeteer-core';
const URL = 'http://127.0.0.1:8017/gta/?autostart&noshadow';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 760, height: 500 });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await sleep(3500);

// 特写:站到最近散步者 2.2 米外
const p = await page.evaluate(() => {
  const G = window.__gta, q = G.nearestPed();
  if (q) {
    // 站在人与马路之间、稍微侧一点:人是正面/半侧,背景是马路(干净),不被 HUD 条压住
    const tx = q.side % 2 === 0 ? 1 : 0, tz = q.side % 2 === 0 ? 0 : 1;   // 沿环道切线侧移
    const px = q.x + q.ox * 4.0 + tx * 1.4, pz = q.z + q.oz * 4.0 + tz * 1.4;
    G.standAt(px, pz, Math.atan2(q.x - px, q.z - pz));
  }
  return q;
});
if (!p) { console.log('没有散步者'); }
await sleep(600);
await page.evaluate(() => { window.__gta.fov = 26; });
await sleep(900);
await page.screenshot({ path: import.meta.dirname + '/../shots/p7-closeup.png' });
await page.evaluate(() => { window.__gta.fov = 56; });

// 车里平视:摆到人行道旁车道,近处行人入画
await page.evaluate(() => {
  const G = window.__gta, q = G.nearestPed();
  if (!q) return;
  const sx = q.x + q.ox * 4.2, sz = q.z + q.oz * 4.2;
  G.spawnAt(sx, sz, Math.atan2(q.x - sx, q.z - sz));
});
await sleep(900);
await page.screenshot({ path: import.meta.dirname + '/../shots/p7-street.png' });
await browser.close();
