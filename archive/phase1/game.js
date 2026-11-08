import * as THREE from './vendor/three.module.js';

// ── 参数 ────────────────────────────────────────────────────
const SKY = 0x070b18;
const GROUND_Y = -16;
const LIMIT_X = 13, LIMIT_Y_LO = -8, LIMIT_Y_HI = 10;
const START_SPD = 26, MAX_SPD = 74, RAMP = 0.6, BOOST_MUL = 1.7;
const RING_GAP = 44, SPAWN_AHEAD = -820, RECYCLE_AT = 26;
const PILLARS = 44, SPAN = 1000;
const LIVES = 3;

const AUTOSTART = new URLSearchParams(location.search).has('autostart');
const AUTOPILOT = new URLSearchParams(location.search).has('autopilot');
let autopilotOn = AUTOPILOT;            // 可用 P 键随时开关

const canvas = document.getElementById('c');
const $ = (id) => document.getElementById(id);

// 页面上直接显示 JS 报错,便于无头验证时看到问题
window.addEventListener('error', (e) => {
  const d = document.createElement('div');
  d.className = 'err';
  d.textContent = 'JS 错误: ' + (e.message || 'unknown');
  document.body.appendChild(d);
});

// ── 渲染器 / 场景 / 灯光 ────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 55, 230);

const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.1, 700);
camera.position.set(0, 2.4, 10);

scene.add(new THREE.HemisphereLight(0x93b9ff, 0x14243d, 1.7));
const key = new THREE.DirectionalLight(0xffffff, 3.2);
key.position.set(5, 14, 6);
scene.add(key);

// 地面
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1600, 1600),
  new THREE.MeshStandardMaterial({ color: 0x0a1124, roughness: 1, metalness: 0 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = GROUND_Y;
scene.add(ground);

// 网格:向前滚动 = 速度感
const CELL = 12;
const grid = new THREE.GridHelper(1600, 1600 / CELL, 0x4d8fe0, 0x1d3f74);
grid.position.y = GROUND_Y + 0.05;
grid.material.transparent = true;
grid.material.opacity = 0.95;
grid.material.fog = false;
scene.add(grid);

// 星星(不吃雾)
{
  const N = 700, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3]     = (Math.random() - 0.5) * 700;
    pos[i * 3 + 1] = 12 + Math.random() * 220;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 700;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0x9fc0ff, size: 1.6, sizeAttenuation: true,
    fog: false, transparent: true, opacity: 0.85,
  })));
}

// 两侧柱子:纯参照物,飞过头就回收
const dummy = new THREE.Object3D();
const pillar = new THREE.InstancedMesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x27446e, roughness: 0.8, metalness: 0.1,
    emissive: 0x0a1e38, emissiveIntensity: 1 }),
  PILLARS
);
pillar.frustumCulled = false;   // 实例会移动,默认的包围盒会误剔除
scene.add(pillar);

const pStates = [];
function parkPillar(i, fresh) {
  const side = i % 2 === 0 ? -1 : 1;
  const s = pStates[i] || (pStates[i] = {});
  s.h = 18 + Math.random() * 74;
  s.w = 2 + Math.random() * 6;
  s.x = side * (LIMIT_X + 5 + Math.random() * 52);
  s.z = fresh ? -Math.random() * SPAN : RECYCLE_AT - SPAN - Math.random() * 40;
}
for (let i = 0; i < PILLARS; i++) parkPillar(i, true);

// ── 飞机 ────────────────────────────────────────────────────
const ship = new THREE.Group();
const hull = new THREE.Mesh(
  new THREE.ConeGeometry(0.38, 1.9, 14),
  new THREE.MeshStandardMaterial({ color: 0xdff0ff, roughness: 0.5, metalness: 0.15,
    emissive: 0x1a4a72, emissiveIntensity: 1.15 })
);
hull.rotation.x = -Math.PI / 2;          // 圆锥默认朝 +Y,转完机头指向 -Z
const wing = new THREE.Mesh(
  new THREE.BoxGeometry(2.5, 0.08, 0.72),
  new THREE.MeshStandardMaterial({ color: 0x8fc4f0, roughness: 0.55, metalness: 0.15,
    emissive: 0x123a5c, emissiveIntensity: 0.9 })
);
wing.position.set(0, -0.04, 0.42);
const glow = new THREE.Mesh(
  new THREE.SphereGeometry(0.24, 14, 12),
  new THREE.MeshBasicMaterial({ color: 0x74e4ff, toneMapped: false })
);
glow.position.set(0, 0, 1.05);
const tailLight = new THREE.PointLight(0x5fd0ff, 22, 30, 2);
tailLight.position.set(0, 0, 1.3);
ship.add(hull, wing, glow, tailLight);
scene.add(ship);

// ── 环 ──────────────────────────────────────────────────────
const ringGeo = new THREE.TorusGeometry(1, 0.13, 10, 56);   // 单位半径,靠 scale 定实际大小
const discGeo = new THREE.CircleGeometry(1, 40);
const rings = [];

function makeRing() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x2f7fbf, roughness: 0.35, metalness: 0.5,
    emissive: 0x2fd0ff, emissiveIntensity: 1.6 });
  const torus = new THREE.Mesh(ringGeo, mat);
  const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({
    color: 0x1c8fd0, transparent: true, opacity: 0.10,
    side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
  }));
  const g = new THREE.Group();
  g.add(torus, disc);
  scene.add(g);
  const r = { g, torus, disc, mat, x: 0, y: 0, rad: 4, hit: false, done: false };
  rings.push(r);
  return r;
}

let lastX = 0, lastY = 0;
function farthestZ() {                     // 当前最靠前(最负)的环
  let m = 0;
  for (const q of rings) m = Math.min(m, q.g.position.z);
  return m;
}
function nearestRing() {                   // 还没穿过、离玩家最近的那个
  let m = -Infinity, res = null;
  for (const q of rings) if (q.g.position.z < 0 && q.g.position.z > m) { m = q.g.position.z; res = q; }
  return res;
}
function placeRing(r) {
  // 难度:分数越高环越小;环与环之间的位移有上限,保证够得到
  const diff = Math.min(1, score / 55);
  r.rad = THREE.MathUtils.lerp(5.2, 3.2, diff) + (Math.random() - 0.5) * 0.7;
  r.x = THREE.MathUtils.clamp(lastX + (Math.random() - 0.5) * 15, -LIMIT_X, LIMIT_X);
  r.y = THREE.MathUtils.clamp(lastY + (Math.random() - 0.5) * 9, LIMIT_Y_LO + 2, LIMIT_Y_HI - 1.5);
  lastX = r.x; lastY = r.y;
  r.g.position.set(r.x, r.y, farthestZ() - RING_GAP - Math.random() * 22);
  r.g.scale.setScalar(r.rad);
  r.hit = false; r.done = false;
  r.mat.color.setHex(0x2f7fbf);
  r.mat.emissive.setHex(0x2fd0ff);
  r.disc.material.opacity = 0.10;
}

// ── 火花 ────────────────────────────────────────────────────
const sparks = [];
{
  const geo = new THREE.IcosahedronGeometry(0.17, 0);
  for (let i = 0; i < 34; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0xa8ecff, transparent: true, toneMapped: false,
    }));
    m.visible = false;
    scene.add(m);
    sparks.push({ m, vel: new THREE.Vector3(), life: 0 });
  }
}
let sparkCursor = 0;
function burst(x, y, z, color, n) {
  for (let i = 0; i < n; i++) {
    const s = sparks[sparkCursor = (sparkCursor + 1) % sparks.length];
    s.m.visible = true;
    s.m.position.set(x, y, z);
    s.m.scale.setScalar(1);
    s.m.material.color.setHex(color);
    const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.5) * 2;
    s.vel.set(Math.cos(a) * 9, Math.sin(a) * 9 + e * 6, e * 8 - 4);
    s.life = 0.55;
  }
}

// ── 声音(纯振荡器,无外部文件)─────────────────────────────
let actx = null, muted = false;
function tone(freq, dur, type, vol, slide) {
  if (muted) return;
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const t = actx.currentTime;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol || 0.05, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination);
    o.start(t); o.stop(t + dur + 0.03);
  } catch (e) { muted = true; }
}

// ── 游戏状态 ────────────────────────────────────────────────
let state = 'ready';        // ready | play | over
let score = 0, combo = 0, lives = LIVES, spd = START_SPD, elapsed = 0;
let px = 0, py = 0, vx = 0, vy = 0, boosting = false, shake = 0, flash = 0;
let best = 0;
try { best = parseInt(localStorage.getItem('ringflight_best') || '0', 10) || 0; } catch (e) {}

const keys = new Set();
let clock = 0;
const ptr = { x: 0, y: 0, t: -99 };

function start() {
  score = 0; combo = 0; lives = LIVES; spd = START_SPD; elapsed = 0;
  px = 0; py = 0; vx = 0; vy = 0; shake = 0; flash = 0;
  lastX = 0; lastY = 0;
  for (const r of rings) scene.remove(r.g);
  rings.length = 0;
  while (farthestZ() > SPAWN_AHEAD) placeRing(makeRing());
  for (let i = 0; i < PILLARS; i++) parkPillar(i, true);
  ship.position.set(0, 0, 0);
  state = 'play';
  $('veil').hidden = true;
  tone(520, 0.1, 'triangle', 0.05, 1.6);
}

function gameOver() {
  state = 'over';
  if (score > best) {
    best = score;
    try { localStorage.setItem('ringflight_best', String(best)); } catch (e) {}
  }
  $('v-title').textContent = '结束';
  $('v-num').textContent = score;
  $('best').textContent = best;
  $('go').textContent = '再来一次';
  $('veil').hidden = false;
  tone(300, 0.5, 'sawtooth', 0.07, 0.28);
}

function onPass(r) {
  const d = Math.hypot(px - r.x, py - r.y);
  if (d < r.rad - 0.45) {
    combo++;
    const pts = (boosting ? 2 : 1) * (1 + Math.floor(Math.min(combo, 20) / 5));
    score += pts;
    r.hit = true;
    r.mat.color.setHex(0x6ff0b0);
    r.mat.emissive.setHex(0x6ff0b0);
    burst(r.x, r.y, 0, 0xa8ecff, 11);
    tone(700 + Math.min(combo, 12) * 42, 0.12, 'triangle', 0.05, 1.5);
  } else {
    combo = 0;
    lives--;
    shake = 1;
    flash = 1;
    tone(190, 0.3, 'sawtooth', 0.06, 0.5);
    if (lives <= 0) gameOver();
  }
}

// ── 输入 ────────────────────────────────────────────────────
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
  keys.add(k);
  if (k === 'p') { autopilotOn = !autopilotOn; return; }
  if (k === 'r') { start(); return; }
  if (state !== 'play' && (k === ' ' || k === 'Enter')) start();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

canvas.addEventListener('pointermove', (e) => {
  ptr.x = (e.clientX / innerWidth) * 2 - 1;
  ptr.y = -((e.clientY / innerHeight) * 2 - 1);
  ptr.t = clock;
});
canvas.addEventListener('pointerdown', () => { if (state !== 'play') start(); });
$('go').addEventListener('click', () => start());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ── 主循环 ──────────────────────────────────────────────────
const clamp = THREE.MathUtils.clamp;
let last = performance.now(), fovShown = 74;

function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));   // 夹住负 dt(rAF 时间戳可能早于 last)
  last = now;
  clock += dt;

  if (state === 'play') {
    elapsed += dt;
    spd = Math.min(MAX_SPD, START_SPD + elapsed * RAMP);
    boosting = keys.has('shift');
    const eff = spd * (boosting ? BOOST_MUL : 1);

    // 转向:按键优先,否则用鼠标(最近 1.4 秒内动过才算)
    const kx = (keys.has('arrowright') || keys.has('d') ? 1 : 0) - (keys.has('arrowleft') || keys.has('a') ? 1 : 0);
    const ky = (keys.has('arrowup') || keys.has('w') ? 1 : 0) - (keys.has('arrowdown') || keys.has('s') ? 1 : 0);
    let ax, ay;
    if (kx || ky) {
      ax = kx * 64 - vx * 3.6;
      ay = ky * 64 - vy * 3.6;
    } else if (clock - ptr.t < 1.4) {
      const ty = LIMIT_Y_LO + (ptr.y + 1) * 0.5 * (LIMIT_Y_HI - LIMIT_Y_LO);
      ax = (ptr.x * LIMIT_X - px) * 30 - vx * 7.6;
      ay = (ty - py) * 30 - vy * 7.6;
    } else {
      ax = -vx * 2.2; ay = -vy * 2.2;
    }
    if (autopilotOn) {                     // 自动飞向下一个环(演示 + 自检用)
      const t = nearestRing();
      if (t) { ax = (t.x - px) * 34 - vx * 7.6; ay = (t.y - py) * 34 - vy * 7.6; }
    }
    vx += ax * dt; vy += ay * dt;
    px = clamp(px + vx * dt, -LIMIT_X, LIMIT_X);
    py = clamp(py + vy * dt, LIMIT_Y_LO, LIMIT_Y_HI);
    if (px === -LIMIT_X || px === LIMIT_X) vx *= 0.2;
    if (py === LIMIT_Y_LO || py === LIMIT_Y_HI) vy *= 0.2;

    ship.position.set(px, py, 0);
    ship.rotation.z = clamp(-vx * 0.035, -0.9, 0.9);     // 横移时侧倾
    ship.rotation.x = clamp(vy * 0.022, -0.5, 0.5);
    glow.scale.setScalar(boosting ? 1.9 : 1);
    tailLight.intensity = boosting ? 60 : 22;

    // 环:向前推进 + 判定
    for (const r of rings) {
      const prev = r.g.position.z;
      r.g.position.z += eff * dt;
      r.torus.rotation.z += dt * 0.4;
      if (!r.done && prev < 0 && r.g.position.z >= 0) { r.done = true; onPass(r); }
      if (r.g.position.z > RECYCLE_AT) placeRing(r);
    }

    // 参照物
    grid.position.z = (grid.position.z + eff * dt) % CELL;
    for (let i = 0; i < PILLARS; i++) {
      const s = pStates[i];
      s.z += eff * dt;
      if (s.z > RECYCLE_AT) parkPillar(i, false);
      dummy.position.set(s.x, GROUND_Y + s.h / 2, s.z);
      dummy.scale.set(s.w, s.h, s.w);
      dummy.updateMatrix();
      pillar.setMatrixAt(i, dummy.matrix);
    }
    pillar.instanceMatrix.needsUpdate = true;
  }

  // 火花
  for (const s of sparks) {
    if (s.life <= 0) continue;
    s.life -= dt;
    if (s.life <= 0) { s.m.visible = false; continue; }
    s.m.position.addScaledVector(s.vel, dt);
    s.vel.multiplyScalar(1 - 2.4 * dt);
    s.vel.y -= 9 * dt;
    const k = s.life / 0.55;
    s.m.material.opacity = k;
    s.m.scale.setScalar(0.3 + k * 0.9);
  }

  // 相机:跟随 + 衰减抖动 + 速度/推进带来的视野拉伸
  const lag = 1 - Math.exp(-7 * dt);
  camera.position.x += (px * 0.6 - camera.position.x) * lag;
  camera.position.y += (2.4 + py * 0.5 - camera.position.y) * lag;
  camera.position.z = 10 + spd / 40;
  if (shake > 0) {
    shake = Math.max(0, shake - dt * 2.6);
    const a = shake * shake * 0.7;
    camera.position.x += (Math.random() - 0.5) * a;
    camera.position.y += (Math.random() - 0.5) * a;
  }
  if (state === 'play') camera.lookAt(px * 0.85, py * 0.8, -34);

  const fov = 74 + (spd - START_SPD) / (MAX_SPD - START_SPD) * 5 + (boosting ? 5 : 0);
  if (Math.abs(fov - fovShown) > 0.15) {
    fovShown = fov;
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  renderer.render(scene, camera);

  // HUD
  $('score').textContent = score;
  $('boost').textContent = boosting ? '×2' : '—';
  $('boost').style.color = boosting ? '#5fd0ff' : '';
  $('lives').textContent = '●'.repeat(Math.max(0, lives)) + '○'.repeat(Math.max(0, LIVES - lives));
  const c = $('combo');
  if (combo >= 2 && state === 'play') {
    c.textContent = 'COMBO ×' + (1 + Math.floor(Math.min(combo, 20) / 5));
    c.style.opacity = '1';
  } else c.style.opacity = '0';
  if (flash > 0) {
    flash = Math.max(0, flash - dt * 3.2);
    canvas.style.filter = 'saturate(' + (1 + flash * 1.6) + ') hue-rotate(' + (-flash * 40) + 'deg)';
  }

  requestAnimationFrame(frame);
}

window.__rf = {                            // 调试快照,调手感时用
  get state() { return state; }, get score() { return score; }, get lives() { return lives; },
  get combo() { return combo; }, get px() { return +px.toFixed(2); }, get py() { return +py.toFixed(2); },
  get speed() { return +spd.toFixed(1); }, get ringCount() { return rings.length; },
  get autopilot() { return autopilotOn; },
  get next() { const r = nearestRing();
    return r && { z: +r.g.position.z.toFixed(1), x: +r.x.toFixed(1), y: +r.y.toFixed(1), rad: +r.rad.toFixed(2) }; },
};
$('best').textContent = best;
if (AUTOSTART) start();          // 无头验证用:?autostart&autopilot
requestAnimationFrame(frame);
