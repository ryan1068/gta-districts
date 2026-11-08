import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage();
await p.setViewport({ width: 900, height: 600, deviceScaleFactor: 2 });   // 2x 像素,裁出来的特写才不糊
await p.goto('http://127.0.0.1:8017/gta/?autostart', { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 2500));
await p.keyboard.press('f');                       // 下车
await new Promise((r) => setTimeout(r, 1200));
await p.keyboard.down('ArrowUp');                  // 走两步,让四肢摆起来
await new Promise((r) => setTimeout(r, 1800));
await p.keyboard.up('ArrowUp');
await new Promise((r) => setTimeout(r, 300));
const at = await p.evaluate(() => window.__gta.manScreen);
const info = await p.evaluate(() => ({ near: window.__gta.nearCar, carVis: window.__gta.carVisible }));
const size = 130;
await p.screenshot({
  path: import.meta.dirname + '/../shots/g8-man-zoom.png',
  clip: { x: Math.max(0, at.x - size), y: Math.max(0, at.y - size - 30), width: size * 2, height: size * 2 },
});
await p.screenshot({ path: import.meta.dirname + '/../shots/g9-onfoot-wide.png' });
console.log(JSON.stringify({ manScreen: at, ...info }));
await b.close();
