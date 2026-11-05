const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

// 로그인 전 웹 UI만 검사한다. 실제 계정·섬 생성과 집중 기록 검증은 별도로 한 번 수행한다.
const base = process.env.WEB_DEMO_TEST_URL || 'http://127.0.0.1:4179';
const reports = path.resolve(__dirname, '../build/web-demo-checks');
const endpoint = 'https://us.i.posthog.com/i/v0/e/';
fs.mkdirSync(reports, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      locale: 'ko-KR',
    });
    const errors = [];
    const events = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(endpoint, async (route) => {
      if (route.request().method() === 'POST') events.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' });
    });
    const viewports = [
      { width: 1920, height: 1080 },
      { width: 1280, height: 900 },
      { width: 1136, height: 650 },
      { width: 1024, height: 768 },
      { width: 700, height: 500 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
      { width: 844, height: 390 },
    ];
    const assertFits = async () => {
      // 창 크기 변경 뒤 RN onLayout과 CSS 배율이 같은 치수에 정착할 때까지 기다린다.
      await page.waitForFunction(() => {
        const canvas = document.querySelector('[data-testid="web-canvas"]');
        const box = document.querySelector('[data-testid="web-viewport"]');
        if (!canvas || !box) return false;
        const c = canvas.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        return (
          c.width > 0 &&
          Math.abs(c.width - b.width) < 1 &&
          Math.abs(c.height - b.height) < 1 &&
          b.left >= 0 &&
          b.top >= 0 &&
          b.right <= innerWidth + 1 &&
          b.bottom <= innerHeight + 1 &&
          canvas.clientWidth === (innerWidth < 700 ? 390 : 1280)
        );
      });
      for (const f of page.frames()) {
        const overflow = await f.evaluate(() => {
          const root = document.documentElement;
          const scrollable = [...document.querySelectorAll('*')].filter((el) => {
            const style = getComputedStyle(el);
            return (
              el.clientWidth &&
              ((el.scrollWidth > el.clientWidth + 1 &&
                ['auto', 'scroll'].includes(style.overflowX)) ||
                (el.scrollHeight > el.clientHeight + 1 &&
                  ['auto', 'scroll'].includes(style.overflowY)))
            );
          });
          return {
            document: root.scrollWidth > innerWidth || root.scrollHeight > innerHeight,
            containers: scrollable.length,
          };
        });
        assert.deepEqual(overflow, { document: false, containers: 0 }, f.url());
      }
    };
    await page.goto(base + '/?analytics_test=1&review=1&demo=1');
    await page.getByRole('button', { name: '웹에서 시작하기', exact: true }).waitFor();
    assert.equal(
      await page.getByRole('button', { name: '사용 분석 끄기', exact: true }).count(),
      0,
    );
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await assertFits();
      const start = await page
        .getByRole('button', { name: '웹에서 시작하기', exact: true })
        .boundingBox();
      assert.ok(
        start &&
          start.x >= 0 &&
          start.y >= 0 &&
          start.x + start.width <= viewport.width + 1 &&
          start.y + start.height <= viewport.height + 1,
      );
      await page.screenshot({
        path: path.join(reports, `landing-${viewport.width}x${viewport.height}.png`),
      });
    }
    await page.getByRole('button', { name: '웹에서 시작하기', exact: true }).click();
    const frame = page.frameLocator('iframe');
    await frame.getByRole('button', { name: '게스트로 시작하기', exact: true }).waitFor();
    assert.equal(
      await frame.getByRole('button', { name: '게스트로 시작하기', exact: true }).isDisabled(),
      true,
    );
    await page.locator('iframe').evaluate((el) => {
      el.contentWindow.__resizeMarker = true;
    });
    const dimensions = [];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await assertFits();
      const result = await page.locator('iframe').evaluate((el) => {
        const b = el.getBoundingClientRect();
        return {
          width: b.width,
          height: b.height,
          sameDocument: el.contentWindow.__resizeMarker,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      assert.equal(result.sameDocument, true);
      assert.equal(result.overflow, false);
      assert.ok(result.width <= 1280);
      dimensions.push({ viewport, ...result });
      await page.screenshot({
        path: path.join(reports, `web-${viewport.width}x${viewport.height}.png`),
      });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: '이용 안내와 앱 설치' }).click();
    await page.getByRole('button', { name: '개인정보·분석 설정' }).click();
    await page.getByRole('button', { name: '사용 분석 끄기', exact: true }).click();
    const before = events.length;
    await page.reload();
    await page.getByRole('button', { name: '이용 안내와 앱 설치' }).click();
    await page.getByRole('button', { name: '개인정보·분석 설정' }).click();
    await page.getByRole('button', { name: '사용 분석 켜기', exact: true }).waitFor();
    await page.getByRole('button', { name: '이용 안내 닫기' }).click();
    await page.getByRole('button', { name: '웹에서 시작하기', exact: true }).click();
    await page
      .frameLocator('iframe')
      .getByRole('button', { name: '게스트로 시작하기', exact: true })
      .waitFor();
    assert.equal(events.length, before);
    assert.deepEqual(errors, []);
    assert.ok(events.every((event) => event.properties.analytics_excluded === 1));
    fs.writeFileSync(
      path.join(reports, 'responsive-web.json'),
      JSON.stringify({ dimensions, errors, analyticsOptOut: true }, null, 2),
    );
    console.log('8개 화면 크기·소개/로그인 안팎 스크롤 없음·동일 iframe·분석 설정 유지 통과');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
