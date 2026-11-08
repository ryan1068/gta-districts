import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage();
await p.goto('http://127.0.0.1:8017/gta/?autostart&noshadow', { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));
const out = await p.evaluate(() => {
  const G = window.__gta;
  const near = G.cars.filter((c) => Math.hypot(c.x - G.x, c.z - G.z) < 9 && !c.blanked)
    .map((c) => ({ i: c.i, type: c.type, x: c.x, z: c.z, d: +Math.hypot(c.x - G.x, c.z - G.z).toFixed(1) }));
  // 路口 ±7 之内停了几辆?道路中心线在 60i-210 上
  let inJunction = 0;
  for (const c of G.cars) {
    const dx = Math.abs(((c.x + 210) % 60 + 60) % 60), dz = Math.abs(((c.z + 210) % 60 + 60) % 60);
    const jx = Math.min(dx, 60 - dx), jz = Math.min(dz, 60 - dz);
    if (jx < 7 && jz < 7) inJunction++;
  }
  return { spawn: [G.x, G.z], insideSolid: G.insideSolid, near, inJunction, total: G.carCount, types: G.carTypes };
});
console.log(JSON.stringify(out, null, 1));
await b.close();
