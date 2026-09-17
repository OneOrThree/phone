const { chromium } = require('playwright'),
  fs = require('fs'),
  assert = require('assert'),
  path = require('path');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, '.docs'), { recursive: true });
const results = [],
  errors = [];
let b;
async function setup(p, route, opts = {}) {
  await p.evaluate(
    ({ route, opts }) => {
      const r = window.__gromoReview,
        s = r.fixture(true),
        i = s.islands[0];
      s.settings.reduceMotion = true;
      s.records = [
        {
          id: 'r1',
          islandId: s.islandId,
          subject: '수학',
          seconds: 3600,
          at: Date.now(),
          fish: 12,
          contributed: false,
        },
      ];
      s.lastResult = s.records[0];
      s.owned = opts.owned ? ['scarf', 'flag', 'sailboat', 'cabinboat'] : [];
      if (opts.owned) {
        i.sharedOwned.push('soda-theme', 'strawberry-roof', 'rain');
        s.orders = [
          {
            id: 'o1',
            product: 'scarf',
            islandId: s.islandId,
            price: 20,
            currency: 'fish',
            at: Date.now(),
          },
          {
            id: 'o2',
            product: 'soda-theme',
            islandId: s.islandId,
            price: 200,
            currency: 'points',
            at: Date.now(),
          },
        ];
      }
      if (opts.stage) i.buildings = opts.stage;
      if (opts.fish !== undefined) s.fish = opts.fish;
      if (opts.points !== undefined) i.points = opts.points;
      if (opts.solo) i.members = [];
      if (opts.empty) {
        i.quests = [];
        i.notices = [];
        i.messages = [];
        s.records = [];
      }
      if (opts.permission === false) s.settings.permission = false;
      if (opts.session)
        s.session = {
          id: 'focus-s',
          islandId: s.islandId,
          subject: '수학 문제',
          target: 25,
          seconds: opts.seconds ?? 600,
          startedAt: Date.now(),
          status: opts.paused ? 'paused' : 'active',
        };
      if (opts.failed)
        i.messages.push({
          id: 'failed',
          memberId: 'me',
          name: s.name,
          color: s.color,
          text: '전송 실패한 편지',
          at: Date.now(),
          status: 'failed',
        });
      if (opts.credit) i.contribution = 60;
      if (opts.fullStrawberry) s.islands[1].capacity = 3;
      r.open(route, { ...opts, state: s });
    },
    { route, opts },
  );
  await p.waitForTimeout(130);
}
async function page() {
  const p = await b.newPage({ viewport: { width: 402, height: 790 } });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => d.dismiss());
  await p.goto('http://127.0.0.1:18762/?review');
  await p.waitForFunction(() => window.__gromoReview);
  return p;
}
async function state(p) {
  return p.evaluate(() => ({
    state: window.__gromoReview.state,
    route: window.__gromoReview.route,
  }));
}
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'pass' });
    console.log('PASS ' + name);
  } catch (e) {
    results.push({ name, status: 'fail', error: e.message });
    console.log('FAIL ' + name + ': ' + e.message);
  }
}
(async () => {
  b = await chromium.launch();
  const p = await page();
  const click = (name) => p.getByRole('button', { name, exact: true }).click({ timeout: 2500 });
  await check('시설 여섯 곳: 고양이 이동 뒤 정확한 화면 진입', async () => {
    for (const [label, r] of [
      ['마을회관', 'hall'],
      ['게시판', 'board'],
      ['전망대', 'tower'],
      ['우체통', 'mail'],
      ['상점', 'shop'],
      ['내 배', 'boat'],
    ]) {
      await setup(p, 'home');
      await click(label);
      await p.waitForFunction((r) => window.__gromoReview.route === r, r);
    }
  });
  await check('첫 섬: 회관20 → 게시판40 고정 건설과 차감', async () => {
    await setup(p, 'home', { stage: [], credit: true });
    await click('마을회관 짓기');
    await click('확인');
    let x = await state(p);
    assert.deepEqual(x.state.islands[0].buildings, ['hall']);
    assert.equal(x.state.islands[0].contribution, 40);
    await click('게시판 짓기');
    await click('확인');
    x = await state(p);
    assert.deepEqual(x.state.islands[0].buildings, ['hall', 'board']);
    assert.equal(x.state.islands[0].contribution, 0);
  });
  await check('집중 설정 입력 → 시작 → 5종 이모티콘 표시', async () => {
    await setup(p, 'focusSetup');
    await p.getByRole('textbox', { name: '오늘의 할 일', exact: true }).fill('영어 단어');
    await click('집중 시작');
    await p.waitForFunction(() => window.__gromoReview.route === 'focus');
    await click('이모티콘');
    for (const e of ['인사', '응원', '졸림', '웃음', '하트뿅뿅']) {
      await click(e);
      await p.waitForTimeout(30);
    }
    assert.equal((await state(p)).state.session.subject, '영어 단어');
    assert.equal(await p.getByRole('button', { name: '우리 함께', exact: true }).count(), 0);
    assert.equal(await p.getByRole('button', { name: '내 배', exact: true }).count(), 0);
    assert.ok(!(await p.locator('body').innerText()).includes('마리'));
  });
  await check('휴식 중 유효 시간 고정 → 재개 → 종료 단일 보상', async () => {
    await setup(p, 'focus', { session: true });
    await click('휴식하기');
    await p.waitForTimeout(600);
    const before = (await state(p)).state.session;
    assert.equal(before.status, 'paused');
    await p.waitForTimeout(1100);
    assert.equal((await state(p)).state.session.seconds, before.seconds);
    await click('집중 이어가기');
    assert.equal((await state(p)).state.session.status, 'active');
    await click('종료');
    await click('확인');
    const after = await state(p);
    assert.equal(after.route, 'focusResult');
    assert.equal(after.state.session, null);
    assert.equal(after.state.fish, 502);
  });
  await check('집중 중 음악 변경 → 같은 집중 화면으로 복귀', async () => {
    await setup(p, 'focus', { session: true });
    await click('현재 음악');
    await click('숲바람');
    let x = await state(p);
    assert.equal(x.state.islands[0].track, 'forest-wind');
    assert.equal(x.state.islands[0].playing, true);
    await p.mouse.click(200, 80);
    assert.equal((await state(p)).route, 'focus');
    assert.ok((await p.locator('body').innerText()).includes('숲바람'));
  });
  await check('게시판 자세히 → 주민 달성률 → 보상 1회', async () => {
    await setup(p, 'board');
    await p.getByRole('button', { name: '자세히 보기' }).first().click({ timeout: 2500 });
    assert.equal((await state(p)).route, 'quest');
    await click('달성 보상 받기 · 10P');
    assert.equal((await state(p)).state.islands[0].points, 1510);
    assert.ok(await p.getByRole('button', { name: '보상 받음' }).isDisabled());
  });
  await check('집중·폰 사용 퀘스트 생성과 내용 수정', async () => {
    for (const body of ['focus', 'screen']) {
      await setup(p, 'questEdit', { body, text: '검증용 퀘스트' });
      await click('게시판에 붙이기');
      assert.ok(
        (await state(p)).state.islands[0].quests.some(
          (q) => q.title === '검증용 퀘스트' && q.type === body,
        ),
      );
    }
    await setup(p, 'questEdit', { detail: 'q-focus', text: '바뀐 퀘스트', body: 'focus' });
    await click('게시판에 붙이기');
    assert.equal((await state(p)).state.islands[0].quests[0].title, '바뀐 퀘스트');
  });
  await check('공지 생성 → 댓글 → 수정 → 삭제', async () => {
    await setup(p, 'noticeEdit', { text: '새 공지', body: '내일 함께 공부해요' });
    await click('공지 저장');
    let x = await state(p),
      id = x.state.islands[0].notices[0].id;
    await p.getByRole('button', { name: '새 공지' }).first().click({ timeout: 2500 });
    await p.getByRole('textbox', { name: '댓글을 남겨요', exact: true }).fill('좋아요');
    await click('보내기');
    assert.equal((await state(p)).state.islands[0].notices[0].comments.length, 1);
    await click('수정');
    await p.getByRole('textbox', { name: '제목', exact: true }).fill('수정된 공지');
    await click('공지 저장');
    await p.getByRole('button', { name: '수정된 공지' }).first().click({ timeout: 2500 });
    await click('수정');
    await click('삭제');
    await click('확인');
    assert.ok(!(await state(p)).state.islands[0].notices.some((n) => n.id === id));
  });
  await check('그룹 편지 전송과 전송 실패 재시도', async () => {
    await setup(p, 'mail', { failed: true });
    await click('다시 보내기');
    assert.equal((await state(p)).state.islands[0].messages.at(-1).status, 'sent');
    await p.getByRole('textbox', { name: '우리 섬 모두에게', exact: true }).fill('오늘도 고생했어');
    await click('보내기');
    assert.equal((await state(p)).state.islands[0].messages.at(-1).text, '오늘도 고생했어');
    assert.ok(!(await p.locator('body').innerText()).includes('읽음'));
  });
  await check('상품 구매 → 내 배까지 이동 → 착용 → 해제', async () => {
    await setup(p, 'product', { detail: 'scarf' });
    await click('20 물고기로 구매');
    await click('구매');
    assert.equal((await state(p)).state.fish, 480);
    await click('내 뗏목에서 갈아입기');
    await p.waitForFunction(() => window.__gromoReview.route === 'wardrobe');
    await click('바다 스카프');
    assert.equal((await state(p)).state.equipped.clothes, 'scarf');
    await click('기본');
    assert.notEqual((await state(p)).state.equipped.clothes, 'scarf');
  });
  await check('은퇴한 선체·깃발은 상점·꾸미기에 없음(기본 뗏목 고정)', async () => {
    await setup(p, 'product', { detail: 'cabinboat' });
    assert.ok((await p.locator('body').innerText()).includes('바다 스카프'));
    await setup(p, 'wardrobe', { owned: true });
    for (const name of ['뗏목', '돛단배', '선실 있는 배', '딸기 깃발'])
      assert.equal(await p.getByRole('button', { name, exact: true }).count(), 0);
    assert.equal((await state(p)).state.equipped.hull, 'raft');
  });
  await check('공동 테마 구매·적용·기본 복원', async () => {
    await setup(p, 'product', { detail: 'soda-theme' });
    await click('200 마을 포인트로 구매');
    await click('구매');
    await click('우리 섬에 적용');
    assert.equal((await state(p)).state.islands[0].theme, 'soda-theme');
    await click('기본 외양으로 해제');
    assert.equal((await state(p)).state.islands[0].theme, 'default');
  });
  await check('잔액 부족·방송기 미건설 음원 구매 제한', async () => {
    await setup(p, 'product', { detail: 'scarf', fish: 0 });
    await click('20 물고기로 구매');
    await p.waitForTimeout(150);
    assert.ok((await p.locator('body').innerText()).includes('재화가 부족해요'));
    assert.equal((await state(p)).state.fish, 0);
    await setup(p, 'product', {
      detail: 'rain',
      stage: ['hall', 'board', 'tower', 'mail', 'shop'],
    });
    await click('30 마을 포인트로 구매');
    await p.waitForTimeout(150);
    assert.ok((await p.locator('body').innerText()).includes('꽃나팔 방송기를 먼저 지어 주세요'));
    assert.ok(!(await state(p)).state.islands[0].sharedOwned.includes('rain'));
  });
  await check('도서관 일기장 기간 변경·이웃 기록·권한 없는 상태', async () => {
    await setup(p, 'stats');
    await click('월 단위');
    assert.ok((await p.locator('body').innerText()).includes('이번 달 합계'));
    await setup(p, 'diary', { detail: 'residents' });
    assert.ok((await p.locator('body').innerText()).includes('민지의 하루'));
    await setup(p, 'stats', { permission: false, tab: 'screen' });
    assert.ok((await p.locator('body').innerText()).includes('아직 연결되지 않은 기록이에요'));
  });
  await check('섬 정보 수정·정원·주민 승인·주민 칸 위임 후 관리 잠금', async () => {
    await setup(p, 'manage');
    await click('섬 정보 수정');
    await p.getByRole('textbox', { name: '섬 이름', exact: true }).fill('새 이름');
    await click('주민 정원');
    await click('주민 정원 8명');
    await click('정하기');
    await click('저장하기');
    let x = await state(p);
    assert.equal(x.state.islands[0].name, '새 이름');
    assert.equal(x.state.islands[0].capacity, 8);
    await click('새봄 가입 승인');
    assert.ok((await state(p)).state.islands[0].members.some((m) => m.name === '새봄'));
    await click('민지 관리');
    await click('방장 위임');
    await click('위임하기');
    assert.equal(await p.getByRole('button', { name: '민지 관리', exact: true }).count(), 0);
    assert.equal(await p.getByRole('button', { name: '섬 정보 수정', exact: true }).count(), 0);
  });
  await check('닉네임 저장·음소거·동작 줄이기·측정 연결', async () => {
    await setup(p, 'profile');
    await p.getByRole('textbox', { name: '닉네임', exact: true }).fill('고양이친구');
    await click('저장');
    assert.equal((await state(p)).state.name, '고양이친구');
    await setup(p, 'settings');
    for (const name of ['알림', '소리', '동작 줄이기', '스크린타임 연결', '가벼운 진동'])
      await p.getByRole('switch', { name, exact: true }).click();
    const x = (await state(p)).state.settings;
    assert.equal(x.sound, false);
    assert.equal(x.reduceMotion, false);
    assert.equal(x.permission, false);
  });
  await check('검색 결과 없음·초대 오류·정원 찬 섬 초대 차단·전망대 섬 찾기', async () => {
    await setup(p, 'explore');
    await p.getByRole('textbox', { name: '섬 이름이나 초대 코드' }).fill('없는이름');
    assert.ok((await p.locator('body').innerText()).includes('찾는 섬이 없어요'));
    // 초대 코드는 첫 섬 선택의 '이미 초대받은 섬이 있어요!' 모달에서 넣는다
    await setup(p, 'chooseIsland');
    await click('이미 초대받은 섬이 있어요!');
    await p.getByRole('textbox', { name: '초대 코드' }).fill('NO');
    await click('확인');
    assert.ok((await p.locator('body').innerText()).includes('다시 확인'));
    // 정원이 가득 찬 딸기 섬의 초대 코드(이미 주민인 소다 섬 코드로는 차단을 확인할 수 없다)
    await setup(p, 'chooseIsland', { fullStrawberry: true });
    await click('이미 초대받은 섬이 있어요!');
    await p.getByRole('textbox', { name: '초대 코드' }).fill('STRAWBERRY');
    await click('확인');
    assert.ok((await p.locator('body').innerText()).includes('정원이 가득 찬 섬이에요'));
    assert.equal((await state(p)).state.islands[1].joined, false);
    await setup(p, 'tower');
    await click('섬 찾기');
    assert.equal((await state(p)).route, 'explore');
  });
  await p.close();
  fs.writeFileSync(
    root + '/.docs/interaction-review.json',
    JSON.stringify({ results, errors }, null, 2),
  );
  await b.close();
  if (results.some((r) => r.status === 'fail') || errors.length) process.exitCode = 1;
})();
