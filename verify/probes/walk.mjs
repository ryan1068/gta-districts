import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage();
await p.setViewport({ width: 1200, height: 760 });
await p.goto('http://127.0.0.1:8017/gta/?autostart', { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 800));
const s = async (tag) => {
  const g = await p.evaluate(() => ({ x: window.__gta.x, z: window.__gta.z, near: window.__gta.nearCar, mode: window.__gta.mode, inside: window.__gta.insideSolid }));
  console.log(`${tag.padEnd(14)} mode=${g.mode} 人=(${g.x.toFixed(1)},${g.z.toFixed(1)}) 距车=${g.near} 卡在实体里=${g.inside}`);
  return g;
};
await s('开局');
await p.keyboard.press('f'); await new Promise((r) => setTimeout(r, 300)); await s('下车后');
await p.keyboard.down('ArrowUp');
for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 250)); await s(`上行+${(i+1)*250}ms`); }
await p.keyboard.up('ArrowUp');
await p.keyboard.down('ArrowDown');
for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 250)); await s(`下行+${(i+1)*250}ms`); }
await p.keyboard.up('ArrowDown');
await p.keyboard.press('f'); await new Promise((r) => setTimeout(r, 300)); await s('再按F');
await b.close();
