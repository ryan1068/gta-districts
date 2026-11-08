// 决定性实验:从真实场景里把挨打者(i=目标)各部件的实例矩阵拆出来 ——
// 位置对不对、缩放是不是塌了,一眼定 writePed 第 822 行有没有写坏
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
    G.renderer.render = (s, c) => { if (!window.__scn && s.isScene) window.__scn = s; orig(s, c); };
    window.__patched = true;
  }
  return { i: p.i };
});
if (!t) { console.log('没人'); await browser.close(); process.exit(0); }
await sleep(600);
await page.keyboard.press('g');
await sleep(800);
const out = await page.evaluate((o) => {
  const p = window.__gta.pedState(o.i);
  const dump = [];
  const m = new (window.__scn.matrixWorld.constructor)();   // getMatrixAt 要真 Matrix4:借 Object3D.matrixWorld 的构造器
  window.__scn.traverse((ob) => {
    if (!ob.isInstancedMesh || ob.count <= o.i) return;
    ob.getMatrixAt(o.i, m);
    const E = m.elements;
    dump.push([
      ob.geometry.type, 'n=' + ob.count,
      'pos=' + [E[12], E[13], E[14]].map((v) => v.toFixed(1)).join(','),
      'sx=' + Math.hypot(E[0], E[1], E[2]).toFixed(2),
      'sy=' + Math.hypot(E[4], E[5], E[6]).toFixed(2),
      'sz=' + Math.hypot(E[8], E[9], E[10]).toFixed(2),
    ].join(' '));
  });
  return { st: p.st, x: +p.x.toFixed(1), z: +p.z.toFixed(1), dump };
}, t);
console.log('目标 st', out.st, '逻辑位置', out.x, out.z);
for (const r of out.dump) console.log('  ', r);
await browser.close();
