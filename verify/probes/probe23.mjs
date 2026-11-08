// 进店(probe23):门口 E 传送 → 屋内物理/相机 → E 出门还原,一条链全查。
// 用 __gta 的 shopDoors/shopRoom/inShop/enterShop/exitShop;坐标在店里=屋内局部系。
// 用法: node verify/probes/probe23.mjs [SEED]
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
const seed = await page.evaluate(() => window.__gta.seed);
console.log(`种子 seed=${seed}`);
const g = () => page.evaluate(() => window.__gta);

check('① 页面加载无 JS 报错', errs.length === 0, errs.slice(0, 2).join(' | '));

// ② 5 家店 + 门前落脚点全干净(和游戏生成器同一把尺子:probeSolid r=0.5,门前 1.4 米)
const doors = await page.evaluate(() => window.__gta.shopDoors);
const blocked = await page.evaluate((ds) => ds
  .map((d) => ({ ...d, bad: window.__gta.probeSolid(d.x + d.nx * 1.4, d.z + d.nz * 1.4, 0.5) }))
  .filter((d) => d.bad).map((d) => d.name), doors);
check('② 全城 5 家店、门前落脚点无一被顶',
  doors.length === 5 && new Set(doors.map((d) => d.name)).size === 5 && blocked.length === 0,
  `家数=${doors.length} 被顶=[${blocked.join(',')}] @ ${doors.map((d) => d.x + ',' + d.z).join(' ')}`);
// 同街区两家撑死隔条 60 米街面的两块地,不会跨路;跨路最小门距 ≈ 路宽 14 + 两侧退线 ≈ 16,
// 所以 12 米阈值只会逮住"同街区扎堆",不会误伤对门的两家。
const spread = Math.min(...doors.flatMap((a) => doors.filter((b) => b !== a).map((b) => Math.hypot(a.x - b.x, a.z - b.z))));
check('②b 5 家店不扎堆(任意两家 >12 米)', spread > 12, `最近两家相距 ${spread.toFixed(0)} 米`);

// ③ 人下车,传送到店 0 门口,按 E(真按键,测的是 keydown 那条路)→ 人应在屋里
await page.keyboard.press('f');
await sleep(S(700));
const d0 = doors[0];
// 门前 1.4 米这个落脚点刚被②验过干净,直接踩(侧挪的事别在浏览器函数里引用 d0 —— 那边没有它)
await page.evaluate(([x, z]) => window.__gta.footAt(x, z), [d0.x + d0.nx * 1.4, d0.z + d0.nz * 1.4]);
await sleep(S(500));
const near = await page.evaluate(() => window.__gta.shopNear);
check('③ 站门口 shopNear 报出店名', near === d0.name, `shopNear=${near},期望 ${d0.name}`);
const solidBefore = (await g()).solidCount;
await page.keyboard.press('e');
await sleep(S(400));
const s3 = await g();
const room = await page.evaluate(() => window.__gta.shopRoom);
check('③b 按 E 进屋:inShop=店名、人在屋框内、碰撞盒变多',
  s3.inShop === d0.name && Math.abs(s3.x) < room.w / 2 && Math.abs(s3.z) < room.d / 2 && s3.solidCount > solidBefore,
  `inShop=${s3.inShop} 人=(${s3.x},${s3.z}) 屋=${room.w}×${room.d} 障碍 ${solidBefore}→${s3.solidCount}`);

// ④ 四面走到极限都穿不出屋(每个方向按住 3 仿真秒,贴墙为止)
let maxIn = { x: 0, z: 0 }, escaped = null;
for (const k of ['w', 's', 'a', 'd']) {
  await page.evaluate(() => { window.__gta.footAt(0, 0); });
  await page.keyboard.down(k);
  const t0 = (await g()).simT;
  while ((await g()).simT - t0 < 3.2) {
    await sleep(S(400));
    const q = await g();
    if (Math.abs(q.x) > room.w / 2 + 0.2 || Math.abs(q.z) > room.d / 2 + 0.2) { escaped = `${k}:(${q.x},${q.z})`; break; }
    maxIn.x = Math.max(maxIn.x, Math.abs(q.x)); maxIn.z = Math.max(maxIn.z, Math.abs(q.z));
  }
  await page.keyboard.up(k);
  if (escaped) break;
}
check('④ 四面都穿不出屋(w/s/a/d 各顶 3.2 仿真秒)', !escaped,
  escaped ? `从 ${escaped} 逃出去了(半屋 ${room.w / 2}×${room.d / 2})` : `极限 (${maxIn.x.toFixed(1)},${maxIn.z.toFixed(1)}) 半屋 ${(room.w / 2).toFixed(1)}×${(room.d / 2).toFixed(1)}`);

// ⑤ 店内相机:贴着最远角也不钻到墙外/顶穿棚顶
await page.evaluate(([x, z]) => window.__gta.footAt(x, z), [room.w / 2 - 1.2, room.d / 2 - 1.2]);
await sleep(S(2500));   // 等相机阻尼把机位推到位(lag≈6/s,2.5 仿真秒足够贴边界)
const cam = await page.evaluate(() => window.__gta.camEye);
check('⑤ 店内相机夹在墙内不穿棚',
  Math.abs(cam.x) < room.w / 2 + 0.4 && Math.abs(cam.z) < room.d / 2 + 0.4 && cam.y > 0.5 && cam.y < room.h - 0.4,
  `cam=(${cam.x},${cam.y},${cam.z}) 屋=${room.w}×${room.d}×${room.h}`);

// ⑥ 再按 E 出门:碰撞盒清零,人回到门前世界坐标(店里 px/pz 是局部系,出门必须换算回全城坐标)
await page.keyboard.press('e');   // 人在屋里任意角落按 E 都行,落点由店门定,不靠"刚才站在哪"
await sleep(S(400));
const s6 = await g();
const distDoor = Math.hypot(s6.x - d0.x, s6.z - d0.z);
check('⑥ 按 E 出门:inShop=null、站回门前、碰撞盒整段摘掉',
  s6.inShop === null && distDoor < 4 && s6.solidCount === solidBefore,
  `inShop=${s6.inShop} 离门 ${distDoor.toFixed(1)} 米 障碍 ${s6.solidCount}(进店前 ${solidBefore})`);
await page.screenshot({ path: import.meta.dirname + '/../shots/shop-exit.png' });

// ⑦ 屋里能跳、不穿天花板:重新进店,Space 一下,峰值 0.5~1.8 且落回
await page.keyboard.press('e');
await sleep(S(300));
const roomIn = await page.evaluate(() => window.__gta.inShop);
let peak = 0, js = await g(), jT0 = js.simT, landed = false;
if (roomIn) {
  await page.keyboard.press(' ');
  while (js.simT - jT0 < 2.5) {
    peak = Math.max(peak, js.jumpH);
    if (peak > 0.3 && js.jumpH <= 0.05) { landed = true; break; }
    await sleep(S(150));
    js = await g();
  }
}
check('⑦ 屋里跳:起跳落回、没穿棚(jumpH 峰值 < 屋高)', roomIn && peak > 0.5 && peak < room.h && landed,
  `inShop=${roomIn} 峰值 ${peak.toFixed(2)} 米 屋高 ${room.h} ${landed ? '已落地' : '未落地'}`);
await page.screenshot({ path: import.meta.dirname + '/../shots/shop-inside.png' });
await page.keyboard.press('e');   // 收尾:出门,别把 harness 留在一屋子家具中间

check('⑧ 全程无 JS 报错', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log(failed ? `${failed} 项未通过` : '全部通过');
await browser.close();
process.exit(failed ? 1 : 0);
