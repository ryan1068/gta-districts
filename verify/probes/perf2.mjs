import puppeteer from 'puppeteer-core';
const variants = [
  ['1400x860 + 阴影(你现在看到的设置)', 1400, 860, ''],
  ['1400x860 无阴影', 1400, 860, '&noshadow'],
  ['760x500  无阴影(harness 用的)', 760, 500, '&noshadow'],
  ['760x500  有阴影', 760, 500, ''],
];
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
for (const [label, w, h, q] of variants) {
  const p = await b.newPage();
  await p.setViewport({ width: w, height: h });
  await p.goto('http://127.0.0.1:8017/gta/?autostart' + q, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1500));
  const fps = await p.evaluate(() => new Promise((res) => {
    let n = 0; const t0 = performance.now();
    const tick = () => { n++; performance.now() - t0 < 2500 ? requestAnimationFrame(tick)
      : res((n * 1000 / (performance.now() - t0)).toFixed(0)); };
    requestAnimationFrame(tick);
  }));
  const g = await p.evaluate(() => ({ perf: window.__gta.perf, ts: window.__gta.timeScale }));
  console.log(`${label.padEnd(38)} fps=${String(fps).padStart(3)}  时间流速=${g.ts}  绘制=${g.perf.calls} 次 / ${(g.perf.tris/1000).toFixed(0)}k 三角面`);
  await p.close();
}
await b.close();
