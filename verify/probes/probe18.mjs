// 对照试验:高负载机器上,全新城市的车流会不会"自己散开"。
// 每城纯挂到世界钟 +60 秒,采样 trafficMoving/wide阻塞 在 sim+20/40/60 三点。
// 若三城都散开 → 套件的墙钟观测窗在慢动作下不够用,该改世界钟;若越挂越堵 → 车流机制真回归。
import puppeteer from 'puppeteer-core';
const URL = 'http://127.0.0.1:8017/gta/?autostart&noshadow';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
for (let city = 1; city <= 2; city++) {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 480 });
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await sleep(3500);
  const g = () => page.evaluate(() => {
    const G = window.__gta;
    return { t: G.simT, mov: G.trafficMoving, tot: G.traffic, wide: G.trafficBlockedWide, lane: G.trafficInLane, fps: G.fps };
  });
  const marks = [];
  for (const target of [20, 40]) {
    for (;;) { const s = await g(); if (s.t >= target) { marks.push(s); break; } await sleep(200); }
  }
  const [a, b] = marks;
  console.log(`城市${city}: sim20s ${a.mov}/${a.tot}动 堵${a.wide} | sim40s ${b.mov}/${b.tot} 堵${b.wide} 车道${b.lane}/${b.tot} (世界钟 ${(b.t - a.t).toFixed(1)}s 推进)`);
  await page.close();
}
await browser.close();
