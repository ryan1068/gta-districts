// 步行·开车同款机位的实景截图:下车 → 沿两排楼之间的街走 3 仿真秒 → 抓渲染当帧
// (toDataURL 紧跟 render 后 = 游戏自己刚画的那一帧,不是合成器的旧画面 —— probe14 的教训)
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
const URL = 'http://127.0.0.1:8017/gta/?autostart&noshadow' + (process.env.SEED ? '&seed=' + process.env.SEED : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 600 });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await sleep(3500);
await page.evaluate(() => {
  const G = window.__gta;
  let n = 0;
  const orig = G.renderer.render.bind(G.renderer);
  G.renderer.render = (s, c) => { orig(s, c); if (++n % 2 === 0) window.__shot = G.renderer.domElement.toDataURL('image/png'); };
});
const ST = () => page.evaluate(() => window.__gta.simT);
const simWait = async (sec) => { const t0 = await ST(); for (;;) { if (await ST() - t0 >= sec) break; await sleep(120); } };
await page.keyboard.press('f');                           // 下车
await simWait(1.5);
await page.keyboard.down('w');                            // 沿街走 3 仿真秒再按快门
await simWait(3.0);
const data = await page.evaluate(() => window.__shot);
await page.keyboard.up('w');
writeFileSync(import.meta.dirname + '/../shots/walk-view.png', Buffer.from(data.split(',')[1], 'base64'));
console.log('已写 ' + import.meta.dirname + '/../shots/walk-view.png');
await browser.close();
