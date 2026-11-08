// 复现顶车组:null/冻结路径探测 —— yield watch + ram + jumpToType,跑 5 轮看哪轮出 null
import puppeteer from 'puppeteer-core';
const URL = 'http://127.0.0.1:8017/gta/?autostart&noshadow';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 380 });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await sleep(3000);

for (let round = 1; round <= 5; round++) {
  const t = await page.evaluate(() => {
    const G = window.__gta;
    const q = G.nearestTrafficLong() || G.nearestTraffic();
    if (!q) return null;
    const fx = Math.sin(q.ry), fz = Math.cos(q.ry);
    G.spawnAt(q.x + fx * 11, q.z + fz * 11, q.ry + Math.PI);
    q.hits0 = G.hits;
    return q;
  });
  if (!t) { console.log(`R${round}: 无流车目标`); continue; }
  // 逼近观测
  let stopped = false;
  const wT0 = Date.now();
  let prevD = 999;
  while (Date.now() - wT0 < 10000) {
    const s = await page.evaluate((o) => {
      const G = window.__gta, c = G.carState(o.i);
      return c ? { d: +Math.hypot(G.x - c.x, G.z - c.z).toFixed(1), spd: c.spd } : null;
    }, t);
    if (s === null) { console.log(`R${round}: WATCH carState null! i=${t.i} count=${await page.evaluate(() => window.__gta.carCount)}`); break; }
    const on = s.d < 30 && s.d <= prevD + 0.5;
    prevD = s.d;
    if (on && s.d < 9 && s.spd < 1.5) { stopped = true; break; }
    if (s.d > prevD + 10) break;
    await sleep(300);
  }
  // 顶车(和套件同步:不换车、carState 摘要没有 i 要从 o.i 补)
  const tgt2 = await page.evaluate((o) => {
    const G = window.__gta;
    const q = G.carState(o.i);
    if (!q) return { fail: 'carState null', i: o.i, count: G.carCount };
    const fx = Math.sin(q.ry), fz = Math.cos(q.ry);
    G.spawnAt(q.x - fx * 14, q.z - fz * 14, q.ry);
    return { i: o.i, x: q.x, z: q.z, fwd: G.forward };
  }, t);
  if (tgt2.fail) { console.log(`R${round}: 顶车摆位失败`, JSON.stringify(tgt2)); continue; }
  await sleep(1200);
  await page.keyboard.down('ArrowUp');
  await sleep(3000);
  await page.keyboard.up('ArrowUp');
  const a = await page.evaluate((o) => {
    const G = window.__gta, c = G.carState(o.i);
    if (!c) return { fail: 'carState null after ram', i: o.i, count: G.carCount,
      wasJumped: o.jumped, mode: G.mode, blanked: G.cars.filter((x) => x.blanked).map((x) => x.i) };
    return { i: o.i, moved: +Math.hypot(c.x - o.x, c.z - o.z).toFixed(1), spd: c.spd, hits: G.hits };
  }, tgt2);
  console.log(`R${round} stop=${stopped}`, JSON.stringify(a));
  await sleep(1500);
}
await browser.close();
