// 诊断"让车流车不动了":正对 11 米摆位后,每 400ms 采一条目标 AI 内部状态
import puppeteer from 'puppeteer-core';
const URL = 'http://127.0.0.1:8017/gta/?autostart&noshadow';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 380 });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await new Promise((r) => setTimeout(r, 3000));

const tgt = await page.evaluate(() => {
  const G = window.__gta;
  const t = G.nearestTrafficLong() || G.nearestTraffic();
  if (!t) return null;
  const fx = Math.sin(t.ry), fz = Math.cos(t.ry);
  G.spawnAt(t.x + fx * 11, t.z + fz * 11, t.ry + Math.PI);
  return t;
});
console.log('target', JSON.stringify(tgt));
if (tgt) {
  const t0 = Date.now();
  for (let k = 0; k < 22; k++) {
    const s = await page.evaluate((o) => {
      const G = window.__gta, c = G.carState(o.i), me = { x: G.x, z: G.z, spd: G.speed };
      return { t: Math.round(performance.now() / 100) / 10, d: +Math.hypot(me.x - c.x, me.z - c.z).toFixed(1),
        spd: c.spd, want: c.want, cruise: c.cruise, stuck: c.stuck, esc: c.escalate,
        turn: c.turn, ai: c.trafficAI, bl: c.blanked, axis: c.axis, dir: c.dir,
        dx: +(c.x - o.x).toFixed(1), dz: +(c.z - o.z).toFixed(1), frames: G.raf.frames };
    }, tgt);
    console.log(JSON.stringify(s));
    await new Promise((r) => setTimeout(r, 400));
  }
}
await browser.close();
