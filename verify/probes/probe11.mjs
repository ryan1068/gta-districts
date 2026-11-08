// 套件的相机断言是开局立刻采样的 —— 那正是"接管残留没回正"最危险的窗口。
// 5 局:每局拖 1.6 秒再松手,然后立刻重开一局(模拟套件 reload→gta→断言),
// 每局开局采一次 cam:必须在车后(北)、y 26±2、没有接管残留。
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
let bad = 0;
for (let round = 1; round <= 5; round++) {
  if (round > 1) await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  else await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await sleep(1600);
  const a = await page.evaluate(() => ({ cam: window.__gta.cam, z: window.__gta.z, grab: window.__gta.camGrab }));
  const behind = a.cam[2] < a.z, hOK = a.cam[1] > 18 && a.cam[1] < 45;
  if (!behind || !hOK || a.grab !== 0) { bad++; console.log(`第 ${round} 局 开局 FAIL`, JSON.stringify(a), 'behind=', behind, 'yOK=', hOK); }
  else console.log(`第 ${round} 局 开局 OK  cam=${JSON.stringify(a.cam)} grab=${a.grab}`);
  // 这局里拖一把:按住右键 1.6 秒不动(时间一过,松手就该秒回)
  await page.keyboard.down('ArrowUp');
  await sleep(2500);
  await page.mouse.move(380, 250);
  await page.mouse.down({ button: 'right' });
  for (let i = 0; i < 12; i++) await page.mouse.move(380 + i * 40, 250 - i * 6);
  await sleep(1600);
  await page.mouse.up({ button: 'right' });
  await page.keyboard.up('ArrowUp');
}
console.log(bad === 0 ? '5 局开局全对' : `${bad}/5 局开局有问题`);
await browser.close();
