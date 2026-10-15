// 전망대·다른 섬 구경·우체통·친구·채팅 묶음. 한 줄 = 한 장, name_ = 대상 id (→ shots/final/<id>.png)
// 실행: CAPTURE_CONFIG=cfg-tower-mail.cjs CAPTURE_OUT=../shots/tower-mail node $SK/capture.cjs   (SK = 스킬의 scripts 폴더 — 공용 하네스는 이 폴더에 없다)
//
// 주의: 검색어(search)는 __gromoReview.open 이 지우지 않는다. 그래서 검색어를 넣는 장은 맨 뒤에 모았다.
// (CAPTURE_IDS 로 한 장만 다시 찍을 때는 새 페이지라 상관없다.)

// 받은 편지 두 통(새봄·민지가 보냄, 아직 안 읽음)
const LETTERS = `
  const t = Date.now();
  s.friends[0].messages.push({ id: 'l1', memberId: 'saebom', name: '새봄', color: 'white',
    text: '오늘 우리 섬에 벚꽃이 피었어. 시험 끝나면 놀러 와! 같이 낚시하자.', at: t - 40 * 60000, status: 'sent' });
  s.friends[1].messages.push({ id: 'l2', memberId: 'minji', name: '민지', color: 'ginger',
    text: '어제 같이 집중해 줘서 고마워. 덕분에 끝까지 했어.', at: t - 3 * 3600000, status: 'sent' });
`;
const withLetters = `(s, is) => { ${LETTERS} }`;
// 딸기 섬을 구경 중인 상태(항해 도착 때 VISIT 액션이 남기는 값)
// 목업 주민 기록은 끝 시각이 '만든 순간'이다. 앱 시계(e.now)가 그보다 조금 늦으면 평균이 1분 모자라게 나와
// 전망대(15분)와 미리보기 시트(16분)가 어긋난다 → 기록을 5초 과거로 밀어 두 화면 숫자를 맞춘다.
const AGED = `s.islands.forEach((i) => i.members.forEach((m) => m.records.forEach((r) => { r.at -= 5000; })));`;
const VISITING = `s.visitingIslandId = 'strawberry';`;

module.exports = [
  // ── 전망대·섬 구경 ──
  { name_: 'travel', route: 'travel', title: '섬 사이 항해', detail: 'strawberry', delay: 900 },
  {
    // 처음 화면은 왼쪽 주민(민지)이 화면 밖에 걸친다 → 지도를 오른쪽으로 70px 끌어 둘 다 보이게 한다
    name_: 'focusVisit',
    route: 'focusVisit',
    title: '내 섬 낚시섬 구경',
    delay: 2500,
    steps: [{ drag: [200, 300, 270, 300] }],
  },
  {
    name_: 'focusVisit.empty',
    route: 'focusVisit',
    title: '낚시섬 구경 · 낚시 중인 주민 없음',
    mutate: `(s, is) => { is.members.forEach((m) => { m.focusing = false; }); }`,
    delay: 1200,
  },
  {
    name_: 'visitIslandFocus',
    route: 'visitIslandFocus',
    title: '방문한 섬의 낚시섬 구경',
    detail: 'strawberry',
    mutate: `(s, is) => { ${VISITING} }`,
    delay: 2500,
    steps: [{ drag: [200, 300, 270, 300] }],
  },
  {
    name_: 'visitIslandFocus.empty',
    route: 'visitIslandFocus',
    title: '방문 섬 낚시섬 · 낚시 중인 주민 없음',
    detail: 'strawberry',
    mutate: `(s, is) => { ${VISITING} s.islands[1].members.forEach((m) => { m.focusing = false; }); }`,
    delay: 1200,
  },
  { name_: 'tower', route: 'tower', title: '전망대 (섬 간 주간 랭킹 시트)', mutate: `(s, is) => { ${AGED} }` },
  {
    name_: 'tower.rankEmpty',
    route: 'tower',
    title: '전망대 — 순위 없음',
    // 순위에는 주민 2명 이상인 섬만 오른다 → 모든 섬을 1명 이하로
    mutate: `(s, is) => { s.islands.forEach((i) => { i.members = i.joined ? [] : i.members.slice(0, 1); }); }`,
  },
  { name_: 'explore', route: 'explore', title: '섬 찾기 (이름·초대 코드 검색 시트)' },
  {
    name_: 'visit',
    route: 'visit',
    title: '바다 건너 섬 (미가입 섬 미리보기 시트)',
    detail: 'strawberry',
    mutate: `(s, is) => { ${AGED} }`,
  },
  {
    name_: 'visit.joinedIsland',
    route: 'visit',
    title: '바다 건너 섬 — 내가 소속된 다른 섬',
    detail: 'strawberry',
    mutate: `(s, is) => { ${AGED} s.islands[1].joined = true; }`,
  },
  {
    // 실제 흐름 그대로: 미리보기 시트 → '섬 둘러보기' → 항해(약 1.9초) → 자동 도착
    name_: 'visitIsland',
    route: 'visit',
    expectRoute: 'visitIsland',
    title: '다른 섬 구경 중 (읽기 전용 섬 화면)',
    detail: 'strawberry',
    steps: [{ click: '섬 둘러보기' }, { waitText: '구경 중' }, { wait: 1200 }],
  },

  // ── 우체통·채팅 ──
  { name_: 'mail', route: 'mail', title: '우체통 (열린 우체통 — 세 칸)', mutate: withLetters },
  { name_: 'chat', route: 'chat', title: '우리 섬 채팅방' },
  {
    name_: 'chat.empty',
    route: 'chat',
    title: '우리 섬 채팅방 — 글 없음',
    mutate: `(s, is) => { is.messages = []; }`,
  },
  { name_: 'mail.inbox', route: 'mail', title: '받은 편지함', tab: '받은 편지', mutate: withLetters },
  { name_: 'mail.inboxEmpty', route: 'mail', title: '받은 편지함 — 편지 없음', tab: '받은 편지' },
  { name_: 'mail.letter', route: 'mail', title: '받은 편지 상세', detail: 'l1', mutate: withLetters },
  { name_: 'friendMail', route: 'friendMail', title: '편지 보낼 친구 선택', detail: 'list' },
  {
    name_: 'friendMail.noFriends',
    route: 'friendMail',
    title: '편지 보낼 친구 선택 — 친구 없음',
    detail: 'list',
    mutate: `(s, is) => { s.friends = []; }`,
  },
  { name_: 'friendMail.compose', route: 'friendMail', title: '친구에게 편지 쓰기', detail: 'saebom' },

  // ── 친구 관리 ──
  { name_: 'friends', route: 'friends', title: '친구 관리' },
  {
    name_: 'friends.empty',
    route: 'friends',
    title: '친구 관리 — 요청·친구 없음',
    mutate: `(s, is) => { s.friends = []; }`,
  },
  {
    name_: 'friends.deleteConfirm',
    route: 'friends',
    title: '친구 삭제 확인창',
    steps: [{ click: '친구 삭제' }],
  },

  // ── 검색어를 넣는 장(뒤에 모음) ──
  {
    name_: 'explore.noResults',
    route: 'explore',
    title: '섬 찾기 — 검색 결과 없음',
    steps: [{ fill: ['섬 이름이나 초대 코드', '고래 섬'] }],
  },
  {
    // 목업 사용자 중 '보리' 가 두 명: 관계 없음(친구 요청) + 내가 요청 보낸 사람(요청 취소)
    name_: 'friends.searchResults',
    route: 'friends',
    title: '친구 관리 — 닉네임 검색 결과',
    steps: [{ fill: ['닉네임으로 친구 찾기', '보리'] }],
  },
  {
    name_: 'friends.searchNoResults',
    route: 'friends',
    title: '친구 관리 — 검색 결과 없음',
    steps: [{ fill: ['닉네임으로 친구 찾기', '고등어'] }],
  },
];
