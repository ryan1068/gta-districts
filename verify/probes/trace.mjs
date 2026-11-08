import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.setViewport({ width: 500, height: 340, deviceScaleFactor: 1 });
await p.goto('http://127.0.0.1:8017/gta/?autostart&noshadow', { waitUntil: 'load' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = () => p.evaluate(() => window.__gta.raf.frames);
async function waitFrames(n) { const f = await frames(); for (let i = 0; i < 600; i++) { if (await frames() - f >= n) return; await sleep(100); } }
await waitFrames(40);
const target = await p.evaluate(() => {
  const off = window.__gta.offLaneReport();
  return off.length ? off[0].i : -1;
});
console.log('追踪车辆 #' + target);
await p.evaluate((i) => window.__gta.traceCar(i), target);
await waitFrames(14);
const log = await p.evaluate(() => window.__gta.traceLog);
await p.evaluate(() => window.__gta.clearTrace());
const st = await p.evaluate((i) => ({ trafficAI: window.__gta.carTrafficAI(i) }), target);
console.log(log.map((r) => JSON.stringify(r)).join('\n'));
const last = log[log.length - 1];
const near = await p.evaluate((pt) => ({
  push: +window.__gta.peakDriftAt(pt).toFixed(2),
  hits: window.__gta.solidsNear(pt.x, pt.z, 1.6),
}), { x: last.x, z: last.z });
console.log('终态', JSON.stringify(st), '位置', near.at, 'ry', near.ry, '本帧被顶', near.push);
console.log('压着的障碍:', JSON.stringify(near.hits, null, 1));
await b.close();
