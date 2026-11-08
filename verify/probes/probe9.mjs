// 泊位行普查:按"泊位行的精确坐标"分组(x = 街道中线 ±5.3 的行、z = 中线 ±5.3 的行),
// 列出每辆停过的行和它的车数。用来定位 spawner 哪一步在丢车。
import puppeteer from 'puppeteer-core';
const URL = 'http://127.0.0.1:8017/gta/?autostart&noshadow';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 400, height: 300 });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await sleep(3000);
console.log(await page.evaluate(() => {
  const G = window.__gta;
  const parked = G.cars.filter((c) => !c.traffic && !c.blanked);
  const rows = new Map();
  const push = (k, v) => { if (!rows.has(k)) rows.set(k, []); rows.get(k).push(v); };
  for (const c of parked) {
    // 竖行(沿 Z 的路边):x 恰好 = camPath(a) ± 5.3 → (x+210) mod 60 ∈ {5.3, 54.7}
    const mx = ((c.x + 210) % 60 + 60) % 60, mz = ((c.z + 210) % 60 + 60) % 60;
    if (Math.abs(mx - 5.3) < 0.15 || Math.abs(mx - 54.7) < 0.15) push('v' + (Math.round((c.x + 210) / 60) * 60 - 210) + (mx < 30 ? '+' : '-'), c.z);
    else if (Math.abs(mz - 5.3) < 0.15 || Math.abs(mz - 54.7) < 0.15) push('h' + (Math.round((c.z + 210) / 60) * 60 - 210) + (mz < 30 ? '+' : '-'), c.x);
    else push('other', 0);
  }
  const hist = {};
  for (const [k, arr] of rows) {
    const n = arr.length;
    hist[n] = (hist[n] || 0) + 1;
  }
  const other = rows.get('other') || [];
  return { total: G.carCount, parked: parked.length, rows: rows.size - (other.length ? 1 : 0), hist, unmapped: other.length };
}));
await browser.close();
