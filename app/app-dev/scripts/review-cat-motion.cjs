// 실행 중인 Expo 웹 또는 export 서버에서 실제 캐릭터 렌더링을 검증한다.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const origin = process.env.MOTION_REVIEW_URL || 'http://127.0.0.1:18813';
const output = path.resolve('.docs/cat-motion');
const colors = ['black', 'ginger', 'cream', 'gray', 'white', 'calico'];
const motions = [
  'walking',
  'blink',
  'tilt',
  'yawn',
  'stretch',
  'groom',
  'focus',
  'cast',
  'reading',
  'reel',
];

async function signature(page) {
  return page.locator('[data-testid="motion-card-ginger"]').evaluate((card) =>
    [...card.querySelectorAll('img, div')].map((el) => ({
      id: el.getAttribute('data-testid'),
      src: el.getAttribute('src'),
      style: el.getAttribute('style'),
    })),
  );
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  const report = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/?motion=1`);
    await page.getByTestId('motion-card-ginger').waitFor();
    for (const color of colors)
      assert.equal(await page.getByTestId(`motion-card-${color}`).count(), 1);

    for (const motion of motions) {
      await page.getByTestId(`motion-${motion}`).click();
      const samples = new Set();
      for (let i = 0; i < (motion === 'blink' ? 26 : 10); i++) {
        samples.add(JSON.stringify(await signature(page)));
        await page.waitForTimeout(170);
      }
      assert.ok(samples.size > 1, `${motion}: 프레임 또는 변형이 변하지 않음`);
      const broken = await page
        .locator('[data-testid^="motion-card-"] img')
        .evaluateAll((images) =>
          images
            .filter((image) => !image.complete || !image.naturalWidth)
            .map((image) => image.src),
        );
      assert.deepEqual(broken, [], `${motion}: 로딩되지 않은 이미지`);
      report.push({ motion, renderedStates: samples.size, broken });
      if (['walking', 'yawn', 'stretch', 'groom', 'reading', 'cast'].includes(motion)) {
        if (['yawn', 'stretch', 'groom'].includes(motion)) {
          await page.getByTestId('motion-cat-ginger-frame-2').waitFor();
        }
        await page.screenshot({ path: path.join(output, `${motion}.png`), fullPage: true });
      }
    }

    await page.getByTestId('motion-reduce').click();
    await page.waitForTimeout(200);
    const still = JSON.stringify(await signature(page));
    await page.waitForTimeout(1000);
    assert.equal(JSON.stringify(await signature(page)), still, '모션 줄이기 중 프레임 변경');
    await page.getByTestId('motion-left').click();
    assert.notEqual(JSON.stringify(await signature(page)), still, '좌우 반전이 적용되지 않음');
    // 시트 전체가 아니라 잘라낸 한 프레임이 반전되는지 확인한다.
    for (const motion of ['reading', 'yawn', 'stretch', 'groom']) {
      await page.getByTestId(`motion-${motion}`).click();
      const frame = page.getByTestId('motion-cat-ginger-frame-0');
      const before = await frame.getAttribute('style');
      await page.getByTestId('motion-left').click();
      assert.equal(
        await frame.getAttribute('style'),
        before,
        `${motion}: 반전으로 시트 오프셋이 변경됨`,
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });

    await page.goto(`${origin}/?review=1`);
    await page.waitForFunction(() => window.__gromoReview);
    for (const route of ['home', 'focus']) {
      await page.evaluate((nextRoute) => {
        const state = window.__gromoReview.fixture(true);
        state.focusSpot = { x: 34.1, y: 55.9 };
        if (nextRoute === 'focus')
          state.session = {
            id: 'motion-review',
            islandId: state.islandId,
            subject: '모션 확인',
            startedAt: Date.now(),
            seconds: 0,
            status: 'active',
          };
        window.__gromoReview.open(nextRoute, { state });
      }, route);
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(output, `${route}.png`), fullPage: true });
    }
    assert.deepEqual(errors, [], '브라우저 런타임 오류');
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ report, errors }, null, 2));
    console.log(JSON.stringify({ report, errors, screenshots: output }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
