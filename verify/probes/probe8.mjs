// 泊位密度核查:全城停了多少辆、单段行最多连排几辆;顺带截图看街味
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
await sleep(3000);
console.log(await page.evaluate(() => {
  const G = window.__gta;
  const parked = G.cars.filter((c) => !c.traffic && !c.blanked);
  // 行聚类:路肩泊位离道路中线 5.3 米( CURB=7−1.7),按 60 米网格吸附"在哪条街、哪一侧",
  // 再按行内前向坐标排序,数最长连排(后车在前车 13 米内算同排)
  const key = (a) => Math.round((a + 210) / 60) * 60 - 210;
  const rows = new Map();
  for (const c of parked) {
    const nearX = Math.abs(((c.x + 210) % 60 + 60) % 60 - 30) < 14;   // 贴着 x=中线±…
    const onVert = Math.abs(Math.abs(((c.x + 210) % 60 + 60) % 60 - 30) - 5.3) < 1.2
                || Math.abs(Math.abs(((c.x + 210) % 60 + 60) % 60 - 30) - (60 - 5.3)) < 1.2;
    const onHoriz = Math.abs(Math.abs(((c.z + 210) % 60 + 60) % 60 - 30) - 5.3) < 1.2
                 || Math.abs(Math.abs(((c.z + 210) % 60 + 60) % 60 - 30) - (60 - 5.3)) < 1.2;
    if (onVert) { const k = 'v' + key(c.x) + (c.x > key(c.x) ? '+' : '-'); (rows.get(k) || rows.set(k, []).get(k)).push(c.z); }
    else if (onHoriz) { const k = 'h' + key(c.z) + (c.z > key(c.z) ? '+' : '-'); (rows.get(k) || rows.set(k, []).get(k)).push(c.x); }
  }
  let maxRun = 0, runs = [];
  for (const arr of rows.values()) {
    arr.sort((a, b) => a - b);
    let run = 1, best = 1;
    for (let i = 1; i < arr.length; i++) { run = arr[i] - arr[i - 1] < 13 ? run + 1 : 1; best = Math.max(best, run); }
    maxRun = Math.max(maxRun, best); runs.push(best);
  }
  runs.sort((a, b) => b - a);
  return { total: G.carCount, parked: parked.length, traffic: G.traffic, maxRun, topRuns: runs.slice(0, 6) };
}));
// 车视角穿行一条街:看泊位零散度
await page.evaluate(() => {
  const G = window.__gta; G.spawnAt(-30, -180, 0);   // 沿 x=-30 这条线直行
});
await page.keyboard.down('ArrowUp');
await sleep(4500);
await page.keyboard.up('ArrowUp');
await page.screenshot({ path: import.meta.dirname + '/../shots/p8-street.png' });
await browser.close();
