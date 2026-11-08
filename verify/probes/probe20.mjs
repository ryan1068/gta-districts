// 种子 & 高楼专项:①同 seed 重放同一座城 ②不同 seed 城不同 ③高楼数量/封顶
// ④全部实体都矮过相机(收镜头休眠的前提)⑤高楼自带独立窗密贴图(第 5 类存在)
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:8017/gta/?autostart&noshadow';
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

const snap = async (url) => {
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await sleep(3000);
  return page.evaluate(() => {
    const G = window.__gta;
    // 车的碰撞盒是跟着车实时 syncSolid 的,车流一跑位置就变 —— 复现性只看静态实体(楼+树)
    const s = G.solids.filter((o) => !o.car);
    return {
      seed: G.seed,
      n: s.length,
      hash: JSON.stringify(s.map((o) => [+o.x.toFixed(2), +o.z.toFixed(2), +o.h.toFixed(2)])),
      tall: s.filter((o) => o.h >= 15.5).map((o) => +o.h.toFixed(1)),
      maxH: Math.max(...s.map((o) => o.h)),
      matClasses: G.bldMatCount,
    };
  });
};

const SEED = ((0x9e3779b9 ^ 12345) >>> 0).toString(36);
const A = await snap(`${BASE}&seed=${SEED}`);
const B = await snap(`${BASE}&seed=${SEED}`);
const C = await snap(`${BASE}&seed=${(0x9e3779b9 >>> 0).toString(36)}`);

check('① seed 回显 (__gta.seed)', A.seed === SEED, `URL ${SEED} → 游戏 ${A.seed}`);
check('① 同 seed 两次加载 = 同一座城', A.hash === B.hash && A.n === B.n, `实体 ${A.n} vs ${B.n}`);
check('② 不同 seed = 不同的城', A.hash !== C.hash, `实体 ${A.n} vs ${C.n}`);
check('③ 有高楼(≥16 米的实体 ≥1 栋)', A.tall.length >= 1, `高楼 ${A.tall.length} 栋: ${A.tall.sort((x, y) => y - x).slice(0, 12).join('/')}`);
check('③ 高楼没超出设计(全部 ≤22.1 米)', A.maxH <= 22.05, `最高实体 ${A.maxH.toFixed(2)} 米`);
check('④ 相机(24.4 米)高于一切实体 ≥2 米', A.maxH <= 22.4, `最高 ${A.maxH.toFixed(1)} 米,余量 ${(31.9 * Math.sin(50 * Math.PI / 180) - A.maxH).toFixed(1)} 米`);

check('⑤ 墙面贴图按类独立(≥5 类,含高楼专类)', A.matClasses >= 5, `${A.matClasses} 类墙面贴图`);

console.log(failed ? `${failed} 项未通过` : '全部通过');
await browser.close();
process.exit(failed ? 1 : 0);
