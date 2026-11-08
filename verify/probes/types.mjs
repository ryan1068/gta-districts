import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage();
await p.setViewport({ width: 780, height: 500, deviceScaleFactor: 2 });
await p.goto('http://127.0.0.1:8017/gta/?autostart&noshadow', { waitUntil: 'load' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = () => p.evaluate(() => window.__gta.raf.frames);
// 软渲染只有个位数 fps,墙上时间没有意义:等"跑了 N 帧"才等于游戏里过了 N*0.05 秒
async function waitFrames(n) {
  const from = await frames();
  for (let i = 0; i < 400; i++) { if (await frames() - from >= n) return; await sleep(150); }
}
await waitFrames(30);
await p.evaluate(() => { window.__gta.fov = 42; });
await waitFrames(30);
const out = [];
for (const [name, tag] of [['货车', 'van'], ['跑车', 'sport'], ['皮卡', 'pickup'], ['出租车', 'taxi']]) {
  await p.evaluate((n) => window.__gta.jumpToType(n), name);
  await waitFrames(70);                      // 70 帧 ≈ 3.5 秒游戏时间,镜头足够转到车后
  const type = await p.evaluate(() => window.__gta.carType);
  await p.screenshot({ path: import.meta.dirname + `/../shots/t-${tag}.png` });
  const at = await p.evaluate(() => window.__gta.carScreen);
  out.push(`${name} → 上手 ${type},车投在 ${at.x},${at.y}`);
}
console.log(out.join('\n'));
await b.close();
