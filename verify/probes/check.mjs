import puppeteer from 'puppeteer-core';

const GAME = 'http://127.0.0.1:8017/';
const AUTO = GAME + '?autostart&autopilot';
const MANUAL = GAME + '?autostart';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const logs = [];
let failed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
         '--enable-unsafe-swiftshader', '--window-size=1400,860'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 860 });
page.on('console', (m) => {
  const t = m.text();
  if (/AudioContext was not allowed/.test(t)) return;
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${t}`);
});
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));

const hud = () => page.evaluate(() => ({
  score: +document.getElementById('score').textContent || 0,
  lives: document.getElementById('lives').textContent,
  boost: document.getElementById('boost').textContent,
  veil: !document.getElementById('veil').hidden,
  over: document.getElementById('v-title').textContent,
  num: document.getElementById('v-num').textContent,
  best: document.getElementById('best').textContent,
}));
const rf = () => page.evaluate(() => ({ ...window.__rf }));

// —— 自动驾驶模式下:游戏确实在跑、在追环、在计分 ——
await page.goto(AUTO, { waitUntil: 'load', timeout: 30000 });
check('无 JS 报错', await page.evaluate(() => !document.querySelector('.err')));
const a = await rf();
check('调试快照可读', a.state === 'play' && a.ringCount > 0 && a.autopilot === true,
      `state=${a.state} 环=${a.ringCount} autopilot=${a.autopilot}`);
await sleep(7000);
const b = await rf();
check('自动驾驶对准环中心', Math.hypot(b.px - b.next.x, b.py - b.next.y) < b.next.rad * 0.5,
      `偏差 ${Math.hypot(b.px - b.next.x, b.py - b.next.y).toFixed(2)} / r=${b.next.rad}`);
check('持续过环计分', b.score > a.score, `得分 ${a.score} -> ${b.score}`);
check('连击累积', b.combo >= 2, `combo=${b.combo}`);
check('速度随时间上升', b.speed > a.speed, `${a.speed} -> ${b.speed}`);
await page.screenshot({ path: import.meta.dirname + '/../shots/01-auto.png' });

// —— 推进键 ——
await page.keyboard.down('Shift');
await sleep(250);
const boosting = (await hud()).boost;
await page.keyboard.up('Shift');
await sleep(250);
check('Shift 触发推进后复位', /×2/.test(boosting) && !/×2/.test((await hud()).boost), `按下时 "${boosting}"`);

// —— 帧率(软件渲染参照)——
const fps = await page.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(tick)
    : res((n * 1000 / (performance.now() - t0)).toFixed(0)); };
  requestAnimationFrame(tick);
}));
check('帧率 >= 30(软件渲染参照)', +fps >= 30, `${fps} fps`);

// —— 关掉自动驾驶 -> 不转向 -> 漏环扣命 -> 结束 -> 分数入库 ——
await page.keyboard.press('p');
await sleep(300);
check('P 键可关掉自动驾驶', (await rf()).autopilot === false);
const banked = (await rf()).score;
const deadline = Date.now() + 45000;
let st = await hud();
while (Date.now() < deadline && !st.veil) { await sleep(500); st = await hud(); }
check('漏环扣命直至结束', st.veil && st.over === '结束' && st.lives === '○○○',
      `title=${st.over} lives=${st.lives} 分数=${st.num}`);
await page.screenshot({ path: import.meta.dirname + '/../shots/02-over.png' });
const stored = await page.evaluate(() => localStorage.getItem('ringflight_best'));
check('有分数时最高分才入库', +stored === +st.num && +stored > 0,
      `本局 ${st.num}(结束前已得 ${banked}) localStorage=${stored}`);
await page.reload({ waitUntil: 'load' });
await sleep(500);
check('刷新后仍记得最高分', +(await hud()).best === +stored, `best=${(await hud()).best}`);

// —— 重新开始 ——
await page.keyboard.press('r');
await sleep(400);
const rs = await hud();
check('R 键重新开始', rs.score === 0 && !rs.veil && rs.lives === '●●●',
      `score=${rs.score} veil=${rs.veil} lives=${rs.lives}`);

// —— 方向键(刚才那个 bug 的回归测试)——
await page.goto(MANUAL, { waitUntil: 'load' });
await sleep(900);
for (const [key, axis, dir] of [['ArrowLeft', 'px', -1], ['ArrowRight', 'px', 1], ['ArrowUp', 'py', 1]]) {
  const before = (await rf())[axis];
  await page.keyboard.down(key);
  await sleep(900);
  await page.keyboard.up(key);
  const after = (await rf())[axis];
  check(`${key} 能驾驶(${axis} 朝 ${dir > 0 ? '正' : '负'}向移动)`,
        (after - before) * dir > 1, `${axis} ${before} -> ${after}`);
}
await page.screenshot({ path: import.meta.dirname + '/../shots/03-manual.png' });

// —— 网络干净 ——
const net404 = logs.filter((l) => /404/.test(l));
check('没有 404(含 favicon)', net404.length === 0, net404.join(' | '));

console.log('\n控制台报错/警告:', logs.length ? '\n  ' + logs.slice(0, 12).join('\n  ') : '无');
console.log(failed ? `\n${failed} 项未通过` : '\n全部通过');
await browser.close();
process.exit(failed ? 1 : 0);
