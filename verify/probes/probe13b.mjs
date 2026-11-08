// 蹲防姿势:按 g 后相机每帧现挑人四周 4 个方位里"没车、离人 3 米"的那个怼上去
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
  if (!window.__patched) {
    const orig = G.renderer.render.bind(G.renderer);
    G.renderer.render = (s, c) => { if (window.__hk) window.__hk(c); return orig(s, c); };
    window.__patched = true;
  }
  window.__t = { i: p.i };   // evaluate 里没有局部 t:钩子在页面里跑,只能挂 window 上
  window.__hk = (cam) => {
    const p = G.pedState(window.__t.i);
    let best = null;
    for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) {
      const cx = p.x + dx, cz = p.z + dz;
      let clear = true;
      for (const c of G.cars) if (Math.hypot(c.x - cx, c.z - cz) < 2.6) { clear = false; break; }
      if (clear) { best = [cx, cz]; break; }
    }
    if (!best) best = [p.x + 3, p.z];
    cam.position.set(best[0], 1.5, best[1]);
    cam.lookAt(p.x, 0.8, p.z); cam.fov = 30; cam.updateProjectionMatrix();
  };
  return { i: p.i };
});
if (!t) { console.log('没人'); await browser.close(); process.exit(0); }
await sleep(600);
await page.keyboard.press('g');
await sleep(1000);
console.log('蹲中: 蹲', await page.evaluate(() => window.__gta.pedsCrouched), '目标状态', await page.evaluate((o) => window.__gta.pedState(o.i).st, t));
await page.screenshot({ path: import.meta.dirname + '/../shots/p13b-crouch.png' });
await browser.close();
