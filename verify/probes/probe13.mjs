// 挨打姿势特写:走真实按键路径按 g,相机怼到蹲着的人跟前拍两张(蹲中/起身后)
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
const t = await page.evaluate(() => {
  const G = window.__gta, p = G.nearestPed();
  if (!p) return null;
  const sx = p.x + p.ox * 1.6, sz = p.z + p.oz * 1.6;
  G.standAt(sx, sz, Math.atan2(p.x - sx, p.z - sz));
  return { i: p.i };
});
if (!t) { console.log('没人'); await browser.close(); process.exit(0); }
// 先把相机架好(按 g 之前),这样 0.6 秒冷却期内蹲下的人不会被下一脚踹散
await page.evaluate((o) => {
  const G = window.__gta;
  if (!window.__patched) {
    const orig = G.renderer.render.bind(G.renderer);
    G.renderer.render = (s, c) => { if (window.__hk) window.__hk(c); return orig(s, c); };
    window.__patched = true;
  }
  // p7c 验证过的构图:相机站人朝马路一侧 2.2 米、1.3 米高、fov 24 怼脸
  // (p.ox 要现取:蹲下的人也被 punch 挪过,别冻住按下那一刻)
  const o0 = G.nearestPed() || { ox: 1, oz: 0 };
  window.__hk = (cam) => {
    const p = G.pedState(o.i);                                  // 每帧现算:人在蹲着也会挪
    cam.position.set(p.x + o0.ox * 2.2, 1.3, p.z + o0.oz * 2.2);
    cam.lookAt(p.x, 0.75, p.z); cam.fov = 24; cam.updateProjectionMatrix();
  };
}, t);
await sleep(600);
await page.keyboard.press('g');
await sleep(1000);
await page.screenshot({ path: import.meta.dirname + '/../shots/p13-crouch.png' });
console.log('蹲中: 蹲下人数', await page.evaluate(() => window.__gta.pedsCrouched), '目标状态', await page.evaluate((o) => window.__gta.pedState(o.i).st, t));
await sleep(3000);
console.log('3 秒后: 蹲下人数', await page.evaluate(() => window.__gta.pedsCrouched), '目标状态', await page.evaluate((o) => window.__gta.pedState(o.i).st, t));
await page.screenshot({ path: import.meta.dirname + '/../shots/p13-up.png' });
await browser.close();
