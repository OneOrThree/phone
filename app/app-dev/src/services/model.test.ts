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
  earnedBy,
  costs,
  buildMinutes,
  dayKey,
  findIslandByInviteCode,
  inviteCodeOf,
  isHost,
  recordSecondsBetween,
  weekStart,
  periodBounds,
  unreadLetters,
  newChatCount,
  clockMinutes,
  canSendLetter,
  isOwnComment,
  kstDayStart,
  kstMonthDay,
  kstHourMinute,
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
  assert.deepEqual(currentIsland(s).notices, []);
  assert.deepEqual(currentIsland(s).messages, []);
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
test('상점은 전망대와 우체통만 선행하며, 축음기 음원은 상점 없이 구매한다', () => {
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
  currentIsland(s).buildings = ['hall', 'board', 'mail', 'tower'];
  s = act(s, 'SELECT_BUILDING', { building: 'shop' });
  assert.equal(currentIsland(s).buildingQuest?.building, 'shop');
});
test('의상은 섬 잔액으로 구매하고 개인 보유품으로 남긴다; 중복 결제·미보유 착용 방지', () => {
  let s = initialState(true);
  s = act(s, 'EQUIP', { key: 'clothes', value: 'scarf' });
  assert.equal(s.equipped.clothes, 'default');
  s = act(s, 'BUY', { id: 'scarf' });
  assert.equal(balance(currentIsland(s)), 1100);
  assert.ok(s.owned.includes('scarf'));
  assert.deepEqual(act(s, 'BUY', { id: 'scarf' }), s);
  currentIsland(s).members = [];
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
test('주민 퀘스트 보상은 달성 시 섬과 주민 누적량에 한 번만 자동 적립', () => {
  let s = initialState(true);
  const island = currentIsland(s),
    member = island.members[0],
    now = Date.now();
  island.members = [member];
  island.quests = [{ ...island.quests[0], target: 10 }];
  const beforeFish = balance(island),
    beforeEarned = earnedBy(island, member.id),
    legacy = JSON.parse(JSON.stringify(s)) as typeof s,
    day = dayKey(now);
  currentIsland(legacy).quests[0].rounds = {
    [day]: {
      targets: ['me', member.id],
      achieved: [member.id],
      claimed: [],
      bonus: false,
      target: 10,
      kind: 'focus',
    },
  };
  s = act(s, 'TICK', { now });
  const rewarded = currentIsland(s);
  assert.equal(balance(rewarded), beforeFish + 10);
  assert.equal(earnedBy(rewarded, member.id), beforeEarned + 10);
  assert.deepEqual(rewarded.quests[0].rounds?.[dayKey(now)]?.claimed, [member.id]);
  assert.deepEqual(act(s, 'TICK', { now }), s);

  const settled = act(legacy, 'TICK', { now });
  assert.equal(balance(currentIsland(settled)), beforeFish + 10);
  assert.equal(earnedBy(currentIsland(settled), member.id), beforeEarned + 10);
  assert.deepEqual(currentIsland(settled).quests[0].rounds?.[dayKey(now)]?.claimed, [member.id]);
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
test('친구를 삭제하면 아직 확인하지 않은 편지도 지운다', () => {
  let s = initialState(true);
  s.friends!.find((f) => f.id === 'saebom')!.messages.push({
    id: 'unread',
    memberId: 'saebom',
    name: '새봄',
    color: 'white',
    text: '아직 안 읽은 편지',
    at: 1,
    status: 'sent',
  });
  s = act(s, 'FRIEND_MESSAGE', { id: 'saebom', text: '보낸 편지' });
  assert.equal(s.friends?.find((f) => f.id === 'saebom')?.messages.length, 2);
  s = act(s, 'FRIEND_DELETE', { id: 'saebom' });
  const saebom = s.friends?.find((f) => f.id === 'saebom');
  assert.equal(saebom?.status, 'none');
  assert.deepEqual(saebom?.messages, []);
});
test('계정 삭제는 섬 물고기는 남기고 사용자 활동과 개인정보를 제거한다', () => {
  let s = initialState(true);
  const island = currentIsland(s);
  island.earned!.me = 999;
  island.ledger.push({ id: 'mine', text: `${s.name} 집중 보상`, at: 1, memberId: 'me' });
  island.ledger.push({ id: 'legacy-mine', text: `${s.name} 집중 보상`, at: 1 });
  island.ledger.push({ id: 'shared', text: '마을회관 공사 완료', at: 2 });
  island.notices.unshift({
    id: 'mine',
    title: '내 공지',
    body: '삭제 대상',
    author: s.name,
    authorId: 'me',
    comments: [],
  });
  island.notices[1].comments.push({
    id: 'mine-comment',
    name: s.name,
    memberId: 'me',
    text: '내 댓글',
  });
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
  s = act(s, 'PROFILE', { name: '새이름' });
  currentIsland(s).notices.push({
    id: 'legacy-old-name-notice',
    title: '예전 이름 공지',
    body: '삭제 대상',
    author: '수빈',
    comments: [],
  });
  currentIsland(s).notices[1].comments.push({
    id: 'legacy-old-name-comment',
    name: '수빈',
    text: '예전 이름 댓글',
  });
  currentIsland(s).members[0].role = 'host';
  s = act(s, 'DELETE_ACCOUNT');
  const scrubbed = s.islands[0];
  assert.equal(scrubbed.fish, 1200);
  assert.equal(scrubbed.earned?.me, undefined);
  assert.deepEqual(
    scrubbed.ledger.map((entry) => entry.id),
    ['shared'],
  );
  assert.ok(!scrubbed.notices.some((notice) => notice.authorId === 'me'));
  assert.ok(!scrubbed.notices.some((notice) => notice.author === '수빈'));
  assert.ok(
    scrubbed.notices.every((notice) =>
      notice.comments.every((comment) => comment.memberId !== 'me' && comment.name !== '수빈'),
    ),
  );
  assert.ok(scrubbed.messages.every((message) => message.memberId !== 'me'));
  assert.deepEqual(scrubbed.quests[0].rounds?.today.targets, ['minji']);
  assert.deepEqual(scrubbed.quests[0].rounds?.today.achieved, []);
  assert.deepEqual(scrubbed.quests[0].rounds?.today.claimed, []);
  assert.deepEqual(scrubbed.buildingQuest?.targets, ['minji']);
  assert.deepEqual(scrubbed.buildingQuest?.base, { minji: 20 });
  assert.equal(s.loggedIn, false);
  assert.deepEqual(s.records, []);
});
test('레거시 원장은 닉네임의 정확한 작성자 접두어만 삭제한다', () => {
  let s = initialState(true);
  s.name = '수';
  s.profileNames = ['수'];
  currentIsland(s).ledger = [
    { id: 'mine', text: '수 · 집중 +10마리', at: 1 },
    { id: 'other', text: '수아 퀘스트 달성 보상 +10마리', at: 2 },
  ];
  currentIsland(s).members[0].role = 'host';
  s = act(s, 'DELETE_ACCOUNT');
  assert.deepEqual(
    s.islands[0].ledger.map((entry) => entry.id),
    ['other'],
  );
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
  assert.deepEqual(act(s, 'LEAVE'), s);
  assert.deepEqual(act(s, 'TRANSFER', { id: 'missing' }), s);
  s = act(s, 'TRANSFER', { id: 'minji' });
  assert.equal(currentIsland(act(s, 'LEAVE')).joined, false);
  assert.deepEqual(act(s, 'KICK', { id: 'dubu' }), s);
  assert.deepEqual(act(s, 'MANAGE', { name: '변경' }), s);
  assert.deepEqual(act(s, 'QUEST_SAVE', { title: '변경', kind: 'focus', target: 10 }), s);
  assert.deepEqual(act(s, 'NOTICE_SAVE', { title: '변경', body: '내용' }), s);
  assert.deepEqual(act(s, 'NOTICE_DELETE', { id: 'welcome' }), s);
});

test('주민이 남은 섬의 방장은 위임 전에 계정을 삭제할 수 없다', () => {
  let s = initialState(true);
  assert.ok(isHost(currentIsland(s)));
  assert.deepEqual(act(s, 'DELETE_ACCOUNT'), s);
  s = act(s, 'TRANSFER', { id: 'minji' });
  s = act(s, 'DELETE_ACCOUNT');
  assert.equal(s.loggedIn, false);
});

test('온보딩 전에는 숨은 가입 섬이 없고 초대 코드는 실제 섬 ID로 찾는다', () => {
  const s = initialState();
  assert.ok(s.islands.every((island) => !island.joined));
  assert.deepEqual(act(s, 'START', { subject: '미가입 집중' }), s);
  const strawberry = s.islands.find((island) => island.id === 'strawberry')!;
  assert.ok(strawberry.members.some((member) => member.role === 'host'));
  assert.equal(strawberry.earned?.me, undefined);
  const joined = act(s, 'JOIN', { id: 'strawberry' });
  assert.equal(joined.islandId, 'strawberry');
  assert.equal(isHost(currentIsland(joined)), false);
  assert.deepEqual(act(joined, 'MANAGE', { name: '이름 탈취' }), joined);
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

test('승인 대기 신청은 섬별로 보존하고 선택한 신청만 취소한다', () => {
  let s = initialState(true);
  const strawberry = s.islands.find((island) => island.id === 'strawberry')!;
  strawberry.approval = true;
  s = act(s, 'JOIN', { id: 'cloud' });
  s = act(s, 'JOIN', { id: 'strawberry' });
  assert.deepEqual(s.pendingIslands, ['cloud', 'strawberry']);
  s = act(s, 'CANCEL_JOIN', { id: 'cloud' });
  assert.deepEqual(s.pendingIslands, ['strawberry']);
  assert.equal(s.pendingIsland, 'strawberry');
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
    record('mon', 'soda', 1800, new Date(2026, 8, 14, 9).getTime()),
    record('last-sat', 'soda', 3600, new Date(2026, 8, 12, 23).getTime()),
    record('other', 'strawberry', 900, now - 1000),
  ];
  // 소다 섬: 나 1800 + 민지 1320 + 두부 960 + 수아 600 = 4680 ÷ 4명
  assert.equal(islandWeeklyAverage(s, currentIsland(s), now), 1170);
  // 딸기 섬: 주민 3명의 2880초 + 그 섬에서 완료한 내 900초
  assert.equal(islandWeeklyAverage(s, s.islands[1], now), 1260);
  assert.equal(hoursMinutes(1170), '19분');
  assert.equal(hoursMinutes(15600), '4시간 20분');
  assert.equal(hoursMinutes(18000), '5시간');
});

test('카운트업 집중·첫 집중 후 회관 안내는 한 번만·예전 저장본은 표시 안 함', () => {
  let s = initialState();
  s = act(s, 'CREATE_ISLAND', { name: '첫 섬' });
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

test('주 경계를 넘은 집중은 일요일 00시 이후 구간만 새 주 평균에 포함', () => {
  const s = initialState(true),
    saturday = new Date(2026, 8, 19, 23, 0).getTime(),
    sunday = new Date(2026, 8, 20, 1, 0).getTime(),
    now = new Date(2026, 8, 20, 2, 0).getTime();
  currentIsland(s).members = [];
  s.records = [
    {
      id: 'across-week',
      islandId: s.islandId,
      subject: '주말 집중',
      seconds: 7200,
      at: sunday,
      fish: 120,
      contributed: true,
      intervals: [{ start: saturday, end: sunday }],
    },
  ];
  assert.equal(islandWeeklyAverage(s, currentIsland(s), now), 3600);
  assert.equal(recordSecondsBetween(s.records[0], sunday - 1800000, sunday + 1800000), 1800);
});

test('일일 퀘스트는 방장만 만들고 수정한다; 시간대 집중은 목표 분이 진행 시간 안이어야 한다', () => {
  let s = initialState(true);
  const quest = currentIsland(s).quests[0];
  const focus = { title: '저녁 집중', kind: 'focus', windowStart: '19:00', windowEnd: '22:00' };
  assert.deepEqual(act(s, 'QUEST_SAVE', { ...focus, target: 181 }), s);
  assert.deepEqual(act(s, 'QUEST_SAVE', { ...focus, windowEnd: '19:00', target: 10 }), s);
  assert.deepEqual(act(s, 'QUEST_SAVE', { ...focus, windowStart: '', target: 10 }), s);
  // 수정에도 같은 검증을 적용하고, 없는 퀘스트 id는 새로 만들지 않는다
  assert.deepEqual(act(s, 'QUEST_SAVE', { ...focus, id: quest.id, target: 181 }), s);
  assert.deepEqual(act(s, 'QUEST_SAVE', { ...focus, id: 'missing', target: 30 }), s);
  s = act(s, 'QUEST_SAVE', { ...focus, target: 180 });
  const pick = ({ title, type, target, windowStart, windowEnd }: any) => ({
    title,
    type,
    target,
    windowStart,
    windowEnd,
  });
  assert.deepEqual(pick(currentIsland(s).quests.at(-1)!), {
    title: '저녁 집중',
    type: 'focus',
    target: 180,
    windowStart: '19:00',
    windowEnd: '22:00',
  });
  s = act(s, 'QUEST_SAVE', { title: '폰 90분', kind: 'screen', target: 90, windowStart: '19:00' });
  assert.equal(currentIsland(s).quests.at(-1)!.windowStart, undefined);
  // 방장은 기존 퀘스트를 수정한다 (스크린타임으로 바꾸면 시간대는 지운다)
  const count = currentIsland(s).quests.length;
  s = act(s, 'QUEST_SAVE', { ...focus, id: quest.id, title: ' 아침 집중 ', target: 45 });
  assert.equal(currentIsland(s).quests.length, count);
  assert.deepEqual(pick(currentIsland(s).quests[0]), {
    title: '아침 집중',
    type: 'focus',
    target: 45,
    windowStart: '19:00',
    windowEnd: '22:00',
  });
  s = act(s, 'QUEST_SAVE', { title: '폰 두 시간', kind: 'screen', target: 120, id: quest.id });
  assert.equal(currentIsland(s).quests[0].windowStart, undefined);
  // 주민은 수정할 수 없다
  const resident = act(s, 'TRANSFER', { id: 'minji' });
  assert.deepEqual(
    act(resident, 'QUEST_SAVE', { title: '바꿈', kind: 'screen', target: 60, id: quest.id }),
    resident,
  );
});

test('오늘 퀘스트를 수정하면 대상 스냅숏은 두고, 미수령 달성·보상을 새 목표·시간대로 바로 다시 판정한다', () => {
  let s = initialState(true);
  // 2026-09-15 12:00 KST
  const now = Date.UTC(2026, 8, 15, 3),
    quest = currentIsland(s).quests[0];
  currentIsland(s).members = [];
  s = act(s, 'START', { subject: '집중', now: now - 30 * 60 * 1000 });
  s = act(s, 'FINISH', { now });
  const day = dayKey(now);
  assert.ok(currentIsland(s).quests[0].rounds?.[day]?.achieved.includes('me'));
  assert.ok(
    s.rewards?.some(
      (reward) => reward.questId === quest.id && reward.kind === 'personal' && !reward.acknowledged,
    ),
  );
  // 회차가 만들어진 뒤 들어온 주민은 오늘 대상이 아니다
  currentIsland(s).members = [{ ...initialState(true).islands[0].members[0], records: [] }];
  s = act(s, 'QUEST_SAVE', {
    id: quest.id,
    title: '오후 집중',
    kind: 'focus',
    target: 60,
    windowStart: '13:00',
    windowEnd: '18:00',
    now,
  });
  let round = currentIsland(s).quests[0].rounds?.[day]!;
  assert.deepEqual(round.targets, ['me']);
  assert.equal(round.target, 60);
  assert.equal(round.kind, 'focus');
  assert.equal(round.windowStart, '13:00');
  assert.equal(round.windowEnd, '18:00');
  assert.ok(!round.achieved.includes('me'));
  assert.ok(
    !s.rewards?.some(
      (reward) => reward.questId === quest.id && reward.kind === 'personal' && !reward.acknowledged,
    ),
  );
  // 새 시간대(13~18시) 안에서 60분을 채우면 다음 평가에서 바로 달성한다
  const at = Date.UTC(2026, 8, 15, 5); // 14:00 KST
  s.records.push({
    id: 'r-afternoon',
    islandId: s.islandId,
    subject: '집중',
    seconds: 3600,
    at,
    fish: 0,
    contributed: true,
  });
  s = act(s, 'TICK', { now: at });
  round = currentIsland(s).quests[0].rounds?.[day]!;
  assert.ok(round.achieved.includes('me'));
  assert.deepEqual(round.targets, ['me']);
});

test('퀘스트 목표 분은 정수만, 시간은 한 자리 시와 종료 24:00을 받는다', () => {
  let s = initialState(true);
  const late = { title: '밤 집중', kind: 'focus', windowStart: '9:00', windowEnd: '24:00' };
  assert.deepEqual(act(s, 'QUEST_SAVE', { ...late, target: 30.5 }), s);
  assert.deepEqual(act(s, 'QUEST_SAVE', { ...late, windowStart: '24:00', target: 30 }), s);
  assert.deepEqual(act(s, 'QUEST_SAVE', { ...late, windowEnd: '24:30', target: 30 }), s);
  assert.equal(clockMinutes('9:05'), 545);
  assert.equal(clockMinutes('24:00'), 1440);
  assert.equal(clockMinutes('25:00'), null);
  s = act(s, 'QUEST_SAVE', { ...late, target: 900 });
  assert.equal(currentIsland(s).quests.at(-1)!.target, 900);
});

test('댓글 삭제: 방장은 모든 댓글, 주민은 자기 댓글만', () => {
  let s = initialState(true);
  s = act(s, 'COMMENT', { id: 'welcome', text: '내 댓글' });
  const mine = currentIsland(s).notices[0].comments.at(-1)!.id;
  // 방장(나)은 다른 주민 댓글도 지운다
  let host = act(s, 'COMMENT_DELETE', { id: 'welcome', commentId: 'c1' });
  assert.ok(!currentIsland(host).notices[0].comments.some((c) => c.id === 'c1'));
  s = act(s, 'TRANSFER', { id: 'minji' });
  assert.deepEqual(act(s, 'COMMENT_DELETE', { id: 'welcome', commentId: 'c1' }), s);
  s = act(s, 'COMMENT_DELETE', { id: 'welcome', commentId: mine });
  assert.ok(!currentIsland(s).notices[0].comments.some((c) => c.id === mine));
});

test('받은 편지는 읽고 닫으면 사라지고, 채팅방 새 글은 마지막으로 연 뒤의 다른 주민 글만 센다', () => {
  let s = initialState(true);
  const friend = s.friends![0];
  friend.messages = [
    {
      id: 'l1',
      memberId: friend.id,
      name: friend.name,
      color: friend.color,
      text: '안녕',
      at: 1,
      status: 'sent',
    },
    {
      id: 'l2',
      memberId: friend.id,
      name: friend.name,
      color: friend.color,
      text: '또 안녕',
      at: 2,
      status: 'sent',
    },
    { id: 'l3', memberId: 'me', name: s.name, color: s.color, text: '답장', at: 3, status: 'sent' },
  ];
  assert.deepEqual(
    unreadLetters(s).map((x) => x.letter.id),
    ['l2', 'l1'],
  );
  s = act(s, 'LETTER_READ', { friend: friend.id, id: 'l2', now: 10 });
  assert.deepEqual(
    unreadLetters(s).map((x) => x.letter.id),
    ['l1'],
  );
  // 이미 읽은 편지를 다시 읽어도 바뀌지 않고, 상세에서 볼 수 있게 편지 자체는 남는다
  assert.deepEqual(act(s, 'LETTER_READ', { friend: friend.id, id: 'l2', now: 20 }), s);
  assert.equal(s.friends![0].messages.find((m) => m.id === 'l2')!.readAt, 10);
  // 내가 보낸 편지는 받은 편지가 아니다
  assert.deepEqual(act(s, 'LETTER_READ', { friend: friend.id, id: 'l3' }), s);
  assert.equal(newChatCount(currentIsland(s)), 2);
  s = act(s, 'CHAT_READ', { now: Date.now() + 1000 });
  assert.equal(newChatCount(currentIsland(s)), 0);
  s = act(s, 'MESSAGE', { text: '내 글', now: Date.now() + 2000 });
  assert.equal(newChatCount(currentIsland(s)), 0);
});

test('공사가 끝나면 완공 안내를 남기고, 다음 건물을 고르면 지운다', () => {
  let s = initialState(true);
  currentIsland(s).buildings = ['hall', 'board', 'gram'];
  currentIsland(s).fish = 3000;
  s = act(s, 'SELECT_BUILDING', { building: 'library' });
  const i = currentIsland(s);
  for (const id of i.buildingQuest!.targets)
    i.earned![id] = (i.earned![id] ?? 0) + buildingShare(i, 'library');
  s = act(s, 'BUILD', { building: 'library', now: 1000 });
  assert.equal(currentIsland(s).completed, undefined);
  s = act(s, 'TICK', { now: 1000 + buildMinutes.library * 60000 });
  assert.deepEqual(currentIsland(s).completed, {
    building: 'library',
    at: 1000 + buildMinutes.library * 60000,
  });
  s = act(s, 'SELECT_BUILDING', { building: 'mail' });
  assert.equal(currentIsland(s).completed, undefined);
});

test('읽음 기준이 없던 예전 저장본을 불러오면 받은 편지 0통·새 글 0개, 이후 받은 것만 새로 센다', () => {
  const old = initialState(true);
  old.friends![0].messages = [
    {
      id: 'l1',
      memberId: 'saebom',
      name: '새봄',
      color: 'white',
      text: '예전 편지',
      at: 500,
      status: 'sent',
    },
  ];
  delete old.lettersReadAt;
  old.islands.forEach((i) => delete i.chatReadAt);
  let s = reducer(old, { type: 'LOAD', state: old, now: 1000 });
  assert.equal(unreadLetters(s).length, 0);
  assert.equal(newChatCount(currentIsland(s)), 0);
  s.friends![0].messages.push({ ...s.friends![0].messages[0], id: 'l2', at: 2000 });
  // 예전 섬 글이 지금보다 늦게 찍혀 있으면 그 시각이 기준이 된다
  const chatReadAt = currentIsland(s).chatReadAt!;
  assert.ok(chatReadAt >= Math.max(...currentIsland(s).messages.map((m) => m.at)));
  currentIsland(s).messages.push({ ...currentIsland(s).messages[0], id: 'm9', at: chatReadAt + 1 });
  assert.deepEqual(
    unreadLetters(s).map((x) => x.letter.id),
    ['l2'],
  );
  assert.equal(newChatCount(currentIsland(s)), 1);
  // 읽음 기준이 있는 저장본은 그대로 둔다
  const fresh = initialState(true);
  fresh.friends![0].messages = old.friends![0].messages;
  assert.equal(unreadLetters(reducer(fresh, { type: 'LOAD', state: fresh, now: 1000 })).length, 1);
});

test('memberId가 없던 예전 댓글은 작성자 이름이 내 이름(바꾼 이름 포함)이면 내 댓글이다', () => {
  let s = initialState(true);
  s.profileNames = ['예전이름', s.name];
  currentIsland(s).notices[0].comments.push(
    { id: 'old-mine', name: '예전이름', text: '예전 내 댓글' },
    { id: 'old-other', name: '두부', text: '남의 댓글' },
  );
  assert.ok(isOwnComment(s, { name: '예전이름' }));
  assert.ok(!isOwnComment(s, { name: '예전이름', memberId: 'minji' }));
  s = act(s, 'TRANSFER', { id: 'minji' });
  assert.deepEqual(act(s, 'COMMENT_DELETE', { id: 'welcome', commentId: 'old-other' }), s);
  s = act(s, 'COMMENT_DELETE', { id: 'welcome', commentId: 'old-mine' });
  assert.ok(!currentIsland(s).notices[0].comments.some((c) => c.id === 'old-mine'));
});

test('회관·게시판처럼 다음 건물로 고르는 건물이 아니면 완공 안내를 남기지 않는다', () => {
  let s = initialState(true);
  currentIsland(s).buildings = ['hall'];
  currentIsland(s).fish = 3000;
  s = act(s, 'BUILD', { building: 'board', now: 1000 });
  s = act(s, 'TICK', { now: 1000 + buildMinutes.board * 60000 });
  assert.ok(currentIsland(s).buildings.includes('board'));
  assert.equal(currentIsland(s).completed, undefined);
});

test('친구 편지는 친구이고 내 섬에 우체통이 있을 때만 보낸다', () => {
  let s = initialState(true);
  assert.ok(canSendLetter(s, 'saebom'));
  assert.ok(!canSendLetter(s, 'haneul'));
  currentIsland(s).buildings = ['hall', 'board'];
  assert.ok(!canSendLetter(s, 'saebom'));
  assert.deepEqual(act(s, 'FRIEND_MESSAGE', { id: 'saebom', text: '안녕' }), s);
});

test('탈퇴한 섬에서는 주민 전용 기록을 추가하거나 재화를 쓸 수 없다', () => {
  let s = initialState(true);
  currentIsland(s).members = [];
  s = act(s, 'LEAVE');
  for (const [type, data] of [
    ['START', { subject: '집중' }],
    ['COMMENT', { id: 'welcome', text: '댓글' }],
    ['MESSAGE', { text: '메시지' }],
    ['BUY', { id: 'scarf' }],
  ] as const)
    assert.deepEqual(act(s, type, data), s);
});

test('강퇴한 주민을 목록에서는 제거해도 완료 기록과 기여는 보존한다', () => {
  let s = initialState(true);
  const island = currentIsland(s),
    member = island.members[0],
    now = new Date(2026, 8, 16, 12).getTime();
  for (const resident of island.members) resident.records = [];
  member.records = [
    {
      id: 'completed-before-kick',
      islandId: island.id,
      subject: '집중',
      seconds: 600,
      at: now,
      fish: 10,
      contributed: true,
    },
  ];
  s = act(s, 'KICK', { id: member.id });
  assert.ok(!currentIsland(s).members.some((resident) => resident.id === member.id));
  assert.equal(currentIsland(s).formerMembers?.[0].records?.[0].seconds, 600);
  assert.equal(islandWeeklyAverage(s, currentIsland(s), now), 200);
});

test('구매 내역 날짜·시각은 기기 시간대가 달라도 Asia/Seoul로 표시한다', () => {
  // 기기 시간대 대신 UTC 게터로 계산하므로 러너 시간대와 무관하다.
  // 로스앤젤레스 기기라면 9/15 08:30으로 보이는 순간이 한국 날짜·시각으로 나와야 한다
  const at = Date.parse('2026-09-15T15:30:00.000Z');
  const la = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'numeric',
    day: 'numeric',
  }).format(at);
  assert.equal(la, '9/15');
  assert.equal(kstMonthDay(at), '9/16');
  assert.equal(kstHourMinute(at), '00:30');
  assert.equal(kstDayStart(dayKey(at)), Date.parse('2026-09-15T15:00:00.000Z'));
  // 한국 23:59와 다음 날 00:00 경계
  assert.equal(kstMonthDay(Date.parse('2026-12-31T14:59:00.000Z')), '12/31');
  assert.equal(kstHourMinute(Date.parse('2026-12-31T14:59:00.000Z')), '23:59');
  assert.equal(kstMonthDay(Date.parse('2026-12-31T15:00:00.000Z')), '1/1');
});

test('퀘스트 날짜와 일·주·월 경계는 기기 타임존과 무관하게 Asia/Seoul을 따른다', () => {
  const kst0030 = Date.parse('2026-09-15T15:30:00.000Z');
  assert.equal(dayKey(kst0030), '2026-09-16');
  // 랭킹 주는 일요일 00시, 도서관 기록의 주(periodBounds)는 월요일 00시부터
  assert.equal(weekStart(kst0030), Date.parse('2026-09-12T15:00:00.000Z'));
  assert.deepEqual(periodBounds('일', 0, kst0030), {
    from: Date.parse('2026-09-15T15:00:00.000Z'),
    until: Date.parse('2026-09-16T15:00:00.000Z'),
  });
  assert.deepEqual(periodBounds('주', 0, kst0030), {
    from: Date.parse('2026-09-13T15:00:00.000Z'),
    until: Date.parse('2026-09-20T15:00:00.000Z'),
  });
  assert.deepEqual(periodBounds('월', 0, kst0030), {
    from: Date.parse('2026-08-31T15:00:00.000Z'),
    until: Date.parse('2026-09-30T15:00:00.000Z'),
  });
  const today = periodBounds('일', 0, kst0030);
  assert.equal(
    recordSecondsBetween(
      {
        id: 'across-kst-midnight',
        islandId: 'soda',
        subject: '자정 경계',
        seconds: 3600,
        at: Date.parse('2026-09-15T15:30:00.000Z'),
        fish: 60,
        contributed: true,
        intervals: [
          {
            start: Date.parse('2026-09-15T14:30:00.000Z'),
            end: Date.parse('2026-09-15T15:30:00.000Z'),
          },
        ],
      },
      today.from,
      today.until,
    ),
    1800,
  );
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
  previous.members[0].role = 'host';
  const other = s.islands.find((j) => j.id !== previous.id)!;
  other.joined = true;
  s = act(s, 'LEAVE');
  assert.equal(s.onboarded, true);
  assert.equal(s.islandId, other.id);
  assert.equal(balance(s.islands.find((j) => j.id === previous.id)!), fish);
});

test('마지막 주민이 탈퇴하면 섬을 종료해 탐색·초대 코드·재가입에서 제외한다', () => {
  let s = initialState(true);
  const island = currentIsland(s);
  island.members = [];
  const id = island.id;
  s = act(s, 'LEAVE');
  const closed = s.islands.find((candidate) => candidate.id === id)!;
  assert.equal(closed.joined, false);
  assert.equal(closed.closed, true);
  assert.equal(closed.visibility, 'private');
  assert.equal(findIslandByInviteCode(s.islands, inviteCodeOf(closed)), undefined);
  assert.deepEqual(act(s, 'JOIN', { id }), s);
});

test('계정 삭제로 마지막 주민이 떠나는 섬도 종료한다', () => {
  let s = initialState(true);
  const island = currentIsland(s);
  island.members = [];
  const id = island.id;
  s = act(s, 'DELETE_ACCOUNT');
  const closed = s.islands.find((candidate) => candidate.id === id)!;
  assert.equal(closed.closed, true);
  assert.equal(closed.visibility, 'private');
  assert.equal(findIslandByInviteCode(s.islands, inviteCodeOf(closed)), undefined);
});

test('섬을 탈퇴해도 그 섬에서 완료한 이번 주 집중 기여는 보존한다', () => {
  let s = initialState(true);
  const island = currentIsland(s),
    now = new Date(2026, 8, 16, 12).getTime();
  for (const member of island.members) member.records = [];
  island.members[0].role = 'host';
  s.records = [
    {
      id: 'mine-before-leave',
      islandId: island.id,
      subject: '집중',
      seconds: 600,
      at: now,
      fish: 10,
      contributed: true,
    },
  ];
  s = act(s, 'LEAVE');
  assert.equal(islandWeeklyAverage(s, s.islands[0], now), 200);
});
