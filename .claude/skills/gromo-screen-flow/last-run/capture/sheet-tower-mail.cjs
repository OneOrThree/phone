// 큰 모아보기(4열) — 글자를 읽을 수 있는 크기로 확인하려고: node sheet-tower-mail.cjs <폴더>
const { chromium } = require(require('path').join(process.env.GROMO_APP || require('path').join(require('os').homedir(), 'soma/phone/app/app-dev'), 'node_modules/playwright'));
const fs = require('fs');
const path = require('path');
(async () => {
  const dir = path.resolve(process.argv[2]);
  const files = fs.readdirSync(dir).filter((f) => /^\d.*\.png$/.test(f)).sort();
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1560, height: 800 } });
  for (let i = 0; i * 8 < files.length; i++) {
    const cells = files.slice(i * 8, i * 8 + 8)
      .map((f) => `<figure><img src="${f}"><figcaption>${f.replace('.png', '')}</figcaption></figure>`).join('');
    const html = path.join(dir, '_big.html');
    fs.writeFileSync(html, `<style>body{margin:6px;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;font:13px sans-serif;background:#eee}figure{margin:0}img{width:100%;display:block}</style>${cells}`);
    await p.goto('file://' + html);
    await p.waitForLoadState('load');
    await p.screenshot({ path: path.join(dir, `_big-${i + 1}.png`), fullPage: true });
  }
  await b.close();
})();
