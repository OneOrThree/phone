const { chromium } = require('playwright'),
  fs = require('fs'),
  path = require('path');
const root = path.resolve(__dirname, '..'),
  dir = root + '/.docs/phone-screens';
fs.mkdirSync(dir, { recursive: true });
const configs = [];
const add = (group, route, title, opts = {}) =>
  configs.push({ id: String(configs.length + 1).padStart(2, '0'), group, route, title, ...opts });
add('01 · 처음 만나는 GROMO', 'login', '첫 시작');
add('01 · 처음 만나는 GROMO', 'character', '내 고양이와 이름');
add('01 · 처음 만나는 GROMO', 'chooseIsland', '첫 섬 선택 · 만들기·공개 섬·초대');
add('01 · 처음 만나는 GROMO', 'createIsland', '새 섬 만들기', {
  text: '반짝이는 섬',
  body: '각자의 속도로 함께 집중해요.',
});
add('01 · 처음 만나는 GROMO', 'joinIsland', '함께할 섬 찾기');
add('01 · 처음 만나는 GROMO', 'approval', '가입 승인 대기');
add('01 · 처음 만나는 GROMO', 'arrival', '처음 떠나는 항해', { delay: 3100 });
add('01 · 처음 만나는 GROMO', 'guide', '앵무새의 첫 안내');
add('02 · 섬에서의 하루', 'home', '건물 없는 첫 섬', { fresh: true });
add('02 · 섬에서의 하루', 'home', '첫 마을회관 건설', { stage: 'hall-ready' });
add('02 · 섬에서의 하루', 'home', '회관 다음은 게시판', { stage: 'board-ready' });
add('02 · 섬에서의 하루', 'home', '함께 자란 우리 섬');
add('03 · 집중과 잠깐의 쉼', 'focusSetup', '오늘의 할 일과 목표 시간', { text: '수학 문제 풀기' });
add('03 · 집중과 잠깐의 쉼', 'focus', '함께 낚시하며 집중', { session: true });
add('03 · 집중과 잠깐의 쉼', 'focus', '내 배로 가까이', { session: true, pinch: true });
add('03 · 집중과 잠깐의 쉼', 'focus', '말풍선으로 보내는 응원', { session: true, emote: true });
add('03 · 집중과 잠깐의 쉼', 'sound', '집중 중 음악 바꾸기', { session: true });
add('03 · 집중과 잠깐의 쉼', 'rest', '모닥불에서 책 읽으며 휴식', { session: true, paused: true });
add('03 · 집중과 잠깐의 쉼', 'focus', '집중 종료 확인', { session: true, confirm: '집중 종료' });
add('03 · 집중과 잠깐의 쉼', 'focusResult', '이번 집중 결과');
add('04 · 기록과 마을의 성장', 'hall', '마을회관');
add('04 · 기록과 마을의 성장', 'stats', '내 집중 기록');
add('04 · 기록과 마을의 성장', 'stats', '스크린타임 기록', { tab: '스크린타임 기록' });
add('04 · 기록과 마을의 성장', 'stats', '공개 주민의 집중 기록', { text: '공개 멤버' });
add('04 · 기록과 마을의 성장', 'stats', '측정 권한이 없는 상태', {
  tab: '스크린타임 기록',
  noPermission: true,
});
add('04 · 기록과 마을의 성장', 'manage', '섬 정보와 가입 방식', {
  text: '소다 섬',
  body: '각자의 공부를 함께해요.',
});
add('04 · 기록과 마을의 성장', 'members', '주민 관리와 초대');
add('04 · 기록과 마을의 성장', 'members', '가입 요청과 방장 권한', { bottom: true });
add('04 · 기록과 마을의 성장', 'ledger', '함께 모으고 사용한 기록');
add('04 · 기록과 마을의 성장', 'construction', '다음 건물 고르기', { stage: 'board' });
add('04 · 기록과 마을의 성장', 'construction', '꽃나팔 방송기와 마지막 상점', {
  stage: 'board',
  bottom: true,
});
add('05 · 게시판에 붙인 작은 목표', 'board', '퀘스트 종이 카드');
add('05 · 게시판에 붙인 작은 목표', 'quest', '그룹원 달성률', { detail: 'q-focus' });
add('05 · 게시판에 붙인 작은 목표', 'quest', '폰 사용 퀘스트', { detail: 'q-screen' });
add('05 · 게시판에 붙인 작은 목표', 'questEdit', '시간대 집중 퀘스트 만들기', {
  text: '저녁 한 시간 집중하기',
  body: 'focus',
});
add('05 · 게시판에 붙인 작은 목표', 'questEdit', '하루 폰 사용 퀘스트 만들기', {
  text: '오늘 폰 사용 두 시간 이내',
  body: 'screen',
});
add('05 · 게시판에 붙인 작은 목표', 'board', '우리 섬 공지', { tab: '공지' });
add('05 · 게시판에 붙인 작은 목표', 'notice', '공지 내용과 댓글', { detail: 'welcome' });
add('05 · 게시판에 붙인 작은 목표', 'noticeEdit', '공지 작성', {
  text: '내일도 우리 같이 힘내요',
  body: '아침 집중은 각자 편한 시간에 시작해요.',
});
add('06 · 조금 더 멀리, 함께', 'tower', '우리 섬 주간 랭킹');
add('06 · 조금 더 멀리, 함께', 'tower', '섬 간 랭킹', { tab: '섬 간 랭킹' });
add('06 · 조금 더 멀리, 함께', 'explore', '다른 섬 찾아보기');
add('06 · 조금 더 멀리, 함께', 'visit', '다른 섬 구경', { detail: 'strawberry' });
add('06 · 조금 더 멀리, 함께', 'travel', '배를 타고 섬 사이 이동', { delay: 3100 });
add('06 · 조금 더 멀리, 함께', 'mail', '우리 섬 편지방');
add('06 · 조금 더 멀리, 함께', 'mail', '편지 작성과 보내기', {
  text: '오늘 한 시간 집중했어! 다들 수고했어.',
});
add('07 · 상점에 모인 취향', 'shop', '내 꾸미기 상품');
add('07 · 상점에 모인 취향', 'product', '개인 상품 미리보기', { detail: 'scarf' });
add('07 · 상점에 모인 취향', 'product', '물고기로 구매 확인', { detail: 'scarf', confirm: '구매' });
add('07 · 상점에 모인 취향', 'product', '뗏목에서 돛단배로', { detail: 'sailboat' });
add('07 · 상점에 모인 취향', 'product', '선실 있는 배 업그레이드', {
  detail: 'cabinboat',
  owned: true,
});
add('07 · 상점에 모인 취향', 'shop', '우리 섬과 건물 테마', { tab: '우리 섬 꾸미기' });
add('07 · 상점에 모인 취향', 'product', '섬 외양 구매와 적용', {
  detail: 'soda-theme',
  owned: true,
});
add('07 · 상점에 모인 취향', 'product', '건물별 테마 적용', {
  detail: 'strawberry-roof',
  owned: true,
});
add('07 · 상점에 모인 취향', 'shop', '함께 들을 ASMR', { tab: '우리 섬의 소리' });
add('07 · 상점에 모인 취향', 'product', '음원 미리듣기와 구매', { detail: 'rain' });
add('07 · 상점에 모인 취향', 'orders', '내 구매 내역', { owned: true });
add('07 · 상점에 모인 취향', 'orders', '섬 공동 구매 내역', { tab: '섬 공동 구매', owned: true });
add('08 · 내 취향은 내 배에', 'boat', '나의 작은 배');
add('08 · 내 취향은 내 배에', 'wardrobe', '옷과 선체 선택', { owned: true });
add('08 · 내 취향은 내 배에', 'wardrobe', '배 소품 배치와 해제', { owned: true, bottom: true });
add('08 · 내 취향은 내 배에', 'profile', '내 프로필과 계정', { text: '수빈' });
add('08 · 내 취향은 내 배에', 'profile', '로그아웃과 회원 탈퇴', { text: '수빈', bottom: true });
add('08 · 내 취향은 내 배에', 'settings', '앱·알림·소리 설정');
add('08 · 내 취향은 내 배에', 'settings', '공개 범위와 측정 권한', { bottom: true });
add('08 · 내 취향은 내 배에', 'sound', '함께 듣는 음악과 기기 음량', { bottom: true });
configs.splice(3, 0, {
  id: '03-invite',
  group: configs[2].group,
  route: 'chooseIsland',
  title: '초대 코드 입력',
  invite: true,
});
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1 });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://127.0.0.1:18762/?review=1');
  await p.waitForFunction(() => window.__gromoReview);
  for (const c of configs) {
    if (process.env.CAPTURE_IDS && !process.env.CAPTURE_IDS.split(',').includes(c.id)) continue;
    await p.evaluate((c) => {
      const r = window.__gromoReview,
        s = r.fixture(!c.fresh),
        is = s.islands[0];
      s.settings.reduceMotion = false;
      s.screenMinutes = 84;
      if (c.fresh) {
        s.loggedIn = true;
        s.onboarded = true;
      }
      if (c.stage) {
        is.buildings =
          c.stage === 'hall-ready' ? [] : c.stage === 'board-ready' ? ['hall'] : ['hall', 'board'];
        is.contribution = c.stage === 'hall-ready' ? 20 : c.stage === 'board-ready' ? 40 : 0;
      }
      if (c.noPermission) s.settings.permission = false;
      if (!c.fresh) {
        s.records = Array.from({ length: 7 }, (_, i) => ({
          id: 'r' + i,
          islandId: s.islandId,
          subject: ['수학 문제 풀기', '영어 단어', '책 읽기'][i % 3],
          seconds: [1800, 2700, 1200, 3600, 2100, 900, 3000][i],
          at: Date.now() - i * 86400000,
          fish: 6,
          contributed: false,
        }));
        s.lastResult = s.records[0];
        is.ledger = [
          { id: 'l1', text: '집중 퀘스트 달성 · +10 마을 포인트', at: Date.now() },
          { id: 'l2', text: '꽃나팔 방송기 건설 · −100 마을 포인트', at: Date.now() - 86400000 },
          { id: 'l3', text: '게시판 건설 · 보탠 물고기 40마리', at: Date.now() - 172800000 },
        ];
      }
      if (c.owned) {
        s.owned = ['scarf', 'flag', 'sailboat'];
        s.equipped = { clothes: 'scarf', decor: 'flag', hull: 'sailboat', position: 'front' };
        is.sharedOwned.push('soda-theme', 'strawberry-roof');
        s.orders = [
          {
            id: 'o1',
            product: 'scarf',
            islandId: s.islandId,
            currency: 'fish',
            price: 20,
            at: Date.now(),
          },
          {
            id: 'o2',
            product: 'soda-theme',
            islandId: s.islandId,
            currency: 'points',
            price: 200,
            at: Date.now(),
          },
        ];
      }
      if (c.session)
        s.session = {
          id: 'session',
          islandId: s.islandId,
          subject: '수학 문제 풀기',
          target: 40,
          startedAt: Date.now(),
          seconds: 1230,
          status: c.paused ? 'paused' : 'active',
        };
      is.track = 'waves';
      is.playing = c.session || false;
      r.open(c.route, { ...c, state: s });
    }, c);
    await p.waitForTimeout(c.delay || 450);
    await p.evaluate(async () => {
      await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
    });
    if (c.invite) {
      await p.getByRole('button', { name: '이미 초대받은 섬이 있어요!', exact: true }).click();
      await p.waitForTimeout(500);
    }
    if (c.bottom) {
      await p.evaluate(() => {
        for (const el of document.querySelectorAll('div'))
          if (el.scrollHeight > el.clientHeight + 50 && getComputedStyle(el).overflowY === 'auto')
            el.scrollTop = el.scrollHeight;
      });
      await p.waitForTimeout(120);
    }
    if (c.pinch) {
      const cd = await p.context().newCDPSession(p);
      await cd.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
          { x: 175, y: 410 },
          { x: 225, y: 410 },
        ],
      });
      await cd.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: 110, y: 410 },
          { x: 290, y: 410 },
        ],
      });
      await cd.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await p.waitForTimeout(200);
    }
    if (c.emote) {
      await p.getByRole('button', { name: '응원', exact: true }).click();
      await p.waitForTimeout(120);
    }
    if (c.confirm) {
      await p.getByRole('button', { name: c.confirm, exact: true }).click();
      await p.waitForTimeout(250);
    }
    await p.screenshot({ path: dir + '/' + c.id + '.png' });
    c.text = await p.locator('body').innerText();
    console.log(c.id + ' ' + c.title);
  }
  fs.writeFileSync(root + '/.docs/phone-screen-catalog.json', JSON.stringify(configs, null, 2));
  fs.writeFileSync(root + '/.docs/phone-screen-errors.json', JSON.stringify(errors, null, 2));
  await b.close();
})();
