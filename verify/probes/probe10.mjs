// 自由视角(A 档)手动验证:按住右键拖 200 像素 → 相机 yaw 明显转走;
// 拖到墙上验证不穿楼;松手 → 回正。每步截图肉眼可查。
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

// 直线开一会儿,让相机稳在车尾
await page.keyboard.down('ArrowUp'); await sleep(4000); await page.keyboard.up('ArrowUp');
const before = await page.evaluate(() => window.__gta.cam);

// 右键按住往右拖 200px
await page.mouse.move(380, 250);
await page.mouse.down({ button: 'right' });
for (let i = 0; i < 10; i++) await page.mouse.move(380 + i * 20, 250 - i * 4);
await sleep(400);
const drag = await page.evaluate(() => window.__gta.cam);
await page.screenshot({ path: import.meta.dirname + '/../shots/p10-drag.png' });
console.log('拖拽中: 相机 y', before[1], '->', drag[1], '  车 z', await page.evaluate(() => +window.__gta.z.toFixed(1)),
  '  接管', await page.evaluate(() => window.__gta.camGrab));

// 先狂拖 1400px 把俯角顶到上限 36°(软渲染 ~30fps,每次 move 隔一帧生效,
// 按 ~0.4 帧/move 折算,1400px 也就 4rad —— 顶到夹缝),再横拖 1200px 绕到楼那一侧:
// 这是"低机位 + 视线扫过街区"最容易穿楼的角度。
for (let i = 0; i < 14; i++) await page.mouse.move(380 + 200 + i * 100, 250 - i * 8);
await sleep(300);
for (let i = 0; i < 24; i++) await page.mouse.move(380 + 1600 + i * 50, 250);
await sleep(500);
const far = await page.evaluate(() => ({ cam: window.__gta.cam, pos: [window.__gta.x, window.__gta.z] }));
await page.screenshot({ path: import.meta.dirname + '/../shots/p10-around.png' });
console.log('低机位绕半圈: 相机', far.cam, '人', far.pos.map((v) => +v.toFixed(1)));

// 滚轮拉近
await page.mouse.wheel({ deltaY: -600 });
await sleep(500);
console.log('拉近后 相机 y =', (await page.evaluate(() => window.__gta.cam))[1]);
await page.screenshot({ path: import.meta.dirname + '/../shots/p10-zoom.png' });

await page.mouse.up({ button: 'right' });
// 松手:2 秒后应该几乎回正(接管量回到 ~0)
await sleep(2600);
console.log('回正中 camGrab =', await page.evaluate(() => window.__gta.camGrab));
await sleep(3000);
console.log('再等 3 秒 camGrab =', await page.evaluate(() => window.__gta.camGrab));
await page.screenshot({ path: import.meta.dirname + '/../shots/p10-rec.png' });
await browser.close();
