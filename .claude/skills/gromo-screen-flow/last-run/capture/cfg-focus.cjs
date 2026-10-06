// 집중·권한 묶음 캡처 설정. 한 줄 = 한 장. target = targets-focus.json 의 id (파일명도 같다).
// 실행: node capture-focus.cjs   (capture.cjs 사본 — st 옵션·catalog 병합·CAPTURE_CHANNEL 추가)
// 황금 물고기만: CAPTURE_URL='http://127.0.0.1:18762/?review=1&demo&golden-test' CAPTURE_CHANNEL=chrome CAPTURE_GOLDEN=1 node capture-focus.cjs

// 낚시 자리: 연못가 기본 자리(FishingIsland.tsx DEFAULT_SPOT). 안 주면 뗏목 내리는 곳에 앉는다.
const spot = (s) => {
  s.focusSpot = { x: 34.1, y: 55.9 };
};
// 모닥불: 내 자리 + 휴식을 4분 전에 시작한 것으로(안 주면 00:00:00 부터 센다 — RestGroup.tsx:186)
// (mutate 는 소스 문자열로 브라우저에 넘어가므로 다른 함수를 부르지 못한다)
const resting = (s) => {
  s.focusSpot = { x: 34.1, y: 55.9 };
  s.session.restStartedAt = Date.now() - 4 * 60000;
};
// 게시판 첫 진입 흐름의 detail (CurrentScreens.tsx:638 — 'board-first|돌아갈 route|detail')
const BOARD_FIRST = 'board-first|board|';
const picked = { applications: 3, categories: 1, webDomains: 0 };

const shots = [
  // ── 집중 흐름 ──
  { target: 'focusTravel', route: 'focusTravel', title: '낚시섬으로 항해', delay: 900, expectRoute: 'focusTravel' },
  { target: 'fishingArrival', route: 'fishingArrival', title: '낚시섬 도착 · 자리 고르기' },
  { target: 'focusSetup', route: 'focusSetup', title: '집중 준비 카드', text: '수학 문제 풀기', mutate: spot },
  {
    target: 'focusSetup.visitorBlocked',
    // LOAD 는 visitingIslandId 를 지운다(model.ts:1383) — 홈을 연 뒤 VISIT 을 보내고, 상태를 다시 싣지 않고 route 만 옮긴다
    route: 'home',
    title: '구경 중 차단 안내',
    steps: [
      { dispatch: { type: 'VISIT', id: 'strawberry' } },
      { js: "window.__gromoReview.open('focusSetup', { guideStep: 99 })", settle: 600 },
    ],
    expectRoute: 'focusSetup',
  },
  { target: 'focus', route: 'focus', title: '집중 중(낚시)', session: true, mutate: spot },
  {
    target: 'focus.emoteFan',
    route: 'focus',
    title: '이모티콘 5종 펼침',
    session: true,
    mutate: spot,
    steps: [{ click: '이모티콘' }],
  },
  {
    target: 'focus.emoteBubble',
    route: 'focus',
    title: '이모티콘 말풍선',
    session: true,
    mutate: spot,
    steps: [{ click: '이모티콘' }, { click: '응원', settle: 500 }],
  },
  {
    target: 'focus.musicModal',
    route: 'focus',
    title: '축음기 음악 고르기',
    session: true,
    mutate: spot,
    steps: [{ label: '축음기 · 음악 고르기' }],
  },
  {
    target: 'focus.endConfirm',
    route: 'focus',
    title: '집중 종료 확인',
    session: true,
    mutate: spot,
    steps: [{ click: '집중 종료' }],
  },
  {
    target: 'rest.sailingToRest',
    route: 'focus',
    title: '모닥불로 항해',
    session: true,
    mutate: spot,
    steps: [{ click: '휴식하기', settle: 0 }, { waitText: '이동 중', settle: 700 }],
    expectRoute: 'rest',
  },
  { target: 'rest', route: 'rest', title: '모닥불 휴식', session: true, paused: true, mutate: resting, delay: 900 },
  {
    target: 'rest.endConfirm',
    route: 'rest',
    title: '휴식 종료 확인',
    session: true,
    paused: true,
    mutate: resting,
    delay: 900,
    steps: [{ click: '휴식 종료하기' }],
  },
  {
    target: 'rest.sailingToSpot',
    route: 'rest',
    title: '낚시섬 내 자리로 항해',
    session: true,
    paused: true,
    mutate: resting,
    delay: 900,
    steps: [{ click: '집중 이어가기', settle: 0 }, { waitText: '이동 중', settle: 1000 }],
  },
  {
    target: 'focusResult',
    route: 'focus',
    title: '집중 결과(낚시섬 배경)',
    session: true,
    mutate: spot,
    steps: [{ click: '집중 종료' }, { js: "document.querySelector('[data-testid=confirm-finish]').click()", settle: 900 }],
    expectRoute: 'focusResult',
  },
  {
    target: 'focusResult.fromRest',
    route: 'rest',
    title: '집중 결과(모닥불 배경)',
    session: true,
    paused: true,
    mutate: resting,
    delay: 900,
    steps: [{ click: '휴식 종료하기' }, { click: '집중 종료', settle: 900 }],
    expectRoute: 'focusResult',
  },
  {
    target: 'focusResult.reward',
    route: 'focus',
    title: '퀘스트 보상받기',
    session: true,
    mutate: spot,
    steps: [
      { click: '집중 종료' },
      { js: "document.querySelector('[data-testid=confirm-finish]').click()", settle: 900 },
      { click: '배 타고 우리 섬으로', settle: 600 },
    ],
    expectRoute: 'focusResult',
  },
  { target: 'returnTravel', route: 'returnTravel', title: '우리 섬으로 귀환 항해', delay: 900 },

  // ── 축음기 ──
  {
    target: 'sound',
    route: 'sound',
    title: '축음기',
    mutate: (s, is) => {
      is.playing = true;
    },
    steps: [{ scroll: 'bottom' }],
  },
  {
    target: 'sound.empty',
    route: 'sound',
    title: '축음기 · 보유곡 없음',
    mutate: (s, is) => {
      is.sharedOwned = [];
      is.track = '';
    },
  },
  { target: 'sound.buyConfirm', route: 'sound', title: '음원 구매 확인', steps: [{ js: 'window.__clickBuyRow()' }] },
  {
    target: 'sound.buySuccess',
    route: 'sound',
    title: '음원 구매 완료',
    steps: [{ js: 'window.__clickBuyRow()' }, { js: 'window.__clickBuyConfirm()', settle: 500 }],
  },
  {
    target: 'sound.buyError',
    route: 'sound',
    title: '물고기 부족 안내',
    mutate: (s, is) => {
      is.fish = 3;
    },
    steps: [{ js: 'window.__clickBuyRow()' }, { js: 'window.__clickBuyConfirm()', settle: 500 }],
  },

  // ── 스크린타임 권한 (st = 네이티브 모듈 응답 흉내) ──
  {
    target: 'screenTimeApps',
    route: 'screenTimeApps',
    detail: 'settings',
    title: '측정 앱 고르기 시트',
    st: { status: 'approved', selection: picked },
  },
  {
    target: 'screenTimeApps.boardFirst',
    route: 'screenTimeApps',
    detail: BOARD_FIRST,
    title: '측정 앱 고르기 · 게시판 첫 진입',
    st: { status: 'approved', autoDelay: 600000 },
  },
  {
    target: 'permission',
    route: 'permission',
    detail: BOARD_FIRST,
    title: '측정 권한 시트(미연결, 게시판 우선 안내)',
    st: { status: 'notDetermined' },
  },
  { target: 'permission.denied', route: 'permission', title: '측정 권한 - 거부됨', st: { status: 'denied' } },
  { target: 'permission.approved', route: 'permission', title: '측정 권한 - 연결됨', st: { status: 'approved' } },
  { target: 'permission.unavailable', route: 'permission', title: '측정 권한 - 사용 불가 기기' },
  {
    target: 'permission.appManager',
    route: 'permission',
    detail: 'settings',
    title: '앱 권한 관리 시트',
    st: { status: 'approved', selection: picked },
  },
];

// 황금 물고기 컷신: ?demo&golden-test 주소에서만 집중 0.9초 뒤 영상이 뜬다(CurrentScreens.tsx:137,1688)
const golden = [0.6, 1.5, 3, 5].map((sec) => ({
  target: 'focus.goldenFishCutscene@' + sec,
  route: 'focus',
  title: `황금 물고기 컷신 +${sec}s`,
  session: true,
  mutate: spot,
  delay: 900 + sec * 1000,
}));

// 축음기 목록에서 첫 미보유 곡 행 / 구매 확인 버튼 누르기 (곡 이름·가격에 기대지 않게 접근성 이름 끝말로 찾는다)
const helpers = `
window.__clickBuyRow = () => [...document.querySelectorAll('[role=button]')].find((b) => /마리로 구매$/.test(b.getAttribute('aria-label') || '')).click();
window.__clickBuyConfirm = () => [...document.querySelectorAll('[role=button]')].find((b) => /마리로 구매$/.test(b.innerText.trim())).click();
`;
module.exports = (process.env.CAPTURE_GOLDEN ? golden : shots).map((c) => ({
  name_: c.target,
  ...c,
  steps: c.steps && [{ js: helpers, settle: 0 }, ...c.steps],
}));
