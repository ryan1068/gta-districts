// 灯杆到底栽没栽在路中间:按游戏同一公式重现杆位,测每根杆到最近道路中线的距离
// (道路中线:横路 z=camPath(j)、竖路 x=camPath(i),路面半宽 ROAD/2=7;
//  人行道应该是 |距离-7| ≥ 0;落在 |d|<6.8 = 明显在铺装/车道上)
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8017/gta/?autostart&noshadow';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 400, height: 300 });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto(`${BASE}&seed=${process.env.SEED || 'abcd'}`, { waitUntil: 'load' });
await sleep(2500);
const r = await page.evaluate(() => {
  const HALF = 210, ROAD = 14, GRID = 7, PERIOD = 60;
  const camPath = (i) => -HALF + i * PERIOD;
  const spots = [];
  for (let i = 0; i <= GRID; i++) for (let s = -HALF + 12; s < HALF - 12; s += 26) {
    const nearCross = Math.abs(s - (Math.round((s + HALF) / 60) * 60 - HALF));
    if (nearCross < 13) continue;
    for (const side of [1, -1]) {
      const off = (ROAD / 2 + 2.4) * side;
      spots.push([camPath(i) + off, s]);
      spots.push([s, camPath(i) + off]);
    }
  }
  // 每根杆到最近中线的距离
  const dmin = (x, z) => {
    let d = 1e9;
    for (let j = 0; j <= GRID; j++) {
      d = Math.min(d, Math.abs(z - camPath(j)), Math.abs(x - camPath(j)));
    }
    return d;
  };
  const bad = spots.filter(([x, z]) => dmin(x, z) < ROAD / 2 - 0.2);
  // 也统计"正好在另一条路中线附近"的(横穿马路中线 = 最扎眼的"路中间")
  const onCenter = spots.filter(([x, z]) => {
    for (let j = 0; j <= GRID; j++) {
      if (Math.abs(z - camPath(j)) < 0.3 || Math.abs(x - camPath(j)) < 0.3) return true;
    }
    return false;
  });
  return { total: spots.length, bad: bad.length, onCenter: onCenter.length, sample: bad.slice(0, 6) };
});
console.log(`杆总数 ${r.total},压在铺装里的 ${r.bad},贴着别路中线的 ${r.onCenter}`, r.sample.length ? `示例 ${JSON.stringify(r.sample)}` : '');
await browser.close();
