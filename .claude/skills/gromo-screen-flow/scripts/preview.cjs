// SVG 미리보기(캡처 그림을 끼워서): node preview.cjs <svg> <out.png> [scale] [clip x,y,w,h]
const { chromium } = require(require('path').join(process.env.GROMO_APP || require('path').join(require('os').homedir(), 'soma/phone/app/app-dev'), 'node_modules/playwright'));
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./sections.cjs');
(async () => {
  const [file, out, scale = '0.2', clip] = process.argv.slice(2);
  let svg = fs.readFileSync(file, 'utf8');
  const m = svg.match(/width="([\d.]+)" height="([\d.]+)"/);
  const w = Math.ceil(+m[1]), h = Math.ceil(+m[2]), s = +scale;
  fs.mkdirSync(path.join(ROOT, 'preview'), { recursive: true });
  const html = path.join(ROOT, 'preview', '_tmp.html');
  fs.writeFileSync(html, `<html><body style="margin:0;background:#888"><div style="transform:scale(${s});transform-origin:0 0;width:${w}px;height:${h}px">${svg}</div></body></html>`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: Math.ceil(w * s), height: Math.ceil(h * s) } });
  await page.goto('file://' + html);
  await page.waitForTimeout(800);
  const opt = { path: out };
  if (clip) { const [x, y, cw, ch] = clip.split(',').map(Number); opt.clip = { x: x * s, y: y * s, width: cw * s, height: ch * s }; }
  await page.screenshot(opt);
  await browser.close();
})();
