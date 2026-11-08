// 单点复现"吃我一拳 FAIL 蹲下0":A) 摆位后立刻 punchNow;B) 摆位 + 墙钟 700ms 后 punchNow;
// C) 摆位 + 700ms 后真按 g。三种各 5 次 —— 哪档挂,锅就在哪层(锥/半径 vs 靶子游走 vs 按键链)
import puppeteer from 'puppeteer-core';
const URL = 'http://127.0.0.1:8017/gta/?autostart&noshadow';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 640, height: 480 });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await sleep(3500);
await page.keyboard.press('f');                          // 下车
await sleep(900);
const aim = () => page.evaluate(() => {
  const G = window.__gta, p = G.nearestPed();
  if (!p) return null;
  const sx = p.x + p.ox * 1.6, sz = p.z + p.oz * 1.6;
  G.standAt(sx, sz, Math.atan2(p.x - sx, p.z - sz));
  return { i: p.i, d: Math.hypot(p.x - sx, p.z - sz) };
});
const stats = { A: 0, B: 0, C: 0 };
const detail = [];
for (let t = 0; t < 5; t++) {
  // A:立刻 punchNow
  let a = await aim();
  if (!a) break;
  stats.A += await page.evaluate(() => window.__gta.punchNow()) > 0 ? 1 : 0;
  await sleep(700);
  // B:700 墙钟后 punchNow(重瞄)
  let b = await aim();
  if (!b) break;
  await sleep(700);
  const nB = await page.evaluate((o) => {
    const G = window.__gta, p = G.pedState(o.i);
    const d = Math.hypot(p.x - G.x, p.z - G.z);
    return { n: G.punchNow(), d };
  }, b);
  stats.B += nB.n > 0 ? 1 : 0;
  if (nB.n === 0) detail.push(`B${t}:按拳时靶子距 ${nB.d.toFixed(1)} 米(瞄准时 ${b.d.toFixed(1)})`);
  await sleep(700);
  // C:700 墙钟后真按 g(重瞄)
  let c = await aim();
  if (!c) break;
  await sleep(700);
  await page.keyboard.press('g');
  const nC = await page.evaluate((o) => {
    const G = window.__gta, p = G.pedState(o.i);
    return { n: G.pedsCrouched, d: +Math.hypot(p.x - G.x, p.z - G.z).toFixed(1), st: p.st };
  }, c);
  stats.C += nC.n > 0 ? 1 : 0;
  if (nC.n === 0) detail.push(`C${t}:按 g 时靶子距 ${nC.d} 米 st=${nC.st}(瞄准时 ${c.d.toFixed(1)})`);
  await sleep(700);
}
console.log('A 立刻 punchNow:', stats.A + '/5', '| B 700ms 后 punchNow:', stats.B + '/5', '| C 700ms 后真按 g:', stats.C + '/5');
for (const d of detail) console.log('  ', d);
await browser.close();
