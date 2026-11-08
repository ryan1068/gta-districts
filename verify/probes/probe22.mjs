// 跑 & 跳 smoke:①Shift 跑速 ②Space 跳的抛物线(峰值/落地)③空中补按 Space 不能二段跳
// ④跳着前进仍受 pushOut 约束(不穿楼)⑤开车里 Space 还是手刹、不跳
import puppeteer from 'puppeteer-core';
const URL = 'http://127.0.0.1:8017/gta/?autostart&noshadow' + (process.env.SEED ? '&seed=' + process.env.SEED : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!ok) failed++; };
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 640, height: 400 });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto(URL, { waitUntil: 'load' });
let TS = 1;
const syncTS = async () => { TS = Math.max(0.1, await page.evaluate(() => window.__gta.timeScale || 1)); };
const S = (ms) => Math.round(ms / TS);
await sleep(3000);
await syncTS();
const g = () => page.evaluate(() => ({ ...window.__gta }));
const cross = async () => {
  const o = await g();
  const x = Math.round((o.x + 210) / 60) * 60 - 210, z = Math.round((o.z + 210) / 60) * 60 - 210;
  await page.evaluate(([a, b]) => window.__gta.footAt(a, b), [x, z]);
  await sleep(S(500));
  return { x, z };
};
await page.keyboard.press('f');                    // 下车
await sleep(S(800));

// ① Shift 跑
await cross();
await page.keyboard.down('Shift'); await page.keyboard.down('w');
let sps = [], prev = await g(), t0 = prev.simT;
while (prev.simT - t0 < 2.2) { await sleep(S(350)); const s = await g();
  if (s.simT > prev.simT) sps.push(Math.hypot(s.x - prev.x, s.z - prev.z) / (s.simT - prev.simT)); prev = s; }
await page.keyboard.up('w'); await page.keyboard.up('Shift');
const run = Math.max(...sps, 0);
check('① Shift 跑得比走快', run > 7, `最快 ${run.toFixed(1)} 米/秒`);
// 走路对照组:同一段再来一次不按住 Shift
let wsps = []; prev = await g(); t0 = prev.simT;
await page.keyboard.down('w');
while (prev.simT - t0 < 1.6) { await sleep(S(350)); const s = await g();
  if (s.simT > prev.simT) wsps.push(Math.hypot(s.x - prev.x, s.z - prev.z) / (s.simT - prev.simT)); prev = s; }
await page.keyboard.up('w');
const walk = Math.max(...wsps, 0);
check('①b 走路对照组速度正常(5~7)', walk > 4.5 && walk < 7, `最快 ${walk.toFixed(1)} 米/秒`);

await syncTS();
// ②③ 跳:起跳 + 空中 0.3 仿真秒再敲一次(不该二段跳)
await cross();
await page.keyboard.press(' ');
await sleep(S(300));
await page.keyboard.press(' ');
let peak = 0, js = await g(), jT0 = js.simT, landed = false;
while (js.simT - jT0 < 3) {
  peak = Math.max(peak, js.jumpH);
  if (peak > 0.3 && js.jumpH <= 0.05) { landed = true; break; }
  await sleep(S(120)); js = await g();
}
check('② 跳有像样的抛物线并落回地面', peak > 0.5 && peak < 1.7 && landed, `峰值 ${peak.toFixed(2)} 米 ${landed ? '已落地' : '未落地'}`);
check('③ 空中补按不产生二段跳', peak < 1.4, `峰值 ${peak.toFixed(2)} 米(二段跳会 >1.8)`);

// ④ 跳着前进:整段跳里没被弹进楼(pushOut 还在管)
await cross();
let inSolid = false, prev4 = await g(), j4 = await g(), t4 = j4.simT;
await page.keyboard.down('w');
while (j4.simT - t4 < 2.5) {
  await page.keyboard.press(' ');
  await sleep(S(600));                       // 一个跳的滞空+落地间隙
  j4 = await g();
  const hAt = await page.evaluate(([x, z]) => window.__gta.solidHeightAt(x, z), [j4.x, j4.z]);
  if (hAt > 0.5 && j4.jumpH < 0.2) { /* 在实体脚下正常 */ }
  if (hAt > 0.5 && j4.jumpH < 0.05 && Math.hypot(j4.x - prev4.x, j4.z - prev4.z) < 0.05) inSolid = true;
  prev4 = j4;
}
await page.keyboard.up('w');
check('④ 连跳前进没被摁进实体里', !inSolid, inSolid ? '有一帧人停在楼里没被顶出来' : '每跳都在往外挪且没陷楼');

await syncTS();
// ⑤ 开车里 Space = 漂移,人不跳
{
  const o5 = await g();                        // 路口未必有 3.4 米内的车让 F 上(F 被拒是规则不是 bug),直接摁进驾驶座
  await page.evaluate(([x, z]) => window.__gta.spawnAt(x, z, 0), [o5.x, o5.z]);
  await sleep(S(800));
}
await page.keyboard.press(' ');
await sleep(S(500));
check('⑤ 开车时 Space 不跳(jumpH 恒 0)', (await g()).jumpH === 0, `jumpH ${(await g()).jumpH}`);

console.log(failed ? `${failed} 项未通过` : '全部通过');
await browser.close();
process.exit(failed ? 1 : 0);
