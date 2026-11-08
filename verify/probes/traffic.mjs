import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.setViewport({ width: 820, height: 520, deviceScaleFactor: 1 });
await p.goto('http://127.0.0.1:8017/gta/?autostart&noshadow', { waitUntil: 'load' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = () => p.evaluate(() => window.__gta.raf.frames);
async function waitFrames(n) { const f = await frames(); for (let i = 0; i < 500; i++) { if (await frames() - f >= n) return; await sleep(120); } }
const snap = () => p.evaluate(() => ({
  n: window.__gta.traffic, moving: window.__gta.trafficMoving, lane: window.__gta.trafficInLane,
  bld: window.__gta.trafficInBuildings, oob: window.__gta.trafficOutOfBounds,
  turns: window.__gta.trafficTurns,
  off: window.__gta.offLaneReport ? window.__gta.offLaneReport() : null,
  spds: window.__gta.cars.filter((c) => !c.blanked).length,
  trace: window.__gta.traceTraffic ? window.__gta.traceTraffic() : null,
}));
await waitFrames(30);
const a = await snap();
const tr0 = await p.evaluate(() => window.__gta.trace ? window.__gta.trace() : null);
await waitFrames(120);                                  // ≈ 6 秒游戏时间
const c = await snap();
await p.screenshot({ path: import.meta.dirname + '/../shots/u-traffic.png' });
await waitFrames(120);
const d = await snap();
console.log(JSON.stringify({ 开始: a, 六秒后: c, 十二秒后: d, errs }, null, 1));
await b.close();
