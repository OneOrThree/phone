const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const reviewUrl = process.env.GROMO_REVIEW_URL ?? 'http://127.0.0.1:18762/?review=1';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const report = [];

  for (const [orientation, width, height] of [
    ['portrait', 402, 874],
    ['landscape', 874, 402],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400 && !response.url().endsWith('/favicon.ico'))
        errors.push(`${response.url()}: ${response.status()}`);
    });

    await page.goto(reviewUrl);
    await page.waitForFunction(() => window.__gromoReview);
    const fixture = await page.evaluate(() => window.__gromoReview.fixture(true));
    const remaining = structuredClone(fixture);
    const nextIsland = remaining.islands.find((island) => island.id !== remaining.islandId);
    nextIsland.joined = true;
    remaining.session = {
      id: 'kicked-session',
      islandId: remaining.islandId,
      subject: '수학',
      startedAt: Date.now(),
      seconds: 0,
      status: 'active',
    };
    await page.evaluate((state) => window.__gromoReview.open('focus', { state }), remaining);
    await page.waitForFunction(
      (id) =>
        window.__gromoReview.route === 'focus' && window.__gromoReview.state.session?.id === id,
      remaining.session.id,
    );
    await page.evaluate(
      (id) => window.__gromoReview.dispatch({ type: 'KICKED_FROM_ISLAND', id }),
      remaining.islandId,
    );
    await page.waitForFunction(() => window.__gromoReview.route === 'home');
    await page.evaluate(() => window.__gromoReview.back());
    assert.equal(await page.evaluate(() => window.__gromoReview.route), 'home');
    assert.equal(await page.evaluate(() => window.__gromoReview.state.islandId), nextIsland.id);
    assert.equal(await page.evaluate(() => window.__gromoReview.state.session), null);

    const viewing = structuredClone(fixture);
    const viewingNext = viewing.islands.find((island) => island.id !== viewing.islandId);
    const viewedIsland = viewing.islands.find(
      (island) => island.id !== viewing.islandId && island.id !== viewingNext.id,
    );
    viewingNext.joined = true;
    await page.evaluate((state) => window.__gromoReview.open('home', { state }), viewing);
    await page.waitForFunction(
      (id) =>
        window.__gromoReview.route === 'home' &&
        window.__gromoReview.state.islands.find((island) => island.id === id)?.joined,
      viewingNext.id,
    );
    await page.evaluate(
      (id) => window.__gromoReview.dispatch({ type: 'VISIT', id }),
      viewedIsland.id,
    );
    await page.waitForFunction(
      (id) => window.__gromoReview.state.visitingIslandId === id,
      viewedIsland.id,
    );
    await page.evaluate(() => window.__gromoReview.open('visit'));
    await page.waitForFunction(() => window.__gromoReview.route === 'visit');
    await page.evaluate(
      (id) => window.__gromoReview.dispatch({ type: 'KICKED_FROM_ISLAND', id }),
      viewing.islandId,
    );
    await page.waitForFunction(
      (id) =>
        window.__gromoReview.route === 'home' &&
        window.__gromoReview.state.islandId === id &&
        window.__gromoReview.state.visitingIslandId === null,
      viewingNext.id,
    );

    const walking = structuredClone(fixture);
    const walkingNext = walking.islands.find((island) => island.id !== walking.islandId);
    walkingNext.joined = true;
    await page.evaluate((state) => window.__gromoReview.open('home', { state }), walking);
    await page.waitForFunction(
      (id) =>
        window.__gromoReview.route === 'home' &&
        window.__gromoReview.state.islands.find((island) => island.id === id)?.joined,
      walkingNext.id,
    );
    await page.evaluate(() => window.__gromoReview.walk('hall'));
    await page.waitForFunction(() => window.__gromoReview.walkRequest === 'hall');
    await page.evaluate(
      (id) => window.__gromoReview.dispatch({ type: 'KICKED_FROM_ISLAND', id }),
      walking.islandId,
    );
    await page.waitForFunction(
      () => window.__gromoReview.route === 'home' && window.__gromoReview.walkRequest === null,
    );

    fixture.islands.forEach((island) => (island.joined = island.id === fixture.islandId));
    fixture.islands.find((island) => island.id === fixture.islandId).members[0].role = 'host';
    await page.evaluate((state) => window.__gromoReview.open('manage', { state }), fixture);
    await page.waitForFunction(() => window.__gromoReview.route === 'manage');
    await page.getByTestId('hall-leave').click();
    assert.ok(await page.getByRole('button', { name: '탈퇴하기', exact: true }).count());
    await page.evaluate(
      (id) => window.__gromoReview.dispatch({ type: 'KICKED_FROM_ISLAND', id }),
      fixture.islandId,
    );

    await page.waitForFunction(() => window.__gromoReview.route === 'chooseIsland');
    await page.evaluate(() => window.__gromoReview.back());
    assert.equal(await page.evaluate(() => window.__gromoReview.route), 'chooseIsland');
    assert.equal(await page.evaluate(() => window.__gromoReview.state.onboarded), false);
    assert.equal(await page.getByRole('button', { name: '탈퇴하기', exact: true }).count(), 0);
    assert.ok(
      await page.getByRole('button', { name: '혼자 시작할 섬 만들기', exact: true }).count(),
    );
    assert.ok(await page.getByRole('button', { name: '기존 섬 참여', exact: true }).count());
    assert.deepEqual(errors, []);
    report.push({ orientation, pass: true });
    await page.close();
  }

  await browser.close();
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
