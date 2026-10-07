// 마을회관 묶음(섬 정보·가계부·건설) — targets-hall.json 의 대상 id 를 name_ 으로 쓴다. 한 줄 = 한 장.
// 실행: node capture-hall.cjs   (기본값이 이 설정 + ../shots/hall)
//   capture-hall.cjs = capture.cjs + 번들 패치 2개. 건설 청사진 장(construction.*)은 그 패치가 있어야 찍힌다:
//   (1) QA 전 건물 완공 강제(TESTFLIGHT_ALL_BUILDINGS) 끄기  (2) 목업 모드 청사진 패널 크래시(Hall.tsx:1576) 우회
// 제외(웹 목업에서 도달 불가): manage.inviteShare(OS 공유 시트), construction.allDone(서버 옵션 전용)

// 내가 주민(방장 아님)이 되게: 첫 주민(민지)을 방장으로
const resident = (s, is) => {
  is.members[0].role = 'host';
};
// 가계부 내역 — 목업 원장은 "제목 ±N마리" 문자열. 제목은 서버 모드 사유 표기와 같게 맞춘다
const ledgerRows = (s, is) => {
  const d = 86400000,
    now = Date.now();
  is.fish = 1200;
  is.ledger = [
    ['집중 적립 +84마리', 0],
    ['공동 구매 −100마리', 1],
    ['퀘스트 보상 +10마리', 2],
    ['건설 사용 −1,360마리', 3],
    ['집중 적립 +126마리', 4],
  ].map(([text, ago], n) => ({ id: 'l' + n, text, at: now - ago * d }));
};
// 건설 초반: 회관·게시판만 완공 → 격자에 도서관·전망대·우체통·축음기(고를 수 있음) + 상점(잠금)
const early = (s, is) => {
  is.buildings = ['hall', 'board'];
};
const earlyResident = (s, is) => {
  is.buildings = ['hall', 'board'];
  is.members[0].role = 'host';
};
// 축음기(1,360마리 · 각자 몫 340)를 목표로 물고기 모으는 중 — 민지만 몫을 채움
const collecting = (s, is) => {
  is.buildings = ['hall', 'board'];
  is.earned = { me: 320, minji: 360, dubu: 200, sua: 165 };
  is.buildingQuest = {
    building: 'gram',
    targets: ['me', 'minji', 'dubu', 'sua'],
    selectedAt: Date.now() - 86400000,
    base: {},
  };
};
// 축음기 공사 중(30분 중 10분 지남)
const building = (s, is) => {
  is.buildings = ['hall', 'board'];
  is.fish = 140;
  is.construction = {
    building: 'gram',
    startedAt: Date.now() - 10 * 60000,
    endsAt: Date.now() + 20 * 60000,
    cost: 1360,
  };
};
const openEdit = { click: '섬 정보 수정' };

module.exports = [
  { route: 'hall', title: '마을회관 책상 장면', name_: 'hall' },
  { route: 'manage', title: '섬 정보 카드 (방장 뷰)', name_: 'manage' },
  { route: 'manage', title: '섬 정보 카드 (주민 뷰)', mutate: resident, name_: 'manage.resident' },
  {
    // LOAD 가 구경 상태를 지우므로 홈을 연 뒤 VISIT 을 보내고, 상태 없이 manage 로 간다
    route: 'home',
    expectRoute: 'manage',
    title: '섬 정보 카드 (방문자 뷰 · 딸기 섬 구경 중)',
    steps: [
      { dispatch: { type: 'VISIT', id: 'strawberry' } },
      { js: "window.__gromoReview.open('manage', { guideStep: 99 })", settle: 600 },
    ],
    name_: 'manage.visitor',
  },
  { route: 'manage', title: '섬 정보 수정 패널', steps: [openEdit], name_: 'manage.edit' },
  {
    route: 'manage',
    title: '주민 정원 선택창(휠)',
    steps: [openEdit, { click: '주민 정원', settle: 500 }],
    name_: 'manage.capacityDialog',
  },
  {
    route: 'manage',
    title: '방장 위임 — 주민 선택 패널',
    steps: [openEdit, { click: '방장 위임' }],
    name_: 'manage.transfer',
  },
  {
    route: 'manage',
    title: '방장 위임 확인창',
    steps: [openEdit, { click: '방장 위임' }, { click: '민지에게 방장 위임' }],
    name_: 'manage.transferConfirm',
  },
  {
    route: 'manage',
    title: '주민 관리 선택창',
    steps: [{ click: '민지 관리' }],
    name_: 'manage.memberMenu',
  },
  {
    route: 'manage',
    title: '주민 내보내기 확인창',
    steps: [{ click: '민지 관리' }, { click: '섬에서 내보내기' }],
    name_: 'manage.kickConfirm',
  },
  {
    route: 'manage',
    title: '섬 탈퇴 확인창 (주민)',
    mutate: resident,
    steps: [{ click: '섬 탈퇴' }],
    name_: 'manage.leaveConfirm',
  },
  { route: 'ledger', title: '공동 가계부 (잔액 책갈피)', mutate: ledgerRows, name_: 'ledger' },
  {
    route: 'ledger',
    title: '공동 가계부 — 적립 책갈피',
    mutate: ledgerRows,
    steps: [{ click: '적립' }],
    name_: 'ledger.earnTab',
  },
  {
    route: 'ledger',
    title: '공동 가계부 — 지출 책갈피',
    mutate: ledgerRows,
    steps: [{ click: '지출' }],
    name_: 'ledger.spendTab',
  },
  { route: 'ledger', title: '공동 가계부 — 내역 없음', name_: 'ledger.empty' },
  { route: 'construction', title: '목각 건물 고르기 (건물 카드 격자)', mutate: early, name_: 'construction' },
  {
    route: 'construction',
    title: '청사진 패널 — 목표로 정할 수 있음',
    mutate: early,
    steps: [{ click: '축음기' }],
    name_: 'construction.plan',
  },
  {
    route: 'construction',
    title: '청사진 패널 — 선택 불가 안내 (주민)',
    mutate: earlyResident,
    steps: [{ click: '축음기' }],
    name_: 'construction.planBlocked',
  },
  {
    route: 'construction',
    title: '청사진 패널 — 목표로 물고기 모으는 중',
    mutate: collecting,
    steps: [{ click: '축음기' }],
    name_: 'construction.planCollect',
  },
  {
    route: 'construction',
    title: '청사진 패널 — 공사 중',
    mutate: building,
    steps: [{ click: '축음기 공사 중' }],
    name_: 'construction.planBuilding',
  },
  {
    route: 'construction',
    // 기본 목업(전 건물 완공). 상점 카드는 청사진 패널 아래에 남아 '완공' 딱지가 함께 보인다
    title: '청사진 패널 — 완공',
    steps: [{ click: '상점 완공' }],
    name_: 'construction.planDone',
  },
  {
    route: 'construction',
    title: '건설 목표 변경 확인창',
    mutate: collecting,
    steps: [{ click: '도서관' }, { click: '이 건물을 목표로 정하기' }],
    name_: 'construction.changeGoalConfirm',
  },
];
