// 强制机位:patch renderer.render 原型,每帧渲染前把相机按 __camHook 摆好
// (游戏相机更新在 render 之前,事后盖 rAF 没用 —— 会被下一帧覆写)
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
// 人 1.7 米高,相机离 5 米举高 2.4 米:越过泊车、不怼墙。四个方位轮着拍,
// 哪张被楼/车怼脸一目了然,挑能看清肩膀的那张算数。
const SHOTS = [['n', 0, -5], ['s', 0, 5], ['e', 5, 0], ['w', -5, 0]];
for (const [name, ddx, ddz] of SHOTS) {
  const q = await page.evaluate((args) => {
    const G = window.__gta, p = G.nearestPed();
    if (!p) return null;
    if (!window.__patched) {
      // r169 的 WebGLRenderer.render 是实例自带(不是原型方法):直接换实例上的
      const orig = G.renderer.render.bind(G.renderer);
      G.renderer.render = (scene, cam) => { if (window.__camHook) window.__camHook(cam); return orig(scene, cam); };
      window.__patched = true;
    }
    window.__camHook = (cam) => {
      const cx = p.x + args[0], cz = p.z + args[1];
      cam.position.set(cx, 2.4, cz);
      cam.lookAt(p.x, 1.15, p.z);
      cam.fov = 30; cam.updateProjectionMatrix();
      window.__camPos = [cx, cz];
    };
    G.standAt(p.x - args[0] * 4, p.z - args[1] * 4, 0);   // 主角支使人另一头远处,别入画
    return { x: p.x, z: p.z };
  }, [ddx, ddz]);
  if (!q) { console.log('没有散步者'); break; }
  await sleep(1300);
  await page.screenshot({ path: import.meta.dirname + `/../shots/p7c-${name}.png` });
  await page.evaluate(() => { window.__camHook = null; window.__gta.fov = 56; });
}
await browser.close();
