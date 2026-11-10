// 通缉/警察(probe24):巡逻点名 → 挨打吃星 → 警车调派逼近 → 不埋楼 → 徒步 BUSTED →
// 小店安全屋灭星 → 警车可抢。一条链全查,定案只读 __gta(星星/热度/警车点名)。
// 玩法选型(用户四选):3 星档 / 清星+路口复活 / 顶撞+围捕不开枪 / 0 星常驻 2 辆巡逻可抢。
// 用法: node verify/probes/probe24.mjs [SEED]
import puppeteer from 'puppeteer-core';
const SEED = process.argv[2] || '';
const URL = `http://127.0.0.1:8017/gta/?autostart&noshadow${SEED ? '&seed=' + SEED : ''}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!ok) failed++; };
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 500 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e && (e.stack || e.message) || e)));
await page.goto(URL, { waitUntil: 'load' });
let TS = 1;
const syncTS = async () => { TS = Math.max(0.1, await page.evaluate(() => window.__gta.timeScale || 1)); };
const S = (ms) => Math.round(ms / TS);
await sleep(3000);
await syncTS();
const g = () => page.evaluate(() => window.__gta);
console.log(`种子 seed=${(await g()).seed}  时间流速 TS=${TS.toFixed(2)}`);

check('① 页面加载无 JS 报错', errs.length === 0, errs.slice(0, 2).join(' | '));

// ② 开局警车点名:6 辆池 = 2 巡逻(挂在街上)+ 4 停编(藏起来了);民用车种盘点里没有"警车"
const c2 = await page.evaluate(() => window.__gta.cops);
const pat = c2.filter((c) => c.police === 'patrol' && !c.blanked);
const pool = c2.filter((c) => c.police === 'pool' && c.blanked);
check('② 警车池点名:6 辆整齐,2 巡逻可见、4 停编藏形',
  c2.length === 6 && pat.length === 2 && pool.length === 4,
  `点名=${c2.length} 巡逻=${pat.length} 停编=${pool.length}`);
const types2 = await page.evaluate(() => Object.keys(window.__gta.carTypes));
check('②b 民用车型盘点不掺警色(警色归通缉系统自己点名)', !types2.includes('警车'), types2.join('/'));

// ③ 巡逻车真在街上跑(不是俩路障)
await sleep(S(4000));
const patMoving = await page.evaluate(() => window.__gta.cops
  .filter((c) => c.police === 'patrol' && !c.blanked && c.spd > 1).length);
check('③ 0 星巡逻车活着在巡航(≥1 辆 spd>1)', patMoving >= 1, `跑着的巡逻车=${patMoving}`);

// ④ 光脚抡拳吃星:每轮先把人重新对准了再挥拳 —— 拳会把人崩退半步、行人爬起来又走两步,
// 只瞄准一次后续全挥空。记账只认 heat 真涨: punchNow 返回的是"当下蹲着的人数"不是命中数
// (教训:返回 7 次、热度只涨 0.18)。0.18/拳 → 6 拳过 1.0 线,断言只看"落实拳→热度>0→星≥1"。
let punchLanded = 0;
{
  const t0 = Date.now();
  while (Date.now() - t0 < S(30000) && punchLanded < 8) {
    const r = await page.evaluate(() => {
      const G = window.__gta;
      const p = G.nearestPed();
      if (!p) return null;
      G.standAt(p.x - p.ox * 1.2, p.z - p.oz * 1.2, Math.atan2(p.ox, p.oz));   // 人前 1.2 米、脸对人
      const h0 = G.heat;
      G.punchNow();
      return { gain: +(G.heat - h0).toFixed(3), stars: G.stars };
    });
    if (r && r.gain > 0) punchLanded++;
    if (r && r.stars >= 1) break;
    await sleep(700);          // 挥拳冷却本来就是墙钟 600ms,真 700ms 间隔必过冷却,不按 TS 缩
  }
}
const g4 = await g();
check('④ 抡拳命中喂通缉:实打实够 6 拳后热度>0 且 stars≥1', punchLanded >= 6 && g4.heat > 0 && g4.stars >= 1,
  `实打=${punchLanded} 拳 heat=${g4.heat} stars=${g4.stars}`);

// ⑤ 警车调派:1 星 = 2 辆追捕(0.8 秒一轮调派,巡逻车就近就地转,不用等远程调车)
let ch5 = 0;
{
  const t0 = Date.now();
  while (Date.now() - t0 < S(8000) && ch5 < 2) { await sleep(S(500)); ch5 = await page.evaluate(() => window.__gta.copChasers()); }
}
check('⑤ 1 星调派:追捕车 ≥2(巡逻车就地转追捕)', ch5 >= 2, `追捕中=${ch5}`);

// ⑥ 追捕逼近:12 仿真秒内最近追捕车离我的距离至少缩 5 米(会开车追,不是停在原地看)
let dFirst = -1, dMin = 1e9, dLast = -1;
{
  const t0 = Date.now();
  while (Date.now() - t0 < S(12000)) {
    const nc = await page.evaluate(() => window.__gta.nearestCop());
    if (nc && nc.police === 'chase') {
      if (dFirst < 0) dFirst = nc.d;
      dMin = Math.min(dMin, nc.d); dLast = nc.d;
    }
    await sleep(S(1000));
  }
}
check('⑥ 追捕真的在逼近:距离缩了 ≥5 米,或已经贴到 6 米内(起步就贴脸不该算假红)',
  dFirst >= 0 && (dFirst - dMin >= 5 || dMin < 6), `首距=${dFirst} 最近=${dMin} 末距=${dLast}`);

// ⑦ 追捕不埋楼:整段追击中,任何一辆追捕车中心嵌进"楼/树盒"(h≥3、非车非店内盒)= 0
const copInBuild = await page.evaluate(() => {
  const G = window.__gta; let worst = 0, who = '';
  for (const co of G.cops) {
    if (co.police !== 'chase' || co.blanked) continue;
    let n = 0;
    for (const s of G.solids) {
      if (s.car || s.interior || s.h < 3) continue;
      const nx = Math.max(s.x - s.hw, Math.min(co.x, s.x + s.hw));
      const nz = Math.max(s.z - s.hd, Math.min(co.z, s.z + s.hd));
      if (Math.hypot(co.x - nx, co.z - nz) < 0.3) n++;
    }
    if (n > worst) { worst = n; who = `#${co.i}@(${co.x},${co.z})`; }
  }
  return { worst, who };
});
check('⑦ 追捕车全程不埋楼(抄近道只穿空地,顶出楼盒靠 pushOutStatic)',
  copInBuild.worst === 0, `嵌楼车数=${copInBuild.worst} ${copInBuild.who}`);

// ⑧ 徒步 BUSTED:升到 3 星(4 辆都来),人已下车站定不动 → 累计被贴 3 秒必捕。
// setHeat 带 grace=8:像"刚当街犯完事",清静满 8 仿真秒才开始消热 —— 不带 grace 热度秒消,
// 追捕车还没从 ≥60 米调上来星就灭光了(2026-11-10 看门狗实拍:整窗 0 帧贴脸)。
// 判定后必须:星清零、人被拎回最近路口(格点)、还在车里、横幅亮着、追捕车退回巡航。
// BUSTED 横幅按真实时间 ≤1 秒/秒退(慢机器上约 2 秒就没了):node 端 S(1200) 一抽就是
// 4 秒开外墙钟,必然抽个空 —— 页内挂 100ms 墙钟线人,被捕那一拍当场定格全身快照。
await page.evaluate(() => {
  const G = window.__gta;
  window.__bs = { b0: G.busts, snap: null };
  window.__bs.iv = setInterval(() => {
    const g2 = window.__gta;
    if (g2.busts > window.__bs.b0 && !window.__bs.snap) {
      window.__bs.snap = { stars: g2.stars, heat: g2.heat, mode: g2.mode, x: g2.x, z: g2.z,
        bustShow: g2.bustShow, busts: g2.busts, heroPos: g2.heroPos };
      clearInterval(window.__bs.iv);
    }
  }, 100);
});
const g8a = await g();
await page.evaluate(() => window.__gta.setHeat(3.2, 8));
let bustSnap = null;
{
  const t0 = Date.now();
  while (Date.now() - t0 < S(45000) && !bustSnap) {
    await sleep(S(1200));
    bustSnap = await page.evaluate(() => window.__bs.snap);
  }
}
const onGrid = (v) => { const m = (((v + 210) % 60) + 60) % 60; return m < 0.5 || m > 59.5; };
check('⑧a 徒步站定被围 → BUSTED(45 仿真秒内 busts+1)', !!bustSnap, `heat顶到=${g8a.heat} 结果=${!!bustSnap}`);
if (bustSnap) {
  check('⑧b 被捕善后:星清零、人被塞回车里、落在最近路口格点、横幅亮着',
    bustSnap.stars === 0 && bustSnap.heat === 0 && bustSnap.mode === 'car' &&
    onGrid(bustSnap.x) && onGrid(bustSnap.z) && bustSnap.bustShow > 0,
    `stars=${bustSnap.stars} mode=${bustSnap.mode} 人=(${bustSnap.x},${bustSnap.z}) 横幅=${bustSnap.bustShow}`);
  // 被捕那刻人是步行身份,placeAt 必须把步行人像收掉:heroPos 第 4 位=hero 可见必须 true
  check('⑧c 被捕回车内:主角车可见(没穿帮成车旁多站一个人)',
    Array.isArray(bustSnap.heroPos) && bustSnap.heroPos[3] === true,
    `heroPos=${JSON.stringify(bustSnap.heroPos)}`);
}

// ⑨ 小店=安全屋:3 星进店 → 追捕车退回巡航、星快速熄灭、期间永不被捕、出门人还在
await page.evaluate(() => {
  const G = window.__gta;
  G.setHeat(3.3);
  const d = G.shopDoors[0];
  G.standAt(G.x, G.z);
  G.footAt(d.x + d.nx * 1.4, d.z + d.nz * 1.4);
  G.enterShop();
});
let starsOut = -1, chasersOut = 9, busts9 = 0;
{
  busts9 = (await g()).busts;
  const t0 = Date.now();
  while (Date.now() - t0 < S(20000)) {
    // copChasers 是方法:g() 的序列化副本上调不动,必须浏览器端算好再带数字回来
    const st = await page.evaluate(() => {
      const G = window.__gta;
      return { stars: G.stars, ch: G.copChasers(), busts: G.busts, inShop: G.inShop };
    });
    starsOut = st.stars; chasersOut = st.ch;
    if (st.stars === 0 && st.ch === 0) break;
    await sleep(S(1000));
  }
}
const g9 = await g();
check('⑨ 安全屋:3 星进店后星灭到 0、追捕车全退、屋里不设捕、人还在店里',
  starsOut === 0 && chasersOut === 0 && g9.busts === busts9 && !!g9.inShop,
  `stars末=${starsOut} 追捕末=${chasersOut} busts=${g9.busts}(基准${busts9}) inShop=${g9.inShop}`);
await page.evaluate(() => window.__gta.exitShop());

// ⑩ 警车可抢(用户:常驻可抢):跳上最近警色车,carType=警车 且点名表里它标"您在开"
const j10 = await page.evaluate(() => {
  const G = window.__gta; G.standAt(G.x, G.z);
  const r = G.jumpToType('警车');
  return r ? { type: G.carType, driven: G.cops.some((c) => c.driven) } : null;
});
check('⑩ 警车可抢:jumpToType("警车") 上去了,点名表标出您在开',
  !!j10 && j10.type === '警车' && j10.driven, JSON.stringify(j10));

// ⑪ 不变量:池子永远 6 辆整编,0 星街面巡回复位 ≥2,全程零 JS 报错
const c11 = await page.evaluate(() => { const G = window.__gta; return { cops: G.cops.length, pat: G.cops.filter((c) => c.police === 'patrol' && !c.blanked).length }; });
check('⑪ 警车池 6 辆整编不破、0 星巡回复位 ≥2(您抢走一辆它会补编)',
  c11.cops === 6 && c11.pat >= 2, `点名=${c11.cops} 巡航=${c11.pat}`);
check('⑫ 全程无 JS 报错', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log(failed ? `${failed} 项未通过` : '全部通过');
await browser.close();
process.exit(failed ? 1 : 0);
