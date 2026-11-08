// 行人系统冒烟:统计 / 散步位移 / 逼响 / 碾压甩飞 / 开销
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

const stat = await page.evaluate(() => {
  const G = window.__gta;
  return { n: G.pedCount, bld: G.pedsInBuildings, oob: G.pedsOutBounds,
    crossing: G.pedsCrossing, panic: G.pedsPanic, down: G.pedsDown, hits: G.pedHitsN };
});
console.log('stats', JSON.stringify(stat));

const moved = await page.evaluate(async () => {
  const G = window.__gta;
  const a = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => G.pedState(i));
  await new Promise((r) => setTimeout(r, 3000));
  const b = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => G.pedState(i));
  return a.filter((p, k) => Math.hypot(b[k].x - p.x, b[k].z - p.z) > 0.5).length;
});
console.log('散步 8 人中 3 秒内动了:', moved);

// 逼响:摆到散步者正后方 6 米,轻油门凑近
const buzz = await page.evaluate(() => {
  const G = window.__gta, p = G.nearestPed();
  if (!p) return null;
  G.spawnAt(p.x, p.z - 6, Math.atan2(0, 1));                 // 车头 +z 朝着人(人在 +z 方向)
  return p;
});
if (buzz) {
  await page.keyboard.down('ArrowUp');
  await sleep(1500);
  await page.keyboard.up('ArrowUp');
  await sleep(600);
  const panic = await page.evaluate((o) => {
    const G = window.__gta, s = G.pedState(o.i);
    return { panicAll: G.pedsPanic, me: s, d: +Math.hypot(G.x - s.x, G.z - s.z).toFixed(1) };
  }, buzz);
  console.log('逼响:', JSON.stringify(panic));

  // 碾压:换一个散步者,摆到正后方 10 米,油门顶过去
  const run = await page.evaluate(() => {
    const G = window.__gta, p = G.nearestPed();
    if (!p) return null;
    G.spawnAt(p.x, p.z - 10, Math.atan2(0, 1));
    return p;
  });
  if (run) {
    await page.keyboard.down('ArrowUp');
    const t0 = Date.now();
    let st = null;
    while (Date.now() - t0 < 9000) {
      await sleep(400);
      st = await page.evaluate((o) => window.__gta.pedState(o.i), run);
      if (st && st.st === 2) break;
    }
    await page.keyboard.up('ArrowUp');
    console.log('碾压后:', JSON.stringify(st), await page.evaluate(() => ({
      hits: window.__gta.pedHitsN, down: window.__gta.pedsDown })));
    await page.screenshot({ path: import.meta.dirname + '/../shots/w1-peds.png' });
  }
}
console.log('开销:', await page.evaluate(() => ({ calls: window.__gta.perf ? window.__gta.perf.calls : window.__gta.drawCalls, tris: window.__gta.perf ? window.__gta.perf.tris : window.__gta.triangles })));
await browser.close();
