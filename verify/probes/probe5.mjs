// 碾人横穿方案的可靠性:一轮页面里连做 3 次,每次重新找横穿者,失败打出末距/车速/坐标
import puppeteer from 'puppeteer-core';
const URL = 'http://127.0.0.1:8017/gta/?autostart&noshadow';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 640, height: 420 });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await sleep(3000);

for (let trial = 1; trial <= 3; trial++) {
  let rtgt = null;
  const tryT0 = Date.now();
  while (!rtgt && Date.now() - tryT0 < 12000) {
    rtgt = await page.evaluate(() => {
      const G = window.__gta, p = G.nearestCrossingPed();
      if (!p) return null;
      const sx = p.x + p.vx * 5, sz = p.z + p.vz * 5;
      G.spawnAt(sx, sz, Math.atan2(-p.vx, -p.vz));
      return { i: p.i, hits0: G.pedHitsN, sx: +sx.toFixed(1), sz: +sz.toFixed(1), px: p.x, pz: p.z };
    });
    if (!rtgt) await sleep(800);
  }
  if (!rtgt) { console.log(`trial${trial}: 12 秒没蹲到横穿者`); continue; }
  await page.keyboard.down('ArrowUp');
  let rs = null;
  const t0 = Date.now();
  const samples = [];
  while (Date.now() - t0 < 9000) {
    rs = await page.evaluate((t) => {
      const G = window.__gta, s = G.pedState(t.i);
      return { st: s.st, hits: G.pedHitsN, d: +Math.hypot(G.x - s.x, G.z - s.z).toFixed(1),
               spd: +G.speed.toFixed(1), cross: s.cross, panic: s.panic };
    }, rtgt);
    samples.push(`${rs.d}/${rs.spd}/${rs.st}${rs.cross ? 'c' : ''}${rs.panic > 0 ? 'P' : ''}`);
    if (rs.st === 2) break;
    await sleep(250);
  }
  await page.keyboard.up('ArrowUp');
  console.log(`trial${trial} ${rs.st === 2 ? 'HIT' : 'MISS'} hits+${rs.hits - rtgt.hits0} 摆位(${rtgt.sx},${rtgt.sz}) 人(${rtgt.px},${rtgt.pz})`,
              rs.st === 2 ? '' : samples.join(' '));
}
console.log('hits total', await page.evaluate(() => window.__gta.pedHitsN));
await browser.close();
