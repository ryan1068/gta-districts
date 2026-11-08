import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage();
await p.setViewport({ width: 1400, height: 860 });
await p.goto('http://127.0.0.1:8017/gta/?autostart', { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 3000));
const perf = await p.evaluate(() => window.__gta.perf);
const ts = await p.evaluate(() => window.__gta.timeScale);
const fps = await p.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n++; performance.now() - t0 < 2500 ? requestAnimationFrame(tick)
    : res((n * 1000 / (performance.now() - t0)).toFixed(0)); };
  requestAnimationFrame(tick);
}));
console.log(JSON.stringify({ drawCalls: perf.calls, triangles: perf.tris, fpsSwiftShader: +fps, timeScale: ts }));
await b.close();
