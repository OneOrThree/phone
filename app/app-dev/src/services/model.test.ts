import assert from 'node:assert/strict';
import {
  initialState,
  reducer,
  currentIsland,
  canBuild,
  canBuy,
  products,
  questRate,
  sessionSeconds,
  capacityOf,
  isFull,
  islandWeeklyAverage,
  hoursMinutes,
  balance,
  buildingReady,
  buildingCost,
  buildingShare,
  collectedBy,
  costs,
  buildMinutes,
  dayKey,
  findIslandByInviteCode,
  inviteCodeOf,
} from '@/services/model';
const act = (s: ReturnType<typeof initialState>, type: string, data = {}) =>
  reducer(s, { type, ...data });
test('휴식은 집중에서 제외, 보상은 집중한 섬에만 적립하고 종료 중복을 막는다', () => {
  let s = initialState(true);
  s = act(s, 'START', { subject: '수학', now: 1000 });
  s = act(s, 'PAUSE', { now: 301000 });
  assert.equal(sessionSeconds(s.session, 901000), 300);
  s = act(s, 'RESUME', { now: 901000 });
  s = act(s, 'FINISH', { now: 1201000 });
  assert.equal(s.records[0].seconds, 600);
  assert.equal(balance(currentIsland(s)), 1210);
  assert.equal(currentIsland(s).earned?.me, 330);
  assert.equal(s.fish, 0);
  assert.deepEqual(act(s, 'FINISH'), s);
});
test('회관→게시판은 섬 인원과 무관한 총량 고정; 차감 후 공사 시간 동안 후속 건설을 막는다', () => {
  let s = act(initialState(), 'CREATE_ISLAND', { name: '건설 섬' });
  s = act(s, 'DEMO_CREDIT', { fish: 300 });
  assert.ok(canBuild(s, 'board'));
  s = act(s, 'BUILD', { building: 'hall', now: 1000 });
  assert.equal(balance(currentIsland(s)), 300 - costs.hall);
  assert.deepEqual(currentIsland(s).buildings, []);
  assert.ok(canBuild(s, 'board'));
  s = act(s, 'TICK', { now: 60999 });
  assert.deepEqual(currentIsland(s).buildings, []);
  s = act(s, 'TICK', { now: 61000 });
  assert.deepEqual(currentIsland(s).buildings, ['hall']);
  s = act(s, 'BUILD', { building: 'board', now: 62000 });
  assert.equal(balance(currentIsland(s)), 300 - costs.hall - costs.board);
  s = act(s, 'TICK', { now: 62000 + buildMinutes.board * 60000 });
  assert.ok(currentIsland(s).buildings.includes('board'));
});
test('도서관을 자유 선택: 목표를 고른 뒤 각자 몫을 모아야 하고 공동 잔액도 필요, 차감은 건설 버튼에서만', () => {
  let s = initialState(true);
  currentIsland(s).buildings = ['hall', 'board', 'gram'];
  currentIsland(s).fish = 3000;
  s = act(s, 'SELECT_BUILDING', { building: 'library' });
  assert.equal(buildingCost(currentIsland(s), 'library'), costs.library);
  // 선택 직후에는 아무도 몫을 모으지 않아 아직 준비되지 않는다
  assert.ok(!buildingReady(currentIsland(s)));
  const share = buildingShare(currentIsland(s), 'library');
  let i = currentIsland(s);
  for (const id of i.buildingQuest!.targets) i.earned![id] = (i.earned![id] ?? 0) + share;
  assert.ok(buildingReady(currentIsland(s)));
  s = act(s, 'BUILD', { building: 'library', now: 1000 });
  assert.equal(balance(currentIsland(s)), 3000 - costs.library);
  assert.equal(currentIsland(s).construction?.endsAt, 1000 + buildMinutes.library * 60000);
  assert.ok(!currentIsland(s).buildings.includes('library'));
  assert.deepEqual(act(s, 'SELECT_BUILDING', { building: 'mail' }), s);
  assert.deepEqual(act(s, 'BUILD', { building: 'library' }), s);
  s = act(s, 'TICK', { now: 1000 + buildMinutes.library * 60000 });
  assert.ok(currentIsland(s).buildings.includes('library'));
  assert.equal(currentIsland(s).buildingQuest, undefined);
});
test('목표 변경 시 계속 대상인 주민은 모은 양을 이어가고, 새로 대상에 들어온 주민은 0부터 시작한다', () => {
  let s = initialState(true);
  currentIsland(s).buildings = ['hall', 'board'];
  s = act(s, 'SELECT_BUILDING', { building: 'library' });
  let i = currentIsland(s);
  // "나"만 도서관 목표에서 몫만큼 모아 둔다
  const libraryShare = buildingShare(i, 'library');
  i.earned!.me = (i.earned!.me ?? 0) + libraryShare;
  s = act(s, 'ADD_MEMBER');
  assert.equal(currentIsland(s).buildingQuest?.targets.length, 4);
  s = act(s, 'SELECT_BUILDING', { building: 'gram' }); // 방장이 목표를 축음기로 변경
  i = currentIsland(s);
  assert.equal(i.buildingQuest?.targets.length, 5);
  // 목표 변경 전부터 계속 대상이던 "나"는 모은 양을 이어간다
  assert.equal(collectedBy(i, 'me'), libraryShare);
  // 목표 변경 시점에 새로 대상에 들어온 중도 가입자는 0부터 시작한다
  const newcomer = i.members.at(-1)!;
  assert.equal(collectedBy(i, newcomer.id), 0);
});
test('음원 구매로 잔액이 부족해지면 완료 상태가 없어지고 부족분만 다시 채운다', () => {
  let s = initialState(true);
  currentIsland(s).buildings = ['hall', 'board', 'gram'];
  currentIsland(s).fish = 2850;
  s = act(s, 'SELECT_BUILDING', { building: 'library' });
  const i = currentIsland(s);
  const share = buildingShare(i, 'library');
  // 대상 전원이 각자 몫만큼 이미 모아 둔 상태
  for (const id of i.buildingQuest!.targets) i.earned![id] = (i.earned![id] ?? 0) + share;
  assert.ok(buildingReady(currentIsland(s)));
  s = act(s, 'BUY', { id: 'rain' });
  assert.equal(balance(currentIsland(s)), 2700);
  assert.ok(!buildingReady(currentIsland(s)));
  assert.equal(currentIsland(s).earned?.me, 320 + share);
  s = act(s, 'DEMO_CREDIT', { fish: 20 });
  assert.ok(buildingReady(currentIsland(s)));
});
test('건물 총액은 섬 인원과 무관하게 고정이다 (GROMO-1829)', () => {
  const solo = initialState(true);
  currentIsland(solo).members = []; // 방장 혼자인 섬
  const full = initialState(true); // 방장 + 주민 3명인 섬
  for (const b of ['gram', 'library', 'mail', 'tower', 'shop'] as const) {
    assert.equal(buildingCost(currentIsland(solo), b), costs[b]);
    assert.equal(buildingCost(currentIsland(solo), b), buildingCost(currentIsland(full), b));
  }
});
test('목표를 고르기 전에 모은 earned는 몫에 포함되지 않는다', () => {
  let s = initialState(true);
  currentIsland(s).buildings = ['hall', 'board'];
  assert.equal(currentIsland(s).earned?.me, 320); // 이미 쌓여 있던 누적 획득량
  s = act(s, 'SELECT_BUILDING', { building: 'gram' });
  const i = currentIsland(s);
  assert.equal(i.earned?.me, 320); // 누적 자체는 그대로 남지만
  assert.equal(collectedBy(i, 'me'), 0); // 목표 선택 이후 모은 양은 0부터 시작한다
});
test('각자 몫은 총액을 대상 인원으로 올림 나눈 값이다', () => {
  let s = initialState(true);
  currentIsland(s).buildings = ['hall', 'board'];
  // 주민 2명을 빼서 대상 3명(나 포함)으로 만든다: 1360 ÷ 3 = 453.33 → 올림 454
  currentIsland(s).members = currentIsland(s).members.slice(0, 2);
  s = act(s, 'SELECT_BUILDING', { building: 'gram' });
  assert.equal(buildingShare(currentIsland(s), 'gram'), 454);
});
test('상점은 다른 시설 모두 완공 후에만 선택, 축음기 음원은 상점 없이 구매', () => {
  let s = initialState(true);
  currentIsland(s).buildings = ['hall', 'board', 'gram'];
  assert.deepEqual(act(s, 'SELECT_BUILDING', { building: 'shop' }), s);
  assert.equal(
    canBuy(
      s,
      products.find((p) => p.id === 'rain')!,
    ),
    null,
  );
  s = act(s, 'BUY', { id: 'rain' });
  assert.equal(balance(currentIsland(s)), 1050);
  assert.deepEqual(act(s, 'BUY', { id: 'rain' }), s);
  s = act(s, 'TRACK', { value: 'rain' });
  s = act(s, 'SETTING', { key: 'sound', value: false });
  assert.equal(currentIsland(s).playing, true);
});
test('의상은 섬 잔액으로 구매하고 개인 보유품으로 남긴다; 중복 결제·미보유 착용 방지', () => {
  let s = initialState(true);
  s = act(s, 'EQUIP', { key: 'clothes', value: 'scarf' });
  assert.equal(s.equipped.clothes, 'default');
  s = act(s, 'BUY', { id: 'scarf' });
  assert.equal(balance(currentIsland(s)), 1100);
  assert.ok(s.owned.includes('scarf'));
  assert.deepEqual(act(s, 'BUY', { id: 'scarf' }), s);
  s = act(s, 'LEAVE');
  assert.ok(s.owned.includes('scarf'));
  assert.equal(s.islands[0].fish, 1100);
  assert.deepEqual(act(s, 'BUY', { id: 'sailboat' }), s);
});
test('일일 퀘스트 개인 보상은 모달에서 10마리 1회, 전원 보너스는 즉시 1회', () => {
  let s = initialState(true);
  currentIsland(s).members = [];
  const now = new Date(2026, 8, 15, 12).getTime();
  s = act(s, 'START', { subject: '집중', now: now - 1800000 });
  s = act(s, 'FINISH', { now });
  assert.equal(balance(currentIsland(s)), 1235);
  const reward = s.rewards!.find((r) => r.kind === 'personal')!;
  assert.equal(reward.amount, 10);
  s = act(s, 'CLAIM', { id: reward.id, now });
  assert.equal(balance(currentIsland(s)), 1245);
  assert.deepEqual(act(s, 'CLAIM', { id: reward.id, now }), s);
  s = act(s, 'TICK', { now });
  assert.equal(balance(currentIsland(s)), 1245);
  s = act(s, 'TICK', { now: now + 86400000 });
  assert.deepEqual(currentIsland(s).quests[0].rounds?.[dayKey(now + 86400000)]?.achieved, []);
});
test('스크린타임은 다음 날 정산, 권한 없음·기록 없음은 0분으로 보상하지 않는다', () => {
  let s = initialState(true);
  currentIsland(s).members = [];
  const now = new Date(2026, 8, 15, 12).getTime();
  s = act(s, 'TICK', { now });
  assert.ok(!s.rewards?.some((r) => r.questId === 'q-screen'));
  s = act(s, 'TICK', { now: now + 86400000 });
  assert.ok(s.rewards?.some((r) => r.questId === 'q-screen' && r.kind === 'personal'));
  let no = initialState(true);
  no.settings.permission = false;
  no = act(no, 'TICK', { now });
  no = act(no, 'TICK', { now: now + 86400000 });
  assert.ok(!no.rewards?.some((r) => r.questId === 'q-screen'));
  assert.equal(questRate(no, currentIsland(no).quests[1]), null);
});
test('친구 수락·거절 후 재신청·보낸 요청 취소·친구 삭제·타 섬 편지 범위', () => {
  let s = initialState(true);
  s = act(s, 'FRIEND_ACCEPT', { id: 'haneul' });
  assert.equal(s.friends?.find((f) => f.id === 'haneul')?.status, 'friend');
  s = act(s, 'FRIEND_MESSAGE', { id: 'haneul', text: '다른 섬 안녕' });
  assert.equal(s.friends?.find((f) => f.id === 'haneul')?.messages.length, 1);
  assert.equal(currentIsland(s).messages.length, 2);
  s = act(s, 'FRIEND_DELETE', { id: 'haneul' });
  assert.deepEqual(act(s, 'FRIEND_MESSAGE', { id: 'haneul', text: '안녕' }), s);
  s = act(s, 'FRIEND_REQUEST', { id: 'haneul' });
  assert.equal(s.friends?.find((f) => f.id === 'haneul')?.status, 'sent');
  s = act(s, 'FRIEND_CANCEL', { id: 'haneul' });
  assert.equal(s.friends?.find((f) => f.id === 'haneul')?.status, 'none');
  let r = initialState(true);
  r = act(r, 'FRIEND_REJECT', { id: 'haneul' });
  r = act(r, 'FRIEND_REQUEST', { id: 'haneul' });
  assert.equal(r.friends?.find((f) => f.id === 'haneul')?.status, 'sent');
});
test('계정 삭제는 섬 물고기는 남기고 사용자 활동과 개인정보를 제거한다', () => {
  let s = initialState(true);
  const island = currentIsland(s);
  island.earned!.me = 999;
  island.ledger.push({ id: 'mine', text: `${s.name} 집중 보상`, at: 1 });
  island.ledger.push({ id: 'shared', text: '마을회관 공사 완료', at: 2 });
  island.notices.unshift({
    id: 'mine',
    title: '내 공지',
    body: '삭제 대상',
    author: s.name,
    comments: [],
  });
  island.notices[1].comments.push({ id: 'mine-comment', name: s.name, text: '내 댓글' });
  island.messages.push({
    id: 'mine',
    memberId: 'me',
    name: s.name,
    color: s.color,
    text: '내 메시지',
    at: 1,
    status: 'sent',
  });
  island.quests[0].rounds = {
    today: {
      targets: ['me', 'minji'],
      achieved: ['me'],
      claimed: ['me'],
      bonus: false,
      target: 30,
      kind: 'focus',
    },
  };
  island.buildingQuest = {
    building: 'hall',
    targets: ['me', 'minji'],
    selectedAt: 1,
    base: { me: 10, minji: 20 },
  };
  s = act(s, 'DELETE_ACCOUNT');
  const scrubbed = s.islands[0];
  assert.equal(scrubbed.fish, 1200);
  assert.equal(scrubbed.earned?.me, undefined);
  assert.deepEqual(
    scrubbed.ledger.map((entry) => entry.id),
    ['shared'],
  );
  assert.ok(!scrubbed.notices.some((notice) => notice.author === '수빈'));
  assert.ok(scrubbed.notices.every((notice) => notice.comments.every((c) => c.name !== '수빈')));
  assert.ok(scrubbed.messages.every((message) => message.memberId !== 'me'));
  assert.deepEqual(scrubbed.quests[0].rounds?.today.targets, ['minji']);
  assert.deepEqual(scrubbed.quests[0].rounds?.today.achieved, []);
  assert.deepEqual(scrubbed.quests[0].rounds?.today.claimed, []);
  assert.deepEqual(scrubbed.buildingQuest?.targets, ['minji']);
  assert.deepEqual(scrubbed.buildingQuest?.base, { minji: 20 });
  assert.equal(s.loggedIn, false);
  assert.deepEqual(s.records, []);
});
test('공지·댓글·그룹 편지 실패와 재시도', () => {
  let s = initialState(true);
  s = act(s, 'NOTICE_SAVE', { title: '내일', body: '함께 집중' });
  const id = currentIsland(s).notices[0].id;
  s = act(s, 'COMMENT', { id, text: '좋아요' });
  assert.equal(currentIsland(s).notices[0].comments.length, 1);
  s = act(s, 'NOTICE_DELETE', { id });
  assert.ok(!currentIsland(s).notices.some((n) => n.id === id));
  s = act(s, 'MESSAGE', { text: '반가워', fail: true });
  const m = currentIsland(s).messages.at(-1)!;
  assert.equal(m.status, 'failed');
  s = act(s, 'RETRY_MESSAGE', { id: m.id });
  assert.equal(currentIsland(s).messages.at(-1)!.status, 'sent');
});
test('승인 요청 1회 처리·방장 위임 이후 관리 제한', () => {
  let s = initialState(true);
  s = act(s, 'ADD_MEMBER');
  const n = currentIsland(s).members.length;
  assert.equal(currentIsland(act(s, 'ADD_MEMBER')).members.length, n);
  s = act(s, 'TRANSFER', { id: 'minji' });
  assert.deepEqual(act(s, 'KICK', { id: 'dubu' }), s);
  assert.deepEqual(act(s, 'MANAGE', { name: '변경' }), s);
  assert.deepEqual(act(s, 'QUEST_SAVE', { title: '변경', kind: 'focus', target: 10 }), s);
  assert.deepEqual(act(s, 'NOTICE_SAVE', { title: '변경', body: '내용' }), s);
  assert.deepEqual(act(s, 'NOTICE_DELETE', { id: 'welcome' }), s);
});

test('온보딩 전에는 숨은 가입 섬이 없고 초대 코드는 실제 섬 ID로 찾는다', () => {
  const s = initialState();
  assert.ok(s.islands.every((island) => !island.joined));
  const joined = act(s, 'JOIN', { id: 'strawberry' });
  assert.equal(joined.islandId, 'strawberry');
  assert.deepEqual(
    joined.islands.filter((island) => island.joined).map((island) => island.id),
    ['strawberry'],
  );
  const custom = { ...s.islands[0], id: 'custom-123', name: '새 섬' };
  s.islands.push(custom);
  assert.equal(inviteCodeOf(custom), 'CUSTOM-123');
  assert.equal(findIslandByInviteCode(s.islands, '  custom-123  ')?.id, custom.id);
});
test('다른 섬 승인·집중 중 이동 차단·직렬화 후 재개', () => {
  let s = initialState(true);
  s = act(s, 'JOIN', { id: 'cloud' });
  assert.equal(s.pendingIsland, 'cloud');
  assert.equal(s.islandId, 'soda');
  s = act(s, 'JOIN', { id: 'cloud', approved: true });
  assert.equal(s.islandId, 'cloud');
  s = act(s, 'START', { subject: '영어', target: 25 });
  assert.deepEqual(act(s, 'JOIN', { id: 'strawberry' }), s);
  const restored = JSON.parse(JSON.stringify(s));
  assert.deepEqual(restored, s);
  assert.equal(restored.session?.subject, '영어');
});

test('시간대 퀘스트는 설정 구간의 유효 시간만 산입', () => {
  const s = initialState(true);
  const at = new Date();
  at.setHours(20, 30, 0, 0);
  s.records = [
    {
      id: 'window-1',
      islandId: s.islandId,
      subject: '저녁',
      seconds: 3600,
      at: at.getTime(),
      fish: 60,
      contributed: false,
    },
  ];
  const q = {
    id: 'window-q',
    title: '20시 집중',
    type: 'focus' as const,
    target: 60,
    windowStart: '20:00',
    windowEnd: '21:00',
    claimed: false,
  };
  assert.equal(questRate(s, q), 50);
});
test('건물 외양은 구매한 시설별로 독립 적용', () => {
  let s = initialState(true);
  s = act(s, 'BUY', { id: 'strawberry-roof' });
  s = act(s, 'BUY', { id: 'strawberry-mail' });
  s = act(s, 'THEME', {
    kind: 'building',
    building: 'hall',
    value: 'strawberry-roof',
  });
  s = act(s, 'THEME', {
    kind: 'building',
    building: 'mail',
    value: 'strawberry-mail',
  });
  assert.equal(currentIsland(s).buildingThemes?.hall, 'strawberry-roof');
  assert.equal(currentIsland(s).buildingThemes?.mail, 'strawberry-mail');
  s = act(s, 'THEME', { kind: 'building', building: 'hall', value: 'default' });
  assert.equal(currentIsland(s).buildingThemes?.mail, 'strawberry-mail');
});

test('이전 목업의 선체·장식을 복원해도 기본 뗏목만 유지', () => {
  const legacy = initialState(true);
  legacy.equipped = { ...legacy.equipped, hull: 'cabinboat', decor: 'flag' };
  legacy.owned = ['scarf', 'flag', 'sailboat', 'cabinboat'];
  const restored = reducer(initialState(), { type: 'LOAD', state: legacy });
  assert.equal(restored.equipped.hull, 'raft');
  assert.equal(restored.equipped.decor, 'none');
  assert.deepEqual(restored.owned, ['scarf']);
  assert.equal(restored.fish, legacy.fish);
  assert.ok(products.every((p) => !['flag', 'sailboat', 'cabinboat'].includes(p.id)));
});

test('정원: 생성 기본 15·1~15 범위·주민 수 미만 불가·가득 찬 섬 가입 차단', () => {
  let s = initialState();
  s = act(s, 'CREATE_ISLAND', { name: '새 섬' });
  assert.equal(currentIsland(s).capacity, 15);
  s = act(s, 'CREATE_ISLAND', { name: '큰 섬', capacity: 40 });
  assert.equal(currentIsland(s).capacity, 15);
  // 최소 정원 1명: 방장 혼자 쓰는 섬
  s = act(s, 'CREATE_ISLAND', { name: '혼자 섬', capacity: 1 });
  assert.equal(currentIsland(s).capacity, 1);
  let f = initialState(true);
  // 소다 섬 주민 4명(나 포함) → 3명으로 줄일 수 없음, 16명도 불가
  assert.deepEqual(act(f, 'CAPACITY', { value: 3 }), f);
  assert.deepEqual(act(f, 'CAPACITY', { value: 16 }), f);
  f = act(f, 'CAPACITY', { value: 4 });
  assert.equal(currentIsland(f).capacity, 4);
  assert.ok(isFull(currentIsland(f)));
  assert.deepEqual(act(f, 'ADD_MEMBER'), f);
  const strawberry = f.islands.find((i) => i.id === 'strawberry')!;
  strawberry.capacity = 3;
  assert.deepEqual(act(f, 'JOIN', { id: 'strawberry' }), f);
  // 정원 필드가 없는 예전 저장본은 최대 정원 15명
  delete strawberry.capacity;
  assert.equal(capacityOf(strawberry), 15);
});

test('섬 평균 집중: 이번 주(일요일 시작) 그 섬 집중 합계 ÷ 주민 수', () => {
  const s = initialState(true);
  const now = new Date(2026, 8, 16, 12).getTime();
  for (const island of s.islands)
    for (const member of island.members)
      for (const record of member.records ?? []) record.at = now - 1000;
  const record = (id: string, islandId: string, seconds: number, at: number) => ({
    id,
    islandId,
    subject: '공부',
    seconds,
    at,
    fish: 0,
    contributed: false,
  });
  s.records = [
    record('sun', 'soda', 1800, new Date(2026, 8, 13, 9).getTime()),
    record('last-sat', 'soda', 3600, new Date(2026, 8, 12, 23).getTime()),
    record('other', 'strawberry', 900, now - 1000),
  ];
  // 소다 섬: 나 1800 + 민지 1320 + 두부 960 + 수아 600 = 4680 ÷ 4명
  assert.equal(islandWeeklyAverage(s, currentIsland(s), now), 1170);
  // 가입 전 딸기 섬: 주민 3명의 시간만
  assert.equal(islandWeeklyAverage(s, s.islands[1], now), 960);
  assert.equal(hoursMinutes(1170), '19분');
  assert.equal(hoursMinutes(15600), '4시간 20분');
});

test('카운트업 집중·첫 집중 후 회관 안내는 한 번만·예전 저장본은 표시 안 함', () => {
  let s = initialState();
  s = act(s, 'START', { subject: '첫 집중', target: 25, now: 1000 });
  assert.ok(!('target' in s.session!));
  s = act(s, 'FINISH', { now: 601000 });
  assert.equal(s.hallGuide, 'pending');
  s = act(s, 'HALL_GUIDE_DONE');
  assert.equal(s.hallGuide, 'done');
  s = act(s, 'START', { subject: '두 번째', now: 700000 });
  s = act(s, 'FINISH', { now: 1300000 });
  assert.equal(s.hallGuide, 'done');
  let built = initialState(true);
  built = act(built, 'START', { subject: '집중', now: 1000 });
  built = act(built, 'FINISH', { now: 601000 });
  assert.equal(built.hallGuide, undefined);
  // 필드 없는 예전 저장본(집중 기록 있음)은 다음 집중을 마쳐도 띄우지 않는다
  let legacy = reducer(initialState(), {
    type: 'LOAD',
    state: JSON.parse(JSON.stringify(s)),
  });
  delete legacy.hallGuide;
  legacy = act(legacy, 'START', { subject: '예전', now: 2000000 });
  legacy = act(legacy, 'FINISH', { now: 2600000 });
  assert.equal(legacy.hallGuide, undefined);
});

test('집중 1분마다 확정 적립, 종료·중복 TICK 시 같은 물고기를 다시 주지 않는다', () => {
  let s = initialState(true);
  const now = new Date(2026, 8, 15, 12).getTime();
  s = act(s, 'START', { subject: '공부', now });
  s = act(s, 'TICK', { now: now + 60000 });
  assert.equal(balance(currentIsland(s)), 1201);
  s = act(s, 'TICK', { now: now + 60000 });
  assert.equal(balance(currentIsland(s)), 1201);
  s = act(s, 'FINISH', { now: now + 120000 });
  assert.equal(balance(currentIsland(s)), 1202);
  assert.equal(s.lastResult?.fish, 2);
});
test('시간대 일일 퀘스트는 휴식이 낀 실제 집중 구간만 계산', () => {
  let s = initialState(true);
  currentIsland(s).members = [];
  const at = new Date(2026, 8, 15, 19).getTime();
  currentIsland(s).quests = [
    {
      id: 'q',
      title: '20시 집중',
      type: 'focus',
      target: 30,
      windowStart: '20:00',
      windowEnd: '21:00',
      claimed: false,
    },
  ];
  s = act(s, 'START', { subject: '공부', now: at });
  s = act(s, 'PAUSE', { now: at + 3600000 });
  s = act(s, 'RESUME', { now: at + 7200000 });
  s = act(s, 'FINISH', { now: at + 9000000 });
  assert.ok(!s.rewards?.some((r) => r.kind === 'personal'));
});
test('일요일 00시 이전 주민 기록도 새 주간 랭킹에 남기지 않는다', () => {
  const s = initialState(true);
  const before = new Date(2026, 8, 19, 23, 59).getTime(),
    after = new Date(2026, 8, 20, 0, 0).getTime();
  currentIsland(s).members.forEach((m) => {
    m.records = [
      {
        id: m.id,
        islandId: s.islandId,
        subject: '공부',
        seconds: 600,
        at: before,
        fish: 10,
        contributed: true,
      },
    ];
  });
  assert.ok(islandWeeklyAverage(s, currentIsland(s), before) > 0);
  assert.equal(islandWeeklyAverage(s, currentIsland(s), after), 0);
});

test('이미 가입한 승인제 섬에 다시 이동할 때 신청을 만들지 않는다', () => {
  let s = initialState(true);
  const target = s.islands.find((j) => j.id !== s.islandId)!;
  target.joined = true;
  target.approval = true;
  s = act(s, 'JOIN', { id: target.id });
  assert.equal(s.islandId, target.id);
  assert.equal(s.pendingIsland, null);
});
test('한 섬을 탈퇴해도 다른 소속 섬과 이전 섬의 공동 물고기를 유지한다', () => {
  let s = initialState(true);
  const previous = currentIsland(s),
    fish = balance(previous);
  const other = s.islands.find((j) => j.id !== previous.id)!;
  other.joined = true;
  s = act(s, 'LEAVE');
  assert.equal(s.onboarded, true);
  assert.equal(s.islandId, other.id);
  assert.equal(balance(s.islands.find((j) => j.id === previous.id)!), fish);
});
