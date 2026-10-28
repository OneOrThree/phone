// 게시판·도서관 묶음. 한 줄 = 한 장. name_ = 대상 id (final 로 복사할 때 그대로 쓴다)
// 기본 목업: 소다 섬, 내가 방장(주민 중 host 가 없으면 내가 방장), 건물 전부 완공.
//
// 다시 찍는 법 (S = workflow 폴더, SK = 스킬의 scripts 폴더, 전부 CAPTURE_CONFIG=이 파일 CAPTURE_OUT=S/shots/board-library):
//   1) node $SK/capture.cjs                                         — 전체 (공용 하네스 — 이 폴더가 아니라 스킬 scripts/ 에 있다)
//   2) CAPTURE_IDS=007,008,009,010,011 node capture-board-library.cjs — 청사진: App.tsx 의 임시 QA 설정
//      (TESTFLIGHT_ALL_BUILDINGS)이 섬을 항상 '건물 전부 완공'으로 되돌려서, 그 dispatch 를 끈 사본으로 찍는다
//   3) CAPTURE_WEEKDAY=6 CAPTURE_IDS=026,027,028,029,030,031,032,033,034,035,036 node capture-board-library.cjs
//      — 일기장: 주 보기가 '오늘까지'만 막대를 그려서, 날짜를 이번 주 토요일로 밀어 7일치를 채운다

// 도서관을 다음 목표로 잡은 섬 (청사진 패널용). earned = 주민별 모은 양, fish = 섬 잔액
const libraryGoal = (earned, fish) =>
  new Function(
    's',
    'is',
    `is.buildings = ['hall', 'board', 'gram'];
     is.buildingQuest = { building: 'library', targets: ['me', 'minji', 'dubu', 'sua'], selectedAt: Date.now(), base: { me: 0, minji: 0, dubu: 0, sua: 0 } };
     is.earned = ${JSON.stringify(earned)};
     is.fish = ${fish};`,
  );
const ready = libraryGoal({ me: 700, minji: 680, dubu: 690, sua: 680 }, 3000);

// 최근 7일 폰 사용 기록 (KST 날짜 키)
const screenWeek = (s) => {
  // 하네스 기본 기록은 끝난 시각이 '지금'이라 화면의 now 보다 몇 ms 늦으면 30분이 29분으로 잘린다 → 10분 전으로
  s.records[0].at -= 600000;
  s.screenDays = {};
  [84, 132, 97, 155, 61, 120, 143].forEach((m, i) => {
    s.screenDays[new Date(Date.now() + 9 * 3600000 - i * 86400000).toISOString().slice(0, 10)] = m;
  });
};

module.exports = [
  // ── 게시판 ──────────────────────────────────────────────
  { route: 'board', title: '게시판 내부 장면 (종이 닫힘)', records: false, name_: 'board' },
  { route: 'board', title: '공지 목록 종이', records: false, tab: '공지', name_: 'board.noticeTab' },
  {
    route: 'board',
    title: '공지 목록 — 비어 있음',
    records: false,
    tab: '공지',
    mutate: (s, is) => {
      is.notices = [];
    },
    name_: 'board.noticeTabEmpty',
  },
  { route: 'board', title: '퀘스트 목록 종이', records: false, tab: '퀘스트', name_: 'board.questTab' },
  {
    route: 'board',
    title: '퀘스트 목록 — 비어 있음',
    records: false,
    tab: '퀘스트',
    mutate: (s, is) => {
      is.quests = [];
    },
    name_: 'board.questTabEmpty',
  },
  { route: 'board', title: '청사진 — 목표 건물 없음', records: false, tab: '청사진', name_: 'board.blueprintNone' },
  {
    route: 'board',
    title: '청사진 — 물고기 모으는 중',
    records: false,
    tab: '청사진',
    mutate: libraryGoal({ me: 680, minji: 520, dubu: 340, sua: 165 }, 1200),
    name_: 'board.blueprintWaiting',
  },
  {
    route: 'board',
    title: '청사진 — 건설 가능',
    records: false,
    tab: '청사진',
    mutate: ready,
    name_: 'board.blueprintReady',
  },
  {
    route: 'board',
    title: '청사진 — 공사 중',
    records: false,
    tab: '청사진',
    mutate: (s, is) => {
      is.buildings = ['hall', 'board', 'gram'];
      is.construction = {
        building: 'library',
        startedAt: Date.now() - 21 * 60000,
        endsAt: Date.now() + 39 * 60000,
        cost: 2720,
      };
    },
    name_: 'board.blueprintBuilding',
  },
  {
    route: 'board',
    title: '청사진 — 완공',
    records: false,
    tab: '청사진',
    mutate: (s, is) => {
      is.buildings = ['hall', 'board', 'gram', 'library'];
      is.completed = { building: 'library', at: Date.now() };
    },
    name_: 'board.blueprintComplete',
  },
  {
    route: 'board',
    title: '건물 짓기 확인창',
    records: false,
    tab: '청사진',
    mutate: ready,
    steps: [{ click: '건설하기' }],
    name_: 'board.buildConfirm',
  },
  { route: 'board', title: '퀘스트 달성 보상 모달', name_: 'board.rewardModal' },
  {
    route: 'board',
    title: '전원 달성 보너스 모달',
    // 주민 전원이 오늘 30분을 채운 상태 → 개인 보상을 받으면 보너스 알림이 이어진다
    mutate: (s, is) => {
      is.members.forEach((m) => m.records.forEach((r) => (r.seconds = 2400)));
    },
    steps: [{ waitText: '보상받기' }, { click: '보상받기' }, { waitText: '모두 해냈어요!' }],
    name_: 'board.bonusRewardModal',
  },
  { route: 'notice', title: '공지 상세', records: false, detail: 'welcome', name_: 'notice' },
  {
    route: 'notice',
    title: '공지 상세 — 댓글 입력 열림',
    records: false,
    detail: 'welcome',
    // 입력칸 아래 '등록 →' 이 종이 밖으로 밀려 있어, 그 버튼이 보일 만큼만 종이 안쪽을 내린다
    steps: [
      { click: '+ 댓글 쓰기' },
      {
        js: `(() => {
          const btn = [...document.querySelectorAll('div')].filter((e) => e.innerText === '등록 →').pop();
          let sc = btn.parentElement;
          while (sc && !(sc.scrollHeight > sc.clientHeight + 5 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
          const d = btn.getBoundingClientRect().bottom - sc.getBoundingClientRect().bottom;
          if (d > 0) sc.scrollTop += d + 12;
        })()`,
      },
    ],
    name_: 'notice.comment',
  },
  {
    // LOAD 가 구경 상태를 지우므로: 홈을 연 뒤 VISIT 을 보내고, 상태 없이 다시 연다
    route: 'home',
    expectRoute: 'notice',
    title: '공지 상세 — 방문자(읽기 전용)',
    records: false,
    mutate: (s) => {
      s.islands[1].notices[0].comments = [];
    },
    steps: [
      { dispatch: { type: 'VISIT', id: 'strawberry' } },
      { js: "window.__gromoReview.open('notice', { detail: 'welcome', guideStep: 99 })", settle: 600 },
    ],
    name_: 'notice.visitor',
  },
  {
    route: 'notice',
    title: '공지 삭제 확인창',
    records: false,
    detail: 'welcome',
    steps: [{ click: '삭제' }],
    name_: 'notice.deleteConfirm',
  },
  {
    route: 'notice',
    title: '댓글 삭제 확인창',
    records: false,
    detail: 'welcome',
    steps: [{ click: '삭제', nth: 1 }],
    name_: 'notice.commentDeleteConfirm',
  },
  {
    route: 'board',
    expectRoute: 'noticeEdit',
    title: '공지 쓰기',
    records: false,
    tab: '공지',
    steps: [{ click: '+ 새 공지' }],
    name_: 'noticeEdit',
  },
  {
    route: 'notice',
    expectRoute: 'noticeEdit',
    title: '공지 수정',
    records: false,
    detail: 'welcome',
    steps: [{ click: '수정' }],
    name_: 'noticeEdit.edit',
  },
  {
    route: 'quest',
    title: '퀘스트 상세 (주민별 달성률)',
    records: false,
    detail: 'q-focus',
    // 오늘 20분 집중 → 내 달성률 66% (목표 미달이라 보상 팝업 없음)
    mutate: (s) => {
      s.records = [{ id: 'r0', islandId: s.islandId, subject: '수학 문제 풀기', seconds: 1200, at: Date.now(), fish: 20, contributed: false }];
    },
    name_: 'quest',
  },
  { route: 'quest', title: '퀘스트 목록 (홈 쪽지로 진입)', records: false, detail: 'home-quest-list', name_: 'quest.homeList' },
  {
    route: 'board',
    expectRoute: 'questEdit',
    title: '퀘스트 만들기',
    records: false,
    tab: '퀘스트',
    steps: [{ click: '+ 만들기' }],
    name_: 'questEdit',
  },
  {
    route: 'quest',
    expectRoute: 'questEdit',
    title: '퀘스트 수정',
    records: false,
    detail: 'q-focus',
    steps: [{ click: '수정' }],
    name_: 'questEdit.edit',
  },

  // ── 도서관 ──────────────────────────────────────────────
  { route: 'library', title: '도서관 원탁 (책 두 권)', name_: 'library' },
  { route: 'diary', title: '내 일기장 — 주 · 집중', mutate: screenWeek, name_: 'diary' },
  {
    route: 'diary',
    title: '내 일기장 — 주 · 폰 사용',
    mutate: screenWeek,
    steps: [{ label: '폰 사용' }],
    name_: 'diary.weekPhone',
  },
  {
    route: 'diary',
    title: '내 일기장 — 일 · 집중',
    mutate: screenWeek,
    steps: [{ click: '일' }],
    name_: 'diary.dayFocus',
  },
  {
    route: 'diary',
    title: '내 일기장 — 일 · 폰 사용',
    mutate: screenWeek,
    steps: [{ click: '일' }, { label: '폰 사용' }],
    name_: 'diary.dayPhone',
  },
  {
    route: 'diary',
    title: '내 일기장 — 월 달력',
    mutate: screenWeek,
    steps: [{ click: '월' }],
    name_: 'diary.month',
  },
  { route: 'diary', title: '내 일기장 — 집중 기록 없음', records: false, name_: 'diary.focusEmpty' },
  {
    route: 'diary',
    title: '내 일기장 — 측정 권한 없음',
    noPermission: true,
    steps: [{ label: '폰 사용' }],
    name_: 'diary.phoneNoPermission',
  },
  {
    route: 'diary',
    title: '내 일기장 — 폰 사용 기록 없음',
    mutate: (s) => {
      s.settings.screenTimeMeasurementReady = false;
    },
    steps: [{ label: '폰 사용' }],
    name_: 'diary.phoneNoData',
  },
  { route: 'diary', title: '이웃들의 일기장 — 주민 목록', detail: 'residents', name_: 'diary.neighbors' },
  {
    route: 'diary',
    title: '이웃들의 일기장 — 이웃 없음',
    detail: 'residents',
    mutate: (s, is) => {
      is.members = [];
    },
    name_: 'diary.neighborsEmpty',
  },
  {
    route: 'diary',
    title: '이웃 일기장 상세',
    detail: 'residents',
    steps: [{ click: '민지 기록' }],
    name_: 'diary.neighborDetail',
  },
];
