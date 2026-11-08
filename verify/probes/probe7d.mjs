// 主角造型验收:步行机位怼着人拍(背后/正面/侧面),看宽肩+平头+皮带+工装
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
// 把主角站到空旷处(马路上),相机绕着他转三个方位
for (const [name, a] of [['back', 0], ['front', Math.PI], ['side', Math.PI / 2]]) {
  await page.evaluate((ang) => {
    const G = window.__gta;
    const q = G.nearestPed();
    G.standAt(q ? q.x : 0, q ? q.z : 0, ang);           // 人朝 ang;相机在其背后 3.6 米
    if (!window.__patched) {
      const orig = G.renderer.render.bind(G.renderer);
      G.renderer.render = (scene, cam) => { if (window.__manCam) window.__manCam(cam); return orig(scene, cam); };
      window.__patched = true;
    }
    window.__manCam = (cam) => {
      const px = G.x, pz = G.z, yaw = ang;              // standAt 之后 G.x/G.z 就是人的位置
      // 相机站人背后 4.6 米、2.4 米高(车/行人从旁边过也不会挡),fov 26:
      // 人占画面大半,皮带扣、肩线、寸头层次都数得出来
      cam.position.set(px - Math.sin(yaw) * 4.6, 2.4, pz - Math.cos(yaw) * 4.6);
      cam.lookAt(px, 1.1, pz);
      cam.fov = 26; cam.updateProjectionMatrix();
    };
  }, a);
  await sleep(1400);
  await page.screenshot({ path: import.meta.dirname + `/../shots/p7d-${name}.png` });
  await page.evaluate(() => { window.__manCam = null; window.__gta.fov = 56; });
}
await browser.close();
