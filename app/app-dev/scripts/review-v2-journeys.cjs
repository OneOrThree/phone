const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const outputDir = path.resolve('.docs/v2-review');
fs.mkdirSync(outputDir, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const report = [];
  for (const [orientation, width, height] of [
    ['portrait', 402, 874],
    ['landscape', 874, 402],
  ]) {
    const p = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('response', (r) => {
      if (r.status() >= 400 && !r.url().endsWith('/favicon.ico'))
        errors.push(r.url() + ': ' + r.status());
    });
    await p.goto('http://127.0.0.1:18762/?review=1');
    await p.waitForFunction(() => window.__gromoReview);
    const open = async (route, opts = {}) => {
      await p.evaluate(({ route, opts }) => window.__gromoReview.open(route, opts), {
        route,
        opts,
      });
      await p.waitForTimeout(200);
    };
    const fixture = await p.evaluate(() => window.__gromoReview.fixture(true));
    const state = () => p.evaluate(() => window.__gromoReview.state);
    const route = () => p.evaluate(() => window.__gromoReview.route);
    await open('visit', { state: fixture, detail: 'cloud' });
    await p.getByRole('button', { name: '가입신청', exact: true }).click();
    await p.waitForFunction(() => window.__gromoReview.state.pendingIsland === 'cloud');
    assert.equal((await state()).islandId, fixture.islandId);
    await p.getByRole('button', { name: '가입신청 취소', exact: true }).click();
    await p.waitForFunction(() => window.__gromoReview.state.pendingIsland === null);
    const joined = JSON.parse(JSON.stringify(fixture));
    joined.islands.find((j) => j.id === 'cloud').joined = true;
    await open('visit', { state: joined, detail: 'cloud' });
    await p.getByRole('button', { name: '배 타고 이동', exact: true }).click();
    await p.waitForFunction(
      () =>
        window.__gromoReview.route === 'home' && window.__gromoReview.state.islandId === 'cloud',
    );
    report.push({
      orientation,
      flow: 'request island → cancel → travel to joined island',
      pass: true,
    });
    await open('home', { state: fixture });
    await p.getByRole('button', { name: '집중하기', exact: true }).click();
    await p.waitForFunction(() => window.__gromoReview.route === 'focusTravel');
    assert.equal((await state()).session, null);
    await p.waitForFunction(() => window.__gromoReview.route === 'fishingArrival');
    assert.equal((await state()).session, null);
    let img = await p.locator('img[src*="fishing-island"]').first().boundingBox();
    assert.ok(img);
    // 낚시섬 지도 좌표는 가로·세로 % (시안 예시 내 자리 34.1, 55.9)
    await p.mouse.click(img.x + 0.341 * img.width, img.y + 0.559 * img.height);
    await p.waitForFunction(() => window.__gromoReview.route === 'focusSetup');
    assert.equal((await state()).session, null);
    await p.getByPlaceholder('예: 영어 단어 외우기').fill('영어 단어 외우기');
    await p.getByRole('button', { name: '집중 시작', exact: true }).click();
    await p.waitForFunction(() => window.__gromoReview.state.session?.status === 'active');
    const spot = (await state()).focusSpot;
    await p.getByRole('button', { name: '이모티콘', exact: true }).click();
    await p.getByRole('button', { name: '하트뿅뿅', exact: true }).click();
    assert.equal(await route(), 'focus');
    await p.waitForTimeout(2100);
    await p.getByRole('button', { name: '휴식하기', exact: true }).click();
    await p.waitForFunction(() => window.__gromoReview.state.session?.status === 'paused');
    const seconds = (await state()).session.seconds;
    await p.waitForTimeout(1100);
    assert.equal((await state()).session.seconds, seconds);
    await p.getByRole('button', { name: '집중 이어가기', exact: true }).click();
    await p.waitForFunction(() => window.__gromoReview.route === 'focus');
    assert.deepEqual((await state()).focusSpot, spot);
    await p.getByRole('button', { name: '휴식하기', exact: true }).click();
    await p.getByRole('button', { name: '휴식 종료하기', exact: true }).click();
    // 휴식 종료는 확인창을 한 번 띄운다
    await p.getByRole('button', { name: '집중 종료', exact: true }).click();
    await p.waitForFunction(() => window.__gromoReview.route === 'focusResult');
    assert.equal((await state()).session, null);
    assert.equal((await state()).resultFromRest, true);
    await p.getByRole('button', { name: '섬으로 돌아가기', exact: true }).click();
    assert.equal(await route(), 'home');
    report.push({
      orientation,
      flow: 'focus → rest → resume same spot → result → home',
      pass: true,
    });
    await open('friends', { state: fixture });
    await p.getByRole('button', { name: '수락', exact: true }).click();
    assert.equal((await state()).friends.find((f) => f.id === 'haneul').status, 'friend');
    await open('friendMail', { detail: 'haneul' });
    await p.getByPlaceholder('편지 보내기').fill('구름 섬에서도 같이 힘내!');
    await p.getByRole('button', { name: '보내기', exact: true }).click();
    let s = await state();
    assert.equal(
      s.friends.find((f) => f.id === 'haneul').messages.at(-1).text,
      '구름 섬에서도 같이 힘내!',
    );
    assert.equal(s.islands[0].messages.length, 2);
    report.push({
      orientation,
      flow: 'accept friend → cross-island private letter',
      pass: true,
    });
    const building = structuredClone(fixture);
    building.islands[0].buildings = ['hall', 'board', 'gram'];
    const libraryCost = 2720;
    const rainPrice = 150;
    building.islands[0].fish = libraryCost + 20;
    await open('construction', { state: building });
    await p.getByRole('button', { name: '도서관', exact: true }).click();
    await p.getByRole('button', { name: '이 건물을 다음 목표로', exact: true }).click();
    s = await state();
    assert.equal(s.islands[0].fish, libraryCost + 20);
    assert.equal(s.islands[0].buildingQuest.targets.length, 4);
    const ready = structuredClone(s);
    const island = ready.islands[0];
    const share = Math.ceil(libraryCost / island.buildingQuest.targets.length);
    for (const id of island.buildingQuest.targets)
      island.earned[id] = (island.buildingQuest.base[id] ?? 0) + share;
    await open('quest', { state: ready, detail: 'building' });
    assert.ok(await p.getByRole('button', { name: '건설하기', exact: true }).isEnabled());
    await open('product', { detail: 'rain' });
    await p.getByRole('button', { name: `섬 물고기 ${rainPrice}마리로 구매`, exact: true }).click();
    await p.getByRole('button', { name: '확인', exact: true }).click();
    assert.equal((await state()).islands[0].fish, libraryCost + 20 - rainPrice);
    await open('quest', { detail: 'building' });
    assert.ok(await p.getByRole('button', { name: '건설하기', exact: true }).isDisabled());
    await p.evaluate(
      (fish) => window.__gromoReview.dispatch({ type: 'DEMO_CREDIT', fish }),
      rainPrice - 20,
    );
    await p.getByRole('button', { name: '건설하기', exact: true }).click();
    await p.getByRole('button', { name: '확인', exact: true }).click();
    s = await state();
    assert.equal(s.islands[0].fish, 0);
    assert.equal(s.islands[0].construction.building, 'library');
    assert.ok(!s.islands[0].buildings.includes('library'));
    const ends = s.islands[0].construction.endsAt;
    await p.evaluate((now) => window.__gromoReview.dispatch({ type: 'TICK', now }), ends);
    await p.waitForFunction(() =>
      window.__gromoReview.state.islands[0].buildings.includes('library'),
    );
    assert.ok((await state()).islands[0].buildings.includes('library'));
    report.push({
      orientation,
      flow: 'select library → spend audio → lose completion → refill → construct → finish',
      pass: true,
    });
    await open('library', { state: fixture });
    await p.getByRole('button', { name: '내 일기장', exact: true }).click();
    await p.getByRole('button', { name: '월', exact: true }).click();
    await p.getByRole('button', { name: '→', exact: true }).click();
    assert.ok(await p.getByText('스크린타임', { exact: false }).count());
    await p.screenshot({
      path: path.join(outputDir, `${orientation}-diary-screen-interaction.png`),
    });
    report.push({
      orientation,
      flow: 'library → personal diary → month → screen time page',
      pass: true,
    });
    await open('library', { state: building });
    assert.ok(await p.getByText('아직 도서관이 없어요', { exact: true }).count());
    report.push({
      orientation,
      flow: 'library stays locked before construction',
      pass: true,
    });
    await open('focus', {
      state: {
        ...fixture,
        session: {
          id: 'gesture',
          islandId: 'soda',
          subject: '공부',
          startedAt: Date.now(),
          seconds: 0,
          status: 'active',
        },
        focusSpot: { x: 350, y: 830 },
      },
    });
    const before = await p.locator('img[src*="fishing-island"]').first().boundingBox();
    await p.mouse.move(width / 2, height / 2);
    await p.keyboard.down('Control');
    await p.mouse.wheel(0, -100);
    await p.keyboard.up('Control');
    await p.waitForTimeout(150);
    const after = await p.locator('img[src*="fishing-island"]').first().boundingBox();
    assert.ok(after.width > before.width);
    report.push({ orientation, flow: 'ctrl + wheel zoom', pass: true });
    assert.deepEqual(errors, []);
    await p.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(outputDir, 'journeys.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
