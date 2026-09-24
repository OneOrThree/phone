import assert from 'node:assert/strict';
import {
  initialState,
  reducer,
  currentIsland,
  mainIsland,
  serverHome,
  viewIsland,
  canVisit,
  visitorJoinState,
  visitorJoinLabel,
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
  buildingOrder,
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
  memberOf,
  clockText,
  questMemberRate,
  joinRequests,
  ledgerParts,
  canSelectBuilding,
  kstDayStart,
  kstMonthDay,
  kstHourMinute,
  myIslandsConsistent,
  intentKeyPool,
  shouldShowShopGuide,
  trackNames,
  todayFocusSeconds,
} from '@/services/model';
const act = (s: ReturnType<typeof initialState>, type: string, data = {}) =>
  reducer(s, { type, ...data });

test('상점 안내는 완공 뒤 계정별 최초 1회만 표시한다', () => {
  let s = initialState(true);
  const island = currentIsland(s);
  island.buildings = island.buildings.filter((building) => building !== 'shop');
  assert.equal(shouldShowShopGuide(s, 'user-a'), false);

  island.buildings.push('shop');
  assert.equal(shouldShowShopGuide(s, 'user-a'), true);
  s = act(s, 'SHOP_GUIDE_DONE', { userId: 'user-a' });
  assert.equal(shouldShowShopGuide(s, 'user-a'), false);
  assert.equal(shouldShowShopGuide(s, 'user-b'), true);

  s.visitingIslandId = 'strawberry';
  assert.equal(shouldShowShopGuide(s, 'user-b'), false);
});

test('메인 섬을 바꿔도 현재 접속 섬은 유지하고 미가입 섬은 선택하지 않는다', () => {
  let s = initialState(true);
  s.islands.find((island) => island.id === 'strawberry')!.joined = true;
  const currentIslandId = s.islandId;

  s = act(s, 'MAIN_ISLAND', { id: 'strawberry' });
  assert.equal(s.mainIslandId, 'strawberry');
  assert.equal(mainIsland(s)?.name, '딸기 섬');
  assert.equal(s.islandId, currentIslandId);

  assert.equal(act(s, 'MAIN_ISLAND', { id: 'cloud' }), s);
  assert.equal(act(s, 'MAIN_ISLAND', { id: 'strawberry' }), s);
});
test('예전 저장본은 가입 중인 섬을 메인 섬으로 복구한다', () => {
  const stored = initialState(true);
  delete (stored as Partial<typeof stored>).mainIslandId;

  const loaded = act(initialState(), 'LOAD', { state: stored, now: 1000 });
  assert.equal(loaded.mainIslandId, 'soda');
  assert.equal(mainIsland(loaded)?.id, 'soda');
});
test('메인 섬에서 탈퇴하면 남은 소속 섬을 메인 섬으로 정한다', () => {
  let s = initialState(true);
  s.islands.find((island) => island.id === 'strawberry')!.joined = true;
  s = act(s, 'MAIN_ISLAND', { id: 'strawberry' });
  s = act(s, 'SWITCH_ISLAND', { id: 'strawberry' });
  s = act(s, 'LEAVE');

  assert.equal(s.islandId, 'soda');
  assert.equal(s.mainIslandId, 'soda');
});
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
  const boardEndsAt = 62000 + buildMinutes.board * 60000;
  s = act(s, 'TICK', { now: boardEndsAt + 2 * 86400000 });
  assert.ok(currentIsland(s).buildings.includes('board'));
  assert.equal(currentIsland(s).boardCompletedDay, dayKey(boardEndsAt));
});
test('QA 완공은 온보딩을 유지하고 완료 후 현재 섬의 공사 중간 상태만 정리한다', () => {
  const fresh = initialState();
  assert.equal(fresh.onboarded, false);
  assert.deepEqual(act(fresh, 'QA_COMPLETE_ALL_BUILDINGS'), fresh);

  const saved = initialState(true),
    island = currentIsland(saved),
    otherBuildings = [...saved.islands[1].buildings];
  island.buildings = ['hall'];
  island.buildingQuest = {
    building: 'board',
    targets: ['me'],
    selectedAt: 1000,
  };
  island.construction = {
    building: 'board',
    startedAt: 1000,
    endsAt: 2000,
    cost: costs.board,
  };
  island.nextBuilding = 'board';
  island.completed = { building: 'hall', at: 900 };

  const loaded = act(saved, 'QA_COMPLETE_ALL_BUILDINGS');
  const completed = currentIsland(loaded);

  assert.deepEqual(completed.buildings, buildingOrder);
  assert.equal(completed.buildingQuest, undefined);
  assert.equal(completed.construction, undefined);
  assert.equal(completed.nextBuilding, undefined);
  assert.equal(completed.completed, undefined);
  assert.deepEqual(loaded.islands[1].buildings, otherBuildings);
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
  currentIsland(s).fish = 2740;
  s = act(s, 'SELECT_BUILDING', { building: 'library' });
  const i = currentIsland(s);
  const share = buildingShare(i, 'library');
  // 대상 전원이 각자 몫만큼 이미 모아 둔 상태
  for (const id of i.buildingQuest!.targets) i.earned![id] = (i.earned![id] ?? 0) + share;
  assert.ok(buildingReady(currentIsland(s)));
  s = act(s, 'BUY', { id: 'rain' });
  assert.equal(balance(currentIsland(s)), 2710);
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
test('상점은 다른 네 건물을 모두 완공해야 고르며, 축음기 음원은 상점 없이 구매한다', () => {
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
  assert.equal(balance(currentIsland(s)), 1170);
  assert.deepEqual(act(s, 'BUY', { id: 'rain' }), s);
  s = act(s, 'TRACK', { value: 'rain' });
  s = act(s, 'SETTING', { key: 'sound', value: false });
  assert.equal(currentIsland(s).playing, true);
  currentIsland(s).buildings = ['hall', 'board', 'mail', 'tower', 'gram'];
  assert.deepEqual(act(s, 'SELECT_BUILDING', { building: 'shop' }), s);
  currentIsland(s).buildings.push('library');
  s = act(s, 'SELECT_BUILDING', { building: 'shop' });
  assert.equal(currentIsland(s).buildingQuest?.building, 'shop');
});
test('축음기는 보유한 현재 곡이 있을 때만 재생한다', () => {
  let s = initialState(true);
  const island = currentIsland(s);
  island.buildings = ['hall', 'board', 'gram'];
  island.sharedOwned = [];

  s = act(s, 'PLAY', { value: true });
  assert.equal(currentIsland(s).playing, false);

  currentIsland(s).sharedOwned = ['waves'];
  s = act(s, 'PLAY', { value: true });
  assert.equal(currentIsland(s).playing, true);
  s = act(s, 'PLAY', { value: false });
  assert.equal(currentIsland(s).playing, false);
  assert.equal(currentIsland(s).playbackReset, 1);
  assert.equal(trackNames.rain, '빗방울 소리');
});
test('PLAYBACK_SYNC는 서버가 확정한 곡과 재생 상태를 섬에 반영한다', () => {
  const before = initialState(false);
  const island = currentIsland(before);
  island.playing = false;
  const next = reducer(before, {
    type: 'PLAYBACK_SYNC',
    islandId: island.id,
    playback: {
      trackId: 'rain',
      playing: true,
      positionSeconds: 12,
      effectiveAt: '2026-09-22T00:00:00Z',
      changedBy: 'u1',
      version: 3,
      serverNow: '2026-09-22T00:00:02Z',
      durationSeconds: 120,
    },
  });
  assert.equal(currentIsland(next).track, 'rain');
  assert.equal(currentIsland(next).playing, true);
  assert.equal(currentIsland(next).serverPlayback?.positionSeconds, 12);
});
test('PLAYBACK_SYNC는 서버의 null 곡을 명시적인 미선택 상태로 반영한다', () => {
  const before = initialState(false);
  const island = currentIsland(before);
  island.sharedOwned = ['waves'];
  const next = reducer(before, {
    type: 'PLAYBACK_SYNC',
    islandId: island.id,
    playback: {
      trackId: null,
      playing: false,
      positionSeconds: 0,
      effectiveAt: '2026-09-22T00:00:00Z',
      changedBy: null,
      version: 0,
      serverNow: '2026-09-22T00:00:01Z',
      durationSeconds: null,
    },
  });
  assert.equal(currentIsland(next).track, null);
  assert.equal(currentIsland(next).playing, false);
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
  // 방장 혼자인 섬을 떠나면 섬을 삭제하므로 공동 잔액도 지운다 (정책-결정-2026-09-14, GROMO-1843)
  assert.equal(s.islands[0].fish, 0);
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
  // KST 정오 고정 — 자정 직후에는 시드 1320초 기록이 전날로 잘려 당일 목표 미달이 되는 flake 차단
  const nowSpy = jest
    .spyOn(Date, 'now')
    .mockReturnValue(new Date('2026-09-22T12:00:00+09:00').getTime());
  try {
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
  } finally {
    nowSpy.mockRestore();
  }
});
test('스크린타임은 다음 날 정산, 권한·측정 대상 없음은 0분으로 보상하지 않는다', () => {
  let s = initialState(true);
  s.settings.screenTimeMeasurementReady = true;
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
  let noSelection = initialState(true);
  noSelection.settings.screenTimeMeasurementReady = false;
  noSelection.screenMinutes = 0;
  noSelection = act(noSelection, 'TICK', { now });
  noSelection = act(noSelection, 'TICK', { now: now + 86400000 });
  assert.ok(!noSelection.rewards?.some((r) => r.questId === 'q-screen'));
  assert.equal(questRate(noSelection, currentIsland(noSelection).quests[1]), null);
});
test('여러 날 뒤 복구한 스크린타임은 누락된 날짜 라운드와 보상도 정산한다', () => {
  let s = initialState(true);
  const island = currentIsland(s);
  island.members = [];
  island.quests.forEach((quest) => delete quest.rounds);
  const missedDay = '2026-09-14';
  const now = Date.parse('2026-09-16T03:00:00.000Z');

  s.settings.screenTimeHistoryReady = false;
  s = act(s, 'SCREEN_TIME_HISTORY', {
    buckets: [{ date: missedDay, minutes: 60 }],
    now,
  });

  const screenQuest = currentIsland(s).quests.find((quest) => quest.type === 'screen')!;
  assert.deepEqual(screenQuest.rounds?.[missedDay]?.achieved, ['me']);
  assert.ok(
    s.rewards?.some(
      (reward) =>
        reward.questId === screenQuest.id && reward.day === missedDay && !reward.acknowledged,
    ),
  );
});
test('히스토리 동기화 전 중간값은 정산하지 않고 최종 버킷만 평가한다', () => {
  let s = initialState(true);
  const island = currentIsland(s);
  island.members = [];
  const yesterday = '2026-09-15';
  const now = Date.parse('2026-09-16T03:00:00.000Z');
  const screenQuest = island.quests.find((quest) => quest.type === 'screen')!;
  screenQuest.rounds = {
    [yesterday]: {
      targets: ['me'],
      achieved: [],
      claimed: [],
      bonus: false,
      target: screenQuest.target,
      kind: 'screen',
    },
  };
  s.screenDays = { [yesterday]: 60 };
  s.settings.screenTimeHistoryReady = false;

  s = act(s, 'TICK', { now });
  assert.ok(!s.rewards?.some((reward) => reward.day === yesterday));

  s = act(s, 'SCREEN_TIME_HISTORY', {
    buckets: [{ date: yesterday, minutes: 180 }],
    now,
  });
  assert.deepEqual(
    currentIsland(s).quests.find((quest) => quest.id === screenQuest.id)?.rounds?.[yesterday]
      ?.achieved,
    [],
  );
  assert.ok(!s.rewards?.some((reward) => reward.day === yesterday));
});
test('권한 공백 날짜는 히스토리와 당일 TICK으로 다시 확정하지 않는다', () => {
  let s = initialState(true);
  currentIsland(s).members = [];
  const now = Date.now();
  const today = dayKey(now);
  const yesterday = dayKey(now - 86400000);

  s = act(s, 'SCREEN_TIME_UNCONFIRMED', { days: [yesterday, today] });
  s = act(s, 'SCREEN_TIME_HISTORY', {
    buckets: [{ date: yesterday, minutes: 60 }],
    now,
  });
  s.screenMinutes = 30;
  s = act(s, 'TICK', { now });

  assert.equal(s.screenDays?.[yesterday], null);
  assert.equal(s.screenDays?.[today], null);
  assert.ok(!s.rewards?.some((reward) => reward.day === yesterday));
});
test('새 퀘스트와 새 가입일 전의 버킷에는 회차를 소급 생성하지 않는다', () => {
  let s = initialState(true);
  const now = Date.parse('2026-09-16T03:00:00.000Z');
  const oldDay = '2026-09-14';
  s = act(s, 'QUEST_SAVE', {
    title: '새 폰 목표',
    kind: 'screen',
    target: 120,
    now,
  });
  const created = currentIsland(s).quests.find((quest) => quest.title === '새 폰 목표')!;

  s.settings.screenTimeHistoryReady = false;
  s = act(s, 'SCREEN_TIME_HISTORY', {
    buckets: [{ date: oldDay, minutes: 60 }],
    now,
  });

  assert.equal(created.createdDay, dayKey(now));
  assert.equal(
    currentIsland(s).quests.find((quest) => quest.id === created.id)?.rounds?.[oldDay],
    undefined,
  );
  assert.ok(!s.rewards?.some((reward) => reward.questId === created.id && reward.day === oldDay));
});
test('게시판 완공 전 스크린타임 버킷에는 퀘스트 회차를 만들지 않는다', () => {
  let s = initialState(true);
  const island = currentIsland(s);
  island.members = [];
  island.boardCompletedDay = '2026-09-15';
  const beforeBoard = '2026-09-14';
  const now = Date.parse('2026-09-16T03:00:00.000Z');

  s.settings.screenTimeHistoryReady = false;
  s = act(s, 'SCREEN_TIME_HISTORY', {
    buckets: [{ date: beforeBoard, minutes: 60 }],
    now,
  });

  const screenQuest = currentIsland(s).quests.find((quest) => quest.type === 'screen')!;
  assert.equal(screenQuest.rounds?.[beforeBoard], undefined);
  assert.ok(!s.rewards?.some((reward) => reward.day === beforeBoard));
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
test('서버 친구 스냅샷은 공용 친구 상태를 교체하되 기존 편지는 보존한다', () => {
  let s = initialState(true);
  s.friends!.find((friend) => friend.id === 'saebom')!.messages.push({
    id: 'letter',
    memberId: 'saebom',
    name: '새봄',
    color: 'white',
    text: '보존할 편지',
    at: 1,
    status: 'sent',
  });

  s = act(s, 'FRIENDS_SYNC', {
    friends: [
      {
        id: 'saebom',
        name: '새봄',
        color: 'white',
        island: '서버 섬',
        status: 'friend',
        messages: [],
      },
      {
        id: 'new-request',
        name: '신규 요청',
        color: 'white',
        island: '',
        status: 'received',
        messages: [],
      },
    ],
  });

  assert.deepEqual(
    s.friends?.map((friend) => [friend.id, friend.status]),
    [
      ['saebom', 'friend'],
      ['new-request', 'received'],
    ],
  );
  assert.equal(s.friends?.[0].island, '서버 섬');
  assert.equal(s.friends?.[0].messages[0]?.id, 'letter');

  s = act(s, 'FRIENDS_SYNC', {
    friends: [
      {
        id: 'saebom',
        name: '새봄',
        color: 'white',
        island: '',
        status: 'received',
        messages: [],
      },
    ],
  });
  assert.equal(s.friends?.[0].status, 'received');
  assert.deepEqual(s.friends?.[0].messages, []);
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
  s.islands[1].kicked = true;
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
  assert.ok(s.islands.every((entry) => entry.kicked === undefined));
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
test('공지는 방장만 쓰고 지우며, 공백만 있는 제목·본문은 저장하지 않는다', () => {
  let s = initialState(true);
  assert.deepEqual(act(s, 'NOTICE_SAVE', { title: '   ', body: '내용' }), s);
  assert.deepEqual(act(s, 'NOTICE_SAVE', { title: '제목', body: ' \n ' }), s);
  s = act(s, 'NOTICE_SAVE', { title: '  공지  ', body: '  본문  ' });
  const saved = currentIsland(s).notices[0];
  assert.deepEqual([saved.title, saved.body], ['공지', '본문']);
  // 주민은 쓰기·수정·삭제를 할 수 없다
  const resident = act(s, 'TRANSFER', { id: 'minji' });
  assert.deepEqual(act(resident, 'NOTICE_SAVE', { title: '새 공지', body: '내용' }), resident);
  assert.deepEqual(
    act(resident, 'NOTICE_SAVE', { id: saved.id, title: '고침', body: '내용' }),
    resident,
  );
  assert.deepEqual(act(resident, 'NOTICE_DELETE', { id: saved.id }), resident);
  // 방장은 수정할 때도 공백을 다듬는다
  s = act(s, 'NOTICE_SAVE', { id: saved.id, title: ' 고친 공지 ', body: ' 고친 본문 ' });
  assert.deepEqual(
    [currentIsland(s).notices[0].title, currentIsland(s).notices[0].body],
    ['고친 공지', '고친 본문'],
  );
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

test('방문자는 다른 섬을 구경만 하고 쓰기는 막히며, 가입하면 구경이 끝난다', () => {
  let s = initialState(true);
  const cloud = () => s.islands.find((island) => island.id === 'cloud')!;
  // 가입한 섬·집중 중·내 섬에 전망대가 없을 때는 방문자로 내릴 수 없다
  const noTower = JSON.parse(JSON.stringify(s));
  currentIsland(noTower).buildings = currentIsland(noTower).buildings.filter(
    (b: string) => b !== 'tower',
  );
  assert.equal(canVisit(noTower, 'cloud'), false);
  assert.equal(canVisit(s, 'soda'), false);
  assert.deepEqual(act(s, 'VISIT', { id: 'soda' }), s);
  const focusing = act(s, 'START', { subject: '수학', now: 1000 });
  assert.deepEqual(act(focusing, 'VISIT', { id: 'cloud' }), focusing);

  s = act(s, 'VISIT', { id: 'cloud' });
  assert.equal(s.visitingIslandId, 'cloud');
  assert.equal(viewIsland(s).id, 'cloud');
  assert.equal(currentIsland(s).id, 'soda');
  // 구경 중에는 내 섬 대상 쓰기(집중·댓글·방장 관리)가 모두 막힌다
  assert.deepEqual(act(s, 'START', { subject: '영어' }), s);
  assert.deepEqual(act(s, 'MANAGE', { name: '이름 탈취' }), s);
  // 섬마다 공지 ID가 같아도 구경 중 댓글이 내 섬 공지에 달리지 않는다
  const notice = cloud().notices[0];
  assert.deepEqual(act(s, 'COMMENT', { id: notice.id, text: '안녕하세요' }), s);
  assert.deepEqual(act(s, 'COMMENT_DELETE', { id: notice.id, commentId: 'x' }), s);
  // 내 섬으로 전환하거나 새 섬을 만들면 구경이 끝난다
  assert.equal(act(s, 'SWITCH_ISLAND', { id: 'soda' }).visitingIslandId, null);
  assert.equal(act(s, 'CREATE_ISLAND', { name: '새 섬', capacity: 5 }).visitingIslandId, null);

  // 승인 필요 섬: 가입 신청 → 신청 취소 → 다시 가입 신청
  assert.equal(visitorJoinState(s, cloud()), 'apply');
  s = act(s, 'JOIN', { id: 'cloud' });
  assert.equal(visitorJoinState(s, cloud()), 'cancel');
  assert.equal(s.visitingIslandId, 'cloud');
  s = act(s, 'CANCEL_JOIN', { id: 'cloud' });
  assert.equal(visitorJoinState(s, cloud()), 'apply');
  // 정원이 차면 신청할 수 없다
  cloud().capacity = cloud().members.length;
  assert.equal(visitorJoinState(s, cloud()), 'full');
  assert.deepEqual(act(s, 'JOIN', { id: 'cloud' }), s);
  cloud().capacity = undefined;

  // 앱을 다시 켜면 구경이 끝난다
  assert.equal(act(s, 'LOAD', { state: s }).visitingIslandId, undefined);
  s = act(s, 'END_VISIT');
  assert.equal(s.visitingIslandId, null);
  assert.equal(viewIsland(s).id, 'soda');

  // 승인 불필요 섬: 이 섬에 가입 → 바로 주민이 되어 그 섬이 현재 섬이 된다
  s = act(s, 'VISIT', { id: 'strawberry' });
  const strawberry = s.islands.find((island) => island.id === 'strawberry')!;
  assert.equal(visitorJoinState(s, strawberry), 'join');
  s = act(s, 'JOIN', { id: 'strawberry' });
  assert.equal(s.visitingIslandId, null);
  assert.equal(s.islandId, 'strawberry');
  assert.equal(viewIsland(s).id, 'strawberry');
});

test('방문자 가입 버튼 라벨은 다섯 가지다', () => {
  assert.deepEqual(visitorJoinLabel, {
    join: '이 섬에 가입',
    apply: '가입 신청',
    cancel: '신청 취소',
    full: '정원이 가득 찼어요',
    blocked: '다시 가입할 수 없어요',
  });
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

test('집중 중에는 섬 잔액이 오르지 않고, 종료할 때 한 번에 적립한다', () => {
  let s = initialState(true);
  const now = new Date(2026, 8, 15, 12).getTime();
  const earned = earnedBy(currentIsland(s), 'me'),
    ledger = currentIsland(s).ledger.length;
  s = act(s, 'START', { subject: '공부', now });
  s = act(s, 'TICK', { now: now + 60000 });
  s = act(s, 'TICK', { now: now + 90000 });
  assert.equal(balance(currentIsland(s)), 1200);
  assert.equal(currentIsland(s).ledger.length, ledger);
  s = act(s, 'FINISH', { now: now + 120000 });
  assert.equal(balance(currentIsland(s)), 1202);
  assert.equal(s.lastResult?.fish, 2);
  assert.equal(earnedBy(currentIsland(s), 'me'), earned + 2);
  assert.equal(currentIsland(s).ledger.length, ledger + 1);
  assert.equal(currentIsland(s).ledger[0].text, `${s.name} · 집중 +2마리`);
  assert.equal(currentIsland(s).ledger[0].memberId, 'me');
  assert.equal(act(s, 'FINISH', { now: now + 180000 }), s);
  // 예전 방식으로 일부를 이미 적립한 저장 세션은 나머지만 준다
  let legacy = act(initialState(true), 'START', { subject: '예전', now });
  legacy = { ...legacy, session: { ...legacy.session!, creditedFish: 1 } };
  legacy = act(legacy, 'FINISH', { now: now + 120000 });
  assert.equal(balance(currentIsland(legacy)), 1201);
});
test('1분 미만 집중은 물고기 0마리라 가계부에 남기지 않는다', () => {
  let s = initialState(true);
  const now = new Date(2026, 8, 15, 12).getTime(),
    ledger = currentIsland(s).ledger.length;
  s = act(s, 'START', { subject: '잠깐', now });
  s = act(s, 'FINISH', { now: now + 59000 });
  assert.equal(s.lastResult?.fish, 0);
  assert.equal(balance(currentIsland(s)), 1200);
  assert.equal(currentIsland(s).ledger.length, ledger);
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

test('떠난 주민도 보존된 기록으로 달성률을 계산한다', () => {
  let s = initialState(true);
  const now = Date.UTC(2026, 8, 16, 3); // 12:00 KST
  const island = currentIsland(s),
    member = island.members[0];
  island.quests[0].windowStart = '09:00';
  island.quests[0].windowEnd = '18:00';
  member.records = [
    {
      id: 'kept',
      islandId: island.id,
      subject: '집중',
      seconds: 900,
      at: Date.UTC(2026, 8, 16, 2),
      fish: 0,
      contributed: true,
    },
  ];
  member.screenDays = { [dayKey(now)]: 60 };
  const before = questMemberRate(s, island.quests[0], member.id, island.id, now);
  assert.equal(before, 50);
  s = act(s, 'KICK', { id: member.id });
  assert.ok(!currentIsland(s).members.some((m) => m.id === member.id));
  assert.equal(memberOf(currentIsland(s), member.id)?.id, member.id);
  const island2 = currentIsland(s);
  assert.equal(questMemberRate(s, island2.quests[0], member.id, island2.id, now), 50);
  // 스크린타임도 보존된 기록을 쓴다 (측정 전이 아니다)
  assert.equal(questMemberRate(s, island2.quests[1], member.id, island2.id, now), 100);
});

test('시간대는 HH:MM으로 저장한다', () => {
  let s = initialState(true);
  s = act(s, 'QUEST_SAVE', {
    title: '아침 집중',
    kind: 'focus',
    windowStart: '9:00',
    windowEnd: '9:30',
    target: 20,
  });
  const q = currentIsland(s).quests.at(-1)!;
  assert.equal(q.windowStart, '09:00');
  assert.equal(q.windowEnd, '09:30');
  assert.equal(clockText('9:5'), '9:5');
  assert.equal(clockText('24:00'), '24:00');
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
  // 더 이른 시각으로 다시 열어도 읽음 기준은 뒤로 가지 않는다 (LOAD가 올려 둔 미래 시각 유지)
  const kept = currentIsland(s).chatReadAt!;
  s = act(s, 'CHAT_READ', { now: kept - 5000 });
  assert.equal(currentIsland(s).chatReadAt, kept);
  assert.equal(newChatCount(currentIsland(s)), 0);
  // 방을 연 채 도착한 미래 시각(시계 오차) 메시지도 CHAT_READ가 읽음 처리한다
  currentIsland(s).messages.push({ ...currentIsland(s).messages[0], id: 'm8', at: kept + 60_000 });
  assert.equal(newChatCount(currentIsland(s)), 1);
  s = act(s, 'CHAT_READ', { now: kept + 1000 });
  assert.equal(currentIsland(s).chatReadAt, kept + 60_000);
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

test('마지막 소속 섬에서 강퇴되면 개인 데이터는 유지하고 첫 소속 선택 상태가 된다', () => {
  let s = initialState(true);
  const island = currentIsland(s);
  island.members[0].role = 'host';
  s.session = {
    id: 'kicked-session',
    islandId: island.id,
    subject: '수학',
    startedAt: 1000,
    seconds: 0,
    status: 'active',
  };
  const personal = {
    name: s.name,
    color: s.color,
    friends: structuredClone(s.friends),
    owned: [...s.owned],
    records: structuredClone(s.records),
  };

  s = act(s, 'KICKED_FROM_ISLAND', { id: island.id });

  assert.equal(currentIsland(s).joined, false);
  assert.equal(currentIsland(s).closed, undefined);
  assert.equal(s.onboarded, false);
  assert.equal(s.session, null);
  assert.equal(currentIsland(s).kicked, true);
  assert.deepEqual(s.membershipRecovery, { reason: 'kicked', islandId: island.id });
  assert.deepEqual(
    {
      name: s.name,
      color: s.color,
      friends: s.friends,
      owned: s.owned,
      records: s.records,
    },
    personal,
  );
});

test('현재 섬에서 강퇴돼도 다른 소속이 있으면 그 섬을 현재 섬으로 복구한다', () => {
  let s = initialState(true);
  const kicked = currentIsland(s);
  const remaining = s.islands.find((island) => island.id !== kicked.id)!;
  const visiting = s.islands.find(
    (island) => island.id !== kicked.id && island.id !== remaining.id,
  )!;
  remaining.joined = true;
  s.visitingIslandId = visiting.id;
  s.session = {
    id: 'kicked-session',
    islandId: kicked.id,
    subject: '수학',
    startedAt: 1000,
    seconds: 0,
    status: 'active',
  };

  s = act(s, 'KICKED_FROM_ISLAND', { id: kicked.id });

  assert.equal(s.onboarded, true);
  assert.equal(s.islandId, remaining.id);
  assert.equal(s.visitingIslandId, null);
  assert.equal(s.session, null);
  assert.deepEqual(s.membershipRecovery, { reason: 'kicked', islandId: kicked.id });
});

test('가입한 보조 섬을 방문 중 강퇴되면 현재 섬으로 화면 복구 신호를 남긴다', () => {
  let s = initialState(true);
  const home = currentIsland(s);
  const visited = s.islands.find((island) => island.id !== home.id)!;
  visited.joined = true;
  s.visitingIslandId = visited.id;

  s = act(s, 'KICKED_FROM_ISLAND', { id: visited.id });

  assert.equal(s.islandId, home.id);
  assert.equal(s.visitingIslandId, null);
  assert.equal(visited.id, s.membershipRecovery?.islandId);
  assert.equal(s.islands.find((island) => island.id === visited.id)?.kicked, true);
});

test('강퇴된 섬은 일반 탐색·초대 코드·가입 경로에서 복원하지 않는다', () => {
  let s = initialState(true);
  const kicked = currentIsland(s);
  kicked.members[0].role = 'host';
  const id = kicked.id;

  s = act(s, 'KICKED_FROM_ISLAND', { id });
  const blocked = s.islands.find((island) => island.id === id)!;

  assert.equal(canVisit(s, id), false);
  assert.equal(visitorJoinState(s, blocked), 'blocked');
  assert.equal(findIslandByInviteCode(s.islands, inviteCodeOf(blocked)), undefined);
  assert.deepEqual(act(s, 'JOIN', { id }), s);
});

test('저장본 세션의 섬 소속을 잃었으면 다른 소속이 남아도 세션을 복원하지 않는다', () => {
  const saved = initialState(true);
  const lost = currentIsland(saved);
  const remaining = saved.islands.find((island) => island.id !== lost.id)!;
  lost.joined = false;
  remaining.joined = true;
  saved.session = {
    id: 'stale-session',
    islandId: lost.id,
    subject: '수학',
    startedAt: 1000,
    seconds: 0,
    status: 'paused',
  };

  const restored = act(initialState(), 'LOAD', { state: saved });

  assert.equal(restored.onboarded, true);
  assert.equal(restored.islandId, remaining.id);
  assert.equal(restored.session, null);
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

test('가입 신청은 한 명씩 승인·거절하고, 정원이 차면 승인만 막는다', () => {
  let s = initialState(true);
  const island = currentIsland(s);
  island.requests = [
    { id: 'mocha', name: '모카', color: 'cream' },
    { id: 'cheese', name: '치즈', color: 'ginger' },
  ];
  s = act(s, 'REJECT_MEMBER', { id: 'cheese' });
  assert.deepEqual(
    joinRequests(currentIsland(s)).map((r) => r.id),
    ['mocha'],
  );
  currentIsland(s).capacity = 4;
  assert.deepEqual(act(s, 'ADD_MEMBER', { id: 'mocha' }), s);
  currentIsland(s).capacity = 5;
  s = act(s, 'ADD_MEMBER', { id: 'mocha' });
  assert.equal(currentIsland(s).members.at(-1)!.name, '모카');
  assert.equal(joinRequests(currentIsland(s)).length, 0);
});

test('예전 저장본은 LOAD에서 가입 신청을 빈 목록으로, 규칙에 안 맞는 상점 목표는 해제한다', () => {
  const saved = initialState(true);
  for (const island of saved.islands) delete island.requests;
  const soda = currentIsland(saved);
  soda.buildings = ['hall', 'board', 'mail', 'tower'];
  soda.buildingQuest = { building: 'shop', targets: ['me'], selectedAt: 1 };
  soda.nextBuilding = 'shop';
  const s = act(initialState(), 'LOAD', { state: saved });
  assert.ok(s.islands.every((island) => joinRequests(island).length === 0));
  assert.equal(currentIsland(s).buildingQuest, undefined);
  assert.equal(currentIsland(s).nextBuilding, undefined);
});

test('강퇴한 주민은 건설 퀘스트 대상에서 빠진다', () => {
  let s = initialState(true);
  currentIsland(s).buildings = ['hall', 'board'];
  s = act(s, 'SELECT_BUILDING', { building: 'library' });
  assert.ok(currentIsland(s).buildingQuest!.targets.includes('dubu'));
  s = act(s, 'KICK', { id: 'dubu' });
  assert.ok(!currentIsland(s).buildingQuest!.targets.includes('dubu'));
});

test('목표로 정하기는 게시판 완공 후·공사 중이 아닐 때만 되고, 화면과 reducer가 같은 규칙을 쓴다', () => {
  let s = initialState(true);
  const island = currentIsland(s);
  island.buildings = ['hall'];
  assert.match(canSelectBuilding(island, 'library')!, /게시판/);
  assert.deepEqual(act(s, 'SELECT_BUILDING', { building: 'library' }), s);
  island.buildings = ['hall', 'board'];
  island.construction = { building: 'gram', startedAt: 0, endsAt: 1, cost: 1360 };
  assert.match(canSelectBuilding(island, 'library')!, /공사/);
  assert.deepEqual(act(s, 'SELECT_BUILDING', { building: 'library' }), s);
  delete island.construction;
  assert.equal(canSelectBuilding(island, 'library'), null);
  s = act(s, 'SELECT_BUILDING', { building: 'library' });
  assert.equal(currentIsland(s).buildingQuest?.building, 'library');
});

test('혼자 남은 방장이 섬을 떠나면 섬 공동 데이터를 지우고 개인 기록은 남긴다', () => {
  let s = initialState(true);
  const island = currentIsland(s);
  island.formerMembers = [{ ...island.members[0], id: 'gone' }];
  island.members = [];
  island.track = 'rain';
  island.ledger = [{ id: 'l1', text: '집중 +10마리', at: 1 }];
  const order = (id: string, product: string, islandId: string) => ({
    id,
    product,
    islandId,
    currency: 'fish',
    price: 100,
    at: 1,
  });
  s.orders = [
    order('mine', 'scarf', island.id),
    order('theme', 'soda-theme', island.id),
    order('song', 'rain', island.id),
    order('other', 'rain', 'strawberry'),
  ];
  s.records = [
    {
      id: 'r1',
      islandId: island.id,
      subject: '집중',
      seconds: 600,
      at: 1,
      fish: 10,
      contributed: true,
    },
  ];
  s = act(s, 'LEAVE');
  const closed = s.islands.find((j) => j.id === island.id)!;
  assert.equal(balance(closed), 0);
  assert.deepEqual(closed.ledger, []);
  assert.deepEqual(closed.buildings, []);
  assert.equal(closed.buildingQuest, undefined);
  assert.deepEqual(closed.formerMembers, []);
  assert.equal(closed.intro, '');
  // 구매한 공동 음원 선택도 기본 음원으로 돌아간다
  assert.equal(closed.track, 'waves');
  // 개인 주문(스카프)과 다른 섬 주문은 남고, 닫힌 섬의 공동 구매만 지운다
  assert.deepEqual(
    s.orders.map((o) => o.id),
    ['mine', 'other'],
  );
  assert.equal(s.records.length, 1);
});

test('예전 버전에서 이미 닫힌 섬도 LOAD에서 공동 데이터를 지우고, 다시 LOAD해도 같다', () => {
  const saved = initialState(true);
  const old = saved.islands.find((j) => j.id === 'cloud')!;
  Object.assign(old, {
    closed: true,
    visibility: 'private',
    members: [],
    fish: 900,
    track: 'rain',
  });
  old.formerMembers = [{ ...saved.islands[1].members[0], id: 'gone' }];
  old.ledger = [{ id: 'l', text: '집중 +10마리', at: 1 }];
  saved.orders = [
    { id: 'mine', product: 'scarf', islandId: old.id, currency: 'fish', price: 100, at: 1 },
    { id: 'theme', product: 'soda-theme', islandId: old.id, currency: 'fish', price: 1000, at: 1 },
    { id: 'open', product: 'rain', islandId: 'soda', currency: 'fish', price: 150, at: 1 },
  ];
  saved.rewards = [
    {
      id: 'rw',
      islandId: old.id,
      questId: 'q-focus',
      day: '2026-09-17',
      amount: 10,
      kind: 'personal',
      acknowledged: false,
    },
  ];
  const once = act(initialState(), 'LOAD', { state: saved });
  const cleaned = once.islands.find((j) => j.id === old.id)!;
  assert.equal(balance(cleaned), 0);
  assert.deepEqual(cleaned.ledger, []);
  assert.deepEqual(cleaned.messages, []);
  assert.deepEqual(cleaned.formerMembers, []);
  assert.equal(cleaned.intro, '');
  assert.equal(cleaned.track, 'waves');
  assert.equal(once.rewards?.length, 0);
  assert.deepEqual(
    once.orders.map((o) => o.id),
    ['mine', 'open'],
  );
  // 열린 섬은 그대로
  assert.equal(balance(currentIsland(once)), balance(currentIsland(saved)));
  assert.deepEqual(act(initialState(), 'LOAD', { state: once }), once);
});

test('섬을 떠나면 그 섬의 받지 않은 보상을 지우고, 닫힌 섬 보상은 CLAIM해도 적립 없이 닫힌다', () => {
  let s = initialState(true);
  const island = currentIsland(s);
  island.members = [];
  const reward = {
    id: 'rw',
    islandId: island.id,
    questId: 'q-focus',
    day: '2026-09-17',
    amount: 10,
    kind: 'personal' as const,
    acknowledged: false,
  };
  s.rewards = [reward];
  s = act(s, 'LEAVE');
  assert.equal(s.rewards?.length, 0);
  // 예전 저장본처럼 보상이 남아 있어도 닫힌 섬에는 적립하지 않고, 보상 창은 닫힌다
  s.rewards = [reward];
  const closed = s.islands.find((j) => j.id === island.id)!;
  const claimed = act(s, 'CLAIM', { id: 'rw' });
  const after = claimed.islands.find((j) => j.id === island.id)!;
  assert.equal(claimed.rewards?.filter((r) => !r.acknowledged).length, 0);
  assert.equal(balance(after), balance(closed));
  assert.deepEqual(after.ledger, closed.ledger);
  assert.deepEqual(after.earned, closed.earned);
});

test('계정 삭제로 마지막 주민이 떠난 섬도 탈퇴와 같이 공동 데이터를 지운다', () => {
  let s = initialState(true);
  const island = currentIsland(s);
  island.members = [];
  island.ledger = [{ id: 'shared', text: '마을회관 완공', at: 1 }];
  const id = island.id;
  s = act(s, 'DELETE_ACCOUNT');
  const closed = s.islands.find((candidate) => candidate.id === id)!;
  assert.equal(closed.closed, true);
  assert.equal(balance(closed), 0);
  assert.deepEqual(closed.ledger, []);
  assert.deepEqual(closed.buildings, []);
  // 주민이 남은 다른 섬은 닫지 않는다
  assert.ok(!s.islands.find((candidate) => candidate.id === 'strawberry')!.closed);
});

test('원장 한 줄은 내용과 끝의 +N마리·−N마리 금액으로 나눈다', () => {
  assert.deepEqual(ledgerParts({ text: '수빈 · 집중 +12마리' }), {
    title: '수빈 · 집중',
    amount: 12,
  });
  assert.deepEqual(ledgerParts({ text: '도서관 공사 시작 −2,720마리' }), {
    title: '도서관 공사 시작',
    amount: -2720,
  });
  assert.deepEqual(ledgerParts({ text: '도서관 완공' }), { title: '도서관 완공', amount: 0 });
});

test('강퇴된 주민이 다시 가입하면 예전 기록을 이어받고, 다시 강퇴해도 그 기록이 남는다', () => {
  let s = initialState(true);
  const island = currentIsland(s);
  island.members.find((m) => m.id === 'dubu')!.records = [
    {
      id: 'dubu-old',
      islandId: island.id,
      subject: '국어 독해',
      seconds: 960,
      at: 1,
      fish: 16,
      contributed: true,
    },
  ];
  s = act(s, 'KICK', { id: 'dubu' });
  currentIsland(s).requests = [{ id: 'dubu', name: '두부', color: 'cream' }];
  s = act(s, 'ADD_MEMBER', { id: 'dubu' });
  const rejoined = currentIsland(s).members.find((m) => m.id === 'dubu')!;
  assert.equal(rejoined.records?.[0].id, 'dubu-old');
  assert.equal(rejoined.role, 'member');
  assert.deepEqual(currentIsland(s).formerMembers, []);
  s = act(s, 'KICK', { id: 'dubu' });
  const former = currentIsland(s).formerMembers!;
  assert.equal(former.length, 1);
  assert.equal(former[0].records?.[0].seconds, 960);
});

// ── 섬 서버 동기화(GROMO-2006) — serverIslands 스냅샷만 쓰고 로컬 fixture를 건드리지 않는다 ──
const sum = (id: string, over: object = {}) => ({
  id,
  name: `서버 섬 ${id}`,
  intro: '소개',
  visibility: 'public',
  approvalRequired: false,
  memberCount: 3,
  maxMembers: 15,
  membershipStatus: 'none',
  joinRequestId: null,
  growthStage: null,
  themeId: null,
  ...over,
});
const req = (id: string, islandId: string, status = 'pending') => ({
  id,
  islandId,
  status,
  version: 1,
  islandName: `섬 ${islandId}`,
  memberCount: 2,
  maxMembers: 15,
  createdAt: '2026-09-21T00:00:00Z',
});

test('SERVER_VILLAGE_POINTS — 서버 정본으로 교체하고 느진 버전은 버린다', () => {
  let s = initialState(true);
  const island = currentIsland(s);
  s = act(s, 'SERVER_VILLAGE_POINTS', {
    islandId: island.id,
    value: 77,
    version: 4,
  });
  assert.equal(balance(currentIsland(s)), 77);
  assert.equal(currentIsland(s).villagePointsVersion, 4);

  s = act(s, 'SERVER_VILLAGE_POINTS', {
    islandId: island.id,
    value: 10,
    version: 3,
  });
  assert.equal(balance(currentIsland(s)), 77);
});

test('ISLAND_SYNC — memberships가 정본이다: onboarded·current 반영, 로컬 fixture 소속을 만들지 않는다', () => {
  let s = initialState();
  s = act(s, 'ISLAND_SYNC', {
    memberships: {
      items: [sum('srv1', { membershipStatus: 'active' })],
      nextCursor: null,
      currentIslandId: 'srv1',
      lossReason: null,
    },
    requests: [],
  });
  const snap = s.serverIslands!;
  assert.equal(snap.currentIslandId, 'srv1');
  assert.equal(s.onboarded, true);
  // 서버 섬을 로컬 Island로 합성하지 않는다 — fixture 목록은 그대로다
  assert.equal(
    s.islands.some((i) => i.id === 'srv1'),
    false,
  );
  // 서버에 없는 로컬 joined 는 걷는다
  s.islands[0].joined = true;
  s = act(s, 'ISLAND_SYNC', {
    memberships: {
      items: [sum('srv1', { membershipStatus: 'active' })],
      nextCursor: null,
      currentIslandId: 'srv1',
      lossReason: null,
    },
  });
  assert.equal(s.islands[0].joined, false);
  // items는 있는데 current가 null — 모호 상태는 소속으로 보지 않는다(fail closed)
  s = act(s, 'ISLAND_SYNC', {
    memberships: {
      items: [sum('srv1')],
      nextCursor: null,
      currentIslandId: null,
      lossReason: null,
    },
  });
  assert.equal(s.onboarded, false);
  assert.equal(s.serverIslands!.currentIslandId, null);
});

test('ISLAND_SYNC — mainIslandId를 실으면 /me 정본으로 갈아 끼우고, 안 실으면 현재 값을 유지한다', () => {
  // GROMO-2054: 두 번째 섬 가입처럼 소속이 바뀌는 동기화는 서버 도출 메인을 함께 반영한다.
  let s = act(initialState(true), 'ISLAND_SYNC', {
    memberships: {
      items: [sum('srv1', { membershipStatus: 'active' })],
      nextCursor: null,
      currentIslandId: 'srv1',
      lossReason: null,
    },
    mainIslandId: 'srv1',
  });
  assert.equal(s.mainIslandId, 'srv1');
  // 명시 null 도 값이다 — 소속이 하나도 없으면 서버 정본은 null 이다
  s = act(s, 'ISLAND_SYNC', {
    memberships: { items: [], nextCursor: null, currentIslandId: null, lossReason: null },
    mainIslandId: null,
  });
  assert.equal(s.mainIslandId, null);
  // 필드를 안 싣는 발신자(explore의 memberships 동기화)는 로컬 선택값을 건드리지 않는다
  s.mainIslandId = 'soda';
  s = act(s, 'ISLAND_SYNC', {
    memberships: {
      items: [sum('srv1', { membershipStatus: 'active' })],
      nextCursor: null,
      currentIslandId: 'srv1',
      lossReason: null,
    },
  });
  assert.equal(s.mainIslandId, 'soda');
});

test('ISLAND_SYNC — 빈 memberships는 onboarded=false로 되돌리고 진행 중 세션·구경을 끊는다', () => {
  let s = initialState();
  s.islands[0].joined = true;
  s.islandId = s.islands[0].id;
  s = act(s, 'START', { subject: '공부', seconds: 60 });
  s.visitingIslandId = s.islands[0].id;
  s = act(s, 'ISLAND_SYNC', {
    memberships: { items: [], nextCursor: null, currentIslandId: null, lossReason: 'KICKED' },
  });
  assert.equal(s.onboarded, false);
  assert.equal(s.session, null);
  assert.equal(s.visitingIslandId, null);
  assert.equal(s.serverIslands!.lossReason, 'KICKED');
});

test('ISLAND_CANDIDATES — 페이지를 이어 붙이고 reset이면 갈아 끼운다', () => {
  let s = act(initialState(), 'ISLAND_CANDIDATES', {
    items: [sum('a')],
    nextCursor: 'c1',
    reset: true,
  });
  s = act(s, 'ISLAND_CANDIDATES', { items: [sum('a'), sum('b')], nextCursor: null });
  const snap = s.serverIslands!;
  assert.deepEqual(
    snap.candidates.map((c) => c.id),
    ['a', 'b'],
  ); // 중복 병합
  assert.equal(snap.nextCursor, null);
  s = act(s, 'ISLAND_CANDIDATES', { items: [sum('x')], nextCursor: 'c9', reset: true });
  assert.deepEqual(
    s.serverIslands!.candidates.map((c) => c.id),
    ['x'],
  );
});

test('ISLAND_REQUEST·ISLAND_SYNC_REQUESTS — 단건 상태와 서버 목록을 분리한다', () => {
  // 단건 조회는 표시 필드(islandName·memberCount·createdAt)가 없다 — 목록에 합성하지 않는다
  let s = act(initialState(), 'ISLAND_REQUEST', {
    request: { id: 'r1', islandId: 'i1', status: 'pending', version: 1 },
  });
  assert.equal(s.serverIslands!.joinRequests.length, 0);
  assert.equal(s.serverIslands!.requestStatus[0].id, 'r1');
  assert.equal(s.serverIslands!.requestStatus[0].status, 'pending');
  // 목록에 이미 있는 신청의 단건 갱신은 서버 표시 필드를 유지하고 status/version만 바꾼다
  s = act(s, 'ISLAND_SYNC_REQUESTS', { requests: [req('r2', 'i2')] });
  s = act(s, 'ISLAND_REQUEST', {
    request: { id: 'r2', islandId: 'i2', status: 'approved', version: 2 },
  });
  const got = s.serverIslands!.joinRequests.find((r) => r.id === 'r2')!;
  assert.equal(got.status, 'approved');
  assert.equal(got.islandName, '섬 i2');
  assert.equal(s.serverIslands!.requestStatus.find((r) => r.id === 'r2')!.status, 'approved');
  // 목록 재조회는 서버 pending 목록으로 통째로 갈아 끼운다 — 종결 r2는 빠진다
  s = act(s, 'ISLAND_SYNC_REQUESTS', { requests: [req('r3', 'i3')] });
  assert.deepEqual(
    s.serverIslands!.joinRequests.map((r) => r.id),
    ['r3'],
  );
  // 단건 상태는 목록과 무관하게 남는다 — 화면의 종결 안내 근거
  assert.equal(s.serverIslands!.requestStatus.find((r) => r.id === 'r2')!.status, 'approved');
});

test('ISLAND_REQUEST — version 없는 종결 결과는 기존 version을 유지한다(합성 금지)', () => {
  // 취소 응답({id,status:'cancelled'})에는 version이 없다 — 없는 값은 합성하지 않는다
  let s = act(initialState(), 'ISLAND_REQUEST', {
    request: { id: 'r1', islandId: 'i1', status: 'pending', version: 3 },
  });
  s = act(s, 'ISLAND_REQUEST', {
    request: { id: 'r1', islandId: 'i1', status: 'cancelled' },
  });
  const entry = s.serverIslands!.requestStatus.find((r) => r.id === 'r1')!;
  assert.equal(entry.status, 'cancelled');
  assert.equal(entry.version, 3);
  // 목록 항목도 version을 덮어쓰지 않고 status만 바꾼다
  s = act(s, 'ISLAND_SYNC_REQUESTS', { requests: [req('r9', 'i9')] });
  s = act(s, 'ISLAND_REQUEST', { request: { id: 'r9', islandId: 'i9', status: 'cancelled' } });
  const got = s.serverIslands!.joinRequests.find((r) => r.id === 'r9')!;
  assert.equal(got.status, 'cancelled');
  assert.equal(got.version, req('r9', 'i9').version);
});

test('myIslandsConsistent — null current+소속은 유효, items 밖 current만 모순', () => {
  const my = (items: object[], currentIslandId: string | null) => ({
    items,
    nextCursor: null,
    currentIslandId,
    lossReason: null,
  });
  // 정상: 무소속 / current가 items 안 / 첫 pending 승인이 소속을 만들었지만 current는 안 옮김
  assert.equal(myIslandsConsistent(my([], null) as any), true);
  assert.equal(myIslandsConsistent(my([sum('a')], 'a') as any), true);
  assert.equal(myIslandsConsistent(my([sum('a')], null) as any), true);
  // 모순: items 밖의 current만 fail closed
  assert.equal(myIslandsConsistent(my([sum('a')], 'zzz') as any), false);
});

test('ISLAND_SYNC — 첫 승인으로 소속만 생기고 current가 없으면 onboarded=false', () => {
  // 승인 필요 섬의 첫 신청이 승인돼 소속이 생겨도 current는 안 옮긴다 — 유효 응답이고 소속 미확정
  const s = act(initialState(false), 'ISLAND_SYNC', {
    memberships: {
      items: [sum('srv')],
      nextCursor: null,
      currentIslandId: null,
      lossReason: null,
    },
  });
  assert.equal(s.onboarded, false);
  assert.equal(s.serverIslands?.currentIslandId, null);
  assert.equal(s.serverIslands?.memberships.length, 1);
});

test('intentKeyPool — 재시도는 같은 키, 확정·종결 후 해제하면 새 키', () => {
  let n = 0;
  const pool = intentKeyPool(() => `k${++n}`);
  const k1 = pool.key('join:i1', 'tok');
  // 응답 유실·재조회 실패 동안 같은 의도 재시도 → 같은 키
  assert.equal(pool.key('join:i1', 'tok'), k1);
  // 확정 후 해제 → 취소/거절 뒤 같은 섬 재신청은 새 키(옛 pending 결과 replay 방지)
  pool.release('join:i1', 'tok');
  const k2 = pool.key('join:i1', 'tok');
  assert.notEqual(k2, k1);
  // 바뀐 의도(body·대상)는 애초에 다른 슬롯
  assert.notEqual(pool.key('join:i1', 'tok2'), k2);
  assert.notEqual(pool.key('join:i2', 'tok'), k2);
});

test('ISLAND_VISIT — 방문 화면 스냅샷을 저장한다', () => {
  const visit = {
    island: sum('i7'),
    members: { items: [], nextCursor: null, version: 1 },
    joinRequestAvailability: 'available',
    joinRequest: null,
  };
  const s = act(initialState(), 'ISLAND_VISIT', { visit });
  assert.equal(s.serverIslands!.visit!.island.id, 'i7');
});

test('todayFocusSeconds — KST 자정 기준, 현재 섬만, 자정을 넘은 구간은 이후분만, 진행 중 세션은 빼고 센다', () => {
  const s = initialState(true);
  s.islandId = 'soda';
  // KST 로 고정된 테스트 TZ(jest.config.js)라 로컬 Date 생성자가 곧 KST 벽시계 시각이다.
  const now = new Date(2026, 8, 20, 10, 0).getTime();
  s.records = [
    // 자정을 넘어 끝난 기록 — 23:30~00:30 중 자정 이후 30분(1800초)만 오늘 집중에 들어간다
    {
      id: 'cross-midnight',
      islandId: 'soda',
      subject: '공부',
      seconds: 3600,
      at: new Date(2026, 8, 20, 0, 30).getTime(),
      fish: 60,
      contributed: true,
      intervals: [
        {
          start: new Date(2026, 8, 19, 23, 30).getTime(),
          end: new Date(2026, 8, 20, 0, 30).getTime(),
        },
      ],
    },
    // 오늘, 다른 섬 — 섬이 다르므로 제외
    {
      id: 'other-island-today',
      islandId: 'strawberry',
      subject: '공부',
      seconds: 600,
      at: new Date(2026, 8, 20, 1, 0).getTime(),
      fish: 10,
      contributed: true,
    },
    // 어제, 같은 섬 — KST 자정 이전이므로 제외
    {
      id: 'yesterday',
      islandId: 'soda',
      subject: '공부',
      seconds: 600,
      at: new Date(2026, 8, 19, 10, 10).getTime(),
      fish: 10,
      contributed: true,
    },
  ];
  // 진행 중 세션은 더하지 않는다 — 서버 복원 세션은 누적 초만 있어 자정 이전 집중을 오늘로 셀 수 있다.
  // 어제 3600초를 집중하고 자정을 넘긴 복원 세션(startedAt = 복원 시각)이 오늘 값을 부풀리지 않아야 한다.
  s.session = {
    id: 'restored',
    islandId: 'soda',
    subject: '공부',
    startedAt: new Date(2026, 8, 20, 9, 55).getTime(),
    seconds: 3600,
    status: 'paused',
  };
  assert.equal(todayFocusSeconds(s, 'soda', now), 1800);
  assert.equal(todayFocusSeconds(s, 'strawberry', now), 600);
});

test('serverHome — 현재 섬의 스냅샷만 돌려주고 전환 뒤 옛 섬 스냅샷은 버린다(GROMO-2138)', () => {
  const sync = (s: any, id: string) =>
    act(s, 'ISLAND_SYNC', {
      memberships: {
        items: [sum('srv1'), sum('srv2')],
        nextCursor: null,
        currentIslandId: id,
        lossReason: null,
      },
    });
  let s = sync(initialState(), 'srv1');
  assert.equal(serverHome(s), null);
  s = act(s, 'SERVER_HOME', { facts: { islandId: 'srv1', completedBuildings: ['hall'] } });
  assert.deepEqual(serverHome(s)?.completedBuildings, ['hall']);
  s = sync(s, 'srv2');
  assert.equal(serverHome(s), null);
});
