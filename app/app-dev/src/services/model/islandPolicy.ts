import { t } from '@/i18n';
import type { MyIslands, VisitScreen } from '@/services/api/islands';
import { buildingOrder, costs, products } from './catalog';
import { dayKey } from './time';
import { Building, Island, Product, State, VisitorJoin } from './types';

export function completeAllBuildings(i: Island, now = Date.now()) {
  i.buildings = [...buildingOrder];
  i.boardCompletedDay ??= dayKey(now);
  delete i.buildingQuest;
  delete i.construction;
  delete i.nextBuilding;
  delete i.completed;
}

export const balance = (i: Island) => i.fish ?? i.contribution + i.points;

export const isHost = (i: Island) =>
  i.joined &&
  (i.serverRole !== undefined
    ? i.serverRole === 'host'
    : !i.members.some((m) => m.role === 'host'));

export const targetIds = (i: Island) => [
  ...(i.joined ? ['me'] : []),
  ...i.members.map((m) => m.id),
];

export const earnedBy = (i: Island, id: string) => i.earned?.[id] ?? 0;

// 건물 총액은 섬 인원과 무관한 고정값
export const buildingCost = (i: Island, b: Building) => costs[b];

// 대상 1인당 몫 = 총액 ÷ 대상 인원(올림). 현재 목표가 b면 스냅숏된 대상 수, 아니면(미리보기) 지금 주민 수
export const buildingShare = (i: Island, b: Building) =>
  Math.ceil(
    costs[b] /
      (i.buildingQuest?.building === b ? i.buildingQuest.targets.length : targetIds(i).length),
  );

// 목표를 고른 뒤부터 모은 양 = 현재 누적 earned − 목표 선택 시점 스냅숏(base)
export const collectedBy = (i: Island, id: string) =>
  earnedBy(i, id) - (i.buildingQuest?.base?.[id] ?? 0);

export const buildingReady = (i: Island) =>
  !!i.buildingQuest &&
  i.buildingQuest.targets.length > 0 &&
  i.buildingQuest.targets.every(
    (id) => collectedBy(i, id) >= buildingShare(i, i.buildingQuest!.building),
  ) &&
  balance(i) >= buildingCost(i, i.buildingQuest.building);

export const currentIsland = (s: State) => s.islands.find((i) => i.id === s.islandId)!;

/** 목업 섬 전환 가능 여부 — 진행 중 세션이 없고, 소속 섬이며, 온보딩 뒤에는 현재 섬에 전망대가 있어야 한다. */
export const canSwitchIsland = (s: State, id: string) => {
  const target = s.islands.find((x) => x.id === id);
  return (
    !s.session &&
    !!target?.joined &&
    !(s.onboarded && target.id !== s.islandId && !currentIsland(s).buildings.includes('tower'))
  );
};

export const mainIsland = (s: State) =>
  s.islands.find((i) => i.id === s.mainIslandId && i.joined && !i.closed) ??
  s.islands.find((i) => i.joined && !i.closed);

// 서버 모드 홈 스냅샷 — 현재 섬의 것일 때만 돌려준다(전환·이탈 뒤 옛 섬 스냅샷을 그리지 않는다)
export const serverHome = (s: State) => {
  const snap = s.serverIslands;
  return snap?.home && snap.home.islandId === snap.currentIslandId ? snap.home : null;
};

// 서버 방문 화면 스냅샷 — 지금 구경 중인 섬의 것일 때만 돌려준다. ISLAND_VISIT 가 visit 만 바꾸고
// visitingIslandId 는 그대로인 구간에 HUD·가입·떠나기 확인이 서로 다른 섬을 보지 않게 한다(GROMO-2259).
export const serverVisit = (s: State): VisitScreen | null =>
  s.visitingIslandId && s.serverIslands?.visit?.island.id === s.visitingIslandId
    ? s.serverIslands.visit
    : null;

// 화면이 그릴 섬: 구경 중이면 구경하는 섬, 아니면 내 현재 섬
export const viewIsland = (s: State, islandId = s.visitingIslandId) =>
  s.serverIslands
    ? displayIsland(s, islandId ?? s.serverIslands.currentIslandId)
    : (islandId && s.islands.find((i) => i.id === islandId)) || currentIsland(s);

// 서버 모드 홈이 그릴 섬(GROMO-2138) — 스냅샷에 있는 값만 채우고 퀘스트·공사·꾸미기·주민 기록처럼
// 스냅샷에 없는 것은 비운다(로컬 목업 섬 값으로 메우지 않는다). 구경 중이거나 스냅샷이 없으면 viewIsland.
export const homeIsland = (s: State): Island => viewIsland(s);

/** 화면 전용 읽기 모델. 서버에 없는 목록·권한을 로컬 목업으로 채우지 않는다. */
export const displayIsland = (s: State, id = s.serverIslands?.currentIslandId): Island => {
  const snap = s.serverIslands;
  if (!snap) return currentIsland(s);
  const facts = id === snap.currentIslandId && id !== s.visitingIslandId ? serverHome(s) : null;
  const visit = snap.visit?.island.id === id ? snap.visit : null;
  const island =
    facts?.home.island ??
    snap.memberships?.find((item) => item.id === id) ??
    (snap.visit && snap.visit.island.id === id ? snap.visit.island : undefined) ??
    snap.candidates?.find((item) => item.id === id);
  const homePlayback = facts?.home.playback;
  const playback = !facts
    ? null
    : snap.playback && snap.playback.version >= (homePlayback?.version ?? -1)
      ? snap.playback
      : homePlayback;
  return {
    id: id ?? '',
    name: island?.name ?? '',
    intro: island?.intro ?? '',
    approval: island?.approvalRequired ?? false,
    capacity: island?.maxMembers,
    joined:
      !!id && (id === snap.currentIslandId || !!snap.memberships?.some((item) => item.id === id)),
    serverRole: facts?.home.island.role ?? null,
    serverMemberCount: island?.memberCount,
    buildings: facts ? [...facts.completedBuildings] : [...(visit?.buildings ?? [])],
    fish: facts?.home.wallets.villagePoints ?? 0,
    points: facts?.home.wallets.villagePoints ?? 0,
    contribution: facts?.home.wallets.villagePoints ?? 0,
    members: [],
    quests: [],
    notices: [],
    messages: [],
    sharedOwned: [],
    theme: 'default',
    buildingTheme: 'default',
    track: playback?.trackId ?? null,
    playing: playback?.playing ?? false,
    serverPlayback: playback ?? undefined,
    ledger: [],
  };
};

// 방문자로 내릴 수 있는지: 섬에 자리 잡은 뒤, 지금 섬 전망대에서, 집중 중이 아닐 때 미가입 섬만
export const canVisit = (s: State, id: string) => {
  const target = s.islands.find((i) => i.id === id);
  return (
    s.onboarded &&
    !s.session &&
    currentIsland(s).joined &&
    currentIsland(s).buildings.includes('tower') &&
    !!target &&
    !target.joined &&
    !target.kicked &&
    !target.closed
  );
};

// 회관에서 다음 건물로 고를 수 있는 건물. 이 건물이 완공될 때만 게시판 청사진에 완공 안내를 남긴다
export const nextBuildings: Building[] = ['gram', 'library', 'mail', 'tower', 'shop'];

// 친구 편지를 보낼 수 있는지: 지금 친구이고 내 섬에 우체통이 있어야 한다 (받는 섬은 상관없다)
export const canSendLetter = (s: State, friendId: string) =>
  s.friends?.find((f) => f.id === friendId)?.status === 'friend' &&
  currentIsland(s).buildings.includes('mail');

// 친구가 보내고 아직 읽고 닫지 않은 편지 (최신순)
export const unreadLetters = (s: State) =>
  (s.friends ?? [])
    .filter((f) => f.status === 'friend')
    .flatMap((f) =>
      f.messages
        .filter((m) => m.memberId !== 'me' && !m.readAt && m.at > (s.lettersReadAt ?? 0))
        .map((m) => ({ friend: f, letter: m })),
    )
    .sort((a, b) => b.letter.at - a.letter.at);

// 친구 편지의 기존 읽음 정본을 따른다. 방문 중에는 내 편지 상태를 남의 섬에 표시하지 않는다.
export const hasMailboxLetters = (s: State, islandId = s.islandId) =>
  !s.visitingIslandId &&
  islandId === s.islandId &&
  currentIsland(s).joined &&
  currentIsland(s).buildings.includes('mail') &&
  unreadLetters(s).length > 0;

export const shouldShowMailboxGuide = (s: State, userId: string) =>
  !s.visitingIslandId &&
  !s.session &&
  currentIsland(s).joined &&
  (s.serverIslands
    ? serverHome(s)?.completedBuildings.includes('mail')
    : currentIsland(s).buildings.includes('mail')) &&
  !s.mailboxGuideSeenBy?.includes(userId);

export const shouldShowShopGuide = (s: State, userId: string) =>
  !s.visitingIslandId &&
  currentIsland(s).joined &&
  (s.serverIslands
    ? serverHome(s)?.completedBuildings.includes('shop')
    : currentIsland(s).buildings.includes('shop')) &&
  !s.shopGuideSeenBy?.includes(userId);

// 채팅방을 마지막으로 연 뒤 다른 주민이 남긴 글 수
// 내 댓글인지: memberId가 없던 예전 저장본은 작성자 이름을 내 이름(바꾼 이름 포함)과 비교한다
// 주민 찾기: 지금 주민이 아니면 떠난 주민(기록 보존)에서 찾는다. 달성률·보상 판정이 같은 기록을 본다
export const memberOf = (i: Island, id: string) =>
  i.members.find((m) => m.id === id) ?? i.formerMembers?.find((m) => m.id === id);

export const isOwnComment = (s: State, c: { memberId?: string; name: string }) =>
  c.memberId != null ? c.memberId === 'me' : [s.name, ...(s.profileNames ?? [])].includes(c.name);

export const newChatCount = (i: Island) =>
  i.messages.filter((m) => m.memberId !== 'me' && m.at > (i.chatReadAt ?? 0)).length;

export const CAPACITY_MIN = 1,
  CAPACITY_MAX = 15;

// 주민 수 = 다른 주민 + (내가 가입했으면) 나
export const residentCount = (i: Island) =>
  i.serverMemberCount ?? i.members.length + (i.joined ? 1 : 0);

export const capacityOf = (i: Island) => i.capacity ?? CAPACITY_MAX;

export const isFull = (i: Island) => residentCount(i) >= capacityOf(i);

export const pendingVisitRequest = (s: State, islandId: string) => {
  const snap = s.serverIslands;
  if (!snap) return undefined;
  const requests = [
    ...(snap.requestStatus ?? []),
    ...(snap.joinRequests ?? []),
    ...(snap.visit?.island.id === islandId && snap.visit.joinRequest
      ? [snap.visit.joinRequest]
      : []),
  ];
  const terminalIds = new Set(requests.filter((r) => r.status !== 'pending').map((r) => r.id));
  return requests.find(
    (r) => r.islandId === islandId && r.status === 'pending' && !terminalIds.has(r.id),
  );
};

export const visitorJoinState = (s: State, i: Island): VisitorJoin =>
  i.kicked
    ? 'blocked'
    : (
          s.serverIslands
            ? !!pendingVisitRequest(s, i.id)
            : (s.pendingIslands ?? []).includes(i.id) || s.pendingIsland === i.id
        )
      ? 'cancel'
      : isFull(i)
        ? 'full'
        : i.approval
          ? 'apply'
          : 'join';

// 읽는 시점에 번역한다 — 모듈 최상위에서 t() 를 부르면 import 시점 언어로 굳는다(i18n/index.ts)
// 게터 객체다 — 펼치거나 직렬화하면 그 시점 로케일로 굳는다(펼치지 말 것).
export const visitorJoinLabel: Record<VisitorJoin, string> = {
  get join() {
    return t('islandVisit.visitorJoin.join');
  },
  get apply() {
    return t('islandVisit.visitorJoin.apply');
  },
  get cancel() {
    return t('islandVisit.visitorJoin.cancel');
  },
  get full() {
    return t('islandVisit.visitorJoin.full');
  },
  get blocked() {
    return t('islandVisit.visitorJoin.blocked');
  },
};

export const inviteCodeOf = (i: Island) => i.id.toUpperCase();

export const findIslandByInviteCode = (islands: Island[], code: string) =>
  islands.find((i) => !i.closed && !i.kicked && inviteCodeOf(i) === code.trim().toUpperCase());

// /me/islands 응답 정합(GROMO-2006) — current가 있으면 items 안에 있어야 한다.
// current null+소속 존재는 유효하다: 첫 pending 승인이 소속을 만들어도 current는 안 옮기고,
// current 섬에서 나가도 남은 소속은 유지된다. 모순(items 밖 current)만 걸러낸다.
export const myIslandsConsistent = (my: MyIslands) =>
  my.currentIslandId == null || my.items.some((x) => x.id === my.currentIslandId);

export function canBuild(s: State, b: Building): string | null {
  const i = currentIsland(s);
  if (!isHost(i)) return t('app.build.blocked.notHost');
  if (i.construction) return t('app.build.blocked.underConstruction');
  if (i.buildings.includes(b)) return t('app.build.blocked.alreadyBuilt');
  if (b === 'board' && !i.buildings.includes('hall')) return t('app.build.blocked.hallRequired');
  if (b !== 'hall' && b !== 'board') {
    if (!i.buildings.includes('board')) return t('app.build.blocked.boardRequired');
    if (i.buildingQuest?.building !== b) return t('app.build.blocked.selectNextBuilding');
    if (
      !i.buildingQuest.targets.length ||
      !i.buildingQuest.targets.every((id) => collectedBy(i, id) >= buildingShare(i, b))
    )
      return t('app.build.blocked.targetNotMet');
    if (b === 'shop' && !shopPrerequisitesMet(i)) return t('app.build.blocked.shopPrerequisite');
  }
  return balance(i) < buildingCost(i, b) ? t('app.build.blocked.insufficientBalance') : null;
}

// 상점은 도서관·전망대·우체통·축음기를 모두 완공한 뒤 고른다 (정책-결정-2026-09-14)
export const shopPrerequisitesMet = (i: Island) =>
  (['library', 'tower', 'mail', 'gram'] as Building[]).every((building) =>
    i.buildings.includes(building),
  );

export const joinRequests = (i: Island) => i.requests ?? [];

// 원장 한 줄 = 내용 + 금액(+적립, −사용). 금액은 문구 끝 "+N마리"/"−N마리"에만 있다
export const ledgerParts = (entry: { text: string }) => {
  const m = entry.text.match(/^(.*?)\s*([+−-])([\d,]+)마리\s*$/);
  return m
    ? { title: m[1], amount: (m[2] === '+' ? 1 : -1) * Number(m[3].replace(/,/g, '')) }
    : { title: entry.text, amount: 0 };
};

// 다음 건물 목표로 고를 수 없는 이유. 없으면 null (방장 여부는 reducer의 hostOnly가 따로 막는다)
export function canSelectBuilding(i: Island, b: Building): string | null {
  if (!['gram', 'library', 'mail', 'tower', 'shop'].includes(b)) return '고를 수 없는 건물이에요.';
  if (i.buildings.includes(b)) return '이미 완공한 건물이에요.';
  if (!i.buildings.includes('board')) return '게시판을 완공한 뒤 목표를 정할 수 있어요.';
  if (i.construction) return '공사가 끝난 뒤 다음 목표를 정할 수 있어요.';
  if (b === 'shop' && !shopPrerequisitesMet(i))
    return '상점은 다른 네 건물을 모두 완공한 뒤 목표로 정할 수 있어요.';
  if (i.buildingQuest?.building === b) return '이미 목표로 정한 건물이에요.';
  return null;
}

// 마지막 주민이 떠난 섬을 닫는다: 탐색·재가입에서 빼고 섬 공동 데이터와 그 섬 보상을 지운다.
// 개인 기록·보유품은 State 쪽에 남는다 (정책 GROMO-1843)
export function closeIsland(s: State, i: Island) {
  Object.assign(i, {
    closed: true,
    visibility: 'private',
    // 이름·id는 기록 참조용으로 남기고 소개 글은 공동 데이터라 지운다
    intro: '',
    fish: 0,
    earned: {},
    ledger: [],
    // 강퇴·탈퇴 주민의 이름·색·기록도 섬 공동 데이터라 같이 지운다
    formerMembers: [],
    buildings: [],
    quests: [],
    notices: [],
    messages: [],
    sharedOwned: [],
    requests: [],
    theme: 'default',
    buildingTheme: 'default',
    buildingThemes: {},
    playing: false,
    // 구매한 공동 음원 선택도 공동 데이터라 기본 음원으로 되돌린다
    track: 'waves',
  });
  delete i.buildingQuest;
  delete i.construction;
  delete i.nextBuilding;
  s.rewards = (s.rewards ?? []).filter((r) => r.islandId !== i.id);
  // 그 섬의 공동 구매(섬·건물 테마·음원) 내역도 지운다. 옷·장신구는 개인 보유품이라 남긴다
  s.orders = s.orders.filter(
    (o) =>
      o.islandId !== i.id ||
      !['island', 'building', 'audio'].includes(
        products.find((p) => p.id === o.product)?.kind ?? '',
      ),
  );
  s.pendingIslands = (s.pendingIslands ?? []).filter((id) => id !== i.id);
  if (s.pendingIsland === i.id) s.pendingIsland = s.pendingIslands.at(-1) ?? null;
}

// 내 소속이 사라졌을 때의 공통 정리. 자진 탈퇴는 마지막 주민이면 섬도 닫지만,
// 강퇴는 방장이 남아 있으므로 내 소속과 개인 화면 컨텍스트만 정리한다.
export function removeOwnMembership(s: State, island: Island, closeWhenEmpty: boolean) {
  const wasCurrent = s.islandId === island.id;
  island.joined = false;
  s.rewards = (s.rewards ?? []).filter((reward) => reward.islandId !== island.id);
  if (island.buildingQuest)
    island.buildingQuest.targets = island.buildingQuest.targets.filter((id) => id !== 'me');
  if (closeWhenEmpty && island.members.length === 0) closeIsland(s, island);

  const nextIsland = s.islands.find((candidate) => candidate.joined && !candidate.closed);
  s.onboarded = !!nextIsland;
  if (wasCurrent && nextIsland) s.islandId = nextIsland.id;
  if (s.mainIslandId === island.id) s.mainIslandId = nextIsland?.id ?? null;
  if (wasCurrent || s.visitingIslandId === island.id || !nextIsland) s.visitingIslandId = null;
  // 소속을 잃은 섬의 진행 중 집중은 서버에서도 강제 종료된다. 로컬 상태에 좀비 세션을 남기지 않는다.
  // 바다 세션(GROMO-2310)의 islandId 는 목적지라 소속과 무관하다
  if (s.session?.kind !== 'sea' && s.session?.islandId === island.id) s.session = null;
}

export function canBuy(s: State, p: Product): string | null {
  const i = currentIsland(s);
  if (!i.joined) return '이 섬 주민만 구매할 수 있어요.';
  if (p.kind === 'audio' ? !i.buildings.includes('gram') : !i.buildings.includes('shop'))
    return p.kind === 'audio' ? '축음기 완공 후 구매할 수 있어요.' : '상점이 아직 열리지 않았어요.';
  if ((p.kind === 'clothes' ? s.owned : i.sharedOwned).includes(p.id))
    return '이미 보유하고 있어요.';
  return balance(i) < p.price ? '섬 물고기 잔액이 부족해요.' : null;
}
