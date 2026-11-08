// 蹲防姿势特写 v4:合成截图两次骗人(人不在帧里)—— 改在 render 钩子里 orig 之后
// 同帧 toDataURL 抓 WebGL 缓冲,游戏画出什么就是什么,不过 compositor 的手
import fs from 'fs';
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
    let n = 0;
    G.renderer.render = (s, c) => {
      window.__hkCount = (window.__hkCount || 0) + 1;
      if (window.__hk) window.__hk(c);
      orig(s, c);
      if (window.__grab && (++n % 2 === 0)) window.__data = G.renderer.domElement.toDataURL('image/png');
    };
    window.__patched = true;
  }
  window.__t = { i: p.i };
  window.__hk = (cam) => {
    const p = G.pedState(window.__t.i);
    window.__lastP = [+p.x.toFixed(1), +p.z.toFixed(1), p.st];
    let best = null;
    // 4 方位:离车 >2.6 米 + 相机到人的视线不穿墙(probeSolid 沿线采样 4 步)
    for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) {
      const cx = p.x + dx, cz = p.z + dz;
      let clear = true;
      for (const c of G.cars) if (Math.hypot(c.x - cx, c.z - cz) < 2.6) { clear = false; break; }
      for (let s = 1; clear && s <= 4; s++) {
        const f = s / 5;
        if (G.probeSolid(cx + (p.x - cx) * f, cz + (p.z - cz) * f)) clear = false;
      }
      if (clear) { best = [cx, cz]; break; }
    }
    if (!best) best = [p.x + 3, p.z];
    cam.position.set(best[0], 1.2, best[1]);
    cam.updateMatrixWorld(true);   // lookAt 读的是上一帧 matrixWorld,不先刷新就会按旧机位算转身(NDC 0.95 血案)
    cam.lookAt(p.x, 0.9, p.z); cam.fov = 28; cam.updateProjectionMatrix();
    // 决定性实验:把蹲着的人硬搬到强制机位正前方 2 米(st=3 时 updatePeds 不改 x,z,不会被参数化挪走)
    if (window.__nudge && p.st === 3 && !window.__nudged) {
      window.__nudged = true; window.__np = [+p.x.toFixed(1), +p.z.toFixed(1)];
      const dx = p.x - best[0], dz = p.z - best[1], dl = Math.hypot(dx, dz) || 1;
      p.x = best[0] + dx/dl*2; p.z = best[1] + dz/dl*2;
    }
    window.__lastCam = [+cam.position.x.toFixed(1), +cam.position.y.toFixed(1), +cam.position.z.toFixed(1)];
  };
  return { i: p.i };
});
if (!t) { console.log('没人'); await browser.close(); process.exit(0); }
await sleep(600);
await page.keyboard.press('g');
await sleep(1000);
await page.evaluate(() => { window.__grab = true; });   // 钩子里下一帧起同帧抓缓冲
await sleep(1200);
const out = await page.evaluate((o) => ({
  st: window.__gta.pedState(o.i).st,
  lastCam: window.__lastCam, ped: window.__lastP, data: window.__data,
}), t);
console.log('诊断: st', out.st, '相机', out.lastCam, '人', out.ped, '抓到图', !!out.data);
fs.writeFileSync(import.meta.dirname + '/../shots/p13c-crouch.png', Buffer.from(out.data.split(',')[1], 'base64'));
await browser.close();
