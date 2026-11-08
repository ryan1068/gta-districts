// 让行不再吞接管:按住右键拖 2 秒,期间车被让行刹停再开走(低速爬 2.5 秒),
// 相机 yaw 必须还带着接管(userYaw 感觉得到:相机 z 明显偏出"正后方")。
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
await sleep(2500);
// 直线开到被前方拦停(车流会刹停让路),再低速跟车 —— 车一动,旧版接管就会被"掉头判定"吞掉
await page.mouse.move(380, 250);
await page.keyboard.down('ArrowUp');
await page.mouse.down({ button: 'right' });
for (let i = 0; i < 8; i++) await page.mouse.move(380 + i * 30, 250);   // 慢速横拖 240px,接管 ~1.4rad
const s1 = await page.evaluate(() => ({ cam: window.__gta.cam, z: window.__gta.z, x: window.__gta.x, spd: window.__gta.speed }));
await sleep(2500);                                                        // 期间持续低速前进
await page.mouse.up({ button: 'right' });
const s2 = await page.evaluate(() => ({ cam: window.__gta.cam, z: window.__gta.z, x: window.__gta.x, spd: window.__gta.speed }));
await sleep(400);
const s3 = await page.evaluate(() => ({ cam: window.__gta.cam, z: window.__gta.z }));
// 接管在:车朝南开,相机相对车偏移的 z 差应该明显小于"正后方式"的差(正后方:camZ 比 z 小 20+)
console.log('拖时', JSON.stringify(s1), '\n2.5 秒后(没松手)', JSON.stringify(s2), '\n松手后', JSON.stringify(s3));
const off1 = s2.z - s2.cam[2];   // 正后方时这个差 ≈ +horiz(20~26);被拖走会明显变小甚至翻负
console.log(off1 < 15 ? `接管保住了(z-camZ=${off1.toFixed(1)};正后方该是 20 上下)` : `接管疑似被吞(z-camZ=${off1.toFixed(1)})`);
await page.screenshot({ path: import.meta.dirname + '/../shots/p12.png' });
await page.keyboard.up('ArrowUp');
await browser.close();
