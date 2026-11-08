// 步行相机四查(机位=开车同款,用户拍板):①W 走向镜头纵深、相机在背后跟 ②纯 D 横移不打陀螺
// ③鼠标转向后 W 走向新镜头纵深 ④在两楼之间的街上正常走时镜头挂在 24 米高、越过屋顶线不进楼盒
//
// 两条铁律(都用过血泪换):
// 1) 时序一律用世界钟 simT(dt 夹 0.05 后的累计)。挂钟采样时,软件渲染一降帧
//    游戏就变慢动作,"位移 1.7 米"其实是"挂钟走了 5 秒、世界只过了 1 秒" —— 假回归。
// 2) 每步先瞬移到最近十字路口中心起手,③ 还额外挑"8 米内无楼无车"的方向再拖 ——
//    场景随机性(撞楼/撞车流)不能算行为回归。
import puppeteer from 'puppeteer-core';
const URL = 'http://127.0.0.1:8017/gta/?autostart&noshadow' + (process.env.SEED ? '&seed=' + process.env.SEED : '');
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
const S = () => page.evaluate(() => ({ x: window.__gta.x, z: window.__gta.z, cam: window.__gta.cam, t: window.__gta.simT }));
const PT = () => page.evaluate(() => window.__gta.simT);            // 世界钟
// 等到世界钟再走 sec 秒(轮询粒度 ~世界 0.05 秒,慢动作时最多过冲 0.1)
const simWait = async (sec, t0) => { for (;;) { if (await PT() - t0 >= sec) break; await sleep(40); } };
const shortA = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const az = (s) => Math.atan2(s.x - s.cam[0], s.z - s.cam[2]);       // 相机→玩家 = 镜头纵深(相机甩到位之后才准)
// 站到最近十字路口中心(马路交叉、必无楼),身体和走向 = 当前镜头纵深
const toCross = () => page.evaluate(() => {
  const G = window.__gta;
  const nx = Math.round((G.x + 210) / 60) * 60 - 210;
  const nz = Math.round((G.z + 210) / 60) * 60 - 210;
  G.standAt(nx, nz, Math.atan2(G.x - G.cam[0], G.z - G.cam[2]));
});
// 瞬移后等 0.8 世界秒:相机按 6/秒收敛到新位置背后,az 读数才等于镜头朝向
const settle = async () => { await toCross(); await simWait(0.8, await PT()); };

// 0. 下车
await page.keyboard.press('f');
await sleep(900);

// ① W 直行 2 世界秒:行进方向与"相机→玩家"方向重合(相机在背后跟)
await settle();
await page.keyboard.down('w');
let sA = await S(); await simWait(2.0, sA.t); let sB = await S();
await page.keyboard.up('w');
{
  const vx = sB.x - sA.x, vz = sB.z - sA.z, vl = Math.hypot(vx, vz) || 1;
  const dot = (vx / vl) * Math.sin(az(sA)) + (vz / vl) * Math.cos(az(sA));
  console.log(dot > 0.85 && vl > 3 ? 'PASS' : 'FAIL', '① W 走向镜头纵深、相机跟在背后 — dot=' + dot.toFixed(2) + ` 走了 ${vl.toFixed(1)} 米`);
}

// ② 纯 D 横移 2.2 世界秒:相机方位角不该转成陀螺(实测坏反馈环会 ~7rad/s 互绕)
await settle();
await page.keyboard.down('d');
const dA = await S(); await simWait(2.2, dA.t); const dB = await S();
await page.keyboard.up('d');
{
  const om = Math.abs(shortA(az(dB) - az(dA))) / (dB.t - dA.t);
  const moved = Math.hypot(dB.x - dA.x, dB.z - dA.z);
  console.log(om < 1.5 && moved > 3 ? 'PASS' : 'FAIL', `② 横移不打陀螺、人在挪 — ω=${om.toFixed(2)}rad/s 位移 ${moved.toFixed(1)} 米`);
}

// ③ 拖镜头(挑净向,±60/120/180° 里第一个 8 米无楼无车的)后按住 W:
//    等 0.8 世界秒让相机甩到位(位置滞后 6/秒)才读"屏幕纵深",采样窗必须在
//    "松手 1.6 世界秒自动回正"启动前收尾 —— 回正一启动走向就画弧,dot 全是弧的噪声。
{
  let dot = 0, vl = 0, tail = 9;
  for (let t = 0; t < 3; t++) {
    await settle();
    const pick = await page.evaluate(() => {
      const G = window.__gta;
      const a0 = Math.atan2(G.x - G.cam[0], G.z - G.cam[2]);
      for (const k of [1, -1, 2, -2, 3]) {
        const a = a0 + k * Math.PI / 3, ux = Math.sin(a), uz = Math.cos(a);
        let clear = true;
        for (let d = 1; d <= 8; d++) if (G.probeSolid(G.x + ux * d, G.z + uz * d, 0.6, -1, true)) { clear = false; break; }
        if (clear) return { px: Math.round(Math.abs(k) * Math.PI / 3 / 0.006), sgn: Math.sign(k) };
      }
      return { px: 250, sgn: 1 };
    });
    await page.mouse.move(320, 240);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(320 + pick.sgn * pick.px * i / 6, 240);
    await page.mouse.up();
    const tUp = await PT();                            // 世界钟上"松手"这一刻(回正闸从它起算)
    await page.keyboard.down('w');
    await simWait(0.8, tUp);
    let mA = await S();                                // 相机甩到位
    await simWait(0.5, mA.t);
    let mB = await S();                                // 仍在 1.6 世界秒回正闸内
    await page.keyboard.up('w');
    const vx = mB.x - mA.x, vz = mB.z - mA.z;
    vl = Math.hypot(vx, vz) || 1;
    dot = (vx / vl) * Math.sin(az(mA)) + (vz / vl) * Math.cos(az(mA));
    tail = mB.t - tUp;
    if (tail < 1.6 && vl > 2.5) break;                 // 窗被回正污染或被车流挡了才重摇;真坏了三轮都难看
  }
  console.log(dot > 0.85 && vl > 2 ? 'PASS' : 'FAIL', `③ 转到哪 W 走向哪 — dot=${dot.toFixed(2)} 位移 ${vl.toFixed(1)} 米 窗尾 ${tail.toFixed(2)} 世界秒`);
}

// ④ 十字路口起步,沿"两排楼之间的街"直走 2.4 世界秒:人正常位移(>6 米),
//    镜头四个采样点全在任何障碍盒的三维体外(24 米挂顶 vs 楼高上限 11;悬在楼正上方掠过
//    不算穿楼,高度得比楼高才算)。车流会穿路口挡人:人走不动算环境 flake,换起点重试。
{
  let pass4 = false, moved = 0, marks = '';
  for (let t = 0; t < 3 && !pass4; t++) {
    await settle();
    const p0 = await S();
    await page.keyboard.down('w');
    let inBox = false; const mm = [];
    for (let i = 0; i < 4; i++) {
      await simWait(0.6, i ? pm.t : p0.t);
      var pm = await S();
      const hAt = await page.evaluate((c) => window.__gta.solidHeightAt(c[0], c[2]), pm.cam);
      if (hAt > pm.cam[1]) { inBox = true; mm.push(`相机在 h=${hAt.toFixed(1)} 盒里`); }
      else mm.push(`${pm.cam[1].toFixed(0)}米${hAt > 0 ? '掠楼顶' : '盒外'}`);
    }
    await page.keyboard.up('w');
    const pE = await S();
    moved = Math.hypot(pE.x - p0.x, pE.z - p0.z);
    pass4 = !inBox && moved > 6;
    marks = `人挪 ${moved.toFixed(1)} 米 — ${mm.join(' / ')}`;
  }
  console.log(pass4 ? 'PASS' : 'FAIL', `④ 楼街直走 2.4 世界秒(3 次内过线) — ${marks}`);
}
await browser.close();
