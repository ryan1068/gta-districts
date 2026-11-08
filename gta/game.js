import * as THREE from '../vendor/three.module.js';

// ══ 第一期范围:城市 + 开车 + 上下车 + 镜头。没有车流/行人/警察/任务 ══

const BLOCK = 46, ROAD = 14, PERIOD = BLOCK + ROAD, GRID = 7;   // 7x7 个街区
const HALF = (GRID * PERIOD) / 2;
const BH_MIN = 6, BH_MAX = 11;          // 普通楼(楼群)高度;高楼另在 16–22,见街区生成处
const TW_MIN = 16, TW_MAX = 22;         // 高楼:天际线点缀。相机 24.4 米仍压在全部屋顶之上(最高 22 米,留 2.4 米)
// 相机在玩家后上方,比一切屋顶(含高楼+女儿墙)都高一截,所以不需要裁剪面
const CAR_MAX = 26, CAR_REV = -9, ACCEL = 20, BRAKE = 34;
const YAW_MAX = 2.3, GRIP = 8.5, GRIP_DRIFT = 1.4, WALK = 5.6;
const RUN_MULT = 1.5, JUMP_V = 5.0, GRAV_J = 13;   // Shift 跑(走速×1.5);Space 跳:初速 5、重力 13 → 最高约 0.96 米、滞空约 0.77 秒
const clamp = THREE.MathUtils.clamp;   // 放在最前面:城市生成阶段也要用(原来夹在主循环旁边,eval 期调用会踩 TDZ)

const AUTOSTART = new URLSearchParams(location.search).has('autostart');
const Q = new URLSearchParams(location.search);
const AUTOSTART2 = Q.has('autostart');
const $ = (id) => document.getElementById(id);

// ── 可复现随机(种子)──
// URL 带 ?seed=xxx(36 进制)→ 同一座城原样重放;不带就用时钟随机。
// 验证套件每次开局会打印它用的 seed,红了拿这个 seed 回来就能精确复现那次现场。
// 整文件 Math.random 全换 rng:城市、贴图、车流、行人一口气全定住(仿真逐帧仍受
// 本机帧率影响,不追求逐帧可回放 —— 要复现的是"城市运气",不是 AI 轨迹)。
const SEED = (() => {
  const s = Q.get('seed');
  if (s != null && s !== '') { const v = parseInt(s, 36); if (!Number.isNaN(v) && (v >>> 0)) return v >>> 0; }
  return (Math.floor((performance.timeOrigin + performance.now()) * 1000) ^ (Date.now() << 3)) >>> 0;
})();
let _seed = SEED;
function rng() {   // mulberry32:几行代码,分布够用,够快
  _seed = (_seed + 0x6d2b79f5) >>> 0;
  let t = _seed;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
console.info(`城市种子 seed=${SEED.toString(36)} (URL 传 ?seed= 可重放同一座城)`);

window.addEventListener('error', (e) => {
  const d = document.createElement('div');
  d.className = 'err';
  d.textContent = 'JS 错误: ' + (e.message || 'unknown');
  document.body.appendChild(d);
});

// ══ 渲染器 ══
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
if (new URLSearchParams(location.search).has('noshadow')) {
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.BasicShadowMap;
}

const SKY = 0x1a2230;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 120, 430);

const camera = new THREE.PerspectiveCamera(56, innerWidth / innerHeight, 0.5, 700);

scene.add(new THREE.HemisphereLight(0xbcd0ff, 0x2b2620, 0.8));         // 剩下交给环境贴图
const sun = new THREE.DirectionalLight(0xffe2b0, 2.9);       // 低角度太阳 = 长影子
sun.position.set(-40, 26, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -62, right: 62, top: 62, bottom: -62, near: 1, far: 220 });
scene.add(sun, sun.target);

// ══ 城市 ══
const ground = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 200, HALF * 2 + 200),
  new THREE.MeshStandardMaterial({ map: roadTex(), roughness: 0.95 }));   // 沥青
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const solids = [];                       // 所有不能穿过去的东西(AABB)
const addSolid = (x, z, w, d, h = 1) => solids.push({ x, z, hw: w / 2, hd: d / 2, h });
// 声明贴在 solids 旁边:选店铺要在生成阶段就问 probeSolid,而 probeSolid 读这个集合 ——
// 挪在后面任何一处都会让店铺代码先撞 TDZ(实测页面白屏:Cannot access 'solidsOff' before initialization)。
const solidsOff = new Set();                 // 暂时不算障碍的 solid 下标 = 你正开着的那辆

// ── 进店状态:必须在 solids 消费方(probeSolid/pushOut)之前声明 ──
// 店内碰撞盒只在"人在店里"这段时间挂在 solids 尾部(s.interior 标记,出门整段截掉)。
// 过滤规矩是 `inside ? 只留 interior : 只丢 interior` —— 别写成 s.interior !== inside:
// 门外一侧 undefined !== false 恒真,会把全城障碍全滤光,人能直接穿楼走。
let inside = null;                        // 人在哪家店里(null=街上);它同时是碰撞过滤开关
let curShop = null, solidMark = 0, heroWasVisible = true;

const rand = (a, b) => a + rng() * (b - a);
const pick = (arr) => arr[(rng() * arr.length) | 0];
const BLOCK_COLORS = [0xb2a893, 0x8f9096, 0x9c7f6e, 0x7d8894, 0xa89b84, 0x6f7d8c, 0xbbb3a4];

const blockTypes = [];                   // 0=楼群 1=公园 2=停车场
const parks = [], lots = [];

const camPath = (i) => -HALF + i * PERIOD;   // 道路中心线(也是路口坐标)

// 先决定每块地是什么,免得后面反复算
for (let gz = 0; gz < GRID; gz++) for (let gx = 0; gx < GRID; gx++) {
  const r = rng();
  const t = r < 0.16 ? 1 : r < 0.30 ? 2 : 0;
  blockTypes.push(t);
  const cx = camPath(gx) + PERIOD / 2, cz = camPath(gz) + PERIOD / 2;
  if (t === 1) parks.push({ cx, cz }); else if (t === 2) lots.push({ cx, cz });
}
const blockIdx = (gx, gz) => blockTypes[gz * GRID + gx];

// ════════════════════════════════════════════════════════════
//  建模:全代码生成,不下载模型
//  俯视角度下真正看得见的是「屋顶」和「车的俯视轮廓」,
//  所以细节预算全砸在这两处:楼有女儿墙/空调机组/楼梯间/水塔,
//  车用挤出出来的真实车身轮廓(带圆角、车头收窄)而不是方块。
//  另外挂一张程序化生成的环境贴图 —— 没有它,金属和车漆就是黑的。
// ════════════════════════════════════════════════════════════

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

function makeCanvas(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  return cv;
}
function canvasTexture(cv, rx, ry, clampEdge) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = clampEdge ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  if (!clampEdge) t.repeat.set(rx, ry);
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}
function speckle(g, w, h, n, alpha) {
  for (let i = 0; i < n; i++) {
    const lit = rng() < 0.5;
    g.fillStyle = `rgba(${lit ? '255,255,255' : '0,0,0'},${(rng() * alpha).toFixed(3)})`;
    g.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 1 + rng() * 2);
  }
}

// 一个"开间 × 一层"的墙面单元,重复铺设后就是整栋楼的窗
function wallTex(cols, floors) {
  return canvasTexture(makeCanvas(64, 64, (g) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(0,0,0,.10)'; g.fillRect(0, 55, 64, 9);            // 楼板暗带
    g.fillStyle = 'rgba(0,0,0,.05)'; g.fillRect(0, 0, 64, 3);             // 上沿阴影
    g.fillStyle = '#1c222b'; g.fillRect(13, 13, 38, 30);                  // 玻璃
    g.fillStyle = 'rgba(148,190,228,.34)'; g.fillRect(13, 13, 38, 10);    // 天空反光
    g.fillStyle = 'rgba(255,214,150,.20)'; g.fillRect(13, 33, 38, 10);    // 室内灯光
    g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(31, 13, 2, 30);     // 窗框中竖
    g.fillStyle = '#9aa0a8'; g.fillRect(11, 43, 42, 3);                   // 窗台
    g.fillStyle = 'rgba(0,0,0,.07)'; g.fillRect(11, 11, 42, 2);
  }), cols, floors);
}
function gravelTex() {
  return canvasTexture(makeCanvas(128, 128, (g) => {
    g.fillStyle = '#565a60'; g.fillRect(0, 0, 128, 128);
    speckle(g, 128, 128, 2600, 0.16);
    g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 2;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(0, i * 32 + 8); g.lineTo(128, i * 32 + 8); g.stroke(); }
    g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(6, 6, 116, 3);            // 泛黄的水渍
    g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(20, 90, 80, 18);
  }), 3, 3);
}
function paveTex() {
  return canvasTexture(makeCanvas(64, 64, (g) => {
    g.fillStyle = '#7f838a'; g.fillRect(0, 0, 64, 64);
    speckle(g, 64, 64, 900, 0.13);
    g.strokeStyle = 'rgba(0,0,0,.22)'; g.lineWidth = 1.5;
    g.strokeRect(0.5, 0.5, 31, 31); g.strokeRect(32.5, 32.5, 31, 31);     // 铺装缝
    g.strokeStyle = 'rgba(0,0,0,.13)';
    g.strokeRect(32.5, 0.5, 31, 31); g.strokeRect(0.5, 32.5, 31, 31);
  }), 12, 12);
}
function roadTex() {
  return canvasTexture(makeCanvas(128, 128, (g) => {
    g.fillStyle = '#2c3037'; g.fillRect(0, 0, 128, 128);
    speckle(g, 128, 128, 3200, 0.14);
    g.fillStyle = 'rgba(0,0,0,.10)'; g.fillRect(0, 40, 128, 22);          // 轮胎带
    g.fillStyle = 'rgba(255,255,255,.03)'; g.fillRect(0, 96, 128, 14);
  }), (HALF * 2 + 200) / 12, (HALF * 2 + 200) / 12);
}
function grassTex() {
  return canvasTexture(makeCanvas(64, 64, (g) => {
    g.fillStyle = '#37643b'; g.fillRect(0, 0, 64, 64);
    speckle(g, 64, 64, 1500, 0.2);
    g.fillStyle = 'rgba(150,180,120,.10)';
    for (let i = 0; i < 26; i++) g.fillRect(rng() * 64, rng() * 64, 3, 2);
  }), 8, 8);
}
function blobTex() {
  return canvasTexture(makeCanvas(64, 64, (g) => {
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, 'rgba(0,0,0,.62)');
    grd.addColorStop(0.55, 'rgba(0,0,0,.30)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  }), 1, 1, true);
}

// 黄昏渐变的环境贴图:车漆和金属终于有东西可反射了
function applyEnv() {
  const cv = makeCanvas(256, 128, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#33456b'); grd.addColorStop(0.44, '#7d8fa8');
    grd.addColorStop(0.52, '#e0a166'); grd.addColorStop(0.62, '#6a5a52');
    grd.addColorStop(1, '#24262b');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,236,190,.75)'; g.beginPath(); g.arc(w * 0.18, h * 0.46, 11, 0, 7); g.fill();
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(t).texture;
  scene.environmentIntensity = 0.55;
  t.dispose();
  pmrem.dispose();
}
applyEnv();

// ── 车身俯视轮廓:圆角 + 车头收窄,挤出成实体 ──
function carPlan(L, W, taper) {
  const s = new THREE.Shape(), hw = W / 2, hl = L / 2, hwn = hw * (1 - taper);
  s.moveTo(-hw, -hl);
  s.lineTo(hw, -hl);
  s.lineTo(hwn, hl * 0.42);
  s.quadraticCurveTo(hwn, hl, hwn * 0.62, hl);
  s.lineTo(-hwn * 0.62, hl);
  s.quadraticCurveTo(-hwn, hl, -hwn, hl * 0.42);
  s.closePath();
  return s;
}
// 挤出后把车身转正:车头朝 +Z,底面贴 y=0
function carSolidGeo(L, W, H, taper, curve) {
  const g = new THREE.ExtrudeGeometry(carPlan(L, W, taper), {
    depth: H, bevelEnabled: true, bevelThickness: 0.09, bevelSize: 0.13,
    bevelSegments: 1, curveSegments: curve, steps: 1,
  });
  g.rotateX(Math.PI / 2);
  g.translate(0, H + 0.09, 0);
  g.computeVertexNormals();
  return g;
}

// ── 人行道(整块街区的铺装,贴图缝距固定)──
const sidewalk = new THREE.InstancedMesh(unitBox,
  new THREE.MeshStandardMaterial({ map: paveTex(), roughness: 0.92 }), GRID * GRID);
sidewalk.receiveShadow = true;
scene.add(sidewalk);

// ── 楼:按「 footprint × 高度」分 4 类,同类共用墙面贴图密度,窗子大小才一致 ──
const bld = [];
for (let gz = 0; gz < GRID; gz++) for (let gx = 0; gx < GRID; gx++) {
  const cx = camPath(gx) + PERIOD / 2, cz = camPath(gz) + PERIOD / 2;
  const m = new THREE.Matrix4().makeScale(BLOCK, 0.34, BLOCK);
  m.setPosition(cx, 0.17, cz);
  sidewalk.setMatrixAt(gz * GRID + gx, m);

  if (blockIdx(gx, gz) !== 0) continue;
  const n = rng() < 0.45 ? 2 : 3;
  const cell = BLOCK / n;
  let tallDone = false;                                  // 每街区最多 1 栋高楼
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (rng() < 0.22) continue;
    const inset = rand(2.4, 5.2);
    const w = cell - inset, d = cell - inset;
    const x = cx - BLOCK / 2 + cell * (i + 0.5), z = cz - BLOCK / 2 + cell * (j + 0.5);
    const tall = !tallDone && rng() < 0.09;              // ≈3 成楼群街区出 1 栋,全城约十栋
    if (tall) tallDone = true;
    const h = tall ? rand(TW_MIN, TW_MAX) : rand(BH_MIN, BH_MAX);
    bld.push({ x, z, w, d, h, tall, color: pick(BLOCK_COLORS) });
    // h 要真传:camHitXZ 按 h 过滤遮挡物。以前不传默认 h=1,楼对相机射线是"透明"的 ——
    // 开车视角高(≥16 米)无所谓,步行 8 米近景就会直接穿进楼壳里。
    // 开车侧靠 hMin=12(> BH_MAX)维持"楼永远不挡镜头"的原设计,行为一字不变。
    addSolid(x, z, w, d, h);
  }
}
const CLASSES = [[15, 8.5], [15, 99], [0, 8.5], [0, 99], [0, 0]];   // [宽度门槛, 高度门槛];第 5 类 = 高楼专用(窗密按真实层高单独算,别被普通楼平均值带偏)
const bucket = (b) => b.tall ? 4 : ((b.w >= 15 ? 1 : 0) * 2) + (b.h >= 8.5 ? 1 : 0);
const acList = [], stairList = [], tankList = [], mastList = [];
const bldMats = [];                            // 一类楼一套墙面贴图(= 贴图类数),harness 数高楼专用类用

CLASSES.forEach((thr, ci) => {
  const group = bld.filter((b) => bucket(b) === ci);
  if (!group.length) return;
  const avgW = group.reduce((s, b) => s + b.w, 0) / group.length;
  const avgH = group.reduce((s, b) => s + b.h, 0) / group.length;
  const cols = Math.max(2, Math.round(avgW / 2.6)), floors = Math.max(2, Math.round(avgH / 2.9));

  const body = new THREE.InstancedMesh(unitBox,
    new THREE.MeshStandardMaterial({ map: wallTex(cols, floors), roughness: 0.8, metalness: 0.06 }), group.length);
  bldMats.push(body.material);
  const roof = new THREE.InstancedMesh(unitBox,
    new THREE.MeshStandardMaterial({ map: gravelTex(), roughness: 0.95 }), group.length);
  body.castShadow = body.receiveShadow = true;
  roof.castShadow = roof.receiveShadow = true;

  group.forEach((b, i) => {
    dummy.position.set(b.x, b.h / 2, b.z); dummy.scale.set(b.w, b.h, b.d);
    dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
    body.setMatrixAt(i, dummy.matrix); body.setColorAt(i, tmpColor.setHex(b.color));

    // 屋顶板略微外扩 = 女儿墙,从上面一眼就能看出这是楼而不是方块
    dummy.position.set(b.x, b.h - 0.09, b.z); dummy.scale.set(b.w + 0.55, 0.46, b.d + 0.55);
    dummy.updateMatrix(); roof.setMatrixAt(i, dummy.matrix);

    const top = b.h + 0.14, span = Math.min(b.w, b.d) / 2 - 1.8;
    const put = (arr, x, z, y, sx, sy, sz, ry) => arr.push({ x: b.x + x, z: b.z + z, y, sx, sy, sz, ry });
    for (let k = 0, cnt = 1 + (rng() < 0.55 ? 1 : 0); k < cnt; k++)
      put(acList, rand(-span, span), rand(-span, span), top + 0.34, 1.5, 0.68, 1.5, rand(0, 1.57));
    // 楼梯间/水塔/天线只给普通楼:高楼 22 米再摞这些就顶穿 24.4 米的相机了,只留矮平的空调机组
    if (!b.tall && rng() < 0.7)
      put(stairList, rand(-span * 0.6, span * 0.6), rand(-span * 0.6, span * 0.6), top + 0.85, 2.6, 1.7, 2.1, 0);
    if (!b.tall && b.w >= 15 && rng() < 0.75)
      put(tankList, rand(-span * 0.7, span * 0.7), rand(-span * 0.7, span * 0.7), top + 1.1, 1.9, 2.2, 1.9, 0);
    if (!b.tall && rng() < 0.4)
      put(mastList, rand(-span, span), rand(-span, span), top + 1.7, 0.09, 3.4, 0.09, 0);
  });
  scene.add(body, roof);
});

// 屋顶杂物:全是实例化,加起来只有几个 draw call,但长影子一拉就像座城市了
function clutter(geo, mat, list, shadow) {
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  im.castShadow = shadow; im.receiveShadow = true;
  list.forEach((o, i) => {
    dummy.position.set(o.x, o.y, o.z); dummy.scale.set(o.sx, o.sy, o.sz);
    dummy.rotation.set(0, o.ry || 0, 0); dummy.updateMatrix();
    im.setMatrixAt(i, dummy.matrix);
  });
  scene.add(im);
  return im;
}
const clutterMat = new THREE.MeshStandardMaterial({ color: 0x6f747b, roughness: 0.75, metalness: 0.2 });
clutter(unitBox, clutterMat, acList, true);
clutter(unitBox, new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.85 }), stairList, true);
clutter(new THREE.CylinderGeometry(0.62, 0.62, 1, 12),
  new THREE.MeshStandardMaterial({ color: 0x9a9488, roughness: 0.6, metalness: 0.35 }), tankList, true);
clutter(new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
  new THREE.MeshStandardMaterial({ color: 0xb9c0c8, roughness: 0.5, metalness: 0.6 }), mastList, true);

// ── 路面标线:中线虚线 + 每个路口四条斑马线 ──
{
  const dash = new THREE.InstancedMesh(unitBox,
    new THREE.MeshStandardMaterial({ color: 0xd9c86a, roughness: 0.7 }), 4096);
  let n = 0;
  for (let i = 0; i <= GRID; i++) {
    const c = camPath(i);
    for (let s = -HALF; s < HALF; s += 6) {
      if (Math.abs(((s + HALF) % PERIOD) - BLOCK / 2 - ROAD / 2) < ROAD / 2 + 1.5) continue;
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(c, 0.05, s); dummy.scale.set(0.24, 0.06, 2.6);
      dummy.updateMatrix(); dash.setMatrixAt(n++, dummy.matrix);
      dummy.position.set(s, 0.05, c); dummy.scale.set(2.6, 0.06, 0.24);
      dummy.updateMatrix(); dash.setMatrixAt(n++, dummy.matrix);
    }
  }
  dash.count = n;
  scene.add(dash);
}
{
  const bar = new THREE.InstancedMesh(unitBox,
    new THREE.MeshStandardMaterial({ color: 0xcfcabf, roughness: 0.8 }), (GRID + 1) * (GRID + 1) * 24);
  let n = 0;
  for (let i = 0; i <= GRID; i++) for (let j = 0; j <= GRID; j++) {
    const cx = camPath(i), cz = camPath(j);
    for (const side of [1, -1]) for (const axis of [0, 1]) {     // axis 0: 横穿 1: 竖穿
      for (let k = 0; k < 6; k++) {
        const off = (k - 2.5) * 1.15;
        dummy.rotation.set(0, 0, 0);
        if (axis === 0) dummy.position.set(cx + off, 0.07, cz + side * (ROAD / 2 + 1.4)), dummy.scale.set(0.55, 0.05, 2.8);
        else dummy.position.set(cx + side * (ROAD / 2 + 1.4), 0.07, cz + off), dummy.scale.set(2.8, 0.05, 0.55);
        dummy.updateMatrix(); bar.setMatrixAt(n++, dummy.matrix);
      }
    }
  }
  bar.count = n;
  scene.add(bar);
}

// ── 路灯:低角度太阳下那一排长影子,是俯视城市最有说服力的东西 ──
{
  const spots = [];
  for (let i = 0; i <= GRID; i++) for (let s = -HALF + 12; s < HALF - 12; s += 26) {
    // 路口让位:杆是"沿这条路"每 26 米撒一档,26 和路周期 60 不互质——总有几档恰好
    // 落在横穿马路那 14 米宽的铺装带里(实测 512 根里 128 根栽在别人家路上,离那个
    // 路口越近越明显)。离任一交叉口中心 <13 米的档位直接跳过,一排灯在路口前自然断档。
    const nearCross = Math.abs(s - (Math.round((s + HALF) / PERIOD) * PERIOD - HALF));
    if (nearCross < 13) continue;
    for (const side of [1, -1]) {
      // 杆身在人行道上(离中心线 9.4 = 路缘 7 + 2.4),泊位车外缘才 6.4,不会被车身吞;
      // 探向车道的是灯头悬臂(1.65 米)——悬臂要朝路面,不是朝街向:
      // 竖路(x=camPath±off)悬臂沿 x 够到中线方向,横路(z=camPath±off)沿 z;
      // 原来两条公式正好写反(都是沿街向),整条街的灯全在照自家人行道。
      const off = (ROAD / 2 + 2.4) * side;
      spots.push({ x: camPath(i) + off, z: s, ry: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
      spots.push({ x: s, z: camPath(i) + off, ry: side > 0 ? Math.PI : 0 });
    }
  }
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.14, 1, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.6, metalness: 0.5 }), spots.length);
  const arm = new THREE.InstancedMesh(unitBox,
    new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.6, metalness: 0.5 }), spots.length);
  const head = new THREE.InstancedMesh(unitBox,
    new THREE.MeshBasicMaterial({ color: 0xffe9b8, toneMapped: false }), spots.length);
  pole.castShadow = arm.castShadow = true;
  spots.forEach((o, i) => {
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(o.x, 3.1, o.z); dummy.scale.set(1, 6.2, 1);
    dummy.updateMatrix(); pole.setMatrixAt(i, dummy.matrix);
    dummy.position.set(o.x + Math.sin(o.ry) * 0.85, 6.1, o.z + Math.cos(o.ry) * 0.85);
    dummy.scale.set(0.16, 0.16, 1.9); dummy.rotation.set(0, o.ry, 0);
    dummy.updateMatrix(); arm.setMatrixAt(i, dummy.matrix);
    dummy.position.set(o.x + Math.sin(o.ry) * 1.65, 5.95, o.z + Math.cos(o.ry) * 1.65);
    dummy.scale.set(0.5, 0.16, 0.34);
    dummy.updateMatrix(); head.setMatrixAt(i, dummy.matrix);
  });
  scene.add(pole, arm, head);
}

// ── 公园:草地 + 三层树冠(俯视看就是一团有层次的绿)──
{
  const lawnMat = new THREE.MeshStandardMaterial({ map: grassTex(), roughness: 1 });
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.26, 0.4, 1, 8),
    new THREE.MeshStandardMaterial({ color: 0x5a4127, roughness: 0.9 }), parks.length * 9);
  const leaf = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: 0x35693a, roughness: 0.85, flatShading: true }), parks.length * 27);
  trunk.castShadow = leaf.castShadow = true;
  let n = 0, leafN = 0;
  for (const p of parks) {
    const lawn = new THREE.Mesh(new THREE.BoxGeometry(BLOCK, 0.5, BLOCK), lawnMat);
    lawn.position.set(p.cx, 0.25, p.cz);
    lawn.receiveShadow = true;
    scene.add(lawn);
    for (let k = 0; k < 9; k++) {
      const x = p.cx + rand(-BLOCK / 2 + 4, BLOCK / 2 - 4), z = p.cz + rand(-BLOCK / 2 + 4, BLOCK / 2 - 4);
      const h = rand(3.2, 5.4), base = rand(1.5, 2.3);
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(x, h / 2 + 0.4, z); dummy.scale.set(1, h, 1);
      dummy.updateMatrix(); trunk.setMatrixAt(n++, dummy.matrix);
      for (let b = 0; b < 3; b++) {
        const r = base * (1 - b * 0.22);
        dummy.position.set(x + rand(-0.5, 0.5), h + 0.5 + b * base * 0.62, z + rand(-0.5, 0.5));
        dummy.scale.set(r, r * 0.82, r);
        dummy.rotation.set(0, rand(0, 3), 0);
        dummy.updateMatrix(); leaf.setMatrixAt(leafN++, dummy.matrix);
      }
      addSolid(x, z, 0.9, 0.9, 3);           // h=3:相机拉近了以后别从树冠里穿过去
    }
  }
  trunk.count = n; leaf.count = leafN;
  scene.add(trunk, leaf);
}

// ══ 可进店:全城标 5 家推得开门的铺子(门口按 E 传进预制室内,再按 E 走回街上)══
// 规矩:
//  · 只在普通矮楼里挑 footprint ≥13.2 米的 —— 高楼是天际线道具,不该能钻进去;
//  · 每个街区最多 1 家,选铺用 Fisher-Yates 洗牌后的顺序 —— 洗牌即散点,不会扎堆一角;
//  · 门开在离最近马路那一面的墙上,门前 1.4 米必须站得住(probeSolid 干净),
//    不行退试次近的一面,两面都不行这块地就换下一家;
//  · 洗牌在这里消耗 rng —— 老种子的车流/行人位置会变,楼群不变(rng 流从这段才分叉)。
// 室内不在这建:第一次进哪家才现建哪家(buildShop),屋子坐落世界原点,
// 靠一圈 BackSide 黑壳把街上的一切挡在屋外,见 buildShop 里的注释。
const SHOP_KINDS = [
  { name: '老张面馆', glow: 0xff7043, floor: 0x8a6f52 },
  { name: '街口超市', glow: 0x53a6ff, floor: 0x8d8f96 },
  { name: '修车铺',   glow: 0xffc24a, floor: 0x6e737a },
  { name: '社区诊所', glow: 0x4fd17c, floor: 0x9fa79f },
  { name: '电玩厅',   glow: 0xb06bff, floor: 0x565064 },
];
const shops = [];
{
  const cands = bld.filter((b) => !b.tall && b.w >= 13.2 && b.d >= 13.2);
  for (let i = cands.length - 1; i > 0; i--) {          // Fisher-Yates
    const j = (rng() * (i + 1)) | 0; const tv = cands[i]; cands[i] = cands[j]; cands[j] = tv;
  }
  const taken = new Set();
  for (let pass = 0; pass < 2 && shops.length < 5; pass++) {
    const usedBlocks = new Set();                        // 第二轮放宽街区名额(只防同一家楼标两次)
    for (const b of cands) {
      if (shops.length >= 5) break;
      if (taken.has(b)) continue;
      const bk = ((b.x + HALF) / PERIOD | 0) * GRID + ((b.z + HALF) / PERIOD | 0);
      if (usedBlocks.has(bk)) continue;
      const hw = b.w / 2, hd = b.d / 2;
      const rx = camPath(Math.round((b.x + HALF) / PERIOD));   // 最近竖路中线
      const rz = camPath(Math.round((b.z + HALF) / PERIOD));   // 最近横路中线
      const faces = [
        { nx: 1, nz: 0, g: Math.abs(rx - (b.x + hw)) },
        { nx: -1, nz: 0, g: Math.abs((b.x - hw) - rx) },
        { nx: 0, nz: 1, g: Math.abs(rz - (b.z + hd)) },
        { nx: 0, nz: -1, g: Math.abs((b.z - hd) - rz) },
      ].sort((p, q) => p.g - q.g);
      let face = null, dx = 0, dz = 0, tOff = 0;
      for (const f of faces.slice(0, 2)) {               // 最近两面各试;都不行换下一家
        const tl = f.nx ? b.d : b.w;
        for (const tryT of [0, rand(-0.18, 0.18) * tl]) {
          const gx2 = f.nx ? b.x + f.nx * hw : b.x + tryT;
          const gz2 = f.nx ? b.z + tryT : b.z + f.nz * hd;
          if (!probeSolid(gx2 + f.nx * 1.4, gz2 + f.nz * 1.4, 0.5)) {
            face = f; dx = gx2; dz = gz2; tOff = tryT; break;
          }
        }
        if (face) break;
      }
      if (!face) continue;
      usedBlocks.add(bk); taken.add(b);
      const K = SHOP_KINDS[shops.length % SHOP_KINDS.length];
      const glowM = new THREE.MeshBasicMaterial({ color: K.glow, toneMapped: false });
      const stepM = new THREE.MeshStandardMaterial({ color: 0x3c424c, roughness: 0.9 });
      const door = new THREE.Group();
      const mk = (sw, sh, sd, x, y, z, mat) => {
        const m = new THREE.Mesh(unitBox, mat);
        m.position.set(x, y, z); m.scale.set(sw, sh, sd);
        m.castShadow = false; m.receiveShadow = false; door.add(m);
      };
      // 沿墙尺寸看朝向:朝 ±x 的门,宽度落在 z 轴上
      mk(face.nx ? 0.14 : 1.6, 2.15, face.nx ? 1.6 : 0.14, dx + face.nx * 0.1, 1.08, dz + face.nz * 0.1, glowM);
      mk(face.nx ? 0.22 : 2.3, 0.5, face.nx ? 2.3 : 0.22, dx + face.nx * 0.18, 2.78, dz + face.nz * 0.18, glowM);
      mk(face.nx ? 1.1 : 1.9, 0.06, face.nx ? 1.9 : 1.1, dx + face.nx * 0.85, 0.05, dz + face.nz * 0.85, stepM);
      scene.add(door);
      shops.push({ i: shops.length, K, b, face, t: tOff, dx, dz, built: false, group: null, room: null, solidSpecs: [] });
    }
  }
}

// ── 车型:五种俯视轮廓互不相同的车 ──
// 同类共用一套实例化几何,所以开销跟着"种类"涨、不跟着"数量"涨。
// body/cab = [长, 宽, 高, 沿车头方向的偏移];wz = 前后轴位置;z 正向 = 车头
const GEO = {
  sedan:  { L: 4.4, W: 2.15, body: [4.4, 2.05, 0.72, 0],    cab: [2.1, 1.74, 0.5, -0.1],   tb: 0.16, tc: 0.22, wr: 0.44, ww: 0.32, wx: 1.02, wz: [1.42, -1.42], r: 1.5,  yaw: 1.0,  steer: 0.42, onBody: true,  wing: true,  skirt: true },
  suv:    { L: 4.9, W: 2.3,  body: [4.9, 2.2, 0.9, 0],      cab: [2.7, 1.98, 0.66, -0.15], tb: 0.08, tc: 0.1,  wr: 0.5,  ww: 0.36, wx: 1.12, wz: [1.6, -1.6],    r: 1.65, yaw: 0.9,  steer: 0.38, onBody: true,  rails: true, skirt: true },
  sport:  { L: 4.3, W: 2.3,  body: [4.3, 2.25, 0.58, 0],    cab: [1.75, 1.62, 0.4, -0.3],  tb: 0.26, tc: 0.3,  wr: 0.42, ww: 0.34, wx: 1.12, wz: [1.42, -1.42],  r: 1.6,  yaw: 1.12, steer: 0.46, onBody: true,  wing: true,  skirt: true, low: true },
  van:    { L: 5.9, W: 2.4,  body: [4.3, 2.32, 1.72, -0.8], cab: [1.6, 2.18, 0.98, 1.9],   tb: 0.02, tc: 0.08, wr: 0.52, ww: 0.4,  wx: 1.16, wz: [2.2, -1.85],   r: 1.95, yaw: 0.8,  steer: 0.3,  onBody: false, doors: true },
  pickup: { L: 5.0, W: 2.3,  body: [3.1, 2.2, 0.66, -1.05], cab: [2.1, 1.98, 0.74, 1.1],   tb: 0.04, tc: 0.12, wr: 0.5,  ww: 0.38, wx: 1.1,  wz: [1.9, -1.75],   r: 1.85, yaw: 0.88, steer: 0.34, onBody: false, bed: true, skirt: true },
};
// 变体 = 几何 + 涂装 + 性能。出租车和轿车共用一套几何,只是黄漆加顶灯。
const TYPES = [
  { key: 'sedan',  geo: 'sedan',  name: '轿车',   w: 0.30, top: 1.0,  acc: 1.0 },
  { key: 'taxi',   geo: 'sedan',  name: '出租车', w: 0.10, top: 0.95, acc: 1.0, color: 0xf0b429, sign: true },
  { key: 'suv',    geo: 'suv',    name: 'SUV',    w: 0.18, top: 0.92, acc: 0.9 },
  { key: 'sport',  geo: 'sport',  name: '跑车',   w: 0.12, top: 1.18, acc: 1.3 },
  { key: 'van',    geo: 'van',    name: '货车',   w: 0.14, top: 0.78, acc: 0.7 },
  { key: 'pickup', geo: 'pickup', name: '皮卡',   w: 0.16, top: 0.9,  acc: 0.9 },
];
const TBY = {};
TYPES.forEach((t) => { TBY[t.key] = t; });
function pickType() {
  let r = rng();
  for (let i = 0; i < TYPES.length; i++) { r -= TYPES[i].w; if (r <= 0) return TYPES[i]; }
  return TYPES[TYPES.length - 1];
}
for (const k in GEO) {                       // 由轮径和车壳高度推出各零件的安装高度
  const g = GEO[k];
  g.key = k;
  g.by = g.wr - 0.04;                        // 车壳贴着轮心装,不然像浮在地上
  g.cy = g.onBody ? g.by + g.body[2] - 0.06 : g.by;
  g.roofY = g.cy + g.cab[2];
}

// ── 车注册表:每一辆都能开走 ──
// 停着的用实例化渲染;你手上那台临时从实例里"抽出来"换成精细主角车,
// 下车时再塞回去 —— 所以你走开后车还站在原地,没有消失。
const CARC = [0xd94f3d, 0x3f6fa8, 0xd8c65a, 0x8b8f96, 0x2f3238, 0x6a9c5d, 0xb9b2a3, 0x2c6f6a, 0xa34a3f];
const cars = [];
// solidsOff 挪到了 solids 旁边(选店铺时 probeSolid 要在生成阶段就用它)
let mode = 'car';                            // car | foot
let active = null, myCar = null;             // 正在开的 / 和你绑定的那辆(车顶标记跟着它)

function mkCar(x, z, ry, t) {
  t = t || pickType();
  const g = GEO[t.geo];
  const c = { i: cars.length, x, z, ry, t, g: t.geo, slot: 0, sign: -1, blanked: false,
              color: t.color || pick(CARC), top: t.top, acc: t.acc, traffic: false };
  cars.push(c);
  addSolid(x, z, g.W, g.L);   // addSolid 收的是全尺寸(内部除 2):原来这里传了半尺寸,车头顶车头只停到 2.6 米,两车看着叠在一起
  c.solid = solids.length - 1;
  solids[c.solid].car = c;
  syncSolid(c);
  return c;
}
// 开局那台停在最近路口(它是 0 号)
{
  const [sx, sz] = nearestCrossing(0, 0);
  const c0 = mkCar(sx, sz, 0, TBY.sedan);
  c0.color = 0xd94f3d;
}
// 路边停车
{
  // 停车规矩:按「路边」一行一行地停,只停在两个路口之间的路肩上,不压斑马线、
  // 不互相叠着。原来的写法是每 3 次随机撒点,实测 118 辆里有 46 辆停在路口里,
  // 而且会两辆叠在一起 —— 既不象,也会把后面的车流堵死。
  const MARG = ROAD / 2 + 2, CURB = ROAD / 2 - 1.7;   // 路肩两端各让出一个路口的宽度
  for (let a = 0; a <= GRID; a++) {
    const line = camPath(a);
    for (let b = 0; b < GRID; b++) {
      const p0 = camPath(b) + MARG, p1 = camPath(b + 1) - MARG;
      for (const horiz of [true, false]) for (const side of [-1, 1]) {
        if (rng() < 0.88) continue;      // 只有 ~12% 的路边段有停车
        // 一行也别从这头排满到那头(那是停车场,不是街):零散 1~4 辆、车距拉大。
        // 上一版这样改过,但只留了"第 0~2 辆"——while 条件没动,第 2 辆的 at 一旦越过
        // 行尾 p1 就提前 break,泊位从此恒 ≤2 辆、全城只剩 55 辆,稀得没人味了
        // (实测"路边泊位够抢"红过)。改成行尾判定放前面,放不满就走到行尾自己停。
        let at = p0, n = (rng() < 0.5 ? 1 : rng() < 0.62 ? 2 : rng() < 0.6 ? 3 : 4);
        while (at < p1 && n-- > 0) {
          const t = pickType(), L = GEO[t.geo].L;
          if (at + L > p1) break;
          const mid = at + L / 2;
          const x = horiz ? mid : line + CURB * side;
          const z = horiz ? line + CURB * side : mid;
          // 车头顺着它停靠的那条街:横路(沿 X)朝 ±X,竖路朝 ±Z。
          // 原来这行是反的,一排车全改成 sideways 戳在路中间,像停车场不像路边。
          mkCar(x, z, horiz ? (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2)
                            : (rng() < 0.5 ? 0 : Math.PI), t);
          at += L + rand(2.5, 7);                // 车间零散,不贴保险杠
        }
      }
    }
  }
}
// ══ 车流:自己会开的车 ══
// 靠右行驶:车道中心在道路中心线 ±2.6,正好避开 4.2 以外的路肩停车带。
// 每辆车只记「在哪条路、朝哪个方向、下一个路口怎么走」,不需要寻路表。
const TRAFFIC = 22, LANE = 2.6;
let TRACE_I = -1;
const TRACE_LOG = [];
function traceCar(c) {                       // 逐帧记录一辆车,别的车不付代价
  if (TRACE_I < 0) return;
  TRACE_LOG.push({ x: +c.x.toFixed(2), z: +c.z.toFixed(2), ry: +c.ry.toFixed(3), ax: c.axis,
    lane: +c.lane.toFixed(2), err: +(((c.axis === 'x' ? c.z : c.x) - c.lane)).toFixed(2),
    spd: +c.spd.toFixed(2), turn: !!c.turn, want: +c.spd.toFixed(1) });
  if (TRACE_LOG.length > 40) TRACE_LOG.shift();
}
const TMIN = 1, TMAX = GRID - 1;      // 车流只用内圈的路和路口(外环路的沥青只有一半在地面里)
function nextCrossCoord(dir, along) {          // 路口坐标满足 (坐标 + HALF) % PERIOD == 0
  const k = dir > 0 ? Math.ceil((along + HALF) / PERIOD) : Math.floor((along + HALF) / PERIOD);
  return -HALF + k * PERIOD;
}
function ryOf(axis, dir) {                     // 车头朝向:axis 上按 dir 走
  return axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
}
function laneOf(axis, line, dir) {             // 右手法则:前进方向的右侧那条道
  return axis === 'x' ? line + LANE * dir : line - LANE * dir;
}
// 右转后的前进方向 = 当前方向的右侧 = (-fz, fx)
function rightTurn(axis, dir) {
  return axis === 'x' ? { axis: 'z', dir: dir } : { axis: 'x', dir: -dir };
}
function relane(c) {
  // 先把车拉回内圈,再按所在位置定车道。反过来做就会把 line 定歪:
  // 实测有 6 辆车实际在外环路(z=210 那条)上开,却被夹成 line=150,
  // 于是它们一路横穿整条街区去"找回自己的车道",离路越开越远。
  const lo = camPath(TMIN) - LANE, hi = camPath(TMAX) + LANE;
  c.x = clamp(c.x, lo, hi); c.z = clamp(c.z, lo, hi);
  const fx = Math.sin(c.ry), fz = Math.cos(c.ry);
  const axis = Math.abs(fx) > Math.abs(fz) ? 'x' : 'z';
  const dir = axis === 'x' ? (fx > 0 ? 1 : -1) : (fz > 0 ? 1 : -1);
  const line = axis === 'x' ? nearestCrossCoord(c.z) : nearestCrossCoord(c.x);
  c.axis = axis; c.dir = dir; c.line = line; c.lane = laneOf(axis, line, dir);
  // 重新上牌要一次到位:车头摆正、车身压到车道中心。原来只改 line/lane,
  // 车头还带着拐歪的角度继续开 —— 横向漂出比纠偏还快, Err 十几米下不来。
  c.ry = ryOf(axis, dir);
  if (axis === 'x') c.z = c.lane; else c.x = c.lane;
  c.turn = null;
  c.nextCross = nextCrossCoord(dir, axis === 'x' ? c.x : c.z);
}
const nearestCrossCoord = (v) => Math.round((v + HALF) / PERIOD) * PERIOD - HALF;
function spawnTraffic() {
  const [sx, sz] = nearestCrossing(0, 0);
  const ix = Math.round((sx + HALF) / PERIOD), iz = Math.round((sz + HALF) / PERIOD);
  for (let n = 0; n < TRAFFIC; n++) {
    const near = n < TRAFFIC * 0.6;            // 六成就放在开局附近,一上车就能看见车流
    const axis = rng() < 0.5 ? 'x' : 'z';
    const jitter = () => (rng() * 5 | 0) - 2;
    const a = clampT((axis === 'x' ? iz : ix) + (near ? (rng() < 0.5 ? -1 : 1) : jitter()));
    const b = clampT((axis === 'x' ? ix : iz) + (near ? ((rng() * 3 | 0) - 1) : jitter()));
    const line = camPath(a);
    const dir = rng() < 0.5 ? 1 : -1;
    const mid = clamp(camPath(b) + rand(PERIOD * 0.28, PERIOD * 0.72), camPath(TMIN) + 9, camPath(TMAX) - 9);
    const t = pickType();
    const x = axis === 'x' ? mid : line - LANE * dir;
    const z = axis === 'x' ? line + LANE * dir : mid;
    const c = mkCar(x, z, ryOf(axis, dir), t);
    Object.assign(c, {
      traffic: true, trafficAI: true, spd: rand(7, 12) * t.top, cruise: rand(8, 13) * t.top,
      axis, dir, line, lane: axis === 'x' ? z : x, turn: null,
      nextCross: nextCrossCoord(dir, mid),
    });
  }
}
const clampT = (i) => Math.max(TMIN, Math.min(TMAX, i));

function updateTraffic(dt) {
  for (const c of cars) {
    if (!c.trafficAI || c.blanked) continue;
    if (c.i === TRACE_I) traceCar(c);
    const g = GEO[c.g], fx = Math.sin(c.ry), fz = Math.cos(c.ry);
    let want = c.cruise, staticBlock = false, row = false, hard = false;   // row=因路权停,hard=跟前车/静止车顶住了
    for (const o of cars) {                    // 前方同车道内有车就让路(包括你停在路上那辆)
      if (o === c) continue;
      const dx = o.x - c.x, dz = o.z - c.z, al = dx * fx + dz * fz;
      // 路权让右:横向接近、在我右侧、正在穿越我路径带的车流车有先行权。
      // 前向扫描只看同车道,横向来车互相看不见 —— 穿楼去重后测出 4 台在路口叠停。
      // "右侧来车"对每一对交叉恰好有一方成立,规则天然反对称,不会互让打转。
      if (o.trafficAI && !o.blanked) {
        const ox = Math.sin(o.ry), oz = Math.cos(o.ry), lat = dx * fz - dz * fx;
        if (Math.abs(fx * oz - fz * ox) > 0.5 && lat > 0 && al > -2 && al < 11 &&
            Math.abs(lat) < 7.5) { want = 0; row = true; }   // 窗口收窄到真实冲突带:15 米硬停会把每个路口都变成排队点
      }
      if (al < -1 || al > 18) continue;
      if (Math.abs(dx * fz - dz * fx) > (g.W + GEO[o.g].W) * 0.5 - 0.35) continue;
      // 原来只要对方中心在前方 0.4 米内就刹车 —— 那已经是两车叠在一起了,
      // 于是 pushOut 每帧把两边横向顶开 0.9 米,比靠道速度还快,车道就保不住了。
      if (al < (g.L + GEO[o.g].L) * 0.5 + 2.2) {
        if (o.trafficAI && !o.blanked) { want = 0; hard = true; }   // 流车:老老实实排队
        else {                                           // 停在路上的车:减速借道绕过去
          staticBlock = true;
          // 原来只是限速到 4,它会继续拱进对方车尾(碰撞半径 1.5 比半个车长小,看着就是叠进去 1.4 米)。
          // 顶到保险杠(车长和 / 2 + 0.5)就停死 —— 对静止障碍也保持真实车距。
          if (al < (g.L + GEO[o.g].L) * 0.5 + 0.5) { want = 0; hard = true; }
          else want = Math.min(want, 4);
        }
        if (!staticBlock) break;
      }
    }
    // 斑马线/逃窜中的行人:停死让人 —— 借道绕不开(人是横着跑的),所以标 hard,
    // 连死锁自救的蠕动都不许拱。环道上散步的人横向偏距 4.8,不落在 ±2.1 扫描带里,不会误刹。
    for (const p of peds) {
      if (p.st === 2) continue;                            // 躺着的不用刹
      const dx = p.x - c.x, dz = p.z - c.z, al = dx * fx + dz * fz;
      if (al < 0.4 || al > 6.5) continue;                  // 窗口收紧:9.5 米+禁蠕动能让一条道冻 7 秒
      if (Math.abs(dx * fz - dz * fx) > 2.1) continue;
      want = 0; hard = true;
    }
    // 路口死锁自救:四向交叉"各自都有右侧来车"时会全体停住(两两反对称保证不了没有 4-环)。
    // 只对路权停(row)且跟前车没顶住(!hard)时解锁 2 m/s 蠕动 —— 必须用 max 抬,
    // 之前用 min 对 want=0 根本抬不起来(探针实拍:esc 滴答响、want 恒 0、卡死一整轮);
    // 前面真顶着一辆车时不许拱,拱了就穿模。
    if (want < c.cruise - 0.5 && c.spd < 0.5) c.stuck = (c.stuck || 0) + dt; else c.stuck = 0;
    if (c.stuck > 1.5) { c.escalate = 3; c.stuck = 0; }
    if ((c.escalate || 0) > 0) { c.escalate -= dt; want = Math.min(want, 3); if (row && !hard) want = Math.max(want, 2); }
    // 借道量平滑进出,不然车头会一抖一抖地拐
    const dodgeTo = staticBlock ? (c.axis === 'x' ? -1.9 * c.dir : 1.9 * c.dir) : 0;
    c.dodge = (c.dodge || 0) + (dodgeTo - (c.dodge || 0)) * (1 - Math.exp(-2.2 * dt));
    c.want = want;                               // 调试:AI 这帧想要多大速度
    c.spd += clamp(want - c.spd, -12 * dt, 6.5 * dt);
    if (c.spd < 0) c.spd = 0;

    const along = c.axis === 'x' ? c.x : c.z;
    if (!c.turn && (c.dir > 0 ? along >= c.nextCross : along <= c.nextCross)) {
      const cross = c.nextCross;
      c.nextCross = nextCrossCoord(c.dir, along + c.dir);
      // 走到内圈尽头必须拐向城中心,不然下一脚就冲出地图边缘的虚空
      const edge = Math.abs(cross) >= camPath(TMAX) - 0.5;
      let forced = null;
      if (edge) {
        const nAxis = c.axis === 'x' ? 'z' : 'x';
        const along2 = nAxis === 'x' ? c.x : c.z;
        forced = { axis: nAxis, dir: along2 > 0 ? -1 : 1 };
      }
      if (forced || rng() < 0.34) {          // 不拐边的路口,三成转弯、里头多半右转
        const r = rightTurn(c.axis, c.dir);
        const nt = forced || (rng() < 0.78 ? r : { axis: r.axis, dir: -r.dir });
        const nLane = laneOf(nt.axis, cross, nt.dir);
        c.turn = true; c.turnLine = cross; c.turnAxis = nt.axis; c.turnDir = nt.dir;
        c.turnRy = ryOf(nt.axis, nt.dir); c.turnLane = nLane;
      }
    }
    if (c.turn) {                              // 先转车头,同时往新车道靠,拼出一条弧线
      const d = shortAngle(c.turnRy - c.ry);
      const step = clamp(d, -2.4 * dt, 2.4 * dt);
      c.ry += step;
      if (Math.abs(d - step) < 0.02) {
        c.ry = c.turnRy; c.turn = false;
        c.axis = c.turnAxis; c.line = c.turnLine; c.dir = c.turnDir; c.lane = c.turnLane;
        // 拐完必须按新车道重算下一个路口:沿用的是老轴的数,会在同一个路口反复拐弯
        c.nextCross = nextCrossCoord(c.dir, (c.axis === 'x' ? c.x : c.z) + c.dir);
      }
    }
    c.x += fx * c.spd * dt; c.z += fz * c.spd * dt;
    const lane = (c.turn ? c.turnLane : c.lane) + (c.turn ? 0 : (c.dodge || 0));
    const laneAxis = c.turn ? c.turnAxis : c.axis;   // turnLane 是新轴上的坐标,拿老轴去靠会把车横着拽飞
    // 靠道速度要明显快于转弯残留的横向偏差,否则车会一直斜着蹭在车道边上
    if (laneAxis === 'x') c.z += clamp(lane - c.z, -5.5 * dt, 5.5 * dt);
    else c.x += clamp(lane - c.x, -5.5 * dt, 5.5 * dt);
    if (!c.turn && Math.abs(c.lane - (c.axis === 'x' ? c.z : c.x)) > 9) relane(c);   // 被撞飞出一条街,直接重新上牌

    const bx = c.x, bz = c.z;
    const o = pushOutStatic(c.x, c.z, g.W * 0.5);   // 被撞进楼里就顶出来(不被别的流车顶)
    c.x = o.x; c.z = o.z;
    c.drift = Math.max(c.drift || 0, Math.hypot(c.x - bx, c.z - bz));   // 被实体顶出去多少
    if (c.x < -HALF || c.x > HALF || c.z < -HALF || c.z > HALF) relane(c);
    syncSolid(c); writeCar(c);
  }
}

spawnTraffic();

// ════════════════════════════════════════════════════════════
//  行人:在街区矩形环道上散步,走到路口时偶尔横穿,被车逼近就四散,
//  被碾到 → 飞出去 + 躺几秒 + 爬起来走回环道。
//  人不算实体(不进 solids):pushOutStatic 只保证不进楼,碾人是街机处理。
//  渲染总共 8 个实例化网格:躯干(帽衫廓形)/ 头(圆)/ 发盖 / 背包 / 左腿 / 右腿(带鞋头)/
//  左臂 / 右臂(带袖口),颜色全走 instanceColor。头身 ~1:6.5,镜头才不会被头挤住。
//  环道离街区边缘只留 0.8(贴马路牙子):楼离边最坏也只有 inset/2=1.2,原来留 1.7
//  等于把 walking 线画进楼占地里(实测 10/42 嵌在楼盒里)——1.2 才是硬让距。
// ════════════════════════════════════════════════════════════
const PEDS = 96, RING = BLOCK / 2 - 0.8;   // 42 人撒在 7×7 街区里太稀疏,用户要"多一点"。实例化网格吃这点量毫无压力(还是 8 个 draw call)
const SHIRT = [0xc3c9d1, 0x7a4a3f, 0x3f5a7a, 0x5a7a4a, 0xa05a3f, 0x8a6f9a, 0x494f5a, 0xc07a5a, 0x6a8a8a];
const SKIN = [0xd8b48c, 0xb98a5e, 0x8a5f3d, 0xe8c9a0];
const PACKC = [0xd0573f, 0x3f6fa8, 0x555b63, 0x9a3f5f];
const HAIRC = [0x241f1c, 0x241f1c, 0x241f1c, 0x4a3626, 0x101014, 0x6b4a2e];   // 黑为主,少数棕/金 —— 和主角同款发色
const PANTS = [0x3c4149, 0x2e3442, 0x4a4e56, 0x5c5648, 0x2a2d33, 0x544a44, 0xc4bda8];
let pedHits = 0;
const peds = [];
const blockCenterOf = (gx, gz) => [camPath(gx) + PERIOD / 2, camPath(gz) + PERIOD / 2];
const ringPoint = (cx, cz, s, t) => s === 0 ? [cx + t, cz - RING] : s === 1 ? [cx + RING, cz + t]
  : s === 2 ? [cx - t, cz + RING] : [cx - RING, cz - t];
const walkDir = (s, dir) => s === 0 ? [dir, 0] : s === 1 ? [0, dir] : s === 2 ? [-dir, 0] : [0, -dir];
// 环上点投回 (side, t) —— 和 ringPoint 用同一套参数,横穿落地时不许有第二套换算
const sideAt = (cx, cz, x, z) => {
  const dxr = x - cx, dzr = z - cz;
  return Math.abs(dxr) >= Math.abs(dzr) ? (dxr >= 0 ? { s: 1, t: dzr } : { s: 3, t: -dzr })
    : (dzr >= 0 ? { s: 2, t: -dxr } : { s: 0, t: dxr });
};
const nearestRing = (cx, cz, x, z) => {
  const lx = x - cx, lz = z - cz;
  return Math.abs(lx) >= Math.abs(lz)
    ? [cx + RING * (lx >= 0 ? 1 : -1), cz + clamp(lz, -RING, RING)]
    : [cx + clamp(lx, -RING, RING), cz + RING * (lz >= 0 ? 1 : -1)];
};
function spawnPeds() {
  for (let k = 0; k < PEDS; k++) {
    const gx = (rng() * GRID) | 0, gz = (rng() * GRID) | 0;
    const [cx, cz] = blockCenterOf(gx, gz);
    const side = (rng() * 4) | 0, t = rand(-RING, RING), dir = rng() < 0.5 ? 1 : -1;
    const [x, z] = ringPoint(cx, cz, side, t), wd = walkDir(side, dir);
    peds.push({ i: k, x, z, cx, cz, gx, gz, st: 0, side, t, dir, spd: rand(1.05, 1.6),
      shirt: pick(SHIRT), skin: pick(SKIN), pack: rng() < 0.6 ? pick(PACKC) : -1,
      // 裤色加权:前 6 个深色权重 3、末位浅卡其只给 1 —— 全街清一色深灰会"死板",但太多浅色又不像城市
      pants: (() => { const r = (rng() * 19) | 0; return PANTS[Math.min(6, (r / 3) | 0)]; })(),
      hair: pick(HAIRC),
      yaw: Math.atan2(wd[0], wd[1]), fx: 0, fz: 0, panic: 0, re: 0, lie: 0, lieT: 0, up: 5, punchT: 0,
      cross: null, phase: rand(0, 6.28), gy: 0.32 });
  }
}

// ── 行人零件:低模 + 顶点色细节,不再是一水儿的方块 ──
// 实例颜色会乘上顶点色:着色区 ×0.28 出"深色拼接"(鞋面/裤缝/袖口),
// ×2.3 出"亮色件"(白鞋头/白抽绳 —— 就是主角那双白鞋、那两根绳的实例化版)。
function pedPartGeo(palisade) {
  const g = new THREE.BoxGeometry(1, 1, 1, 1, 3, 1);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    let b = 1;
    if (palisade) {
      const y = pos.getY(i), z = pos.getZ(i);
      if (y > 0.42) b = 0.82;                              // 小腿收口
      if (y < -0.42 && z > 0) b = 0.28;                   // 鞋面:深一块
      if (y < -0.42 && z > 0.25) b = 2.3;                 // 鞋头:白
    }
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
// 帽衫廓形,按主角的三件套改:主角是躯干 0.56 宽 + 一块 0.74 的肩甲(比躯干宽 32%)
// + 1:0.75 的厚身子。之前是一根 1.0 宽 0.3 厚的"门板"——肩头 3.1 倍头宽,
// 手臂整个埋进板里,远看就是方块壮汉。这里把几何改成三段:肩线鼓包、胸、收腰。
function pedTorsoGeo() {
  const g = new THREE.BoxGeometry(1, 1, 1, 1, 3, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    let w = 1, d = 1;
    // 肩线:实例 0.52 宽时 0.61 ≈ 1.8 个头宽。主角的 0.74 看着不宽,是因为他脑袋上扣着
    // 0.47 宽的帽兜;行人是 0.34 的小圆头,照搬同比例就成了 2.2 倍肩的衣架。收窄一档,更像街上的清瘦青年。
    if (y > 0.33) { w = 1.18; d = 0.8; }
    else if (y > 0.12) { w = 1; d = 1.05; }               // 胸:只比身子厚一丝,1:0.78(主角 0.56×0.34);1.15 试过,背视肿成鹅蛋
    else if (y > -0.3) { w = 0.9; d = 1; }                // 腰:帽衫下摆
    else { w = 0.94; d = 0.92; }                          // 臀:胯比腰略宽,腿根才接得住
    pos.setX(i, pos.getX(i) * w); pos.setZ(i, pos.getZ(i) * d);
  }
  g.computeVertexNormals();
  return g;
}
const legGeo = pedPartGeo(true);
const armGeo = pedPartGeo(false);
const torsoGeo = pedTorsoGeo();
const pedStd = (rough, vertexColors) => new THREE.MeshStandardMaterial({ roughness: rough, vertexColors });
const pTorso = new THREE.InstancedMesh(torsoGeo, pedStd(0.85), PEDS);
const pHead = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 10, 8), pedStd(0.7), PEDS);
const pHair = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, 1.9), pedStd(0.9), PEDS);
const pPack = new THREE.InstancedMesh(unitBox, pedStd(0.8), PEDS);
const pLegL = new THREE.InstancedMesh(legGeo, pedStd(0.9, true), PEDS);
const pLegR = new THREE.InstancedMesh(legGeo, pedStd(0.9, true), PEDS);
const pArmL = new THREE.InstancedMesh(armGeo, pedStd(0.82, true), PEDS);
const pArmR = new THREE.InstancedMesh(armGeo, pedStd(0.82, true), PEDS);
const PED_MESHES = [pTorso, pHead, pHair, pPack, pLegL, pLegR, pArmL, pArmR];
for (const m of PED_MESHES) {
  m.count = PEDS; m.frustumCulled = false;
  m.castShadow = (m === pTorso); m.receiveShadow = true;   // 只给躯干投影:42 个人 8 套网格,影子够用又便宜
  scene.add(m);
}

const PEUL = new THREE.Euler(0, 0, 0, 'YXZ');
const PQ = new THREE.Quaternion(), PP = new THREE.Vector3(), PSC0 = new THREE.Vector3(1, 1, 1);
const PP1 = new THREE.Matrix4(), PP2 = new THREE.Matrix4(), PTM = new THREE.Matrix4();
const PRX = new THREE.Matrix4(), PSC = new THREE.Matrix4();
function writePed(p) {
  PEUL.set(p.lie, p.yaw, 0); PQ.setFromEuler(PEUL);       // YXZ:先偏航、再绕自己的脚点躺倒
  PP.set(p.x, p.gy, p.z); PP1.compose(PP, PQ, PSC0);
  // 摆幅分三档:站着 0、散步 0.38、被车逼响撒腿 0.72 —— panic 时 spd 恒 3.6,用 p.st 判
  const sw = p.st === 2 || p.st === 3 ? 0 : Math.sin(p.phase) * (p.st === 1 ? 0.72 : 0.38);
  // 吃了你一拳(st=3):佝背抱头。前倾是先把整个局部系下压再绕脚点转 —— 不抬腿、
  // 不抬"胯",蹲下去的是身板;两条胳膊交叉举到脑门前。躺倒(st=2)仍是不动的硬挺,
  // 两种姿态要一眼分得开。
  const crouch = p.st === 3;
  const part = (im, ox, oy, oz, rx, dip, sx, sy, sz) => {
    PTM.makeTranslation(ox, oy, oz);
    if (rx) { PRX.makeRotationX(rx); PTM.multiply(PRX); }
    if (dip) { PTM.multiply(PRX.makeTranslation(0, -dip, 0)); }
    PSC.makeScale(sx, sy, sz);
    im.setMatrixAt(p.i, PP2.copy(PP1).multiply(PTM).multiply(PSC));
  };
  const lean = crouch ? 0.6 : 0;
  // 矮壮街童比例(头顶 1.70,头身 ~1:6.5):之前 1.65 身高顶 0.3 大方头,远看像火柴人戴鞋盒,
  // 近景相机还会被头挤住。圆脸球 + 发盖从街上看就是"人"了。
  if (crouch) PTM.makeTranslation(0, -0.34, 0).multiply(PRX.makeRotationX(lean));
  else PTM.identity();          // 别写 makeIdentity:3D 矩阵压根没这方法,一调整个循环炸穿(血泪)
  PP1.multiply(PTM);            // 把"下压 + 前倾"并进基础位姿里。别写成 PP1.copy(PP2):
  // PP2 是 part() 的手上残渣(上一帧背包槽那份 0.001 缩小的垃圾矩阵),copy 会把 803 行
  // 刚算好的世界基座整个换成垃圾 —— 全体路人被压成 1 毫米小点缩在世界角落。
  // 逻辑层(st、蹲点数)全对、验证全绿,只有画面没人 —— 血泪第二弹。
  part(pLegL, 0.105, 0.66, 0, crouch ? -0.5 : sw, 0.31, 0.15, 0.62, 0.16);   // 前倾了要把腿拉回竖直,不然两截斜着插地
  part(pLegR, -0.105, 0.66, 0, crouch ? -0.5 : -sw, 0.31, 0.15, 0.62, 0.16);
  // 手臂贴着肩线挂(肩半宽 0.305,胳膊外缘探到 0.335 — 侧影里胳膊和身子分得开)
  // 抱头:举 2.6 让手越过眉线、往中线收 0.09、 attach 点挪到脸前 -0.10 ——
  // 上一版(2.15/0.05/-0.17)截图里两手停在胸口两侧,看着像举手投降不像挨打抱头
  const armUp = crouch ? 2.6 : 0, armIn = crouch ? -0.10 : 0, armDip = crouch ? 0 : 0.26;
  part(pArmL, 0.27 + (crouch ? -0.09 : 0), 1.30, armIn, crouch ? armUp : -sw * 0.85, armDip, 0.13, 0.52, 0.13);
  part(pArmR, -0.27 + (crouch ? 0.09 : 0), 1.30, armIn, crouch ? armUp : sw * 0.85, armDip, 0.13, 0.52, 0.13);
  part(pTorso, 0, 1.02, 0, 0, 0, 0.52, 0.62, 0.36);                   // 四段在几何里(实例 0.52 宽 → 肩 0.61)
  part(pHead, 0, 1.52, 0, crouch ? -0.2 : 0, 0, 0.34, 0.36, 0.33);    // 圆脸 0.34:抱头时头再往下低一点
  part(pHair, 0, 1.55, -0.02, crouch ? -0.2 : 0, 0, 0.365, 0.375, 0.355);
  // 蹲着时背包被前倾整块翘到头顶后面,远看像背上插了块乱板(截图实锤)—— 挨打那两秒半收起来
  if (p.pack >= 0 && !crouch) part(pPack, 0, 1.08, -0.2, 0, 0, 0.34, 0.42, 0.14);
  else part(pPack, 0, -60, 0, 0, 0, 0.001, 0.001, 0.001);              // 不带背包:缩到极小,别在脚下留个盒子
}

const modLineDist = (v) => { const d = ((v + HALF) % PERIOD + PERIOD) % PERIOD; return Math.min(d, PERIOD - d); };
function updatePeds(dt) {
  const buzzX = mode === 'car' ? hx : px, buzzZ = mode === 'car' ? hz : pz;
  const carSpd = mode === 'car' ? Math.hypot(vx, vz) : 0;
  const carGeo = mode === 'car' && active ? GEO[active.g] : null;
  for (const p of peds) {
    // ── 被碾:车矩形(带长度)扫到、车速 >1.2 → 躺下 + 顺着车速甩出去 ──
    if (p.st !== 2 && carGeo && carSpd > 1.2) {
      const dx = p.x - hx, dz = p.z - hz;
      const al = dx * Math.sin(hh) + dz * Math.cos(hh);
      const la = dx * Math.cos(hh) - dz * Math.sin(hh);
      if (Math.abs(al) < carGeo.L / 2 + 0.2 && Math.abs(la) < carGeo.W / 2 + 0.28) {
        p.st = 2; p.lieT = 0; p.up = rand(3.5, 6.5); pedHits++;
        const fling = Math.min(7, carSpd * 0.45);
        p.fx = vx / carSpd * fling; p.fz = vz / carSpd * fling;
      }
    }
    // ── 被逼响:高速车贴到跟前就撒腿跑 —— 你开的车 7 米,车流 4.5 米。
    // 车流也得逼:人不是车流的实体,车流只刹不让,人不躲就会被车流犁过去。
    // (st=3 不豁免:你打完他还贴着你不躲,下一拳照打 —— 被连打时姿势由 punchT 重计时,
    //  躲车优先于抱头反而不对,车从人身上犁过去才是 GTA。)
    if (p.st !== 2 && p.st !== 3) {
      for (const cv of cars) {
        const sp = cv === active ? carSpd : (cv.spd || 0);
        if (sp <= 2.5) continue;                            // 停着的车(speed 未定义)直接跳
        const cx0 = cv === active ? hx : cv.x, cz0 = cv === active ? hz : cv.z;
        const d = Math.hypot(p.x - cx0, p.z - cz0);
        if (d > (cv === active ? 7 : 4.5)) continue;
        p.st = 0; p.cross = null; p.re = 0; p.panic = rand(2.2, 3.8);
        p.fx = (p.x - cx0) / (d || 1) + rand(-0.35, 0.35);
        p.fz = (p.z - cz0) / (d || 1) + rand(-0.35, 0.35);
        const n = Math.hypot(p.fx, p.fz) || 1; p.fx /= n; p.fz /= n;
        p.st = 1;
        break;
      }
    }
    let vlen = 0;
    // ── 吃了你一拳(st=3):抱头原地蹲,骂完就走。别并进 st=1 逃窜去"跑":跑起来
    // phase 推进、腿一摆,抱头姿势就散了;也别并进 st=2 躺:躺着是"被车碾的",
    // 和"挨打"得分开,测试也各查各的。2.2 秒后自己站起来。
    // 环道位置是参数化的(t 沿边),退的那半步必须重锚回参数,否则散步分支下一帧
    // ringPoint 一把覆盖坐标、半步白退 —— 挨打之前人本来就在环道 0.8 米内,sideAt 直接吸附。
    if (p.st === 3) {
      if ((p.punchT += dt) > 2.2) {
        p.st = 0; p.re = 1;
        const at = sideAt(p.cx, p.cz, p.x, p.z); p.side = at.s; p.t = at.t;
      }
    } else if (p.st === 2) {                              // 躺着滑行 → 到点爬起来走回环道
      p.x += p.fx * dt; p.z += p.fz * dt;
      const damp = Math.exp(-2.6 * dt); p.fx *= damp; p.fz *= damp;
      if ((p.lieT += dt) > p.up) { p.st = 0; p.re = 1; }
    } else if (p.st === 1) {                              // 逃窜
      const sp = 3.6;
      p.x += p.fx * sp * dt; p.z += p.fz * sp * dt; vlen = sp;
      p.yaw = Math.atan2(p.fx, p.fz);
      if ((p.panic -= dt) <= 0) { p.st = 0; p.re = 1; }
    } else if (p.re) {                                    // 逃完/挨打完:先走回本街区环道
      const [rx, rz] = nearestRing(p.cx, p.cz, p.x, p.z);
      const dx = rx - p.x, dz = rz - p.z, d = Math.hypot(dx, dz);
      // 收尾也要重锚 —— 这里原来只吸附 1.2 米以内的。挨打的退挪、被碾的甩飞都可能停得远,
      // 而散步分支下一帧就把参数 (side,t) 直接套回人身上:不重锚,人会瞬移回旧环道位置,
      // "爬起来走人"变成"闪现回原位"。(按当前位置吸附,人从哪走起就在哪。)
      if (d < 1.2) { const at = sideAt(p.cx, p.cz, p.x, p.z); p.side = at.s; p.t = at.t; p.re = 0; }
      else if ((p.reT = (p.reT || 0) + dt) > 1.6) {
        const at = sideAt(p.cx, p.cz, p.x, p.z); p.side = at.s; p.t = at.t; p.re = 0;
      } else {
        p.fx = dx / d; p.fz = dz / d;
        p.x += p.fx * 1.9 * dt; p.z += p.fz * 1.9 * dt; vlen = 1.9;
        p.yaw = Math.atan2(p.fx, p.fz);
      }
    } else if (p.cross) {                                 // 横穿大马路(14.8 米,直线)
      const q = p.cross, seg = Math.hypot(q.x1 - q.x0, q.z1 - q.z0);
      q.t += dt * (2.4 / seg);
      const k = Math.min(1, q.t);
      p.x = q.x0 + (q.x1 - q.x0) * k; p.z = q.z0 + (q.z1 - q.z0) * k; vlen = 2.4;
      p.yaw = Math.atan2(q.x1 - q.x0, q.z1 - q.z0);
      if (q.t >= 1) {
        p.cross = null;
        p.gx += q.gx; p.gz += q.gz;
        [p.cx, p.cz] = blockCenterOf(p.gx, p.gz);
        const at = sideAt(p.cx, p.cz, p.x, p.z); p.side = at.s; p.t = at.t;
      }
    } else {                                              // 沿环道散步,走到路口偶尔横穿一次
      p.t += p.dir * p.spd * dt;
      if (Math.abs(p.t) > RING) {
        const edge = p.t > 0 ? RING : -RING;
        p.t = edge;
        if (rng() < 0.16) {
          const [x0, z0] = ringPoint(p.cx, p.cz, p.side, p.t);
          const dnx = p.side === 1 ? 1 : p.side === 3 ? -1 : 0;
          const dnz = p.side === 0 ? -1 : p.side === 2 ? 1 : 0;
          const [ncx, ncz] = blockCenterOf(p.gx + dnx, p.gz + dnz);
          const lox = x0 - p.cx, loz = z0 - p.cz;         // 穿轴分量取反、另一轴保持:对心镜像落地
          p.cross = { t: 0, x0, z0, x1: ncx + (dnx ? -lox : lox), z1: ncz + (dnz ? -loz : loz), gx: dnx, gz: dnz };
        } else {
          p.side = (p.side + (p.dir > 0 ? 1 : 3)) % 4; p.t = -edge;
        }
      }
      const [x, z] = ringPoint(p.cx, p.cz, p.side, p.t);
      p.x = x; p.z = z;
      const wd = walkDir(p.side, p.dir); vlen = p.spd;
      p.yaw = Math.atan2(wd[0], wd[1]);
    }
    p.x = clamp(p.x, -HALF + 2, HALF - 2); p.z = clamp(p.z, -HALF + 2, HALF - 2);
    const out = pushOutStatic(p.x, p.z, 0.3); p.x = out.x; p.z = out.z;
    const onWalk = modLineDist(p.x) > ROAD / 2 + 0.35 && modLineDist(p.z) > ROAD / 2 + 0.35;
    p.gy += ((onWalk ? 0.32 : 0) - p.gy) * Math.min(1, 8 * dt);   // 上人行道抬一步、下马路落回来
    p.phase += vlen * dt * 3.4;
    const lieT = p.st === 2 ? Math.PI / 2 : 0;
    p.lie += (lieT - p.lie) * Math.min(1, 5 * dt);
    writePed(p);
  }
  for (const m of PED_MESHES) m.instanceMatrix.needsUpdate = true;
}
spawnPeds();
peds.forEach((p) => {
  pTorso.setColorAt(p.i, tmpColor.setHex(p.shirt));
  pArmL.setColorAt(p.i, tmpColor.setHex(p.shirt));          // 袖子跟上衣同色,一套穿搭
  pArmR.setColorAt(p.i, tmpColor.setHex(p.shirt));
  pLegL.setColorAt(p.i, tmpColor.setHex(p.pants));          // 顶点色:鞋面 ×0.28、鞋头 ×2.3
  pLegR.setColorAt(p.i, tmpColor.setHex(p.pants));
  pHead.setColorAt(p.i, tmpColor.setHex(p.skin));
  pHair.setColorAt(p.i, tmpColor.setHex(p.hair));
  pPack.setColorAt(p.i, tmpColor.setHex(p.pack >= 0 ? p.pack : 0x555b63));
  writePed(p);
});
for (const m of PED_MESHES) if (m.instanceColor) m.instanceColor.needsUpdate = true;

// 车绕 Y 转过之后的轴对齐包围盒(车流每帧也要走这条,所以别写死尺寸)
function syncSolid(c) {
  const g = GEO[c.g], s = solids[c.solid];
  const cl = Math.abs(Math.cos(c.ry)), sn = Math.abs(Math.sin(c.ry));
  s.x = c.x; s.z = c.z;
  s.hw = sn * (g.L / 2) + cl * (g.W / 2);
  s.hd = cl * (g.L / 2) + sn * (g.W / 2);
}

// 每种几何一组实例;轮子和出租车顶灯是全城共用的两个实例化网格
const paintMat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.5 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x11151b, roughness: 0.16, metalness: 0.25 });
const IG = {};
for (const k in GEO) IG[k] = { body: null, cab: null, n: 0 };
cars.forEach((c) => { c.slot = IG[c.g].n++; });
for (const k in GEO) {
  const g = GEO[k], e = IG[k], cap = Math.max(1, e.n);
  e.body = new THREE.InstancedMesh(carSolidGeo(g.body[0], g.body[1], g.body[2], g.tb, 1), paintMat, cap);
  e.cab = new THREE.InstancedMesh(carSolidGeo(g.cab[0], g.cab[1], g.cab[2], g.tc, 1), glassMat, cap);
  e.body.count = e.cab.count = e.n;           // 容量按 1 兜底,实际数量由 count 定
  e.body.castShadow = true;
  e.body.frustumCulled = false; e.cab.frustumCulled = false;   // 车流会跑动,包围球算不准
  scene.add(e.body, e.cab);
}
const pWheel = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10).rotateZ(Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x12151a, roughness: 0.8 }), Math.max(1, cars.length * 4));
pWheel.count = cars.length * 4;
pWheel.frustumCulled = false;
scene.add(pWheel);
const taxis = cars.filter((c) => c.t.sign);
taxis.forEach((c, i) => { c.sign = i; });
const pSign = new THREE.InstancedMesh(unitBox,
  new THREE.MeshBasicMaterial({ color: 0xffe9a8, toneMapped: false }), Math.max(1, taxis.length));
pSign.count = taxis.length;
pSign.frustumCulled = false;
scene.add(pSign);

function writeCar(c) {
  const g = GEO[c.g], e = IG[c.g], hide = c.blanked, y = hide ? -60 : 0;
  dummy.rotation.set(0, c.ry, 0);
  dummy.scale.setScalar(1);
  dummy.position.set(c.x + Math.sin(c.ry) * g.body[3], hide ? -60 : g.by, c.z + Math.cos(c.ry) * g.body[3]);
  dummy.updateMatrix(); e.body.setMatrixAt(c.slot, dummy.matrix);
  dummy.position.set(c.x + Math.sin(c.ry) * g.cab[3], hide ? -60 : g.cy, c.z + Math.cos(c.ry) * g.cab[3]);
  dummy.updateMatrix(); e.cab.setMatrixAt(c.slot, dummy.matrix);
  const ws = g.wr / 0.42;                      // 轮子共用一个网格,尺寸靠实例缩放区分
  dummy.scale.set(ws, ws, ws);
  for (let k = 0; k < 4; k++) {
    const ox = (k & 1 ? -1 : 1) * g.wx, oz = g.wz[k >> 1];
    dummy.position.set(c.x + Math.cos(c.ry) * ox + Math.sin(c.ry) * oz, hide ? -60 : g.wr,
                       c.z - Math.sin(c.ry) * ox + Math.cos(c.ry) * oz);
    dummy.updateMatrix(); pWheel.setMatrixAt(c.i * 4 + k, dummy.matrix);
  }
  dummy.scale.setScalar(1);
  if (c.sign >= 0) {                           // 出租车顶灯
    dummy.position.set(c.x + Math.sin(c.ry) * g.cab[3], hide ? -60 : g.roofY + 0.16,
                       c.z + Math.cos(c.ry) * g.cab[3]);
    dummy.scale.set(0.74, 0.2, 0.3);
    dummy.updateMatrix(); pSign.setMatrixAt(c.sign, dummy.matrix);
    dummy.scale.setScalar(1);
    pSign.instanceMatrix.needsUpdate = true;
  }
  e.body.instanceMatrix.needsUpdate = true;
  e.cab.instanceMatrix.needsUpdate = true;
  pWheel.instanceMatrix.needsUpdate = true;
}
cars.forEach((c) => { IG[c.g].body.setColorAt(c.slot, tmpColor.setHex(c.color)); writeCar(c); });
for (const k in GEO) { if (IG[k].n) { IG[k].body.instanceColor.needsUpdate = true; IG[k].body.instanceMatrix.needsUpdate = true; IG[k].cab.instanceMatrix.needsUpdate = true; } }
pWheel.instanceMatrix.needsUpdate = true;
pSign.instanceMatrix.needsUpdate = true;

function useHero(c) {
  for (const k in heroes) heroes[k].visible = (k === c.g);
  hero = heroes[c.g];
  hero.userData.paint.color.setHex(c.color);
  hero.userData.roof.color.setHex(c.color).multiplyScalar(0.82);
  if (hero.userData.sign) hero.userData.sign.visible = !!c.t.sign;   // 只有出租车才亮顶灯
}
function hideHeroes() { for (const k in heroes) heroes[k].visible = false; }

function driveCar(c) {
  if (active && active !== c) parkCar(active);
  active = c; myCar = c;
  c.trafficAI = false;                         // 抢来的车流车从此不再自己开
  c.blanked = true; writeCar(c);
  solidsOff.add(c.solid);                      // 自己这辆不再挡自己
  mode = 'car';
  useHero(c); man.visible = false;
  updateBlip();
}
function parkCar(c) {
  c.x = hx; c.z = hz; c.ry = hh;
  syncSolid(c);
  c.blanked = false; writeCar(c);
  solidsOff.delete(c.solid);
  active = null;
  hideHeroes();
}
function commitCar() {
  if (active) { active.x = hx; active.z = hz; active.ry = hh; }
}
function jack(c) {                           // 直接上"这一辆"具体的车
  if (active && active !== c) { commitCar(); parkCar(active); }
  hx = c.x; hz = c.z; hh = c.ry;
  px = hx; pz = hz; ph = hh; walkYaw = hh; manYaw = hh; py = 0; vy = 0; grounded = true;
  vx = vz = vf = vr = 0; odo = 0;
  driveCar(c);
}
function nearestCar(x, z, maxD) {
  let best = null, bd = maxD;
  for (const c of cars) {
    if (c === active) continue;
    const d = Math.hypot(x - c.x, z - c.z);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
// 把车挪到某处并坐进去(开局 / R 键 / 测试脚本都用它)
function putCarAt(x, z, h) {
  const c = active || myCar || cars[0];
  hx = x; hz = z; hh = h;
  px = x; pz = z; ph = h; walkYaw = h; manYaw = h; py = 0; vy = 0; grounded = true;
  vx = vz = vf = vr = 0; odo = 0;
  driveCar(c);
  syncSolid(c);
}

// 车顶标记:你没开它的时候才亮。楼最高 11.5 米,所以标记悬在 13.4 米,永远不会被楼挡住
const blipGroup = new THREE.Group();
{
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd45c, toneMapped: false });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.2, 8), mat);
  cone.rotation.x = Math.PI; cone.position.y = 13.4;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1, 6),
    new THREE.MeshBasicMaterial({ color: 0xffd45c, toneMapped: false, transparent: true, opacity: 0.26 }));
  beam.scale.set(1, 11.8, 1); beam.position.y = 7.2;
  blipGroup.add(cone, beam);
  blipGroup.visible = false;
  scene.add(blipGroup);
}
function updateBlip() {
  // 在店里时黑壳罩不住"就停在门外两步内"的那辆被偷车,标记也会悬在屋里 —— 直接不显示
  const show = !!myCar && active !== myCar && !inside;
  blipGroup.visible = show;
  if (show) blipGroup.position.set(myCar.x, 0, myCar.z);
}

// ══ 主角车:每种几何一套精模,上车时按车型换上那套 ══
// 保险杠/后视镜/扰流板/尾灯都按车型尺寸摆,不再是所有车共用一套零件位置。
const heroes = {};
let hero = null;
{
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x0d1218, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.92,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15191f, roughness: 0.55, metalness: 0.3 });
  const plateMat = new THREE.MeshStandardMaterial({ color: 0xe8e6df, roughness: 0.5 });
  const lampOn = new THREE.MeshBasicMaterial({ color: 0xfff3ce, toneMapped: false });
  const lampOff = new THREE.MeshBasicMaterial({ color: 0xff4a3d, toneMapped: false });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x6d737c, roughness: 0.5, metalness: 0.4 });

  function build(g) {
    const grp = new THREE.Group();
    const paint = new THREE.MeshPhysicalMaterial({
      color: 0xd94f3d, roughness: 0.3, metalness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.2,
    });
    const roof = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.5 });
    let shadowOn = true;                       // 只有大面参与投影,小零件不参与
    const add = (geo, mat, x, y, z) => {
      const o = new THREE.Mesh(geo, mat);
      o.position.set(x, y, z);
      o.castShadow = shadowOn;
      grp.add(o);
      return o;
    };
    const box = (mat, x, y, z, sx, sy, sz) => add(unitBox, mat, x, y, z).scale.set(sx, sy, sz);
    const [bL, bW, bH, bZ] = g.body, [cL, cW, cH, cZ] = g.cab;
    const hl = g.L / 2, hw = g.W / 2;

    add(carSolidGeo(bL, bW, bH, g.tb, 4), paint, 0, g.by, bZ);
    add(carSolidGeo(cL, cW, cH, g.tc, 4), glass, 0, g.cy, cZ);
    shadowOn = false;
    add(unitBox, roof, 0, g.roofY + 0.04, cZ).scale.set(cW * 0.68, 0.06, cL * 0.44);   // 浅色车顶
    box(dark, 0, g.by + 0.1, hl - 0.1, g.W * 0.9, 0.34, 0.3);                          // 前保险杠
    box(dark, 0, g.by + 0.1, -hl + 0.1, g.W * 0.9, 0.34, 0.3);                         // 后保险杠
    box(plateMat, 0, g.by + 0.06, hl - 0.02, 0.44, 0.14, 0.07);                        // 前牌
    box(dark, 0, g.by + 0.02, -hl + 0.02, 0.44, 0.14, 0.07);                           // 后牌
    for (const s of [-1, 1]) {
      box(dark, (hw + 0.06) * s, g.cy + cH * 0.5, cZ + cL * 0.34, 0.3, 0.1, 0.13);     // 后视镜
      box(lampOn, bW * 0.3 * s, g.by + bH * 0.55, hl - 0.03, 0.4, 0.16, 0.08);         // 前照灯
      box(lampOff, bW * 0.32 * s, g.by + bH * 0.5, -hl + 0.03, 0.36, 0.16, 0.08);      // 尾灯
    }
    if (g.skirt) for (const s of [-1, 1]) box(dark, (bW / 2 + 0.02) * s, g.by - 0.07, bZ, 0.14, 0.24, bL - 0.5);
    if (g.wing) {
      box(dark, 0, g.roofY - 0.28, -hl + 0.16, g.W * 0.82, 0.07, 0.36);                // 尾翼
      for (const s of [-1, 1]) box(dark, bW * 0.32 * s, g.roofY - 0.42, -hl + 0.16, 0.1, 0.26, 0.1);
    }
    if (g.rails) for (const s of [-1, 1]) box(railMat, cW * 0.36 * s, g.roofY + 0.12, cZ, 0.09, 0.1, cL * 0.78);
    if (g.bed) {                                  // 皮卡:一圈斗帮,俯视看就是个敞口斗
      const bedZ = bZ, bedW = bW, bedL = bL;
      box(dark, 0, g.by - 0.02, bedZ, bedW * 0.92, 0.06, bedL * 0.94);
      for (const s of [-1, 1]) box(paint, (bedW / 2) * s, g.by + 0.3, bedZ, 0.1, 0.34, bedL - 0.1);
      box(paint, 0, g.by + 0.3, bedZ - bedL / 2, bedW, 0.34, 0.1);
    }
    if (g.doors) {                                // 货车:车尾两扇门 + 侧板分缝
      box(dark, bW * 0.24, g.by + bH * 0.45, bZ - bL / 2 - 0.01, 0.04, bH * 0.85, 0.06);
      box(dark, 0, g.by + bH * 0.98, bZ, bW * 0.98, 0.06, bL * 0.98);
    }
    const sign = g.key === 'sedan' ? box(new THREE.MeshBasicMaterial({ color: 0xffe9a8, toneMapped: false },
      0, g.roofY + 0.16, cZ, 0.74, 0.2, 0.3)) : null;
    if (sign) sign.visible = false;               // 只有出租车涂装才亮

    const tireGeo = new THREE.CylinderGeometry(g.wr, g.wr, g.ww, 16).rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(g.wr * 0.58, g.wr * 0.58, g.ww + 0.02, 10).rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x0e1116, roughness: 0.85 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xa8adb5, roughness: 0.35, metalness: 0.8 });
    const wheels = [];
    for (const [x, z] of [[-g.wx, g.wz[0]], [g.wx, g.wz[0]], [-g.wx, g.wz[1]], [g.wx, g.wz[1]]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, g.wr, z);
      const spin = new THREE.Group();
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.castShadow = true;
      spin.add(tire, new THREE.Mesh(rimGeo, rimMat));
      pivot.add(spin);
      grp.add(pivot);
      wheels.push({ pivot, spin, front: z > 0 });
    }
    grp.userData.wheels = wheels;
    grp.userData.paint = paint;      // 抢来的车要换成它的车漆
    grp.userData.roof = roof;
    grp.userData.sign = sign;
    grp.visible = false;
    scene.add(grp);
    return grp;
  }
  for (const k in GEO) heroes[k] = build(GEO[k]);
}

// ══ 人:连帽衫青年 ══
// 俯视下真正看得清的只有三样:帽兜轮廓、肩、鞋 —— 细节全砸在这三处。
// 演变记录:连帽衫+橘书包(少年)→ 摘书包 → 宽肩平头皮带工装(粗犷)→ 你说还原:
// 粗犷批整批撤回,且背后什么都没有了(书包、后颈团、腰后团全拆)。帽兜是"戴在头上"
// 的(后脑鼓包+帽口一圈),不在"背着"的范围里 —— 别再往 back 上加东西,用户要看空背。
const man = new THREE.Group();
{
  const hood = new THREE.MeshStandardMaterial({ color: 0xc3c9d1, roughness: 0.78 });      // 帽衫本体:浅花灰
  const hoodDark = new THREE.MeshStandardMaterial({ color: 0x4e5764, roughness: 0.8 });   // 帽兜:深石板灰
  const shoulder = new THREE.MeshStandardMaterial({ color: 0xaeb6c0, roughness: 0.78 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd8b48c, roughness: 0.7 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x241f1c, roughness: 0.85 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x3c4149, roughness: 0.8 });   // 还原:深灰运动裤(工装橄榄随粗犷批一起撤)
  const shoe = new THREE.MeshStandardMaterial({ color: 0xeae7e0, roughness: 0.55 });
  const add = (geo, mat, x, y, z, parent) => {
    const o = new THREE.Mesh(geo, mat);
    o.position.set(x, y, z);
    o.castShadow = true;
    (parent || man).add(o);
    return o;
  };
  // 躯干略宽松(帽衫的廓形),腰往下收
  add(new THREE.BoxGeometry(0.56, 0.58, 0.34), hood, 0, 1.1, 0);
  add(new THREE.BoxGeometry(0.5, 0.14, 0.3), pants, 0, 0.78, 0);
  add(new THREE.BoxGeometry(0.74, 0.16, 0.36), shoulder, 0, 1.36, 0);      // 肩
  // 帽子:后脑鼓起来一团,前脸留一圈帽檐,中间露出脸 —— 这三样都在"头上",
  // 后背上从帽檐下沿(1.5 出头)到腰带是干净的一片浅灰,什么都不挂。
  add(new THREE.SphereGeometry(0.235, 18, 14), hoodDark, 0, 1.6, -0.035).scale.set(0.96, 0.86, 1.04);
  add(new THREE.SphereGeometry(0.185, 16, 12), skin, 0, 1.545, 0.055);     // 脸
  add(new THREE.SphereGeometry(0.19, 16, 12), hair, 0, 1.585, -0.01).scale.set(1, 0.5, 1);
  add(new THREE.TorusGeometry(0.2, 0.055, 8, 16), hoodDark, 0, 1.63, 0.03)
    .rotation.set(1.4, 0, 0);                                             // 帽口一圈
  // 抽绳:两根小白绳,近看有细节,远看是两个亮点
  add(new THREE.BoxGeometry(0.03, 0.2, 0.03), shoe, -0.08, 1.16, 0.18);
  add(new THREE.BoxGeometry(0.03, 0.2, 0.03), shoe, 0.08, 1.16, 0.18);

  // 四肢:Group 落在肩/胯上,网格往下偏 —— rotation.x 就是从关节摆
  const limb = (w, h, mat, x, y, z, foot, hand) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    add(new THREE.BoxGeometry(w, h, w * 1.15), mat, 0, -h / 2, 0, pivot);
    if (foot) add(foot, shoe, 0, -h + 0.05, 0.05, pivot);
    if (hand) add(hand, skin, 0, -h - 0.05, 0, pivot);
    man.add(pivot);
    return pivot;
  };
  const hs = new THREE.SphereGeometry(0.075, 10, 8);
  const fs = new THREE.BoxGeometry(0.19, 0.1, 0.32);
  const armL = limb(0.15, 0.52, hood, -0.4, 1.34, 0, null, hs);
  const armR = limb(0.15, 0.52, hood, 0.4, 1.34, 0, null, hs);
  const legL = limb(0.17, 0.62, pants, -0.14, 0.82, 0, fs);
  const legR = limb(0.17, 0.62, pants, 0.14, 0.82, 0, fs);
  man.userData.limbs = { armL, armR, legL, legR };
}
man.visible = false;
scene.add(man);

// 接触阴影:软边圆斑,跟着车头/人转,比硬边一圈像样
const blobGroup = new THREE.Group();
const blob = new THREE.Mesh(new THREE.CircleGeometry(1, 28),
  new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false, toneMapped: false }));
blob.rotation.x = -Math.PI / 2;
blobGroup.add(blob);
scene.add(blobGroup);
blobGroup.visible = false;

// ══ 状态 ══
let state = 'ready';                     // ready | play
let hx = 0, hz = 0, hh = 0;              // 手上这辆车的位姿(车本身存在 cars[] 里)
let vx = 0, vz = 0, vf = 0, vr = 0;      // 速度(前向/侧向分解)
let px = 0, pz = 0, ph = 0, manYaw = 0;  // 人:位姿;manYaw 是身体平滑朝向
let py = 0, vy = 0, grounded = true;     // 跳的竖直态(只步行用;py 是离地高度)
let walkPhase = 0, walkYaw = 0, hits = 0, hitCool = 0, steerVis = 0, odo = 0, tNow = 0;

// 开局必须落在路口正中间。(0,0) 看着像中心,其实在街区里 —— 道路中心线在
// camPath(i) = -210 + 60i 上,x=0 是某块地的中间。随机生成时它会变成空地或楼,
// 埋进楼里的话一踩油门就顶墙(实测前向速度只有 -0.2)。R 键早就这么做了,开局漏了。
const spawn = () => {
  const [sx, sz] = nearestCrossing(0, 0);
  placeAt(sx, sz, 0);
};
spawn();

function placeAt(x, z, h) { if (inside) exitShop(); putCarAt(x, z, h); }   // 在店里被 R/harness 拽走:先算出门,再把人塞进车

// 最近路口(按网格吸附)
function nearestCrossing(x, z) {
  return [Math.round((x + HALF) / PERIOD) * PERIOD - HALF,
          Math.round((z + HALF) / PERIOD) * PERIOD - HALF];
}

// ══ 碰撞:圆 vs 轴对齐矩形,逐个测(障碍物 ~300 个,够快)══
function probeSolid(x, z, r = 0, skip = -1, carsToo = true) {
  for (let i = 0; i < solids.length; i++) {
    if (solidsOff.has(i) || i === skip) continue;
    const s = solids[i];
    if (!!s.interior !== !!inside) continue;     // 店里只问店内盒,街上只问街上盒
    if (!carsToo && s.car) continue;             // 只问建筑时用这刀:车流合法擦边不该算"穿楼"
    // "点到矩形的真实距离"(和 pushOut/resolveCar 同一把尺子),不是"扩盒命中":
    // 扩盒在楼角处必命中 —— 车身顶在拐角上时中心已被顶到 ≥r(物理没错),
    // 扩盒探针却坚持说穿模,测试里为这个假阳红过两次。r=0 时命中条件 = 中心落在盒内。
    const nx = Math.max(s.x - s.hw, Math.min(x, s.x + s.hw));
    const nz = Math.max(s.z - s.hd, Math.min(z, s.z + s.hd));
    const dx = x - nx, dz = z - nz;
    if (dx * dx + dz * dz <= r * r) return true;
  }
  return false;
}
function pushOutStatic(x, z, r) {           // 只被静止障碍顶:车流之间靠车距让路,不靠互相挤
  for (let i = 0; i < solids.length; i++) {
    if (solidsOff.has(i)) continue;
    const s = solids[i];
    if (s.car && s.car.trafficAI) continue;
    const nx = Math.max(s.x - s.hw, Math.min(x, s.x + s.hw));
    const nz = Math.max(s.z - s.hd, Math.min(z, s.z + s.hd));
    const dx = x - nx, dz = z - nz, d2 = dx * dx + dz * dz;
    if (d2 > r * r) continue;
    const d = Math.sqrt(d2);
    const ux = d > 1e-6 ? dx / d : 0, uz = d > 1e-6 ? dz / d : 1;
    x += ux * (r - d); z += uz * (r - d);
  }
  return { x, z };
}
function pushOut(x, z, r) {              // 推出所有重叠实体,返回修正后的位置
  // 只有主角走路用它(车流/路人都走 pushOutStatic)—— 所以可以按"人在不在店里"整套换盒子:
  // 店里:外面全城障碍(包括原点那块地上的楼)不再挡人,只剩店里的墙和家具;
  // 街上:店里的碰撞盒此时压根不存在(进门才挂、出门截掉),这条过滤是双保险。
  for (let i = 0; i < solids.length; i++) {
    if (solidsOff.has(i)) continue;
    const s = solids[i];
    if (!!s.interior !== !!inside) continue;
    const nx = Math.max(s.x - s.hw, Math.min(x, s.x + s.hw));
    const nz = Math.max(s.z - s.hd, Math.min(z, s.z + s.hd));
    const dx = x - nx, dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 > r * r) continue;
    const d = Math.sqrt(d2);
    let ux, uz;
    if (d > 1e-6) { ux = dx / d; uz = dz / d; } else { ux = 0; uz = 1; }
    x += ux * (r - d); z += uz * (r - d);
  }
  return { x, z };
}


// ══ 进店/出门(传送式,方案 B)══
// 人进屋后 px/pz 直接当屋内坐标用(屋子坐落世界原点,px 本来就直接喂 man.position ——
// 一套坐标三方共用:物理、人物、相机)。屋外的城市在屋里不参与物理(pushOut 的 interior
// 过滤),所以原点那块地上的楼不会在店里立隐形墙。
function buildShop(s) {
  const g = new THREE.Group();
  const w = s.b.w - 1.0, d = s.b.d - 1.0, ht = 3.1, th = 0.3;   // 室内净尺寸:四面墙吃掉 1 米见方
  s.room = { w, d, h: ht };
  const glow = new THREE.MeshBasicMaterial({ color: s.K.glow, toneMapped: false });
  const warm = new THREE.MeshBasicMaterial({ color: 0xffe9c4, toneMapped: false });
  const floorM = new THREE.MeshStandardMaterial({ color: s.K.floor, roughness: 0.85 });
  const wallM = new THREE.MeshStandardMaterial({ color: 0xd4cec2, roughness: 0.92 });
  const ceilM = new THREE.MeshStandardMaterial({ color: 0xb3aca0, roughness: 0.95 });
  const std = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
  const spec = [];
  const bx = (x, y, z, sw, sh, sd, mat, solid) => {
    const m = new THREE.Mesh(unitBox, mat);
    m.position.set(x, y, z); m.scale.set(sw, sh, sd);
    m.castShadow = false; m.receiveShadow = false; g.add(m);   // 屋内不吃日光投影(斜射会拉出斜影穿墙)
    if (solid) spec.push({ x, z, hw: sw / 2, hd: sd / 2, h: sh });
    return m;
  };
  bx(0, -0.07, 0, w + 2 * th, 0.14, d + 2 * th, floorM, false);
  const wallX = (x) => bx(x, ht / 2, 0, th, ht, d + 2 * th, wallM, true);
  const wallZ = (z) => bx(0, ht / 2, z, w + 2 * th, ht, th, wallM, true);
  wallX(w / 2 + th / 2); wallX(-(w / 2 + th / 2)); wallZ(d / 2 + th / 2); wallZ(-(d / 2 + th / 2));
  bx(0, ht + 0.09, 0, w + 2 * th, 0.18, d + 2 * th, ceilM, false);
  // 外黑壳:BackSide 的"里衬"盒 —— 店里看到的永远只有屋里:楼/树/人/车/地面全被这圈
  // 比屋子大 6 米的不透光盒子挡在墙外(店里只有一间房亮着这件事靠它兜底,不靠运气)。
  const shell = new THREE.Mesh(unitBox, new THREE.MeshBasicMaterial({ color: 0x12141a, side: THREE.BackSide }));
  shell.position.set(0, 3, 0); shell.scale.set(w + 2 * th + 6, 9.4, d + 2 * th + 6); g.add(shell);
  // 门那一面:里侧发光门板(出门就靠它指路)+ 两扇亮窗给屋里"借"点街光
  const fx = s.face.nx, fz = s.face.nz;
  const lx = fx ? fx * (w / 2 - 0.04) : s.t, lz = fx ? s.t : fz * (d / 2 - 0.04);
  bx(lx, 1.05, lz, fx ? 0.06 : 1.5, 2.1, fx ? 1.5 : 0.06, glow, false);
  const span = (fx ? d : w) * 0.27;
  for (const off of [span, -span]) {
    if (fx) bx(lx, 1.6, off, 0.05, 1.0, 2.0, glow, false); else bx(off, 1.6, lz, 2.0, 1.0, 0.05, glow, false);
  }
  for (const off of [d * 0.22, -d * 0.22]) bx(0, ht - 0.04, off, 1.3, 0.05, 0.34, warm, false);   // 顶灯两条
  // ── 陈设(按店种)── prop 是落地实盒:家具全进碰撞,推桌子推不动
  const prop = (x, z, sw, sd, sh, c) => bx(x, sh / 2, z, sw, sh, sd, std(c), true);
  const k = s.i % SHOP_KINDS.length;
  if (k === 0) {                                    // 面馆:柜台 + 一桌四凳 + 后墙冰柜
    prop(-w * 0.24, -d * 0.18, 3.0, 0.9, 1.05, 0xb4875a);
    prop(w * 0.16, d * 0.06, 1.5, 1.5, 0.75, 0xd8c9a8);
    for (const [ax, az] of [[0.72, 0], [-0.72, 0], [0, 0.72], [0, -0.72]]) prop(w * 0.16 + ax, d * 0.06 + az, 0.42, 0.42, 0.46, 0x8f5f3a);
    prop(w * 0.32, -d * 0.3, 1.1, 1.1, 1.9, 0x9aa2a8);
  } else if (k === 1) {                             // 超市:三排货架 + 门边收银台
    for (const off of [-w * 0.28, 0, w * 0.28]) prop(off, -d * 0.1, 0.9, d * 0.55, 1.8, 0x7f8894);
    prop(w * 0.2, d * 0.32, 1.3, 0.8, 0.95, 0x4a7fb5);
  } else if (k === 2) {                             // 修车铺:举升台上一台没修完的车 + 工具箱
    prop(-w * 0.06, -d * 0.16, 3.0, 2.0, 0.3, 0x4a5058);
    prop(-w * 0.06, -d * 0.16, 3.6, 1.7, 0.95, 0xc0504a);   // 车壳:一个实盒够撞,漆面高光靠两条哑光块凑
    prop(-w * 0.06, -d * 0.16, 1.8, 1.45, 0.5, 0x8a3b36);
    prop(w * 0.3, d * 0.18, 1.0, 0.7, 1.1, 0xc94f3d);
    prop(-w * 0.38, d * 0.3, 0.9, 0.9, 1.6, 0x5d6570);
  } else if (k === 3) {                             // 诊所:前台 + 两条长椅 + 药柜
    prop(-w * 0.2, -d * 0.22, 2.4, 0.9, 1.0, 0xd9dee3);
    prop(w * 0.12, d * 0.16, 1.8, 0.55, 0.5, 0x8d9aa5);
    prop(w * 0.12, d * 0.38, 1.8, 0.55, 0.5, 0x8d9aa5);
    prop(-w * 0.34, d * 0.28, 1.2, 0.5, 1.9, 0xe6ebe8);
  } else {                                          // 电玩厅:沿墙四台机子(发光脸)+ 一桌
    for (const off of [-w * 0.34, -w * 0.12, w * 0.12, w * 0.34]) prop(off, -d * 0.34, 1.0, 0.8, 1.7, 0x2e3340);
    prop(-w * 0.34, -d * 0.34 + 0.43, 0.86, 0.05, 0.5, s.K.glow);   // 屏幕脸三块:Basic 不受光,黑柜里自己就是光源
    prop(0, -d * 0.34 + 0.43, 0.86, 0.05, 0.5, s.K.glow);            // (四台的斜脸做不了:盒盒都是轴对齐的,三块已经够点亮屋子)
    prop(w * 0.34, -d * 0.34 + 0.43, 0.86, 0.05, 0.5, s.K.glow);
    prop(0, d * 0.2, 2.0, 1.2, 0.75, 0x3a4150);
  }
  s.solidSpecs = spec;
  g.visible = false; scene.add(g);
  s.group = g; s.built = true;
}

function enterShop(s) {
  if (inside || mode !== 'foot') return;
  if (!s.built) buildShop(s);
  s.group.visible = true;
  curShop = s; inside = s;
  solidMark = solids.length;
  for (const sp of s.solidSpecs) solids.push({ x: sp.x, z: sp.z, hw: sp.hw, hd: sp.hd, h: sp.h, interior: true });
  // 进门起点在门同侧、往屋里让 1.8 米(门线上有建筑碰撞盒,起点直接给屋里免被顶一帧)
  const fx = s.face.nx, fz = s.face.nz;
  heroWasVisible = hero.visible;
  px = fx ? fx * (s.room.w / 2 - 1.8) : s.t * 0.6; pz = fx ? s.t * 0.6 : fz * (s.room.d / 2 - 1.8);
  py = 0; vy = 0; grounded = true;
  walkYaw = camYaw = Math.atan2(-fx, -fz); manYaw = walkYaw;   // 进屋先面向屋里,W 立刻可用
  userYaw = 0; userPitch = 0; userZoom = 1; holdT = 99;
  // 相机瞬移到位(平滑 6/s 从 24 米外的街上拉回来要飞两秒,穿帮);黑壳圈外顺路灭掉
  // 街上人偶和主角车,屋里不该看见"自己"停在门外,出门全部还原。
  camX = px + Math.sin(camYaw) * 5.1; camZ = pz + Math.cos(camYaw) * 5.1;
  camY = Math.min(2.5, s.room.h - 0.6);
  for (const m of PED_MESHES) m.visible = false;
  hero.visible = false; blobGroup.visible = false;
}

function exitShop() {
  if (!inside) return;
  solids.length = solidMark;                     // 店内碰撞盒整段摘除(它们在表尾,车/街区的下标不动)
  const s = curShop;
  s.group.visible = false;
  // 出门落点必须换算成世界坐标:屋里的 px/pz 是"以原点屋子为中心"的局部系,一出门它就是全城坐标。
  // 门前 1.6 米这个落脚点,生成时已按 1.4 米 / 0.5 身宽验过干净(比门口还外挪 0.2,稳)。
  px = s.dx + s.face.nx * 1.6; pz = s.dz + s.face.nz * 1.6;
  py = 0; vy = 0; grounded = true;
  walkYaw = camYaw = Math.atan2(s.face.nx, s.face.nz); manYaw = ph = walkYaw;   // 背门面向街,W 直接走
  // 相机瞬移回街上机位(人后 18.7 米、屋顶上方 24.4 米):让阻尼从屋里慢慢飞要横穿大半座城。
  // 街上相机本来就压在屋顶之上,高度不用另算;机位落在人背后的街面延长线上。
  camX = px - s.face.nx * 18.7; camZ = pz - s.face.nz * 18.7; camY = 24.4;
  inside = null; curShop = null;
  for (const m of PED_MESHES) m.visible = true;
  hero.visible = heroWasVisible;
  blobGroup.visible = true;                      // 步行分支只挪斑不显斑,这里必须还给 true,出店人就永久没影了
}

const nearShop = () => {                          // 门口 2.8 米内才算"够得着门"
  let best = null, bd = 2.8;
  for (const s of shops) {
    const dd = Math.hypot(px - s.dx, pz - s.dz);
    if (dd < bd) { bd = dd; best = s; }
  }
  return best;
};

// ══ 输入 ══
const keys = new Set();
addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === 'r') {                          // 回到最近路口,车头朝向保持不变
    const [cx, cz] = nearestCrossing(hx, hz);
    placeAt(cx, cz, hh);
  }
  // E:店门进出的唯一键。在店里按 = 出门(不管离门多远);在街上只认"步行 + 够得着门"。
  // F/R 在店里按 = 先出门再走各自流程(开车流程按屋里那套局部坐标算会驴唇不对马嘴)。
  if (k === 'e' && state === 'play') {
    if (inside) exitShop();
    else if (mode === 'foot') { const s2 = nearShop(); if (s2) enterShop(s2); }
  }
  if (k === 'f' && state === 'play') { if (inside) exitShop(); else toggleCar(); }
  if (k === 'g' && state === 'play' && mode === 'foot' && !inside) punch();
  // Space 在步行时=跳;开车里的 Space 是漂移手刹(见 keys.has(' ')),两套模式各用各的。
  // e.repeat 拦掉长按连跳 —— 按住 Space 该是站着的一个人,不该成弹簧腿。
  if (k === ' ' && state === 'play' && mode === 'foot' && grounded && !e.repeat) { vy = JUMP_V; grounded = false; }
  // C 循环机位:常规 → 贴目标低角 → 高俯视(用户:下车后视角别固定死)
  if (k === 'c' && state === 'play') {
    camPreset = (camPreset + 1) % CAM_PRESETS.length;
    userPitch = 0; userZoom = 1;        // 拖的偏移清零,新机位从它自己的默认俯仰接棒
  }
  if (state !== 'play' && (k === ' ' || k === 'enter')) startGame();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

// G:挥拳。只有步行能用。打谁?正面 ±60° 锥内、2.3 米里最近的那个 —— 不是"最近的人"
// (背后贴着你的人不该被反手打中);命中就 st=3 蹲 2.2 秒、退你半步远(原地蹲不打飞,
// 打完还得"骂完走开",位移给一点人才不像钉在原地)。冷却按真实墙钟算(软渲染下游戏钟
// 只有 0.25 倍速,按 sim 秒数冷却的话你在慢机器上敲 G 会觉得按键丢了)。
let lastPunch = 0;
function punch() {
  if (performance.now() - lastPunch < 600) return;
  lastPunch = performance.now();
  man.userData.punchT = 0.28;                            // 主角右手摆一下。动画公式按 0.28 秒归一化(punchT 从 0.28 衰减到 0 = 摆一整弧),
  // 原来写 1 会把半秒的拳头拉成整一秒的慢动作太极
  let best = null, bd = 2.3;
  for (const p of peds) {
    if (p.st === 2) continue;                            // 已经躺着的别再打
    const dx = p.x - px, dz = p.z - pz, d = Math.hypot(dx, dz);
    if (d > bd) continue;
    // 拳头锥对着头朝向(manYaw),不对基准角:斜着走时基准角还贴在镜头上,
    // 身体已经转向行进方向 —— 打的是"你看着的方向"。standAt 两个都设,测试不受影响。
    const fwd = dx * Math.sin(manYaw) + dz * Math.cos(manYaw);
    if (fwd < d * 0.5) continue;                         // cos60°:锥外的不打
    bd = d; best = p;
  }
  if (!best) return;
  best.st = 3; best.punchT = 0; best.cross = null;
  best.re = 0;
  const d = Math.hypot(best.x - px, best.z - pz) || 1;
  best.x += (best.x - px) / d * 0.5; best.z += (best.z - pz) / d * 0.5;   // 退半步
  pedHits++;   // HUD"撞人"直接报成"撞/打人" —— 不加计数器不加键位,见 index.html 那行文案
}

// F:开车 -> 下车,站在车门边,车留在原地;步行 -> 上「最近的一辆车」(不限自己那辆)
function toggleCar() {
  if (mode === 'car') {
    commitCar();
    parkCar(active);
    const rx = -Math.cos(hh), rz = Math.sin(hh);   // 车右侧
    px = hx + rx * 1.9; pz = hz + rz * 1.9;
    ph = hh; walkYaw = hh; manYaw = hh;
    py = 0; vy = 0; grounded = true;            // 车在坡上/刚落地都按站稳算,别把上一段竖直态带下来
    vx = vz = vf = vr = 0;
    mode = 'foot';
    man.visible = true;
  } else {
    const c = nearestCar(px, pz, 3.4);
    if (!c) return;
    if (Math.hypot(c.spd || 0) > 9) return;       // 跑得太快的车流车够不着,得先把它逼停
    jack(c);                                      // 实例让位给主角车,它的碰撞盒也摘掉
  }
}

$('go').addEventListener('click', startGame);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function startGame() {
  spawn(); hits = 0;                       // placeAt 会顺手把人塞进开局那辆车
  state = 'play';
  $('veil').hidden = true;
}

// ══ 镜头 ══
// A 档自由视角:右键(或左键按住空白处 —— 没绑左键,点 HUD 不算)拖 = 水平无限转 +
// 俯角 20°~72°;滚轮 = 距离 0.55~1.6 倍。松手 1.6 秒后 yaw 滑回人物身后、俯角/距离滑回默认。
// 接管期间驾驶操作不变(steering 是车头相对的),镜头只是"看",不参与"开"。
// 相机扎进楼里会贴脸黑屏:用 solids 的 AABB 做射线(只挡 h>6 的楼和 h=3 的树,
// 车/消防栓那种矮东西不挡),相机被拽到墙前 0.9 米,贴墙看清而不是穿到楼里去。
let camYaw = 0, camX = 0, camY = 26, camZ = -22;
let userYaw = 0, userPitch = 0, userZoom = 1, dragYaw = 0, dragPitch = 0, holdT = 99;
// ── C 键循环的三个机位(pitch=-1 表示用现行默认:开车 50° / 步行 58°)──
// 低角 30° 配 0.6 倍距 = "贴目标怼脸";高俯 70° 配 1.25 倍距 = 看路口局势。
// 拖拽/滚轮照常叠在机位之上,自动回正回的是当前机位的默认,不是最初默认。
let camPreset = 0;
const CAM_PRESETS = [{ pitch: -1, dist: 1 }, { pitch: 30, dist: 0.6 }, { pitch: 70, dist: 1.25 }];
let dragging = 0;
const shortAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

// 射线-XY-AABB  slab 测试(只算水平面,高度门槛另判):返回射线起点到碰撞点的 t,没撞上返回 0
function camHitXZ(ox, oz, dx, dz, maxT, hMin) {
  let best = 0;
  for (const s of solids) {
    if (s.h <= hMin) continue;
    const minx = s.x - s.hw, maxx = s.x + s.hw, minz = s.z - s.hd, maxz = s.z + s.hd;
    let t1 = -1e9, t2 = 1e9;
    if (Math.abs(dx) > 1e-6) {
      const inv = 1 / dx; let a = (minx - ox) * inv, b2 = (maxx - ox) * inv;
      if (a > b2) { const tmp = a; a = b2; b2 = tmp; }
      t1 = a; t2 = Math.min(t2, b2);
    } else if (ox < minx || ox > maxx) { t1 = 1e9; }
    if (Math.abs(dz) > 1e-6) {
      const inv = 1 / dz; let a = (minz - oz) * inv, b2 = (maxz - oz) * inv;
      if (a > b2) { const tmp = a; a = b2; b2 = tmp; }
      t1 = Math.max(t1, a); t2 = Math.min(t2, b2);
    } else if (oz < minz || oz > maxz) { t1 = 1e9; }
    if (t1 < t2 && t1 > 0 && t1 < maxT + 1) best = best === 0 || t1 < best ? t1 : best;
  }
  return best;
}

addEventListener('mousedown', (e) => {
  if (e.button === 2 || e.button === 0) { dragging = 1; holdT = 99; e.preventDefault(); }
});
addEventListener('mousemove', (e) => {
  if (!dragging) return;
  userYaw += e.movementX * 0.006; dragYaw = e.movementX * 0.006;
  userPitch = clamp(userPitch - e.movementY * 0.004, -0.4, 0.15);   // 22°~72°(36° 比步行默认还高一点)
});
addEventListener('mouseup', () => { if (dragging) { dragging = 0; holdT = 0; } });
addEventListener('wheel', (e) => { userZoom = clamp(userZoom + e.deltaY * 0.0012, 0.55, 1.6); holdT = 99; }, { passive: true });
addEventListener('contextmenu', (e) => e.preventDefault());

function updateCamera(dt, tx, tz, thead, speed) {
  if (inside) {
    // ── 店内机位:人在后 5 米、高 2 米的小 30° 吊杆,拖拽/滚轮照常能用,但 XZ 被夹在
    // 屋墙里 0.6 米(相机穿墙 = 满屏黑,夹比遮挡便宜)。街上那套 24 米压屋顶的公式整个
    // 不换过来:3.1 米的屋子里,24 米的杆子会把天花板怼出画面外 —— C 机位/wantDist 在屋里不参与。
    holdT += dt;
    if (!dragging && holdT > 1.6) {
      const rec = 1 - Math.exp(-2.2 * (holdT - 1.6) * dt);
      userYaw -= userYaw * rec; userPitch -= userPitch * rec;
    }
    camYaw += shortAngle(thead + userYaw - camYaw) * (1 - Math.exp(-5.5 * dt));
    if (Math.abs(dragYaw) > 1e-4) { camYaw += dragYaw; dragYaw = 0; }   // 拖动即时生效,和街上一致
    const rad = 30 * Math.PI / 180 + clamp(userPitch, -0.3, 0.08);
    const dist = 5.0 + (userZoom - 1) * 1.6;
    const horiz = dist * Math.cos(rad), high = dist * Math.sin(rad);
    const lag = 1 - Math.exp(-9 * dt);
    camX += (tx - Math.sin(camYaw) * horiz - camX) * lag;
    camZ += (tz - Math.cos(camYaw) * horiz - camZ) * lag;
    camY += (Math.min(inside.room.h - 0.55, 1.05 + high) - camY) * lag;
    const mx = inside.room.w / 2 - 0.6, mz = inside.room.d / 2 - 0.6;   // 夹在墙内 0.6 米
    camX = clamp(camX, -mx, mx); camZ = clamp(camZ, -mz, mz);
    camera.position.set(camX, camY, camZ);
    camera.lookAt(tx + Math.sin(camYaw) * 1.6, 1.0, tz + Math.cos(camYaw) * 1.6);
    return;
  }
  const cp = CAM_PRESETS[camPreset];
  // 步行取景 = 开车取景完全同款(用户拍板:"切成和开车一样,不用放大"):30 米挂 23 米高,
  // 越过屋顶线(楼高上限 11 米)看人 —— 开车在楼群里穿行不怕挡镜头的机制,步行原样继承。
  // 步行传进来的 speed 恒为 WALK,所以起步/停步不会有个 30→32 米的呼吸感。
  const wantPitch = cp.pitch < 0 ? 50 : cp.pitch;
  const wantDist = (30 + Math.min(speed, CAR_MAX) * 0.34) * cp.dist;
  holdT += dt;
  // 松手够久(或在车↔步切换后 thead 跳得比用户拖的快),接管量自己溜回 0 —— "滑回"就是这么实现的
  if (!dragging && holdT > 1.6) {
    const rec = 1 - Math.exp(-2.2 * (holdT - 1.6) * dt);
    userYaw -= userYaw * rec; userPitch -= userPitch * rec; userZoom += (1 - userZoom) * rec;
    // 车头方向离相机超过 57° = 有人在开车掉头/横摆 —— 接管别再硬往身后拽了,直接软收。
    // (原来用 1 弧度=57°:车流让行时自己刹停都会过线,实测一次让行就把 2.8rad 的接管吞了,
    //  玩家按住 3 秒的视角在车一走动时凭空消失。57°→26° 后让行摆头保得住,真掉头照收。)
    if (Math.abs(shortAngle(thead - camYaw)) > 0.46 && Math.abs(userYaw) > 0.03) userYaw *= 0.9;
  }
  // 步行且"拖完还没回正"这 1.6 秒里冻结水平角自动追赶:走的方向贴相机(相机相对控制),
  // 相机角追"身体+拖拽量",身体又追走的方向 —— 三个节点首尾相接,拖进来的 1.8 弧度没处泄,
  // 实测变 7rad/s 旋转木马:鼠标一松手 W,走的方向疯狂画弧(dot 直接 -0.2)。
  // 冻结期间拖拽增量照常即时生效;1.6 秒后回正启动,userYaw 边缩边追,自动滑回身后。
  // 开车侧没这个环(车头由方向盘定,不吃相机),速率维持原样。
  const chase = mode === 'car' || dragging || holdT > 1.6 ? (mode === 'car' ? 3.4 : 5.5) : 0;
  camYaw += shortAngle(thead + userYaw - camYaw) * (1 - Math.exp(-chase * dt));
  if (Math.abs(dragYaw) > 1e-4) { camYaw += dragYaw; dragYaw = 0; }   // 本帧新拖的角立刻生效(增量制,360° 不打卷)
  const rad = (wantPitch * Math.PI / 180) + userPitch;
  const dist = wantDist * userZoom;
  const horiz = dist * Math.cos(rad), high = dist * Math.sin(rad);
  const lag = 1 - Math.exp(-6 * dt);
  camX += (tx - Math.sin(camYaw) * horiz - camX) * lag;
  camZ += (tz - Math.cos(camYaw) * horiz - camZ) * lag;
  camY += (high - camY) * lag;
  const px2 = tx - camX, pz2 = tz - camZ, len = Math.hypot(px2, pz2);
  // hMin=TW_MAX+1(19)高于一切实体高度(普通楼 11 / 高楼 18):相机 24 米挂在全部屋顶之上,
  // 任何楼/树都进不了这条射线,收镜头机制整体休眠 —— 高楼加进来也没把它叫醒。
  // (步行曾试过 hMin=2.5 的"贴楼拽近"(8 米近景配套),实测贴墙时相机 5Hz 抽搐,
  // 且用户否掉了近景方案,整套退回开车同款。射线量程=整条"人→相机"是当时的修法,留着无害。)
  const pull = len > 0.3 ? camHitXZ(tx, tz, px2 / len, pz2 / len, len, TW_MAX + 1) : 0;
  if (pull > 0) {          // 楼在"人→相机"半路挡着:相机站到墙前,别穿进去糊黑
    // 最短留 1.2 米:人背快抵到墙时(倒车贴墙),原来的 (pull-0.9)/len 会归零,
    // 相机直接摁到人头顶上变俯视图糊成一团。1.2 米 = 贴脸特写,还是比穿楼好看。
    // 下限也不能写死:墙贴到 0.5 米级时"最短 1.2 米"反而把相机摁进楼里。
    // 近墙时贴着墙皮走(pull 的一半),最挤不过贴脸 —— 相机永远在障碍外面。
    const cd = Math.min(len, Math.max(pull - 0.9, Math.min(1.2, pull * 0.5)));
    camX = tx + px2 / len * cd; camZ = tz + pz2 / len * cd;
    const wallH = 6 * 0.9 + 1.2;
    if (camY > wallH) camY = wallH;
  }
  camera.position.set(camX, camY, camZ);
  // 视线提前量 9 米,步行开车同一份:23 米高空 50° 俯角下,9 米的偏移只是把人在画面里
  // 放低一点(和车头在画面里的位置一致),不存在近景里"人贴画面底边"的问题。
  camera.lookAt(tx + Math.sin(camYaw) * 9, 1.2, tz + Math.cos(camYaw) * 9);
}

// ══ 主循环 ══
let last = performance.now(), sumDt = 0, sumReal = 0;

let frameCount = 0;
function frame(now) {
  frameCount++;
  // rAF 的时间戳是“帧开始”时刻,可能早于上一帧记录的 last,所以两头都要夹住:
  // 负 dt 会让相机的平滑插值反向发散(实测把相机甩到 180 米高)
  const raw = (now - last) / 1000;
  const dt = Math.min(0.05, Math.max(0, raw));   // dt 夹上限 = 卡帧时变慢动作,而不是穿模
  last = now;
  if (raw > 0) { sumDt += dt; sumReal += Math.min(0.5, raw); }
  tNow += dt;

  if (state === 'play') {
    const up = keys.has('arrowup') || keys.has('w');
    const down = keys.has('arrowdown') || keys.has('s');
    const steer = (keys.has('arrowright') || keys.has('d') ? 1 : 0) - (keys.has('arrowleft') || keys.has('a') ? 1 : 0);
    const drift = keys.has(' ');
    hitCool = Math.max(0, hitCool - dt);

    if (mode === 'car') {
      const T = active, g = GEO[T.g];               // 每种车的油门/极速/转向手感都不同
      const vtop = CAR_MAX * T.top;
      const fx = Math.sin(hh), fz = Math.cos(hh);
      const rx = -Math.cos(hh), rz = Math.sin(hh);   // 车的右侧 = 屏幕右

      if (up) vf += ACCEL * T.acc * dt;
      if (down) { if (vf > 0.6) vf -= BRAKE * dt; else vf = Math.max(CAR_REV, vf - ACCEL * 0.55 * dt); }
      if (!up && !down) vf *= Math.exp(-1.7 * dt);
      vf = clamp(vf, CAR_REV, vtop);

      // 转向:低速转得狠,高速自动变钝(否则满速开不住);倒车时方向自动反
      const authority = clamp(vf / 7, -1, 1) * (1 - 0.45 * clamp(Math.abs(vf) / vtop, 0, 1));
      const yawRate = steer * YAW_MAX * g.yaw * authority * (drift ? 1.45 : 1);
      hh -= yawRate * dt;              // 减号:这个世界里 yaw 变大是往屏幕左偏

      // 侧向抓地:手刹 = 抓地骤降 = 漂移
      vr *= Math.exp(-(drift ? GRIP_DRIFT : GRIP) * dt);
      if (Math.abs(vf) > 0.2 && steer) vr += -yawRate * vf * 0.30 * dt;   // 转弯被甩向外侧

      vx = fx * vf + rx * vr;
      vz = fz * vf + rz * vr;
      hx += vx * dt; hz += vz * dt;
      odo += Math.hypot(vx, vz) * dt;   // 里程:大角度转弯时净位移会绕回来,判「有没有在走」得用它

      const imp = resolveCar(g.r);    // 撞击(楼/车都算):吃掉法向速度,不做二次解析(大车碰撞半径更大)
      if (imp > 6 && hitCool <= 0) { hits++; hitCool = 0.5; }

      steerVis += (steer - steerVis) * Math.min(1, dt * 9);
      hero.position.set(hx, 0, hz);
      hero.rotation.y = hh + vr * 0.03;
      hero.rotation.z = -vr * 0.02;
      for (const w of hero.userData.wheels) {
        w.spin.rotation.x -= vf * dt / g.wr;                  // 自转按各自轮径,否则大车轮子看着在打滑
        if (w.front) w.pivot.rotation.y = steerVis * g.steer; // 转向绕铰点
      }
      blobGroup.visible = true;
      blobGroup.position.set(hx, 0.03, hz);
      blobGroup.rotation.y = hh;
      // 圆斑被 blob.rotation.x 摊平后,local y 才是"沿车身"那一轴:
      // 原来写 (2.35, 1.2) = 横着胖、顺着瘦,长车底下像个短粗的水渍
      blob.scale.set(g.W * 1.15, g.L * 0.78, 1);
      commitCar();                                      // 位姿写回 cars[]
      updateCamera(dt, hx, hz, hh, Math.hypot(vx, vz));
    } else {
      const mx = (keys.has('arrowright') || keys.has('d') ? 1 : 0) - (keys.has('arrowleft') || keys.has('a') ? 1 : 0);
      const mz = (keys.has('arrowup') || keys.has('w') ? 1 : 0) - (keys.has('arrowdown') || keys.has('s') ? 1 : 0);
      const moving = mx || mz;
      // 跳的竖直积分:起跳只改一次 vy,这里逐帧抛物线,落地复位。水平照常走(空中可继续
      // 用键盘调向,街机手感;想要抛物线锁死水平的话,把移动那几行用 grounded 一挡就行)。
      if (!grounded) {
        vy -= GRAV_J * dt;
        py += vy * dt;
        if (py <= 0) { py = 0; vy = 0; grounded = true; }
      }
      const sprinting = moving && grounded && keys.has('shift');   // 按住 Shift=跑;腾空瞬间不接管(不然落地前按住会接力起飞感)
      const spd = WALK * (sprinting ? RUN_MULT : 1);
      if (moving) {
        // GTA 式相机相对控制:走路基准角贴当前镜头朝向 —— W 永远朝屏幕纵深走,
        // 鼠标把镜头转到哪,W 就走向哪。以前 walkYaw 只在下车那刻定死,
        // 之后 W 永远走同一个世界方向、相机也不转,像俯视角遗留(用户投诉的根源)。
        walkYaw = camYaw;
        const dx = Math.sin(walkYaw) * mz - Math.cos(walkYaw) * mx;   // 上=屏幕纵深,右=其屏幕右
        const dz = Math.cos(walkYaw) * mz + Math.sin(walkYaw) * mx;
        const len = Math.hypot(dx, dz);
        // 身体只在前走(含斜前)时转向行进方向 —— 相机跟着转,这才叫"绕弧转身"。
        // 纯横移/倒车保持面朝前方滑步(GTA 的 moonwalk):不然平移的方向=新的"身后",
        // 相机水平角去追它,人和相机互相绕,实测 D 键会变成 8.8rad/s 的原地陀螺。
        ph = mz > 0 ? Math.atan2(dx, dz) : walkYaw;
        const o = pushOut(px + (dx / len) * spd * dt, pz + (dz / len) * spd * dt, 0.45);
        px = o.x; pz = o.z;
        walkPhase += dt * (sprinting ? 13.5 : 9);   // 步频跟跑速一起涨,不然快腿慢腿一个样
      }
      manYaw += shortAngle(ph - manYaw) * (1 - Math.exp(-14 * dt));
      man.position.set(px, py + (moving && grounded ? Math.abs(Math.sin(walkPhase)) * 0.05 : 0), pz);
      man.rotation.y = manYaw;
      man.rotation.x = moving ? 0 : Math.sin(tNow * 1.7) * 0.012;   // 站着时轻微呼吸
      const sw = Math.sin(walkPhase) * (moving ? 0.7 : 0);
      const L = man.userData.limbs;
      L.legL.rotation.x = sw; L.legR.rotation.x = -sw;
      L.armL.rotation.x = -sw * 0.8; L.armR.rotation.x = sw * 0.8;
      if (!grounded) {   // 腾空姿态:收腿、手臂前摆。地上 24 米高空也能一眼看出是跳不是滑行
        L.legL.rotation.x = -0.55; L.legR.rotation.x = -0.3;
        L.armL.rotation.x = 1.1; L.armR.rotation.x = 0.9;
      }
      // 挥拳:右手在 0.28 秒里"抡出去再拽回来"(sin 半拱),盖住摆臂的右臂槽位
      const pt = man.userData.punchT || 0;
      if (pt > 0) {
        man.userData.punchT = Math.max(0, pt - dt);
        L.armR.rotation.x = -Math.sin((1 - man.userData.punchT / 0.28) * Math.PI) * 1.9;
      }
      blobGroup.position.set(px, 0.03, pz);
      blobGroup.rotation.y = ph;
      blob.scale.set(0.55, 0.72, 1);
      // 喂 manYaw(身体真实朝向)而不是定死的 walkYaw —— 相机水平角才会跟着人转。
      // walkYaw 现在每走一步都贴镜头,喂它等于让相机追自己,等于没喂。
      // speed 恒传 WALK:取景和开车同款后它是常数,走/停之间相机不会呼吸式缩进缩出。
      updateCamera(dt, px, pz, manYaw, WALK);
    }

    updateTraffic(dt);
    updatePeds(dt);
    sun.position.set((mode === 'car' ? hx : px) - 40, 26, (mode === 'car' ? hz : pz) + 30);
    sun.target.position.set(mode === 'car' ? hx : px, 0, mode === 'car' ? hz : pz);
    updateBlip();
  }

  renderer.render(scene, camera);

  const sp = mode === 'car' ? Math.hypot(vx, vz) : 0;
  $('kmh').textContent = Math.round(sp * 3.6);
  $('kmh').style.opacity = mode === 'car' ? '' : '0';   // 步行时速度表让位:那块大数是汽车的仪表盘,人走路报 5km/h 没意义
  $('modev').textContent = mode === 'car' ? '开车' : '步行';
  $('hitsv').textContent = hits;
  $('pedsv').textContent = pedHits;
  $('blocksv').textContent = blockTypes.filter((t) => t === 0).length + ' 楼区 / ' + parks.length + ' 公园 / ' + lots.length + ' 停车场';
  // 门口提示:走近某家店报"按 E 进入 XX",在店里常驻"按 E 离店"(店里有去无回会懵)
  const hintEl = $('hint');
  const nearIn = (inside || state !== 'play' || mode !== 'foot') ? null : nearShop();
  const htxt = inside ? `按 E 离店 · ${inside.K.name}` : nearIn ? `按 E 进入 ${nearIn.K.name}` : '';
  hintEl.textContent = htxt;
  hintEl.style.opacity = htxt ? '1' : '0';

  requestAnimationFrame(frame);
}

// 车的碰撞(直接改 vx/vz,避开上面那个绕来绕去的写法)
function resolveCar(r) {
  let hitSpeed = 0;
  for (let i = 0; i < solids.length; i++) {
    if (solidsOff.has(i)) continue;
    const s = solids[i];
    const nx = Math.max(s.x - s.hw, Math.min(hx, s.x + s.hw));
    const nz = Math.max(s.z - s.hd, Math.min(hz, s.z + s.hd));
    let dx = hx - nx, dz = hz - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 > r * r) continue;
    let ux, uz, dd = Math.sqrt(d2);
    if (dd > 1e-6) { ux = dx / dd; uz = dz / dd; } else { ux = 0; uz = 1; dd = 0; }
    hx += ux * (r - dd); hz += uz * (r - dd);
    const soft = s.car && s.car.trafficAI;     // 撞的是会让路的车流车,不是墙
    if (soft) { s.car.x -= ux * (r - dd) * 0.9; s.car.z -= uz * (r - dd) * 0.9; s.car.spd *= 0.3; }
    const vn = vx * ux + vz * uz;
    if (vn < 0) { hitSpeed = Math.max(hitSpeed, -vn); const k = soft ? 0.75 : 1.25; vx -= ux * vn * k; vz -= uz * vn * k; }
  }
  vf = Math.sin(hh) * vx + Math.cos(hh) * vz;
  vr = -Math.cos(hh) * vx + Math.sin(hh) * vz;
  return hitSpeed;
}

// ══ 调试快照:harness 直接读游戏真实状态 ══
window.__gta = {
  seed: SEED.toString(36),               // 本次城市种子:红了拿它拼进 ?seed= 重放同一座城
  get jumpH() { return +py.toFixed(2); },   // 离地高度(米),步行跳才有值
  footAt(x, z) { px = x; pz = z; py = 0; vy = 0; grounded = true; },   // 步行瞬移(harness 专用):不上下车,竖直态复位站稳。在店里时坐标是屋内局部系
  get inShop() { return inside ? inside.K.name : null; },
  get shopRoom() { return inside ? { w: +inside.room.w.toFixed(2), d: +inside.room.d.toFixed(2), h: inside.room.h } : null; },
  get shopDoors() { return shops.map((s) => ({ name: s.K.name, x: +s.dx.toFixed(1), z: +s.dz.toFixed(1), nx: s.face.nx, nz: s.face.nz })); },
  get shopNear() { if (inside) return 'in'; const s2 = nearShop(); return s2 ? s2.K.name : null; },   // 门口 2.8 米内报店名,否则 null
  get camEye() { return { x: +camX.toFixed(2), y: +camY.toFixed(2), z: +camZ.toFixed(2) }; },          // 相机真实位置(店内机位是否钻墙用)
  enterShop() { if (!inside && mode === 'foot') { const s2 = nearShop(); if (s2) enterShop(s2); } return inside ? inside.K.name : null; },
  exitShop,                                            // 出门走的是和按 E 同一条路径,测的就是玩家路径本身
  get bldMatCount() { return bldMats.length; },   // 墙面贴图类数(5 = 普通 4 类 + 高楼 1 类)
  get state() { return state; }, get mode() { return mode; },
  get x() { return +(mode === 'car' ? hx : px).toFixed(2); },
  get z() { return +(mode === 'car' ? hz : pz).toFixed(2); },
  get heading() { return +hh.toFixed(3); },
  get speed() { return +Math.hypot(vx, vz).toFixed(2); },
  get forward() { return +vf.toFixed(2); },
  get lateral() { return +vr.toFixed(2); },
  get odo() { return +odo.toFixed(1); },
  get hits() { return hits; },
  get solidCount() { return solids.length; },
  get solids() { return solids; },
  get blocks() { return blockTypes.length; },
  get nearCar() { const c = nearestCar(px, pz, 1e9); return c ? +Math.hypot(px - c.x, pz - c.z).toFixed(2) : 999; },
  get carCount() { return cars.length; },
  get carId() { return active ? active.i : -1; },
  get myCarId() { return myCar ? myCar.i : -1; },
  get carVisible() { return active ? (!!hero && hero.visible) : (!!myCar && !myCar.blanked); },
  get carType() { return active ? active.t.name : (myCar ? myCar.t.name : null); },
  get carTypes() { const m = {}; cars.forEach((c) => { m[c.t.name] = (m[c.t.name] || 0) + 1; }); return m; },
  get myCarTop() { return active ? +(CAR_MAX * active.top).toFixed(1) : 0; },
  get selfBlocked() { return !!active && !solidsOff.has(active.solid); },   // 被自己的碰撞盒挡住 = true
  get solidsOffCount() { return solidsOff.size; },
  get blip() { return blipGroup.visible ? { x: +blipGroup.position.x.toFixed(1), z: +blipGroup.position.z.toFixed(1) } : null; },
  get cars() { return cars.map((c) => ({ i: c.i, x: +c.x.toFixed(1), z: +c.z.toFixed(1), type: c.t.name, blanked: !!c.blanked, traffic: !!c.trafficAI })); },
  // 把人的位置投到屏幕上(截特写用)
  get manScreen() {
    const v = new THREE.Vector3(px, 1.0, pz).project(camera);
    return { x: Math.round((v.x * 0.5 + 0.5) * innerWidth), y: Math.round((-v.y * 0.5 + 0.5) * innerHeight) };
  },
  // 主角网格的真实世界位置 —— 用来核对"逻辑位姿"和"画面上那张车"是不是同一个地方
  get heroPos() { return hero ? [+hero.position.x.toFixed(2), +hero.position.y.toFixed(2), +hero.position.z.toFixed(2), !!hero.visible, hero.userData.paint ? '#' + hero.userData.paint.color.getHexString() : '-'] : null; },
  get raf() { return { frames: frameCount, state, mode }; },
  get traffic() { return cars.filter((c) => c.trafficAI).length; },
  get trafficMoving() { return cars.filter((c) => c.trafficAI && c.spd > 1).length; },
  // 正在拐弯的车本来就该偏出车道,不能算作"开歪了"
  get trafficInLane() { return cars.filter((c) => c.trafficAI && !c.turn &&
      Math.abs((c.axis === 'x' ? c.z : c.x) - c.lane) < 2.2).length; },
  // 哪些车不在自己车道上、偏了多少、是不是正在拐 —— 只报数看不出原因
  offLaneReport() {
    cars.forEach((c) => { c.drift = 0; });   // 读一次清零,报的是这一段的累计顶出量
    return cars.filter((c) => c.trafficAI && !c.turn)
      .map((c) => ({ i: c.i, err: +Math.abs((c.axis === 'x' ? c.z : c.x) - c.lane).toFixed(1),
        x: +c.x.toFixed(1), z: +c.z.toFixed(1), push: +((c.drift || 0)).toFixed(2), ry: +(c.ry % 6.283).toFixed(2), line: +c.line.toFixed(1),
        lane: +c.lane.toFixed(1), next: +c.nextCross.toFixed(1), spd: +c.spd.toFixed(1), axis: c.axis, dir: c.dir }))
      .filter((r) => r.err > 2.2).slice(0, 6);
  },
  get trafficTurns() { return cars.filter((c) => c.trafficAI && c.turn).length; },
  // 注意要跳过自己的碰撞盒:车的中心永远在自己盒子里,否则这条永远是 22
  // 只查一次、只查建筑:车中心天然在自己那个 AABB 里,必须 skip 自己的槽位再问别的实体;
  // 车不查车 —— 路口横向擦边的两辆车间距 2.2,合法通过也会离对方盒边 <0.8,别把擦边当穿楼。
  // (原来写成 A && !A 恒等于 0,"穿楼=0"一直是空过的假绿。)
  get trafficInBuildings() { return cars.filter((c) => c.trafficAI && probeSolid(c.x, c.z, 0.8, c.solid, false)).length; },
  get trafficBlocked() { return cars.filter((c) => c.trafficAI && probeSolid(c.x, c.z, 0.8, c.solid) > 0).length; },
  get trafficOutOfBounds() { return cars.filter((c) => c.trafficAI &&
      (c.x < -HALF || c.x > HALF || c.z < -HALF || c.z > HALF)).length; },
  get trafficBlockedWide() { return cars.filter((c) => c.trafficAI && probeSolid(c.x, c.z, 1.6, c.solid)).length; },
  // 离玩家最近的一辆流车:用来做"撞开它"的验证。
  // minSpd>0 时只要"此刻真在跑"的:堵死城市里(对照试验实测全新城市也会 13/22 动、
  // 堵 5~6)最近的那辆十有八九是排队链尾,拿它测让路/追尾永远观测不到逼近 —— 三轮全废。
  nearestTraffic(minSpd = 0) {
    const ax = mode === 'car' ? hx : px, az = mode === 'car' ? hz : pz;
    let best = null, bd = 1e9;
    for (const c of cars) if (c.trafficAI && !c.blanked && !c.turn && c.spd >= minSpd) { const d = Math.hypot(c.x - ax, c.z - az); if (d < bd) { bd = d; best = c; } }
    return best ? { i: best.i, x: +best.x.toFixed(1), z: +best.z.toFixed(1), spd: +best.spd.toFixed(1), ry: +best.ry.toFixed(3) } : null;
  },
  // 前方 55 米内不会遇到路口的流车:追尾/让路验证需要一段不拐弯的直路,
  // 不然目标在追击途中转弯横穿,接触退化成擦肩,"撞上计数"就成了环境运气。
  nearestTrafficLong(minSpd = 0) {
    const ax = mode === 'car' ? hx : px, az = mode === 'car' ? hz : pz;
    let best = null, bd = 1e9;
    for (const c of cars) {
      if (!c.trafficAI || c.blanked || c.turn || c.spd < minSpd) continue;
      const along = c.axis === 'x' ? c.x : c.z;
      const nxt = nextCrossCoord(c.dir, along);
      const ahead = c.dir > 0 ? nxt - along : along - nxt;
      if (ahead < 55) continue;
      const d = Math.hypot(c.x - ax, c.z - az); if (d < bd) { bd = d; best = c; }
    }
    return best ? { i: best.i, x: +best.x.toFixed(1), z: +best.z.toFixed(1), spd: +best.spd.toFixed(1), ry: +best.ry.toFixed(3) } : null;
  },
  get pedCount() { return peds.length; },
  get pedsPanic() { return peds.filter((p) => p.st === 1).length; },
  get pedsDown() { return peds.filter((p) => p.st === 2).length; },
  get pedsCrossing() { return peds.filter((p) => !!p.cross).length; },
  get pedsCrouched() { return peds.filter((p) => p.st === 3).length; },   // 正抱着头蹲着的("吃我一拳"态)
  // 人必须留在街区/人行道上:嵌楼 = 0(除非正在横穿),出格 = 0
  get pedsInBuildings() { return peds.filter((p) => !p.cross && !p.re && p.st !== 2 && probeSolid(p.x, p.z, 0.05, -1, false)).length; },
  get pedsOutBounds() { return peds.filter((p) => Math.abs(p.x) > HALF - 1 || Math.abs(p.z) > HALF - 1).length; },
  get pedHitsN() { return pedHits; },
  pedState(i) {
    const p = peds[i];
    return p ? { x: +p.x.toFixed(2), z: +p.z.toFixed(2), st: p.st, cross: !!p.cross, re: !!p.re,
      lie: +p.lie.toFixed(2), panic: +p.panic.toFixed(1), gy: +p.gy.toFixed(2), yaw: +p.yaw.toFixed(2) } : null;
  },
  nearestPed() {                                  // 挑一个正在散步的(不横穿/不逃窜),测试才好瞄准
    const ax = mode === 'car' ? hx : px, az = mode === 'car' ? hz : pz;
    let best = null, bd = 1e9;
    for (const p of peds) { if (p.st === 2 || p.st === 1 || p.cross) continue;
      const d = Math.hypot(p.x - ax, p.z - az); if (d < bd) { bd = d; best = p; } }
    if (!best) return null;
    // ox/oz = 人所在位置朝街区的反方向(朝马路):测试摆车该摆在线上,人线嵌在楼盒带里
    const lx = best.x - best.cx, lz = best.z - best.cz;
    const o = Math.abs(lx) >= Math.abs(lz) ? [Math.sign(lx) || 1, 0] : [0, Math.sign(lz) || 1];
    return { i: best.i, x: +best.x.toFixed(1), z: +best.z.toFixed(1), st: best.st, ox: o[0], oz: o[1] };
  },
  // 正在横穿大马路的人 + 他的行进方向:碾压验证要"相向闭合",人沿横线走来、车沿横线迎上去,
  // 不用修方向盘 —— 散步者贴车道平行开 12 米,人横着走两步就出了车头走廊,是运气题。
  nearestCrossingPed() {
    const ax = mode === 'car' ? hx : px, az = mode === 'car' ? hz : pz;
    let best = null, bd = 1e9;
    for (const p of peds) { if (p.st !== 0 || p.re || !p.cross) continue;
      const d = Math.hypot(p.x - ax, p.z - az); if (d < bd) { bd = d; best = p; } }
    if (!best) return null;
    const q = best.cross, seg = Math.hypot(q.x1 - q.x0, q.z1 - q.z0) || 1;
    return { i: best.i, x: +best.x.toFixed(1), z: +best.z.toFixed(1),
      vx: +((q.x1 - q.x0) / seg).toFixed(3), vz: +((q.z1 - q.z0) / seg).toFixed(3) };
  },
  traceCar(i) { TRACE_I = i; TRACE_LOG.length = 0; return true; },
  get traceLog() { return TRACE_LOG.slice(-12); },
  clearTrace() { TRACE_I = -1; TRACE_LOG.length = 0; },
  // 这一圈半径内压着哪些障碍:被顶来顶去的时候,得知道是谁在顶
  // 这一帧里"被实体顶出去"的最大距离:和 traceCar 对上看,就知道是不是碰撞在推它
  peakDriftAt() { return Math.max(0, ...cars.filter((c) => c.trafficAI).map((c) => c.drift || 0)); },
  solidsNear(x, z, r) {
    const out = [];
    for (let i = 0; i < solids.length; i++) {
      if (solidsOff.has(i)) continue;
      const q = solids[i];
      const nx = Math.max(q.x - q.hw, Math.min(x, q.x + q.hw));
      const nz = Math.max(q.z - q.hd, Math.min(z, q.z + q.hd));
      const d = Math.hypot(x - nx, z - nz);
      if (d > r) continue;
      out.push({ i, sx: +q.x.toFixed(1), sz: +q.z.toFixed(1), hw: +q.hw.toFixed(2), hd: +q.hd.toFixed(2),
                 d: +d.toFixed(2), kind: q.car ? (q.car.t.name + (q.car.trafficAI ? '(流车)' : '(停车)')) : '楼/树' });
    }
    return out.sort((a, b) => a.d - b.d).slice(0, 5);
  },
  carState(i) {                     // cars 是给测试看的摘要,没有速度;要看真身用这个
    const c = cars[i];
    return c ? { x: +c.x.toFixed(2), z: +c.z.toFixed(2), spd: +(c.spd || 0).toFixed(2), ry: +c.ry.toFixed(3),
                 type: c.t.name, L: GEO[c.g].L, W: GEO[c.g].W, trafficAI: !!c.trafficAI, blanked: !!c.blanked,
                 want: +(c.want ?? -99).toFixed(2), cruise: +(c.cruise ?? -1).toFixed(2), axis: c.axis || '?',
                 dir: c.dir || 0, turn: !!c.turn, stuck: +(c.stuck || 0).toFixed(2), escalate: +(c.escalate || 0).toFixed(2) } : null;
  },
  carTrafficAI(i) { const c = cars[i]; return !!(c && c.trafficAI); },
  get carScreen() {
    const v = new THREE.Vector3(hx, 1.0, hz).project(camera);
    return { x: Math.round((v.x * 0.5 + 0.5) * innerWidth), y: Math.round((-v.y * 0.5 + 0.5) * innerHeight) };
  },
  // 跳到附近某型车上(截图 / 测换车用)
  jumpToType(name) {
    let best = null, bd = 1e9;
    const ax = mode === 'car' ? hx : px, az = mode === 'car' ? hz : pz;
    for (const c of cars) { if (c.t.name === name && c !== active) { const d = Math.hypot(c.x - ax, c.z - az); if (d < bd) { bd = d; best = c; } } }
    if (!best) return null;
    jack(best);
    return { i: best.i, type: best.t.name, d: +bd.toFixed(1) };
  },
  standAt: (x, z, h) => { if (active) parkCar(active); px = x; pz = z;
    if (h != null) { ph = h; walkYaw = manYaw = h; }       // 可选朝向:步行特写要能对着目标拍
    mode = 'foot'; man.visible = true; hideHeroes(); },
  get insideSolid() { return probeSolid(mode === 'car' ? hx : px, mode === 'car' ? hz : pz, mode === 'car' ? 1.4 : 0.4); },
  // 某点在障碍盒里的最大高度(不在任何盒里 = 0)。相机射线只认 h>2.5 的障碍 ——
  // 测试摆位找"真会挡镜头的障"得用同一把尺子,别把矮盒(车、路障)当楼。
  solidHeightAt(x, z) { let h = 0; for (const s of solids) { if (Math.abs(x - s.x) <= s.hw && Math.abs(z - s.z) <= s.hd && s.h > h) h = s.h; } return h; },
  // 测试专用:直接打最近一拳(正面锥内)。测试别去模拟"走到人面前转向",
  // 那是走路+朝向两套老断言的活;punch() 的真实按键路径在 keydown 里已挂好。
  punchNow() { punch(); return peds.filter((p) => p.st === 3).length; },
  // 谁在蹲着 —— 给验证脚本点名用
  get pedsPunchTarget() { const p = peds.find((q) => q.st === 3); return p ? { i: p.i, x: +p.x.toFixed(1), z: +p.z.toFixed(1) } : null; },
  // 附近有没有某型可抢的车:不抢,只问。测试要用快车撞流车,又不能让测试自己上路政
  // (换了车 odo 不清零,"过多少个街区"就测不了)。types 按数量降序。
  hasNearbyType(name) {
    let n = 0; const counts = {};
    for (const c of cars) { if (c === active || c.blanked) continue;
      counts[c.t.name] = (counts[c.t.name] || 0) + 1; if (c.t.name === name) n++; }
    return { n, types: Object.entries(counts).sort((a, b) => b[1] - a[1]) };
  },
  get cam() { return [+camera.position.x.toFixed(1), +camera.position.y.toFixed(1), +camera.position.z.toFixed(1)]; },
  // dt 夹 0.05 秒 = 卡帧时游戏变慢动作。验证脚本按挂钟采样会把"慢动作"读成"走不动",
  // 一切行走/时序断言都得以这个被夹住的世界钟为准。
  get simT() { return tNow; },
  // 自由视角的接管状态:0=全自动跟车,1=你正按住鼠标,还有 userYaw 是拖了多少弧度
  get camGrab() { return dragging ? 1 : (userYaw > 0.05 || userYaw < -0.05 || userPitch < -0.02 || userPitch > 0.02 || Math.abs(userZoom - 1) > 0.02) ? 1 : 0; },
  get camPreset() { return camPreset; },                 // 0 常规 / 1 贴目标低角 / 2 高俯视
  probeSolid: (x, z, r = 0) => probeSolid(x, z, r),   // r 可传:门口落脚点要按 0.5 米身宽问,不许测试自己另造一把尺子
  spawnAt: (x, z, h) => placeAt(x, z, h ?? 0),
  set fov(v) { camera.fov = v; camera.updateProjectionMatrix(); },
  // 与显卡无关的真实开销指标;timeScale=1 表示满速,小于 1 说明机器跟不上
  get perf() { return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; },
  get renderer() { return renderer; },      // 探针用:在 render 前塞入自己的机位(相机更新在 render 之前,事后盖 rAF 会被覆写)
  get timeScale() { return sumReal > 0 ? +(sumDt / sumReal).toFixed(2) : 1; },
};

if (AUTOSTART2) startGame();
requestAnimationFrame(frame);
