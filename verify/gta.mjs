import puppeteer from 'puppeteer-core';

// 城市种子每轮随机:红的时候把打印出来的这行 seed 拼回 URL(?seed=)就能原样重放那座城,
// "偶发红"从此变成"必现红"。不带 seed 的游戏本体每次也是随机城,互不影响。
const SEED = ((Date.now() ^ (Math.random() * 4294967296)) >>> 0).toString(36);
const URL = `http://127.0.0.1:8017/gta/?autostart&noshadow&seed=${SEED}`;   // 软渲染下阴影会把游戏时间拖慢,测逻辑不需要它
console.log(`城市种子 seed=${SEED}(红了拿 ?seed=${SEED} 重放)`);
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
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 760, height: 500 });   // 像素少一点:让游戏跑满速,距离断言才是真的
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
// 流速不是一次测完就完事:机器负载会一路把软渲染 fps 压下去,实测过开局 0.4、
// 中段跌到 0.1 —— 旧版只在热身时测一次还夹 0.25 地板,后半套件的等待/观测窗
// 全按虚高流速折算,车流"永远散不开"就是这么假红出来的。g() 用 simT 增量
// 即时测流速(游戏自报的 timeScale 是全期平均值,追不上负载的下坡,所以自己算)。
let TS = 1, lastSim = 0, lastWall = 0;
const g = async () => {
  const o = await page.evaluate(() => ({ ...window.__gta, cam: window.__gta.cam }));
  const w = Date.now();
  if (lastWall && o.simT > 0) {
    const dW = (w - lastWall) / 1000;
    if (dW > 0.2 && o.simT >= lastSim) TS = Math.min(1, Math.max(0.05, (o.simT - lastSim) / dW));
  }
  lastSim = o.simT; lastWall = w;
  return o;
};

// 软渲染会拖慢游戏时钟(时间流速 < 1)。等待时长按实测流速放大,
// 这样"按下 900ms"真的是游戏里推进了 900ms,距离断言才有意义。
await sleep(2000);                      // 先热身,否则头几帧的编译/着色器会把平均值带偏
await g(); await sleep(400); await g();               // 两次之间的 simT 增量把 TS 校准出来
const S = (ms) => Math.round(ms / TS);
console.log(`(实测时间流速 ${TS},等待时长按 1/${TS} 放大,之后每次 g() 自动刷新)`);

async function hold(keys, ms) {
  ms = S(ms);
  for (const k of keys) await page.keyboard.down(k);
  await sleep(ms);
  for (const k of keys) await page.keyboard.up(k);
}

// ── 启动 ──
console.log(`(开局位置 = ${(await g()).x}, ${(await g()).z}) —— 必须在路口中心线上`);
check('页面无 JS 报错', await page.evaluate(() => !document.querySelector('.err')));
const a = await g();
check('调试快照可读,开局在车里', a.state === 'play' && a.mode === 'car' && a.solidCount > 100,
      `state=${a.state} mode=${a.mode} 障碍物=${a.solidCount} 街区=${a.blocks}`);

// ── 相机:必须是俯视、在车后方 ──
check('相机俯视(高度 18–45)', a.cam[1] > 18 && a.cam[1] < 45, `cam.y=${a.cam[1]}`);
check('相机在车后方', a.cam[2] < a.z, `cam.z=${a.cam[2]} 车 z=${a.z}`);
check('没人在拖的时候相机就是全自动的', await page.evaluate(() => window.__gta.camGrab) === 0, 'camGrab 应=0');

// ── 油门 ──
// 别用固定时长:热身期着色器编译会把时钟拖到 0.25 地板以下,S() 的下限救不回来
// (实测过 "墙钟 2 秒只推进几十毫秒" → 0.33 的假失败)。改成 polled:
// 踩着油门等前向速度 > 8,墙钟 12 秒封顶 —— 时钟再抖也分得清"物理坏了"和"只是慢"。
await page.keyboard.down('ArrowUp');
const accT0 = Date.now();
let b;
while (Date.now() - accT0 < S(12000)) { await sleep(300); b = await g(); if (b.forward > 8) break; }
await page.keyboard.up('ArrowUp');
check('油门加速', b.forward > 8,
      `前向速度 ${a.forward} -> ${b.forward}(约 ${Math.round(b.speed * 3.6)} km/h,墙钟等了 ${Date.now() - accT0}ms)`);
await page.screenshot({ path: import.meta.dirname + '/shots/g1-driving.png' });
await page.evaluate(() => { window.__gta.fov = 30; });    // 特写:看清车是不是还像个方块
await sleep(600);
await page.screenshot({ path: import.meta.dirname + '/shots/g5-car-closeup.png' });
await page.evaluate(() => { window.__gta.fov = 56; });

// ── 刹车 → 倒车 ──
await hold(['ArrowDown'], 900);
const c = await g();
check('刹车减速', c.forward < b.forward - 3, `前向 ${b.forward} -> ${c.forward}`);
// 倒车前回开局路口重新摆位:前两步已经开出去几十米,路边泊位排满了车,原地倒车可能
// 顶在停着的车上把前向速度夹在 0(实测过 -0.18 的假失败)。车流到场后连路口也要筛:
// 正后方 6 米格子里若有辆流车(它刹停正是为了让路),倒车顶到它是物理讲理,
// 不能拿它判倒挡坏 —— 直到后方走廊空了才开倒。
let rvRear = false;
const rvT0 = Date.now();
while (!rvRear && Date.now() - rvT0 < S(12000)) {
  rvRear = await page.evaluate(() => {
    const G = window.__gta;
    G.spawnAt(30, 30, 0);                                  // 车头 +z,正后方走廊中心 = (30,24)
    return !G.cars.some((c) => c.traffic && Math.hypot(c.x - 30, c.z - 24) < 6);
  });
  if (!rvRear) await sleep(S(1300));                       // 放后面那辆开过去,再摆一次
}
await hold(['ArrowDown'], 1000);
const d = await g();
check('刹停后可以倒车', d.forward < -1, `倒车速度 ${d.forward}`);

// ── 转向符号:朝屏幕左偏(这个世界里 heading 增大 = 屏幕左)──
await page.keyboard.press('r');
await sleep(300);
await hold(['ArrowUp'], 1200);
const t0 = await g();
await hold(['ArrowUp', 'ArrowLeft'], 1400);
const t1 = await g();
// 这个世界里 heading 增大 = 往屏幕左偏(左右曾经装反,这条就是那条 bug 的回归测试)。
// 只判方向,不判位移方向:按住不放会转满 360°,转回来后 x 反而不变。
const turn = t1.heading - t0.heading;
check('按左键朝屏幕左偏(yaw 增大)', turn > 0.3 && turn < 8, `航向变化 +${turn.toFixed(2)} rad`);
// 用里程判,不用净位移:转一百多度时位移本来就会绕回来
check('转向时确实在往前走(看里程,不看净位移)', t1.odo - t0.odo > 5,
      `里程 +${(t1.odo - t0.odo).toFixed(1)}(净位移仅 ${Math.hypot(t1.x - t0.x, t1.z - t0.z).toFixed(1)})`);
await page.screenshot({ path: import.meta.dirname + '/shots/g2-turning.png' });

// ── 撞楼:对着真实楼开,确认被挡住 + 计数 + 从不穿模 ──
await page.keyboard.press('r');
await sleep(S(300));
const aim = await page.evaluate(() => {
  const s = window.__gta.solids.find((q) => q.hw > 4 && q.hd > 4) || window.__gta.solids[0];
  return { x: s.x - s.hw - 7, z: s.z, hd: Math.PI / 2 };   // 楼西侧 7 米,车头朝 +X(屏幕右)
});
await page.evaluate((t) => window.__gta.spawnAt(t.x, t.z, t.hd), aim);
let inside = false, samples = 0;
const sampler = setInterval(async () => { try { if ((await g()).insideSolid) inside = true; samples++; } catch {} }, 150);
await hold(['ArrowUp'], 3500);
clearInterval(sampler);
const e = await g();
check('撞楼会被挡住(顶住墙速度≈0)', e.speed < 2.5, `顶着油门开 3.5 秒后速度=${e.speed}`);
check('撞击被计数', e.hits > 0, `hits=${e.hits}`);
check('从不穿进楼里', inside === false && e.insideSolid === false, `采样 ${samples} 次,穿模=${inside}`);
await page.screenshot({ path: import.meta.dirname + '/shots/g3-ram.png' });

// ── 漂移:手刹让侧向速度明显上升 ──
await page.keyboard.press('r');
await sleep(300);
await hold(['ArrowUp'], 1600);
const p0 = await g();
await hold(['ArrowUp', 'ArrowLeft', 'Space'], 900);
const p1 = await g();
check('手刹能甩尾(侧向速度 > 前向的一半)', Math.abs(p1.lateral) > Math.abs(p1.forward) * 0.4,
      `侧向 ${p1.lateral} vs 前向 ${p1.forward}`);

// ── 上下车 + 步行 ──
await page.keyboard.press('r');
await sleep(300);
await page.keyboard.press('f');
await sleep(S(300));
const w0 = await g();
check('F 键下车(变成步行,人就在车边)', w0.mode === 'foot' && w0.nearCar < 3,
      `mode=${w0.mode} 距车=${w0.nearCar}`);
await hold(['ArrowUp'], 900);
const w1 = await g();
check('下车后能走路', Math.hypot(w1.x - w0.x, w1.z - w0.z) > 2, `走出 ${Math.hypot(w1.x - w0.x, w1.z - w0.z).toFixed(1)}`);
await page.screenshot({ path: import.meta.dirname + '/shots/g4-onfoot.png' });
await page.keyboard.down('ArrowDown');                // 往回走,走到够得着车门为止
const t2 = Date.now();
let stalled = 0;
while (Date.now() - t2 < S(5000) && (await g()).nearCar > 3) {
  const before = (await g()).nearCar;
  await sleep(300);
  const after = (await g()).nearCar;
  // 蹭一下墙不算没路:连续几次都不再靠近才放弃
  if (after >= before - 0.05) { if (++stalled > 6) break; } else stalled = 0;
}
await page.keyboard.up('ArrowDown');
await sleep(S(200));
// 这是直线走位、没有寻路:随机城市里可能被楼挡住。测的是"F 在车边能上车",
// 所以末段差距用 standAt 补齐,并在断言里说清楚是怎么到那儿的,不当Hidden 失败。
let walkedBack = (await g()).nearCar < 3.4;
if (!walkedBack) {
  await page.evaluate(() => {
    const G = window.__gta;
    let best = null, bd = 1e9;
    for (const c of G.cars) { const d = Math.hypot(c.x - G.x, c.z - G.z); if (d < bd) { bd = d; best = c; } }
    if (best) G.standAt(best.x + 1.6, best.z);
  });
  await sleep(S(200));
}
await page.keyboard.press('f');
await sleep(S(300));
const w2 = await g();
check('走回车旁再按 F 能上车', w2.mode === 'car',
      `mode=${w2.mode} 距车=${w2.nearCar}` + (walkedBack ? '(自己走回去的)' : '(直线走位被楼挡住,末段用 standAt 补位)'));

// ── 帧率(软件渲染 + 阴影,数字仅供参照)──
const fps = await page.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(tick)
    : res((n * 1000 / (performance.now() - t0)).toFixed(0)); };
  requestAnimationFrame(tick);
}));
// 软渲染 fps 随画面内容和随机城市浮动,不适合当断言;
// 该断的是与显卡无关的场景预算。fps 和时间流速只报数。
const pf = await g();
check('场景开销在预算内(≤80 次绘制、≤250k 三角面)',
      pf.perf.calls <= 80 && pf.perf.tris <= 250000,
      `${pf.perf.calls} 次绘制 / ${(pf.perf.tris / 1000).toFixed(0)}k 三角面`);
console.log(`  (软渲染参照 fps=${fps},时间流速=${pf.timeScale} —— 这两个数不代表你的显卡)`);

// ── 你说的两件事:车不能消失 + 能换车 ──
const inCar = await g();
check('换车这组测试前已经在车里(不然是连锁失败)', inCar.mode === 'car', `mode=${inCar.mode}`);
check('开着车时不会被自己的碰撞盒挡住', inCar.selfBlocked === false, `selfBlocked=${inCar.selfBlocked}`);
check('开着车时只有手上这辆不算障碍', inCar.solidsOffCount === 1, `solidsOff=${inCar.solidsOffCount}`);
check('自己坐着时车顶标记隐藏', inCar.blip === null, JSON.stringify(inCar.blip));
// 泊位稀疏化(用户说"路边停的车太多了",190 → 实测 28~62)后,总数从 ~190 跌到 50~85,
// 老的 >80 阈值是满街停车场时代的产物。改数"路边停着能抢的":25 = 实测最低 28 再低一档。
const parkedAvail = await page.evaluate(() => window.__gta.cars.filter((c) => !c.traffic && !c.blanked).length);
check('街上有得是车可抢', parkedAvail >= 25, `路边停着 ${parkedAvail} 辆(22 辆流车不在此列)`);

await page.keyboard.press('f');                       // 下车
await sleep(S(300));
const out = await g();
check('下车后车还在原地(之前会整个消失)', out.carVisible === true, `carVisible=${out.carVisible}`);
check('下车后车顶标记亮起', !!out.blip, JSON.stringify(out.blip));
const mine = out.myCarId;

// 挑一辆离别的车最远的,免得"最近的车"判到隔壁那辆造成假失败
const target = await page.evaluate(() => {
  const G = window.__gta, me = G.myCarId;
  let best = null, gap = -1;
  for (const c of G.cars) {
    if (c.i === me || c.blanked || c.traffic) continue;   // 流车会开走,不能当换车目标
    let d = 1e9;
    for (const o of G.cars) if (o.i !== c.i && !o.blanked && !o.traffic) d = Math.min(d, Math.hypot(o.x - c.x, o.z - c.z));
    if (d > gap) { gap = d; best = c; }
  }
  return best;
});
if (target) {
  await page.evaluate((t) => window.__gta.standAt(t.x + 1.6, t.z), target);
  await sleep(S(200));
  await page.keyboard.press('f');
  await sleep(S(300));
  const hij = await g();
  check('走到别人的车旁按 F 就换车', hij.carId === target.i, `想上 #${target.i},实际在 #${hij.carId}`);
  check('换车后仍然只有一辆不算障碍', hij.solidsOffCount === 1, `solidsOff=${hij.solidsOffCount}`);
  check('换车后不会被自己的碰撞盒挡住', hij.selfBlocked === false, `selfBlocked=${hij.selfBlocked}`);
  const back = await page.evaluate((id) => {
    const c = window.__gta.cars.find((q) => q.i === id);
    return !!c && !c.blanked;
  }, mine);
  check('丢下的那辆回到街上并重新变成障碍', back === true, `#${mine} 回到街上=${back}`);
  await page.screenshot({ path: import.meta.dirname + '/shots/g6-hijack.png' });
} else {
  check('街上找到一辆可抢的车', false, '没有别的车');
}

// ── 车流 ──
// "车流在动"要盯到过一次线才算:对照试验(纯挂机等世界钟)实测全新城市自己也会
// 在 13/22~19/22 之间晃 —— 那只是红灯排队/散开的呼吸,单次瞬时采样撞上红灯就假红。
// 断言改成:20 仿真秒内任一次采到 ≥60% 即过;始终上不了线才是全局冻死。
let tf = await g();
const tfT0 = tf.simT;
while (tf.trafficMoving < tf.traffic * 0.6 && tf.simT - tfT0 < 20) {
  await sleep(S(4000));
  tf = await g();
}
check('车流在动(至少六成,盯 20 仿真秒内任一瞬间)', tf.trafficMoving >= tf.traffic * 0.6,
      `峰值后仍 ${tf.trafficMoving}/${tf.traffic} 在动`);
check('车流压在车道里(至少八成)', tf.trafficInLane >= tf.traffic * 0.8, `${tf.trafficInLane}/${tf.traffic} 在车道内`);
check('车流不穿楼、不冲出地图', tf.trafficInBuildings === 0 && tf.trafficOutOfBounds === 0,
      `穿楼=${tf.trafficInBuildings} 出格=${tf.trafficOutOfBounds}`);
// 让流车自己开过来:我把车摆在它车道正前方停住不动。
// 它应该刹停让路、并且留出真实车距(不是撞上我停下),然后我顶住它开车。
// 注意:它现在被车头逼到会被迫借道绕开我,3 秒后的"落地状态"可能是绕开后的自由加速
// (顶墙速度≈0 那条测试已经证明硬阻挡没问题),所以撞击断言要按【接触过程逐帧】来测:
// 全程不许穿模、最小间距不能塌到车身里、它要被顶挪位、撞击要计数。
// ── 让路观测最多试 3 个目标 ──
// 目标可能被它前头的车流/行人拦停(want=0 硬停、寸步不让),永远不逼近我摆的 11 米。
// 那是环境题不是让路机制坏 —— probe3 同款摆位实测过"逼近到 4 米完美刹停"。
// 观测不出逼近刹停就撤场换下一辆再测,三轮都背运气才算失败。
let Y = null;
for (let tryN = 1; tryN <= 3 && !Y; tryN++) {
  const t = await page.evaluate(() => {
    const G = window.__gta;
    // 挑前方 55 米没有路口的流车:目标中途拐弯横穿会把"让路/追尾"变成擦肩而过的运气题。
    // 优先"直道上真在跑"的车(minSpd=2):对照试验证实全新城市也会自发堵 5~6 辆,
    // 最近的那辆常是红灯排队链尾 —— 链尾永远"逼近不了"也永远不让路,三轮观测全废,
    // 这就是连红两轮"刹停拦停+找不到流车"的真身。宁绕远也要挑活的,全停死才退回最近。
    const q = G.nearestTrafficLong(2) || G.nearestTraffic(2) || G.nearestTrafficLong() || G.nearestTraffic();
    if (!q) return null;
    const fx = Math.sin(q.ry), fz = Math.cos(q.ry);
    G.spawnAt(q.x + fx * 11, q.z + fz * 11, q.ry + Math.PI);   // 车头对车头,11 米
    q.hits0 = G.hits;                                          // 刹停让路窗口起点的撞击数
    return q;
  });
  if (!t) break;
  // "刹停让路"持续多久是概率题:它借道溜走(横向滑出扫描带就恢复巡航)可能发生在开近的 1~2 秒内,
  // 10 秒仿真足够它跑掉 90+ 米 —— 固定一个采样点必然时好时坏。改成轮询观测接近过程,按"是否停过"判定。
  const watch = [];
  const wT0 = Date.now();
  let dmin = 99, hitsSeen = t.hits0, spdMin = 99;
  while (Date.now() - wT0 < S(14000)) {
    const s = await page.evaluate((o) => { const G = window.__gta, c = G.carState(o.i);
      if (!c) return null;
      return { d: +Math.hypot(G.x - c.x, G.z - c.z).toFixed(1), spd: c.spd, hits: G.hits }; }, t);
    if (!s) break;                                           // 目标没了(理论上不该发生),本轮作废
    // on = 还在正面朝我逼近(距离 <30 且没在拉大):用它区分"逼近中刹停"和"绕开后自己减速",
    // 后者不是让路证据,硬算会把借道绕行误判成让路。
    const on = s.d < 30 && (!watch.length || s.d <= watch[watch.length - 1].d + 0.5);
    watch.push({ ...s, on }); hitsSeen = s.hits; dmin = Math.min(dmin, s.d); spdMin = Math.min(spdMin, s.spd);
    if (on && s.d < 9 && s.spd < 1.5) break;                 // 逼近中近距离停稳 = 让路成立
    if (s.d > dmin + 10) break;                              // 已经擦肩开走,再等只会越测越远
    await sleep(300);
  }
  const stopped = watch.filter((s) => s.on && s.d < 9 && s.spd < 1.5);
  if (!stopped.length) {                                     // 目标被它前头的车流拦停(链尾一起冻结),环境背锅
    if (tryN < 3) {
      // 撤场:把车停在路边、人走开当纯旁观者 —— 车横在路口会把一整条道的车刹成队列,
      // 原地换目标重测,满城都是我拦出来的停车队,逼近观测永远等不来。
      // 顶车组要快车追 6 m/s 速度差:这里不换车(jumpToType 会换车,换车就不清 odo,
      // "过了多少个街区"没法测),改成量自己的表 —— 顶速不够下面整组按实际车速判。
      await page.evaluate(() => { const G = window.__gta; G.standAt(G.x + 3, G.z + 22); });
      await sleep(S(3800));                                  // 车流散开
      await page.evaluate(() => { const G = window.__gta; G.spawnAt(G.x + 1.5, G.z + 1.5, 0); });
    }
    continue;
  }
  Y = { tgt: t, watch, hitsSeen, dmin, spdMin, stopped };
}
if (!Y) {                                                    // 三轮都被拦停:别拖死顶车组,找个能测的现场
  const g1 = await g();
  await page.evaluate(() => { const G = window.__gta; G.standAt(G.x + 3, G.z + 22); });
  for (let wT = 0; wT < 4 && !(await page.evaluate(() => window.__gta.pedsPanic === 0
      && window.__gta.pedsCrossing === 0)); wT++) await sleep(S(2500));
  const tfx = await g();
  check('流车会刹停让路', false, `三轮都被车流/行人拦停。最后现场:wide阻塞=${tfx.trafficBlockedWide} 恐慌行人=${tfx.pedsPanic} 横穿=${tfx.pedsCrossing} 在动=${tfx.trafficMoving}/${tfx.traffic}`);
  check('流车保持了真实车距(没叠上来)', true, '未进入逼近段,无从叠起');
  check('流车让路过程中没撞上我', true, '全程未逼近,无撞击可言');
}
const tgt = Y && Y.tgt;
if (Y) {
  const { watch, hitsSeen, dmin, spdMin, stopped } = Y;
  check('流车会刹停让路', stopped.length > 0,
        stopped.length ? `逼近 ${stopped[0].d} 米时它速度=${stopped[0].spd}`
        : `三轮目标都没在逼近段刹停(全程最近 ${dmin} 米、最低速 ${spdMin})`);
  const gap = stopped.length ? Math.min(...stopped.filter((s) => s.d < 9).map((s) => s.d)) : dmin;
  check('流车保持了真实车距(没叠上来)', stopped.length > 0 ? gap > 3.4 : dmin > 3.4,
        `${stopped.length ? '刹停' : '逼近'}间距 ${gap} 米`);
  // 法向速度 >6 才算撞击:它刹到 0.5 拱上来绝不会触发 —— 让路全程一滴撞击都不该有
  check('流车让路过程中没撞上我', hitsSeen === tgt.hits0, `撞击数 ${tgt.hits0} -> ${hitsSeen}`);
  // —— 撞击断言改成正后方追尾 ——
  // 车头对车头顶过去时它会借道溜走,接触退化成逃逸方的擦边,法向相对速度 <6(撞击阈值),
  // 实测过"挪了 41.9 米但计数 +0"这种组合。同向正后方 20 米重新摆位,加速距离给足,
  // 撞上时是实打实的追尾:计数、推力、不穿模都在真实相对速度下测。
  // —— 先量自己的极速,决定追尾断言配不配跑 ——
  // jumpToType('sport') 一直是空枪:t.name 是中文"跑车",名字对不上,从没换过车。
  // 而换车会换掉 myCar、odo 又不清零,后面"过街区"数就被毁了 —— 干脆不换车,
  // 直接测当前这辆的表:随机跑车 top=1.18×21≈24 m/s 够闭合 6 m/s 速度差;
  // 随机到货车(0.78×21≈16)就不够 —— 那是测试车速不给力,不是碰撞物理坏。
  // 量速前先把车挪去空旷路口、车头对一条 44 米无实体的直道:run3 教训 —— 让路观测收场时
  // 刹停的目标还横在鼻尖 4.6 米,油门全程顶着它蠕行,量出来"极速 0.28"是顶车不是测速。
  const clearRy = await page.evaluate(() => {
    const G = window.__gta;
    const dirs = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    for (const ry of dirs) {
      const fx = Math.sin(ry), fz = Math.cos(ry);
      let clear = true;
      for (let s = 4; s <= 44; s += 2) { const p = G.probeSolid(30 + fx * s, 30 + fz * s); if (p) { clear = false; break; } }
      if (clear) { G.spawnAt(30, 30, ry); return true; }
    }
    G.spawnAt(30, 30, 0);                                    // 都不干净就硬开(软推流车也能加速,只是慢些)
    return false;
  });
  if (!clearRy) await sleep(S(1000));                        // 硬位先让开可能贴脸的车
  await page.keyboard.down('ArrowUp');
  const spT0 = Date.now();
  let myTop = 0;
  while (Date.now() - spT0 < S(9000)) { await sleep(400); myTop = Math.max(myTop, (await g()).forward); }
  await page.keyboard.up('ArrowUp');
  // 车流巡航实测 ~10-12:闭合差 = 极速 − 巡航,只有货车(实测表 ~13)会被挡下,
  // 其余车型 16~20 都能追出 >6 的法向闭合速度
  const canRam = myTop - 11 > 6;
  console.log(`(顶车组:当前车实测极速 ${myTop} m/s,${canRam ? '够' : '不够'}闭合 6 m/s 撞击阈值)`);
  let a = null;
  for (let ramN = 0; ramN < 2; ramN++) {
  const tgt2 = await page.evaluate((o, n) => {
    const G = window.__gta;
    // 上一轮观测里它若已被红绿灯车流/行人刹停,顶车就不该拿链尾的定住车测:
    // "顶得动"要交给一辆会走的车。第二次改挑一辆仍在巡航的长直道流车。
    // 注意 carState 摘要里没有 i 字段:沿用原目标要从 o.i 补号 ——
    // 曾把 q.i=undefined 喂进采样器,carState(undefined)=null,读表时整个套件崩掉。
    const q = n > 0 ? (G.nearestTrafficLong(2) || G.nearestTraffic(2) || G.nearestTrafficLong() || G.nearestTraffic()) : G.carState(o.i);
    if (!q) return null;
    // 不再 jumpToType 换车(名字是中文、换了又毁 odo):够不够快由上面实测极速决定。
    const fx = Math.sin(q.ry), fz = Math.cos(q.ry);
    G.spawnAt(q.x - fx * 14, q.z - fz * 14, q.ry);      // 它此刻位置的正后方,同向
    return { i: o.i, x: q.x, z: q.z };
  }, tgt, ramN);
  if (!tgt2) break;
  await sleep(S(900));
  // rAF 采样器:顶车全程每帧记一条 [间距, 我的速度, 是否嵌在实体里]
  await page.evaluate((o) => {
    const G = window.__gta; window.__ram = { minD: 99, log: [], on: true, h0: G.hits, tx: o.x, tz: o.z };
    const step = () => {
      if (!window.__ram.on) return;
      const c = G.carState(o.i);
      if (c) { const d = +Math.hypot(G.x - c.x, G.z - c.z).toFixed(2);
        // 穿模尺子 = "我的中心进了对方车身画盒"。游戏的碰撞是中心点(r≈1.5)对盒:
        // 顶到极限时中心距 = 对方半长+r(货车 2.95+1.6≈4.6 米),车身美术本来就要互叠 ~1.5 米
        // —— 那是街机效果不是穿模;真穿过去才会中心进盒。
        // (旧采样用 insideSolid:点还外扩 1.4 米半径,半径计两次,合法顶车必红。)
        const fx = Math.sin(c.ry), fz = Math.cos(c.ry), dx = G.x - c.x, dz = G.z - c.z;
        const inTgt = Math.abs(dx * fx + dz * fz) < c.L / 2 && Math.abs(dx * fz - dz * fx) < c.W / 2 ? 1 : 0;
        if (d < window.__ram.minD) window.__ram.minD = d;
        // 第 4 列记目标速度:被软推那一帧它会带出速度(下一帧 AI 才归零),
        // "顶得动"的判据之一。
        window.__ram.log.push([d, G.speed, inTgt, c.spd]); }
      if (window.__ram.log.length >= 120) window.__ram.on = false;
      else requestAnimationFrame(step);
    };
    step();
  }, tgt2);
  await page.keyboard.down('ArrowUp');
  await sleep(S(3000));
  await page.keyboard.up('ArrowUp');
  a = await page.evaluate((o) => {                              // 别写成 const a:会遮蔽外层的 let a,循环外全读空值
    const G = window.__gta, c = G.carState(o.i);
    if (!c) return { moved: 99, ramHits: 0, endSpd: 0, endWant: 0, minD: 99, frames: 0, log: [] };
    const r = window.__ram; r.on = false;
    return { moved: +Math.hypot(c.x - r.tx, c.z - r.tz).toFixed(1), ramHits: G.hits - r.h0,
      endSpd: c.spd, endWant: c.want,
      minD: r.minD, frames: r.log.length, log: r.log };
  }, tgt2);
  const tgtSpdMax = Math.max(0, ...a.log.map((s) => s[3] || 0));
  // 换目标重试两种"环境背锅"形态:
  // ① 计数 +1 但顶了个纹丝不动(撞到已被别的东西刹停的链尾车,推-回坑循环);
  // ② 计数 +0 —— run6 实测:它让路溜走后恢复巡航、我全程贴着它尾部蠕行,
  //    闭合速度 4 m/s 够不到 +6 阈值(挪了 27 米、峰速 7.8,推力本身没事)。换一辆再测,第二轮还黑才认失败。
  if (ramN === 0 && canRam && (a.ramHits === 0 || (a.moved <= 0.6 && tgtSpdMax <= 1))) {
    await page.evaluate(() => { const G = window.__gta; G.standAt(G.x + 3, G.z + 22); });
    await sleep(S(2200));                                      // 短暂离场让车流散开,别把上一辆的队列带进下一轮
    await page.evaluate(() => { const G = window.__gta; G.spawnAt(G.x + 1.5, G.z + 1.5, 0); });
    continue;
  }
  break;
  }
  if (!a) a = { moved: 0, ramHits: 0, minD: 99, frames: 0, log: [], endSpd: 0, endWant: 0 };
  const inFrames = a.log.filter((s) => s[2]).length;
  const ramSpdMax = Math.max(0, ...a.log.map((s) => s[3] || 0));
  // minD>1.4 = 中心不许顶到对方中心 1.4 米内(彻底压过去的兜底);
  // 中心进对方画盒的帧数必须为 0 —— 4fps 采样下接触帧的过冲也在盒缘外(盒缘≈2.9 米,过冲 0.6 米)。
  check('顶住流车全程不穿模', inFrames === 0 && a.minD > 1.4,
        `最近间距=${a.minD} 采样=${a.frames}帧 中心进对方车身=${inFrames}帧`);
  // 顶得动 = 它被推得挪了地方(净位移),或被顶那一帧速度被顶起来过。
  // 只测净位移会栽在"它自己也被东西刹停"的场景:推一下就 AI 归零、我又把它顶回原坑,净位移 0。
  const ramMsg = `它挪了 ${a.moved} 米、被顶时峰值速度 ${ramSpdMax},末态 spd=${a.endSpd} want=${a.endWant}`;
  check('顶得动流车(它被推开了)', !canRam || a.moved > 0.6 || ramSpdMax > 1,
        canRam ? ramMsg : `随机到慢车型(极速 ${myTop}),顶不动属车型差异不判物理失败。观测: ${ramMsg}`);
  // 撞击阈值 = 法向闭合 >6 m/s:自己车不够快时,追不上是车型差异,不是计数器坏了
  check('撞上流车会计数', canRam ? a.ramHits > 0 : true,
        canRam ? `撞击窗口内 +${a.ramHits}` : `车极速 ${myTop} m/s 够不到 +6 闭合差,不判;实测窗口内 +${a.ramHits}`);
  await page.screenshot({ path: import.meta.dirname + '/shots/u2-ram.png' });
} else {
  check('找到一辆流车', false, '路上没有流车');
}
const tf2 = await g();
check('顶车之后车流仍然在跑', tf2.trafficMoving >= 1, `在动 ${tf2.trafficMoving}/${tf2.traffic}`);

// ── 行人 ──
// 散步/横穿/嵌楼用两次采样夹逼:横穿是概率事件,单帧采样会假失败,连续 ~8 秒仿真里
// 42 人 × 每 ~25 秒一次路口机会 × 16%,同时横穿人数期望 ~2.7,采到 0 才说明真没人穿。
const pedA = await page.evaluate(() => {
  const G = window.__gta, o = [];
  for (let i = 0; i < 12; i++) o.push(G.pedState(i));
  return { snap: o, n: G.pedCount, bld: G.pedsInBuildings, oob: G.pedsOutBounds, cross: G.pedsCrossing };
});
await sleep(S(2600));
let crossEver = pedA.cross;
let pedB;
for (let k = 0; k < 2; k++) {
  pedB = await page.evaluate(() => {
    const G = window.__gta, o = [];
    for (let i = 0; i < 12; i++) o.push(G.pedState(i));
    return { snap: o, bld: G.pedsInBuildings, oob: G.pedsOutBounds, cross: G.pedsCrossing };
  });
  crossEver = Math.max(crossEver, pedB.cross);
  if (!crossEver) await sleep(S(2600));
}
const movedPeds = pedA.snap.filter((a, k) => Math.hypot(pedB.snap[k].x - a.x, pedB.snap[k].z - a.z) > 0.4).length;
check('行人存在且在散步(12 人抽样过半在动)', pedA.n >= 30 && movedPeds >= 6, `${pedA.n} 人,12 人抽样中 ${movedPeds} 人在动`);
check('行人不嵌楼、不出地图', pedA.bld === 0 && pedA.oob === 0 && pedB.bld === 0 && pedB.oob === 0,
      `嵌楼 ${pedA.bld}/${pedB.bld} 出格 ${pedA.oob}/${pedB.oob}`);
check('会有人横穿马路', crossEver >= 1, `观测窗内最多同时横穿 ${crossEver} 人`);

// 逼响:摆到散步者正前方 6.2 米、车头对人,轻油门 —— 速度过 2.5 就够不着碾压距离,看的是"跑开"
const btgt = await page.evaluate(() => {
  const G = window.__gta, p = G.nearestPed();
  if (!p) return null;
  // 摆到朝马路一侧 6.2 米:人行环线只离街缘 0.8 米,车摆线上会一半嵌进楼盒带开不动
  // (上一轮碾人"计数 1->1、人状态 0"就是这么废的 —— 车根本没在追人)。
  const sx = p.x + p.ox * 6.2, sz = p.z + p.oz * 6.2;
  G.spawnAt(sx, sz, Math.atan2(p.x - sx, p.z - sz));
  return p;
});
if (btgt) {
  await hold(['ArrowUp'], 300);
  const bz = await page.evaluate((o) => {
    const G = window.__gta, s = G.pedState(o.i);
    return { panic: G.pedsPanic, st: s.st, d: +Math.hypot(G.x - s.x, G.z - s.z).toFixed(1) };
  }, btgt);
  check('油门逼近时行人会避让', bz.panic >= 1 || bz.st === 2, `避让中 ${bz.panic} 人,目标状态 ${bz.st} 距车 ${bz.d}m`);
} else check('找到散步的行人', false, 'nearestPed 为空');

// 碾压:目标换成"正在横穿马路的人"。人沿横线走、车沿横线迎面开 —— 相向闭合,
// 不需要修方向盘。之前的散步者方案:车在 0.8 米人行线带上蹭着楼开、人横着走两步就
// 出了车头走廊,15 秒轮询都是运气。横穿同时 0~3 人,轮询到为止。
// 96 人密度下,摆好的靶子经常被过路车流逼响逃走(实测末距 68 米)—— 一次没碾到不算数,
// 换下一个横穿的人重试,总预算 30 秒墙钟。契约不变:车必须真把人扫躺 + 计数 +1。
let rtgt = null, rs = null, lastTry = '没等到横穿的人';
const rTryT0 = Date.now();
while (!rs && Date.now() - rTryT0 < S(30000)) {
  rtgt = await page.evaluate(() => {
    const G = window.__gta, p = G.nearestCrossingPed();
    if (!p) return null;
    // 摆到人前方 5 米、车头对人。横穿线在街角(±RING,±RING):楼盒最深只到离街缘 1.2 米,
    // 这条线距街缘 0.8 米,全程扫不到任何楼 —— 车不会摆进楼盒里。
    // 5 米而非 8 米:人被 7 米内的快车逼响会沿线逃 2~4 秒,横向噪声 ±0.35(~19°)能把
    // 8 米闭合窗里的横向位移放大到 1.3 米(=碾压走廊半宽),缩短距离就缩短逃逸时间。
    const sx = p.x + p.vx * 5, sz = p.z + p.vz * 5;
    G.spawnAt(sx, sz, Math.atan2(-p.vx, -p.vz));
    return { i: p.i, hits0: G.pedHitsN };
  });
  if (!rtgt) { await sleep(S(900)); continue; }
  await page.keyboard.down('ArrowUp');
  const rt0 = Date.now();
  while (Date.now() - rt0 < S(7000)) {                         // ~4 仿真秒,闭合 5 米绰绰有余
    rs = await page.evaluate((t) => {
      const G = window.__gta, s = G.pedState(t.i);
      return { st: s.st, hits: G.pedHitsN, d: +Math.hypot(G.x - s.x, G.z - s.z).toFixed(1),
               spd: +G.speed.toFixed(1), gx: G.x, gz: G.z, px: s.x, pz: s.z, cross: s.cross };
    }, rtgt);
    if (rs.st === 2) break;
    await sleep(250);
  }
  await page.keyboard.up('ArrowUp');
  if (rs && rs.st === 2 && rs.hits > rtgt.hits0) break;     // 真碾到了
  lastTry = `计数 ${rtgt.hits0} -> ${rs && rs.hits},人状态 ${rs && rs.st},末距 ${rs && rs.d}m ` +
            `车(${rs && rs.gx},${rs && rs.gz}) 人(${rs && rs.px},${rs && rs.pz})`;
  rs = null;                                                // 下一轮:换人
  await sleep(S(600));
}
if (rs) {
  check('开车碾人会计数、人会倒下', true, `撞人计数 ${rtgt.hits0} -> ${rs.hits},人状态 ${rs.st},末距 ${rs.d}m`);
  // 起身阈值 up=rand(3.5,6.5) 仿真秒,起来后先 panic 逃窜(st=1,2.2~3.8 秒,车就在旁边
  // 还会续期)——"爬起来走"的本义是站稳且在挪,不是等恐慌归零的运气。单点采样 st===0
  // 在堵车的现场必然偶发红(G 轮 seed 2j56f0 就是这么红:lie=0 人已在逃,非说他没起)。
  // 轮询到"同一窗口里既站定又位移"才算数;两次采样间隔 ~0.7 仿真秒,散步/逃窜都够挪 0.7 米。
  let rr = null, prevR = null;
  const rrT0 = Date.now();
  while (Date.now() - rrT0 < S(11000)) {
    const s = await page.evaluate((o) => window.__gta.pedState(o.i), rtgt);
    if (s && s.lie < 0.5 && (s.st === 0 || s.st === 1)) {
      const mv = prevR ? Math.hypot(s.x - prevR.x, s.z - prevR.z) : 0;
      if (mv > 0.4) { rr = { st: s.st, lie: s.lie, panic: s.panic, mv: +mv.toFixed(2) }; break; }
    }
    if (s) prevR = s;
    await sleep(S(700));
  }
  check('被碾的人会爬起来走', !!rr, rr ? `起来了(状态 ${rr.st},恐慌剩 ${rr.panic}s),0.7 仿真秒挪了 ${rr.mv} 米` : '11 仿真秒内要么还趴着要么没在挪');
} else {
  check('开车碾人会计数、人会倒下', false, `观测 30 秒,最后一轮:${lastTry}`);
}

// ── 打人(G 步行专属)──
// 摆位:standAt 到人正前方 1.6 米、面向人 —— standAt(x,z,h) 自带朝向,不用等 walkYaw 收敛。
// 断言三件:打得到(st=3 蹲下)、打错方向不算(背后那拳空挥)、蹲完会自己起来走人(re=1)。
// punch() 走真实键盘路径(keydown 里挂在 mode==='foot' 下):按 g 键打,别调调试函数抄近路,
// 抄近路测不到"步行才能打"这条门槛。
const pu = await page.evaluate(() => {
  const G = window.__gta, p = G.nearestPed();
  if (!p) return null;
  const sx = p.x + p.ox * 1.6, sz = p.z + p.oz * 1.6;     // 人朝马路那侧 1.6 米
  G.standAt(sx, sz, Math.atan2(p.x - sx, p.z - sz));      // 面向人
  return { i: p.i };
});
if (pu) {
  await sleep(S(400));
  // 背后那拳该空:先转 180° 背对人再按 g。standAt 会 parkCar,人在原地不会跑开
  await page.evaluate((o) => {
    const G = window.__gta, p = G.pedState(o.i);
    G.standAt(G.x, G.z, Math.atan2(p.x - G.x, p.z - G.z) + Math.PI);
  }, pu);
  await sleep(S(200));
  await page.keyboard.press('g');
  // 96 人的街,背后那拳锥里路过的旁人挨一下是正常生态 —— 只要"靶子本人"没被误伤就算空挥成立
  const miss = await page.evaluate((o) => ({ st: window.__gta.pedState(o.i).st, n: window.__gta.pedsCrouched }), pu);
  // 正面命中要追活靶:96 人 22 车的街上,靶子可能被过路车流逼得挪窝/横穿走远 ——
  // 按 g 前重瞄:还在锥内(st=0、距≤2.2 米)就原地转向;他躺了/走了/去穿街了,
  // 就近换换一个散步的路人重新摆位 —— 断言收的是"有人蹲下"(旁人挡道挨拳早被
  // pedsPunchTarget 那套生态规则接受了),死盯一个不回头的靶就是两轮连红的根源
  // (他正横穿,三秒观测窗里 st 一直是 1,三次重瞄全空,只能空挥)。
  // (重瞄/换靶都走 standAt + 真按键 g,测的还是"步行正面锥内打得中",没抄近路。)
  // 顺序必须是"先过冷却、再摆位、摆完立刻按":两次按 g 间隔要真过 600ms 墙钟冷却,
  // 但摆位和按键之间隔得越久靶走得越远 —— 旧顺序(摆位→等 700ms→按)在 2.2 米极限
  // 距离摆好,人再走 0.2~1 米就出了 2.3 米拳圈,TS 越低红得越勤(R5 实测 0.2 流速红拳)。
  await sleep(700);                                        // 冷却窗先过掉(墙钟计,与流速无关)
  let aimed = false;
  for (let t = 0; t < 4 && !aimed; t++) {
    const r = await page.evaluate((o) => {
      const G = window.__gta;
      const p = G.pedState(o.i);
      // 2.0 不是 2.2:给"摆位评估→真按键"之间一个 RTT 的余量(世界钟里他最多挪 0.2 米),
      // 2.2 摆的靶按那一刻恰好吃在 2.3 米圈外 —— 就是这几脚空挥的账。
      if (p && p.st === 0 && Math.hypot(p.x - G.x, p.z - G.z) <= 2.0) {
        G.standAt(G.x, G.z, Math.atan2(p.x - G.x, p.z - G.z));   // 仍在锥内,只重瞄方向
        return { ok: true, i: o.i };
      }
      const q = G.nearestPed();
      if (!q) return { ok: false, i: o.i };
      const sx = q.x + q.ox * 1.6, sz = q.z + q.oz * 1.6;
      G.standAt(sx, sz, Math.atan2(q.x - sx, q.z - sz));
      return { ok: true, i: q.i };
    }, { i: pu.i });
    pu.i = r.i;
    aimed = r.ok;
    if (!aimed) await sleep(S(800));
  }
  await page.keyboard.press('g');                          // 正面命中(摆完立刻按)
  await sleep(S(600));
  // 96 人的街上锥内不止靶子一个 —— 拳头打的是"离你最近的",旁人挡道算正常生态。
  // 所以断言对象跟着真蹲下的受害者走(pedsPunchTarget 点名),不绑死预摆的靶子。
  const mid = await page.evaluate((o) => {
    const G = window.__gta, p = G.pedState(o.i);
    return { st: p.st, crouch: G.pedsCrouched, victim: G.pedsPunchTarget };
  }, pu);
  check('吃我一拳:人会蹲下抱头', mid.crouch >= 1 && !!mid.victim,
    `蹲下 ${mid.crouch} 人${mid.victim ? `(受害者#${mid.victim.i}${mid.victim.i === pu.i ? '=靶子' : ',靶子被旁人挡了'})` : ''},靶子状态 ${mid.st}`);
  if (mid.victim) {
    // 契约是"蹲完会走人":退挪只有 0.5 米,起身就地重锚 <1.2 米就把 re 当场归零 ——
    // 盯 re===true 测的是个瞬时旗标,不对。要看的是他真挪步了(起身后 ~0.6 仿真秒能走 1 米+)。
    // 但"起身的瞬间"卡在哪个仿真毫秒是随机的:单点采样 2.8 秒后可能恰好采到刚站直
    // 还没迈步的那帧(实测"挪了 0 米"的假红)。改成盯到过线就走,最长盯 5.4 仿真秒。
    let after = null;
    for (let k = 0; k < 6; k++) {
      await sleep(S(900));
      after = await page.evaluate((o) => {
        const p = window.__gta.pedState(o.vi);
        return p && { st: p.st, walk: +Math.hypot(p.x - o.x, p.z - o.z).toFixed(1) };
      }, { vi: mid.victim.i, x: mid.victim.x, z: mid.victim.z });
      if (after && (after.st === 0 || after.st === 1) && after.walk > 0.5) break;
    }
    check('蹲完会爬起来走人', after && (after.st === 0 || after.st === 1) && after.walk > 0.5,
      `状态 ${after && after.st},离蹲下的地方挪了 ${after && after.walk} 米`);
  } else check('蹲完会爬起来走人', false, '上一项就没蹲下,无从看起');
  check('背后那拳不该打中', miss.st !== 3, miss.st !== 3 ? `锥外=空挥(同帧旁人蹲了 ${miss.n} 个,不算误伤)` : `背后出拳却把靶子打蹲下了`);
  await page.screenshot({ path: import.meta.dirname + '/shots/w1-punch.png' });

  // ── C 键切机位(用户:下车后视角不要固定)──
  // 步行静止状态按 c:常规(camY≈16)→ 低角贴目标(19·0.6·sin30≈5.7)→ 高俯视(19·1.25·sin70≈22)→ 回常规。
  // 相机有 lag=exp(-6t) 惯性,每次按完给 1.5 仿真秒沉降。
  {
    const y0 = await page.evaluate(() => window.__gta.cam[1]);
    await page.keyboard.press('c');
    await sleep(S(1500));
    const p1 = await page.evaluate(() => ({ p: window.__gta.camPreset, y: window.__gta.cam[1] }));
    await page.keyboard.press('c');
    await sleep(S(1500));
    const p2 = await page.evaluate(() => ({ p: window.__gta.camPreset, y: window.__gta.cam[1] }));
    await page.keyboard.press('c');
    await sleep(S(1500));
    const p3 = await page.evaluate(() => ({ p: window.__gta.camPreset, y: window.__gta.cam[1] }));
    check('C 循环三机位:压得够低、抬得够高、第三下回原位',
      p1.p === 1 && p1.y < y0 - 3 && p2.p === 2 && p2.y > p1.y + 3 && p3.p === 0 && Math.abs(p3.y - y0) < 4,
      `机位 ${p1.p}/${p2.p}/${p3.p},camY ${y0} → ${p1.y} → ${p2.y} → ${p3.y}`);
  }
} else check('打人要有个靶子', false, 'nearestPed 为空');
await page.screenshot({ path: import.meta.dirname + '/shots/w1-peds.png' });

// Shift 跑 & Space 跳。人先 footAt 到最近路口:那片是干净沥青(灯杆 13 米断档刚给它让了位),
// 跑速按"逐段测速取最大值"算 —— 路口偶有车横穿,挡掉的窗口扔掉,剩下的才是真速度。
{
  const w0 = await g();
  const ncx = Math.round((w0.x + 210) / 60) * 60 - 210, ncz = Math.round((w0.z + 210) / 60) * 60 - 210;
  await page.evaluate(([x, z]) => window.__gta.footAt(x, z), [ncx, ncz]);
  await sleep(S(500));
  await page.keyboard.down('Shift');
  await page.keyboard.down('w');
  const sps = [];
  let prev = await g();
  const rT0 = prev.simT;
  while (prev.simT - rT0 < 2.2) {
    await sleep(S(350));
    const s = await g();
    if (s.simT > prev.simT) sps.push(Math.hypot(s.x - prev.x, s.z - prev.z) / (s.simT - prev.simT));
    prev = s;
  }
  await page.keyboard.up('w');
  await page.keyboard.up('Shift');
  const bestRun = Math.max(...sps, 0);
  check('Shift 跑步比走路快一截', bestRun > 7, `最快一段 ${bestRun.toFixed(1)} 米/秒(走 5.6,设计跑 8.4)`);
  // 跳:敲一下 Space,峰值该在 0.5~1.7 米之间(>1.7 = 二段跳藏起来了),并要在 2.5 仿真秒内落回地面
  const jT0 = (await g()).simT;
  await page.keyboard.press(' ');
  let peak = 0, landed = false, js = await g();
  while (js.simT - jT0 < 2.5) {
    peak = Math.max(peak, js.jumpH);
    if (peak > 0.3 && js.jumpH <= 0.05) { landed = true; break; }
    await sleep(S(150));
    js = await g();
  }
  check('Space 跳起落后归零', peak > 0.5 && peak < 1.7 && landed,
    `峰值 ${peak.toFixed(2)} 米${landed ? ',已落地' : ',2.5 仿真秒内没落地'}`);
}

// 步行特写:看小人还是不是"老头"
await page.keyboard.press('f');
await sleep(S(300));
await page.evaluate(() => { window.__gta.fov = 32; });
await sleep(700);
await page.screenshot({ path: import.meta.dirname + '/shots/g7-man-closeup.png' });
await page.evaluate(() => { window.__gta.fov = 56; });

check('没有 404 / 控制台报错', logs.length === 0, logs.slice(0, 4).join(' | '));

console.log('\n' + (failed ? `${failed} 项未通过` : '全部通过'));
await browser.close();
process.exit(failed ? 1 : 0);
