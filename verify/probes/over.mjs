import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage();
await p.setViewport({ width: 1400, height: 860 });
await p.goto('http://127.0.0.1:8017/?autostart&autopilot', { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 4000));
await p.keyboard.press('p');                       // 关掉自动驾驶,让它漏环而死
const t = Date.now();
while (Date.now() - t < 40000) {
  if (await p.evaluate(() => !document.getElementById('veil').hidden)) break;
  await new Promise((r) => setTimeout(r, 400));
}
await p.screenshot({ path: import.meta.dirname + '/../shots/04-over-fixed.png' });
console.log('结束界面截图完成');
await b.close();
