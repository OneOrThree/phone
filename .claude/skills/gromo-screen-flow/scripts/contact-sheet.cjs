// 캡처 폴더를 한눈에 보는 모아보기 이미지로 만든다: node contact-sheet.cjs <폴더> [한 장당 개수]
const { chromium } = require(require('path').join(process.env.GROMO_APP || require('path').join(require('os').homedir(), 'soma/phone/app/app-dev'), 'node_modules/playwright'));
const fs = require('fs');
const path = require('path');
(async () => {
  const dir = path.resolve(process.argv[2]);
  const per = Number(process.argv[3] || 27);
  const files = fs.readdirSync(dir).filter((f) => /^\d.*\.png$/.test(f)).sort();
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1620, height: 800 } });
  for (let i = 0; i * per < files.length; i++) {
    const cells = files
      .slice(i * per, (i + 1) * per)
      .map(
        (f) =>
          `<figure><img src="${f}"><figcaption>${f.replace('.png', '')}</figcaption></figure>`,
      )
      .join('');
    // about:blank 에서는 file:// 이미지를 못 읽으므로 같은 폴더에 html 을 두고 연다
    const html = path.join(dir, '_sheet.html');
    fs.writeFileSync(
      html,
      `<style>body{margin:8px;display:grid;grid-template-columns:repeat(9,1fr);gap:8px;font:11px sans-serif;background:#eee}figure{margin:0}img{width:100%;display:block}</style>${cells}`,
    );
    await p.goto('file://' + html);
    await p.waitForLoadState('load');
    await p.screenshot({ path: path.join(dir, `_sheet-${i + 1}.png`), fullPage: true });
  }
  await b.close();
})();
