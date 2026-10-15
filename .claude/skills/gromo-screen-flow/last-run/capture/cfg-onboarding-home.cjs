// 온보딩·홈·공용 팝업 묶음. 한 줄 = 한 장. 하네스는 capture-onboarding-home.cjs (capture.cjs 사본 + 서버 모드 흉내).
// 실행: CAPTURE_CONFIG=cfg-onboarding-home.cjs CAPTURE_OUT=../shots/onboarding-home node capture-onboarding-home.cjs
// target = targets-onboarding-home.json 의 id. 통과한 장은 shots/final/<target>.png 로 복사한다.

// mutate 는 브라우저 안에서 도는 함수의 소스 문자열이어야 해서(바깥 변수를 못 본다) 값은 JSON 으로 박아 넣는다.
const set = (extra, obj) =>
  `(s, is) => { ${extra || ''}; Object.assign(s, ${JSON.stringify(obj || {})}); }`;
// 신규 계정(섬 없음·온보딩 전)
const NEWBIE = 's.onboarded = false; s.mainIslandId = null';

// ── 서버 모드 흉내용 더미 값 (서버 DTO 모양) ──
const sum = (id, name, o = {}) => ({
  id,
  name,
  intro: '각자의 공부를 함께해요.',
  visibility: 'public',
  approvalRequired: false,
  memberCount: 4,
  maxMembers: 15,
  membershipStatus: 'none',
  joinRequestId: null,
  growthStage: null,
  themeId: null,
  ...o,
});
const snap = (o = {}) => ({
  memberships: [],
  currentIslandId: null,
  lossReason: null,
  candidates: [],
  nextCursor: null,
  visit: null,
  joinRequests: [],
  requestStatus: [],
  ...o,
});
const req = (status) => ({
  id: 'req-1',
  islandId: 'cloud',
  status,
  version: 1,
  islandName: '구름 섬',
  memberCount: 4,
  maxMembers: 15,
  createdAt: '2026-10-05T05:00:00Z',
});
const server = (target, title, route, snapshot, o = {}) => ({
  target,
  title,
  route,
  fresh: true,
  server: {},
  mutate: set(NEWBIE, { serverIslands: snapshot }),
  ...o,
});
// 서버 모드 홈 스냅샷(SERVER_HOME 으로 넣는다 — LOAD 는 home 을 비운다)
const facts = (villagePoints) => ({
  islandId: 'srv-soda',
  home: {
    island: {
      ...sum('srv-soda', '소다 섬', { memberCount: 1, membershipStatus: 'active' }),
      role: 'host',
      version: 1,
    },
    focusSummary: {
      date: '2026-10-05',
      completedSeconds: 1800,
      currentSessionSecondsToday: 0,
      totalSeconds: 1800,
      serverNow: '2026-10-05T05:00:00Z',
    },
    session: null,
    restMembers: { items: [], serverNow: '2026-10-05T05:00:00Z', watermarks: [] },
    wallets: { fish: 0, villagePoints, fishVersion: null, villagePointsVersion: 1 },
    playback: null,
    playbackAvailability: 'facility_locked',
    buildings: [],
    members: { items: [], nextCursor: null, version: 1 },
  },
  completedBuildings: [],
  members: [],
});
const serverHome = (target, title, villagePoints, item, o = {}) => ({
  target,
  title,
  route: 'home',
  server: {},
  records: false,
  mutate: set('', {
    serverIslands: snap({
      memberships: [sum('srv-soda', '소다 섬', { membershipStatus: 'active' })],
      currentIslandId: 'srv-soda',
    }),
  }),
  api: {
    '/me/islands': { items: [sum('srv-soda', '소다 섬')], currentIslandId: 'srv-soda' },
    '/islands/srv-soda/construction-options': {
      islandVersion: 1,
      costPolicyVersion: 1,
      selectedBuildingId: null,
      villagePoints,
      walletVersion: 1,
      items: [{ id: 'hall', name: '마을회관', cost: 60, currency: 'VILLAGE_POINT', selectable: true, ...item }],
    },
  },
  steps: [
    { dispatch: { type: 'SERVER_HOME', facts: facts(villagePoints) }, settle: 600 },
    { click: '건설하기', settle: 900 },
  ],
  ...o,
});
// 목업 홈: 회관을 지을 수 있는 방장 (섬 통장 72마리, 회관 60마리)
const HALL_READY = {
  route: 'home',
  stage: 'hall-ready',
  keepBuildings: true,
  records: false,
  mutate: '(s, is) => { is.fish = 72; }',
};
// 회관 터(지도 오른쪽 위)가 화면에 들어오게 지도를 끈다
const HALL_SITE = [{ drag: [380, 300, 20, 450] }, { drag: [380, 300, 300, 330] }];
// 다른 섬 구경 시작 — LOAD 는 구경 상태를 지우므로 화면을 연 뒤 실제 명령으로 건다
const VISIT = { dispatch: { type: 'VISIT', id: 'strawberry' }, settle: 700 };

module.exports = [
  // ── 온보딩 ──
  { target: 'login.bootLoading', title: '앱 시작 로딩', route: 'login', bootHold: true },
  { target: 'login', title: '로그인(시작 화면)', route: 'login' },
  { target: 'character', title: '내 고양이(털색·닉네임 설정)', route: 'character', fresh: true, mutate: set(NEWBIE) },
  { target: 'chooseIsland', title: '첫 섬 선택', route: 'chooseIsland', fresh: true, mutate: set(NEWBIE) },
  {
    target: 'chooseIsland.inviteCode',
    title: '초대 코드 입력 팝업',
    route: 'chooseIsland',
    fresh: true,
    mutate: set(NEWBIE),
    steps: [{ click: '이미 초대받은 섬이 있어요!' }, { fill: ['초대 코드', 'CLOUD'] }],
  },
  server('chooseIsland.invitePreview', '초대받은 섬 미리보기 팝업', 'chooseIsland', snap(), {
    server: { resolveInvite: sum('cloud', '구름 섬') },
    steps: [{ click: '이미 초대받은 섬이 있어요!' }, { fill: ['초대 코드', 'CLOUD'] }, { click: '확인', settle: 500 }],
  }),
  server(
    'chooseIsland.joined',
    '첫 섬 선택 - 가입 확인 카드',
    'chooseIsland',
    snap({ memberships: [sum('cloud', '구름 섬', { membershipStatus: 'active' })], currentIslandId: 'cloud' }),
  ),
  server(
    'chooseIsland.pendingResume',
    '첫 섬 선택 - 진행 중인 가입 신청 버튼',
    'chooseIsland',
    snap({ joinRequests: [req('pending')] }),
  ),
  {
    target: 'createIsland',
    title: '새 섬 만들기',
    route: 'createIsland',
    fresh: true,
    mutate: set(NEWBIE),
    text: '오스카의 섬',
    body: '매일 조금씩 같이 집중해요.',
  },
  server(
    'createIsland.done',
    '새 섬 만들기 - 생성 완료',
    'createIsland',
    snap({ memberships: [sum('new', '오스카의 섬', { membershipStatus: 'active' })], currentIslandId: 'new' }),
    { text: '오스카의 섬', body: '매일 조금씩 같이 집중해요.', steps: [{ click: '섬 만들기', settle: 500 }] },
  ),
  { target: 'joinIsland', title: '섬 찾기(공개 섬 둘러보기)', route: 'joinIsland', detail: 'strawberry', fresh: true, mutate: set(NEWBIE) },
  {
    target: 'joinIsland.empty',
    title: '섬 찾기 - 공개 섬 없음',
    route: 'joinIsland',
    fresh: true,
    mutate: set(NEWBIE + "; s.islands.forEach((i) => { i.visibility = 'private'; })"),
  },
  server(
    'joinIsland.visitInfo',
    '섬 찾기 - 섬 공개 정보 펼침',
    'joinIsland',
    snap({
      candidates: [sum('strawberry', '딸기 섬'), sum('cloud', '구름 섬', { approvalRequired: true })],
      visit: {
        island: sum('strawberry', '딸기 섬'),
        members: {
          items: ['민지', '두부', '수아', '새봄'].map((name, n) => ({
            id: 'm' + n,
            name,
            catColor: null,
            role: n ? 'member' : 'host',
            appearance: null,
          })),
          nextCursor: null,
          version: 1,
        },
        joinRequestAvailability: 'none',
        joinRequest: null,
      },
    }),
  ),
  {
    target: 'joinIsland.pending',
    title: '섬 찾기 - 가입 신청 대기 중',
    route: 'joinIsland',
    detail: 'cloud',
    fresh: true,
    mutate: set(NEWBIE),
    steps: [{ click: '가입 신청', settle: 500 }],
  },
  server(
    'joinIsland.joined',
    '섬 찾기 - 가입 완료 카드',
    'joinIsland',
    snap({
      candidates: [sum('strawberry', '딸기 섬'), sum('cloud', '구름 섬', { approvalRequired: true })],
      memberships: [sum('strawberry', '딸기 섬', { membershipStatus: 'active' })],
      currentIslandId: 'strawberry',
    }),
  ),
  server('approval', '가입 신청(승인 대기)', 'approval', snap({ joinRequests: [req('pending')] }), { detail: 'cloud' }),
  server(
    'approval.approved',
    '가입 신청 - 승인됨',
    'approval',
    snap({
      joinRequests: [req('approved')],
      memberships: [sum('cloud', '구름 섬', { membershipStatus: 'active' })],
      currentIslandId: 'cloud',
    }),
    { detail: 'cloud' },
  ),
  server('approval.closed', '가입 신청 - 거절됨', 'approval', snap({ joinRequests: [req('rejected')] }), { detail: 'cloud' }),
  { target: 'arrival', title: '첫 항해 컷신(섬 도착)', route: 'arrival', delay: 800 },

  // ── 홈 ──
  { target: 'home', title: '섬 홈(내 섬)', route: 'home', records: false, mutate: '(s, is) => { is.quests = []; }' },
  { target: 'home.mailboxGuide', title: '홈 - 펠리컨 우체통 안내 1/3', route: 'home', records: false, npcGuide: true },
  {
    target: 'home.mailboxGuide2',
    title: '홈 - 펠리컨 우체통 안내 2/3',
    route: 'home',
    records: false,
    npcGuide: true,
    steps: [{ click: '다음' }],
  },
  {
    target: 'home.mailboxGuide3',
    title: '홈 - 펠리컨 우체통 안내 3/3',
    route: 'home',
    records: false,
    npcGuide: true,
    steps: [{ click: '다음' }, { click: '다음' }],
  },
  // 실제 사용자(서버 모드)가 보는 접힌 카드 = 「섬 통장 N마리 + 건설하기」. 목업 카드(72/60 마리)는 참고용으로 따로 남긴다
  serverHome('home.buildCard', '홈 - 건설 카드(마을회관 짓기, 서버 모드 접힌 카드)', 72, { buildable: true, blockedReason: null }, {
    steps: [{ dispatch: { type: 'SERVER_HOME', facts: facts(72) }, settle: 600 }],
  }),
  { name_: 'home.buildCard.mock', title: '홈 - 건설 카드(목업 모드 변형, 참고용)', ...HALL_READY },
  { target: 'home.buildConfirm', title: '홈 - 건설 확인창', ...HALL_READY, steps: [{ click: '건설하기' }] },
  serverHome('home.serverBuildOpen', '홈 - 건설 카드 펼침(비용 확인)', 72, { buildable: true, blockedReason: null }),
  serverHome('home.serverBuildBlocked', '홈 - 건설 카드 펼침(건설 불가)', 24, {
    buildable: false,
    blockedReason: 'INSUFFICIENT_FUNDS',
  }),
  {
    // 공사 중반(골조) 상태로 열고, 회관 터가 보이게 지도를 끈다 (확인 직후에는 토스트가 카드를 가리고 터가 화면 밖이다)
    target: 'home.underConstruction',
    title: '홈 - 공사 중',
    route: 'home',
    records: false,
    keepBuildings: true,
    mutate:
      "(s, is) => { is.buildings = []; is.fish = 12; is.construction = { building: 'hall', startedAt: Date.now() - 27000, endsAt: Date.now() + 33000, cost: 60 }; }",
    steps: HALL_SITE,
  },
  {
    // 공사 종료 2.5초 전 상태로 열어 회관 터로 지도를 끌어 두고, 완공 연출(1.8초)이 시작되면 그 중간을 찍는다
    target: 'home.constructionDone',
    title: '홈 - 완공 연출',
    route: 'home',
    records: false,
    keepBuildings: true,
    mutate:
      "(s, is) => { is.buildings = []; is.fish = 12; is.construction = { building: 'hall', startedAt: Date.now() - 600000, endsAt: Date.now() + 2500, cost: 60 }; }",
    steps: [
      ...HALL_SITE,
      {
        js: `new Promise((ok, no) => { const t0 = Date.now(); const t = setInterval(() => { if (document.querySelector('[aria-label="마을회관 완공"]')) { clearInterval(t); ok(); } else if (Date.now() - t0 > 8000) { clearInterval(t); no(new Error('완공 연출이 안 뜸')); } }, 40); })`,
        settle: 500,
      },
    ],
  },
  { target: 'home.questNote', title: '홈 - 오늘 퀘스트 쪽지', route: 'home', records: false },
  {
    target: 'home.questRewardNote',
    title: '홈 - 보상 받기 쪽지',
    route: 'home',
    records: false,
    mutate:
      "(s, is) => { s.rewards = [{ id: 'rw1', islandId: s.islandId, questId: 'q-focus', day: new Date().toISOString().slice(0, 10), amount: 10, kind: 'personal', acknowledged: false }]; }",
  },
  {
    // 게시판·전망대·상점·도서관 표시는 서버 값이라 ?demo=1 의 시연 상태로, 우체통 펠리컨은 안 읽은 친구 편지로 만든다
    target: 'home.buildingIndicators',
    title: '홈 - 건물 새 소식 표시',
    route: 'home',
    records: false,
    demo: true,
    mutate:
      "(s, is) => { is.quests = []; s.friends[0].messages.push({ id: 'l1', memberId: 'saebom', name: '새봄', color: 'white', text: '오늘도 같이 집중해요!', at: Date.now(), status: 'sent' }); }",
    // 우체통(왼쪽)과 게시판(오른쪽)이 한 화면에 들어오게 조금 축소하고 왼쪽으로 끈다
    steps: [
      { zoom: [200, 450, 200], settle: 500 },
      { drag: [300, 450, 265, 450], settle: 500 },
    ],
  },
  {
    target: 'home.visiting',
    title: '홈 - 다른 섬 구경 중',
    route: 'home',
    records: false,
    steps: [VISIT],
  },

  // ── 공용 팝업 ──
  {
    target: 'guard.notBuilt',
    title: '건물 미완공 잠금 안내 (공용)',
    route: 'sound',
    records: false,
    keepBuildings: true,
    mutate: "(s, is) => { is.buildings = is.buildings.filter((b) => b !== 'gram'); }",
  },
  {
    target: 'guard.noIsland',
    title: '가입한 섬 없음 안내 (공용)',
    route: 'hall',
    records: false,
    // 소속이 없으면 앱이 곧바로 첫 섬 선택으로 되돌린다(App.tsx 1362) — 그 되돌림만 피하려고 loggedIn 을 내린다
    mutate: '(s, is) => { s.islands.forEach((i) => { i.joined = false; }); s.mainIslandId = null; s.loggedIn = false; }',
  },
  {
    target: 'guard.residentsOnly',
    title: '주민만 이용 가능 안내 (공용)',
    route: 'library',
    records: false,
    steps: [VISIT],
  },
  {
    target: 'product.memberConversion',
    title: '회원 전환 시트(소셜 계정으로 계속하기)',
    route: 'product',
    detail: 'scarf',
    terms: '2026-09',
    mutate: '(s, is) => { is.fish = 500; }',
    steps: [{ js: 'void window.__openConv()', settle: 500 }],
  },
  {
    target: 'product.accountSwitchConfirm',
    title: '기존 계정 충돌 확인(이미 연결된 계정)',
    route: 'product',
    detail: 'scarf',
    terms: '2026-09',
    mutate: '(s, is) => { is.fish = 500; }',
    steps: [
      { js: 'void window.__openConv()', settle: 500 },
      { js: "document.querySelector('[data-testid=member-conversion-terms]').click()" },
      { js: 'void window.__askSwitch()', settle: 500 },
    ],
  },
  // external.mailApp 은 앱 화면이 아니라(기기 메일 앱) 찍지 않는다.
].map((c) => ({ ...c, name_: c.name_ ?? c.target }));
