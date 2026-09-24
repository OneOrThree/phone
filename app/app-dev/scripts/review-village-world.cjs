// 개발 미리보기의 실제 화면·전환·시설 진입을 검사한다. Expo 웹 서버가 필요하다.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const url = process.env.GROMO_REVIEW_URL || 'http://127.0.0.1:18774/';
const all = ['hall', 'board', 'gram', 'library', 'mail', 'tower', 'shop'];
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const out = path.resolve('.docs/village-world-review');
  fs.mkdirSync(out, { recursive: true });
  const errors = [],
    results = [];
  try {
    for (const [orientation, width, height] of [
      ['portrait', 402, 874],
      ['landscape', 874, 402],
    ]) {
      const page = await browser.newPage({ viewport: { width, height } });
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(url + '?demo=1&review=1&village=layered');
      await page.waitForFunction(() => window.__gromoReview);
      const home = async (buildings) => {
        await page.evaluate((buildings) => {
          const s = window.__gromoReview.fixture(true);
          s.settings.reduceMotion = true;
          s.mailboxGuideSeenBy = ['local'];
          s.islands.find((i) => i.id === s.islandId).buildings = buildings;
          window.__gromoReview.open('home', { state: s });
        }, buildings);
        await page.getByTestId('village-preview-toggle').waitFor();
        await page.waitForFunction((buildings) => {
          const r = window.__gromoReview;
          return (
            r.route === 'home' &&
            JSON.stringify(r.state.islands.find((i) => i.id === r.state.islandId).buildings) ===
              JSON.stringify(buildings)
          );
        }, buildings);
        await page.waitForTimeout(100);
      };
      await home(all);
      assert.equal(await page.locator('[data-testid^="village-building-"]').count(), 7);
      assert.equal(await page.locator('[data-testid^="village-road-"]').count(), 8);
      await page.waitForTimeout(500);
      const broken = await page
        .locator('img')
        .evaluateAll((imgs) =>
          imgs.filter((i) => !i.complete || !i.naturalWidth).map((i) => i.src),
        );
      assert.deepEqual(broken, []);
      await page.screenshot({ path: path.join(out, orientation + '.png') });
      await page.getByTestId('village-preview-toggle').click();
      assert.equal(await page.locator('[data-testid^="village-building-"]').count(), 0);
      await page.getByTestId('village-preview-toggle').click();
      assert.equal(await page.locator('[data-testid^="village-building-"]').count(), 7);
      // 화면에 보이는 시설의 실제 탭 → 이동 → 화면 진입.
      if (orientation === 'portrait') {
        await page.getByRole('button', { name: '게시판', exact: true }).click();
        await page.waitForFunction(() => window.__gromoReview.route === 'board');
      }
      for (const route of ['hall', 'library', 'shop', 'tower', 'mail', 'sound', 'boat']) {
        await home(all);
        await page.evaluate((route) => window.__gromoReview.walk(route), route);
        await page.waitForFunction((route) => window.__gromoReview.route === route, route);
      }
      // 현재 앱은 QA 설정으로 내 섬 시설을 모두 완성한다. 건설 단계는 구경할 섬으로 검증한다.
      const visit = async (buildings) => {
        await page.evaluate((buildings) => {
          const s = window.__gromoReview.fixture(true);
          s.islands.find((i) => i.id === 'cloud').buildings = buildings;
          window.__gromoReview.open('visitIsland', { state: s, detail: 'cloud' });
        }, buildings);
        await page.waitForFunction(
          (n) =>
            window.__gromoReview.route === 'visitIsland' &&
            document.querySelectorAll('[data-testid^="village-building-"]').length === n,
          buildings.length,
        );
      };
      await visit(['hall']);
      assert.equal(await page.locator('[data-testid^="village-building-"]').count(), 1);
      assert.equal(await page.locator('[data-testid^="village-road-"]').count(), 2);
      assert.equal(await page.getByRole('button', { name: '상점', exact: true }).count(), 0);
      await visit([]);
      assert.equal(await page.locator('[data-testid^="village-building-"]').count(), 0);
      assert.equal(await page.locator('[data-testid^="village-road-"]').count(), 1);
      await page.goto(url + '?demo=1&review=1');
      await page.waitForFunction(() => window.__gromoReview);
      await home(all);
      assert.equal(await page.locator('[data-testid^="village-building-"]').count(), 0);
      results.push({
        orientation,
        facilities: 7,
        roads: 8,
        transitions: 2,
        routes: 7,
        buildingStates: 3,
        defaultOriginal: true,
      });
      await page.close();
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ results, errors }, null, 2));
    console.log(JSON.stringify({ results, errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
