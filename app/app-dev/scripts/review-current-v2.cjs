const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const reviewUrl = process.env.GROMO_REVIEW_URL || 'http://127.0.0.1:18762/?review=1';
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const report = [];
  const out = path.resolve('.docs/v2-review');
  fs.mkdirSync(out, { recursive: true });
  for (const [orientation, width, height] of [
    ['portrait', 402, 874],
    ['landscape', 874, 402],
  ]) {
    const p = await b.newPage({ viewport: { width, height } });
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await p.goto(reviewUrl);
    await p.waitForFunction(() => window.__gromoReview);
    for (const [route, detail, tab] of [
      ['home'],
      ['hall'],
      ['construction'],
      ['manage'],
      ['members'],
      ['ledger'],
      ['library'],
      ['diary'],
      ['boat'],
      ['mainIsland'],
      ['friends'],
      ['friendSearch'],
      ['mail'],
      ['chat'],
      ['friendMail', 'list'],
      ['friendMail', 'saebom'],
      ['board'],
      ['quest', 'q-focus'],
      ['questEdit'],
      ['notice', 'welcome'],
      ['noticeEdit'],
      ['tower'],
      ['explore'],
      ['visit', 'cloud'],
      ['visitIsland', 'cloud'],
      ['visitIslandFocus', 'cloud'],
      ['shop'],
      ['product', 'scarf'],
      ['product', 'rain'],
      ['orders'],
      ['wardrobe'],
      ['profile'],
      ['settings'],
      ['permission'],
      ['focusVisit'],
      ['fishingArrival'],
      ['focusSetup'],
      ['focus'],
      ['rest'],
      ['focusResult'],
    ]) {
      await p.evaluate(
        ({ route, detail, tab }) => {
          const s = window.__gromoReview.fixture(true);
          s.tutorial = { step: 99 };
          s.focusGuideDone = true;
          if (['boat', 'mainIsland'].includes(route)) {
            s.islands.find((island) => island.id === 'strawberry').joined = true;
            s.islands.find((island) => island.id === 'cloud').joined = true;
          }
          if (['focus', 'rest', 'focusResult'].includes(route))
            s.session = {
              id: 'review',
              islandId: s.islandId,
              subject: '수학 문제 풀기',
              startedAt: Date.now() - 1230000,
              seconds: 0,
              status: route === 'rest' ? 'paused' : 'active',
              restStartedAt: Date.now() - 130000,
            };
          s.focusSpot = { x: 34.1, y: 55.9 };
          window.__gromoReview.open(route, {
            state: s,
            detail,
            tab,
            body: route === 'questEdit' ? 'focus' : '',
            text: route === 'focusSetup' ? '수학 문제 풀기' : '',
          });
        },
        { route, detail, tab },
      );
      await p.waitForTimeout(280);
      const broken = await p.evaluate(() =>
        [...document.querySelectorAll('img')]
          .filter((i) => i.src && (!i.complete || !i.naturalWidth))
          .map((i) => i.src),
      );
      const signOverflows = await p.locator('img[src*="wooden-name-sign"]').evaluateAll(
        (images) =>
          images.filter((image) => {
            const imageBox = image.parentElement.getBoundingClientRect();
            const signBox = image.parentElement.parentElement.getBoundingClientRect();
            return imageBox.width > signBox.width + 1 || imageBox.height > signBox.height + 1;
          }).length,
      );
      if (signOverflows) errors.push(`${route}: 팻말 이미지 ${signOverflows}개가 영역을 넘음`);
      if (route === 'home' && (await p.evaluate(() => window.__gromoReview.route)) !== 'home')
        errors.push('홈 검수 화면이 다른 경로로 바뀜');
      await p.screenshot({
        path: path.join(out, `${orientation}-${route}${detail ? '-' + detail : ''}.png`),
      });
      report.push({ orientation, route, detail, broken, errors: [...errors] });
    }
    await p.close();
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        screens: report.length,
        broken: report.filter((r) => r.broken.length),
        errors: [...new Set(report.flatMap((r) => r.errors))],
      },
      null,
      2,
    ),
  );
  await b.close();
  if (report.some((r) => r.broken.length || r.errors.length)) process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
