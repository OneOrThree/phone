import { t, tForLocale, SUPPORTED_LOCALES } from '@/i18n';
import type { IslandSummary, MyIslands, MyJoinRequest, VisitScreen } from '@/services/api/islands';
import type { PlaybackState } from '@/services/api/playback';
import type { PersonalInventory, SharedInventory } from '@/services/api/shop';
import type { HomeWorldFacts } from '@/services/homeSnapshot';
import { SECONDS_PER_FISH, buildMinutes, buildingNames, buildingOrder, products } from './catalog';
import { initialState, makeIsland, uuid } from './fixtures';
import {
  ensureQuestRound,
  evaluateQuests,
  idleTicks,
  sessionSeconds,
  tickIdle,
} from './focusPolicy';
import {
  CAPACITY_MAX,
  CAPACITY_MIN,
  balance,
  buildingCost,
  canBuild,
  canBuy,
  canSelectBuilding,
  canSendLetter,
  canSwitchIsland,
  canVisit,
  closeIsland,
  completeAllBuildings,
  currentIsland,
  earnedBy,
  isFull,
  isHost,
  isOwnComment,
  joinRequests,
  nextBuildings,
  removeOwnMembership,
  residentCount,
  shopPrerequisitesMet,
  shouldShowMailboxGuide,
  shouldShowShopGuide,
  targetIds,
} from './islandPolicy';
import { clockMinutes, clockText, dayKey } from './time';
import { Action, Building, Friend, RecordItem, RequestStatusEntry, Session, State } from './types';

// 서버 온보딩 스냅샷 접근 — null 이면 빈 껍데기를 만든다(리듀서 내부 전용).
// 구 저장본은 requestStatus가 없을 수 있어 읽기 전에 채운다.
const serverSnap = (s: State) => {
  const snap = (s.serverIslands ??= {
    memberships: [],
    currentIslandId: null,
    lossReason: null,
    candidates: [],
    nextCursor: null,
    visit: null,
    joinRequests: [],
    requestStatus: [],
  });
  snap.requestStatus ??= [];
  return snap;
};

export function reducer(state: State, a: Action): State {
  if (a.type === 'RESET') return initialState(!!a.full);
  if (a.type === 'LOAD') {
    const loaded = JSON.parse(JSON.stringify(a.state)) as State;
    // 앱을 다시 켜면 구경을 끝내고 내 섬에서 시작한다
    delete loaded.visitingIslandId;
    delete loaded.visitLeaveAsked;
    delete loaded.visitGreeted;
    const retired = ['flag', 'sailboat', 'cabinboat', 'scarf', 'straw-hat'];
    const loadedAt = a.now ?? Date.now();
    loaded.islands.forEach((i) => {
      i.formerMembers ??= [];
      // 채팅 읽음 기준이 없던 저장본은 지금까지의 글을 모두 읽은 것으로 본다
      i.chatReadAt ??= Math.max(loadedAt, ...i.messages.map((m) => m.at));
      // 예전 저장본: 가입 신청 목록이 없으면 빈 목록(가짜 새봄 신청을 띄우지 않는다)
      i.requests ??= [];
      const earliestRound = i.quests.flatMap((quest) => Object.keys(quest.rounds ?? {})).sort()[0];
      if (i.joined) i.joinedDay ??= earliestRound ?? dayKey(loadedAt);
      if (i.buildings.includes('board')) i.boardCompletedDay ??= earliestRound ?? dayKey(loadedAt);
      i.quests.forEach((quest) => {
        quest.createdDay ??= Object.keys(quest.rounds ?? {}).sort()[0] ?? dayKey(loadedAt);
      });
      // 예전 규칙(전망대·우체통만 선행)으로 고른 상점 목표는 지금 규칙에 안 맞으면 해제한다
      if (i.buildingQuest?.building === 'shop' && !i.construction && !shopPrerequisitesMet(i)) {
        delete i.buildingQuest;
        delete i.nextBuilding;
      }
      i.fish ??= i.points + i.contribution + (i.id === loaded.islandId ? loaded.fish : 0);
      i.earned ??= Object.fromEntries(
        targetIds(i).map((id) => [
          id,
          id === 'me'
            ? loaded.records.filter((r) => r.islandId === i.id).reduce((n, r) => n + r.fish, 0)
            : 0,
        ]),
      );
    });
    const pendingIslands =
      loaded.pendingIslands ?? (loaded.pendingIsland ? [loaded.pendingIsland] : []);
    const loadedMainIsland = loaded.islands.find(
      (island) => island.id === loaded.mainIslandId && island.joined && !island.closed,
    );
    const next: State = {
      ...loaded,
      // 재실행은 홈에서 체험을 다시 시작한다. 보상은 서버의 계정 영수증으로 복구한다.
      tutorialExperience: undefined,
      schema: 2,
      fish: 0,
      friends: loaded.friends ?? [],
      rewards: loaded.rewards ?? [],
      screenDays: loaded.screenDays ?? {},
      screenTimeUnconfirmedDays: loaded.screenTimeUnconfirmedDays ?? [],
      profileNames: loaded.profileNames ?? [loaded.name],
      mainIslandId: loaded.serverIslands
        ? (loaded.mainIslandId ?? null)
        : (loadedMainIsland?.id ??
          loaded.islands.find((island) => island.joined && !island.closed)?.id ??
          null),
      // 받은 편지 읽음 기준이 없던 저장본은 이미 받은 편지를 모두 읽은 것으로 본다
      lettersReadAt:
        loaded.lettersReadAt ??
        Math.max(loadedAt, ...(loaded.friends ?? []).flatMap((f) => f.messages.map((m) => m.at))),
      pendingIslands,
      pendingIsland: loaded.pendingIsland ?? pendingIslands.at(-1) ?? null,
      // 재실행 복구용 서버 온보딩 스냅샷 — 공개 요약·신청만 담겨 있어 저장해도 안전하다
      // 홈 스냅샷은 저장본에서 되살리지 않는다 — 재실행마다 서버에서 새로 받는다(GROMO-2138)
      serverIslands: loaded.serverIslands
        ? { ...loaded.serverIslands, home: null, playback: null }
        : null,
      settings: {
        ...loaded.settings,
        // 표식 없는 저장본의 reduceMotion 은 OS 가 쓴 값과 사용자가 켠 값을 가를 수 없다 — 한 번 끄고 표식을 남긴다(GROMO-2159)
        reduceMotion: loaded.settings.reduceMotionUserOnly ? loaded.settings.reduceMotion : false,
        reduceMotionUserOnly: true,
        publicRecords: true,
        screenTimeHistoryReady: loaded.settings.screenTimeHistoryReady ?? false,
      },
      equipped: {
        ...loaded.equipped,
        clothes: 'default',
        hull: 'raft',
        decor: 'none',
        position: 'front',
      },
      owned: loaded.owned.filter((id) => !retired.includes(id)),
      orders: loaded.orders.filter((o) => !retired.includes(o.product)),
    };
    // 예전 버전에서 닫힌 섬에 남아 있던 공동 데이터도 지금 규칙대로 정리한다(여러 번 해도 같다)
    next.islands.forEach((i) => i.closed && closeIsland(next, i));
    // 저장본·서버 동기화 결과가 onboarded 플래그보다 우선한다.
    const joined = next.islands.filter((island) => island.joined && !island.closed);
    next.onboarded = joined.length > 0;
    if (!joined.some((island) => island.id === next.islandId) && joined[0])
      next.islandId = joined[0].id;
    if (
      next.session &&
      next.session.kind !== 'sea' &&
      !joined.some((island) => island.id === next.session!.islandId)
    )
      next.session = null;
    if (!next.onboarded) next.visitingIslandId = null;
    return next;
  }
  const hostOnly = [
    'MANAGE',
    'KICK',
    'TRANSFER',
    'ADD_MEMBER',
    'REJECT_MEMBER',
    'CAPACITY',
    'QUEST_SAVE',
    'NOTICE_SAVE',
    'NOTICE_DELETE',
    'SELECT_BUILDING',
    'BUILD',
  ];
  if (hostOnly.includes(a.type) && !isHost(currentIsland(state))) return state;
  // 서버 섬의 소속은 serverIslands가 정본이다. 로컬 목업 섬은 미가입이어도 자리 선택을 저장해야 한다.
  if (a.type === 'FOCUS_SPOT') {
    const hasCurrentIsland = state.serverIslands
      ? state.serverIslands.currentIslandId !== null
      : currentIsland(state).joined;
    if (!hasCurrentIsland || state.visitingIslandId) return state;
  }
  const joinedOnly = [
    'START',
    'COMMENT',
    'MESSAGE',
    'RETRY_MESSAGE',
    'BUY',
    'TRACK',
    'THEME',
    'CLAIM_MEMBER',
    'COMMENT_DELETE',
    'CHAT_READ',
  ];
  if (joinedOnly.includes(a.type) && !currentIsland(state).joined) return state;
  // 구경 중에는 쓰기를 모두 막는다. 이 동작들은 내 현재 섬을 대상으로 하므로 구경하는 섬 화면에서 섞이면 안 된다
  if (state.visitingIslandId && (hostOnly.includes(a.type) || joinedOnly.includes(a.type)))
    return state;
  if (
    a.type === 'DELETE_ACCOUNT' &&
    state.islands.some((island) => isHost(island) && island.members.length > 0)
  )
    return state;
  // 할 일 없는 TICK(매초)은 깊은 복사·비교 없이 그대로 돌려준다(GROMO-2372)
  if (a.type === 'TICK' && tickIdle(state, a.now ?? Date.now())) return state;
  const s = JSON.parse(JSON.stringify(state)) as State,
    i = currentIsland(s),
    now = a.now ?? Date.now();
  const log = (text: string, memberId = 'me') =>
    i.ledger.unshift({ id: uuid(), text, at: now, memberId });
  // 도메인별 구분선(GROMO-2004). 이 리듀서 하나에 여러 티켓이 동시에 붙는다 — 자기 도메인 구간
  // 안에만 case 를 더하면 서로의 머지 충돌이 줄어든다. 구간 순서는 바꾸지 않는다.
  switch (a.type) {
    case 'FOCUS_GUIDE_RESTORED':
      s.focusGuideDone = true;
      if (a.focusBlockingIntro && s.focusBlockingIntro !== 'seen')
        s.focusBlockingIntro = a.focusBlockingIntro;
      s.tutorialEnrollment = 'existing';
      s.tutorial = { step: 99 };
      delete s.tutorialExperience;
      break;
    case 'FOCUS_BLOCKING_INTRO_SEEN':
      s.focusBlockingIntro = 'seen';
      break;
    case 'GUIDE_STEP': {
      if (
        a.expected &&
        ((s.tutorial?.step ?? 0) !== a.expected.step ||
          (s.tutorialRevision ?? 0) !== a.expected.revision)
      )
        return state;
      const step = a.step as number;
      if (s.focusGuideDone && step < 22) return state;
      if (step === 22 && !s.focusGuideDone) s.focusBlockingIntro ??= 'pending';
      if (step >= 22) s.focusGuideDone = true;
      if ([0, 4, 99].includes(step)) delete s.tutorialExperience;
      s.tutorialRevision = (s.tutorialRevision ?? 0) + 1;
      s.tutorial = {
        step,
        ...(step >= 9 && step <= 21
          ? {
              sessionId:
                s.session?.id ??
                s.tutorialExperience?.session?.id ??
                s.tutorialExperience?.result?.id ??
                s.tutorial?.sessionId ??
                s.lastResult?.id,
            }
          : {}),
      };
      break;
    }
    // ── 인증·계정 ──
    case 'LOGIN':
      s.loggedIn = true;
      if (Array.isArray(a.linkedProviders)) s.linkedProviders = [...a.linkedProviders];
      break;
    case 'ONBOARDING_STORY':
      if (['intro', 'scope', 'done'].includes(a.checkpoint)) s.onboardingStory = a.checkpoint;
      break;
    case 'PROFILE':
      if (typeof a.name === 'string' && a.name && a.name !== s.name)
        s.profileNames = [
          ...new Set([...(s.profileNames ?? [s.name]), s.name, a.name].filter(Boolean)),
        ];
      // 새 입력은 화면에서 공백을 제거한다. 서버가 보존한 기존 이름과 빈 편집 초안은 원문 그대로 둔다.
      if (typeof a.name === 'string') s.name = a.name;
      s.color = a.color || s.color;
      break;
    // ── 섬 — 만들기·가입·이동 ──
    case 'CREATE_ISLAND': {
      const n = makeIsland(uuid(), a.name.trim() || t('ui.policy.my_island_97b77'), false, true);
      n.joined = true;
      n.joinedDay = dayKey(now);
      n.intro = a.intro || '';
      n.approval = !!a.approval;
      n.capacity = Math.min(
        CAPACITY_MAX,
        Math.max(CAPACITY_MIN, Math.round(a.capacity) || CAPACITY_MAX),
      );
      s.islands.push(n);
      s.islandId = n.id;
      s.mainIslandId ??= n.id;
      s.visitingIslandId = null;
      s.onboarded = true;
      break;
    }
    case 'CANCEL_JOIN': {
      const target = a.id ?? s.pendingIsland;
      s.pendingIslands = (s.pendingIslands ?? []).filter((id) => id !== target);
      s.pendingIsland = s.pendingIslands.at(-1) ?? null;
      break;
    }
    case 'JOIN': {
      if (s.session) return state;
      const island = s.islands.find((x) => x.id === a.id);
      if (!island || island.closed || island.kicked || (!island.joined && isFull(island)))
        return state;
      const wasJoined = island.joined;
      if (!island.joined && island.approval && !a.approved) {
        s.pendingIslands = [...new Set([...(s.pendingIslands ?? []), island.id])];
        s.pendingIsland = island.id;
        break;
      }
      s.travelOrigin = s.onboarded ? i.name : t('ui.policy.my_raft_2aa18');
      island.joined = true;
      if (!wasJoined) island.joinedDay = dayKey(now);
      s.islandId = island.id;
      s.mainIslandId ??= island.id;
      // 구경하던 섬에 바로 가입하면 그 섬 주민이 되어 구경이 끝난다
      s.visitingIslandId = null;
      s.pendingIslands = (s.pendingIslands ?? []).filter((id) => id !== island.id);
      s.pendingIsland = s.pendingIslands.at(-1) ?? null;
      s.onboarded = true;
      break;
    }
    case 'TRAVEL_FROM':
      s.travelOrigin = a.name;
      break;
    case 'VISIT':
      if (!canVisit(state, a.id)) return state;
      s.visitingIslandId = a.id;
      delete s.visitLeaveAsked;
      delete s.visitGreeted;
      break;
    case 'END_VISIT':
      s.visitingIslandId = null;
      delete s.visitLeaveAsked;
      delete s.visitGreeted;
      break;
    case 'VISIT_LEAVE_ASKED':
      s.visitLeaveAsked = true;
      break;
    case 'VISIT_GREETED':
      s.visitGreeted = true;
      break;
    case 'SWITCH_ISLAND': {
      if (!canSwitchIsland(s, a.id)) return state;
      s.islandId = a.id as string;
      s.visitingIslandId = null;
      break;
    }
    case 'MAIN_ISLAND': {
      const target = s.islands.find((island) => island.id === a.id);
      if (!target?.joined || target.closed || target.id === state.mainIslandId) return state;
      s.mainIslandId = target.id;
      break;
    }
    case 'SERVER_MAIN_ISLAND':
      s.mainIslandId = a.islandId as string | null;
      break;
    // ── 섬 — 서버 동기화(GROMO-2006) ──
    // 서버 응답만 serverIslands 스냅샷에 반영한다. CREATE_ISLAND·JOIN·CANCEL_JOIN 의
    // 로컬 성공 경로는 REVIEW·DEMO fixture 용이며 일반 실행의 성공 경로에서 부르지 않는다.
    case 'ISLAND_SYNC': {
      if (a.focusGuideDone) {
        s.focusGuideDone = true;
        s.tutorialEnrollment = 'existing';
        s.tutorial = { step: 99 };
        delete s.tutorialExperience;
      }
      // /me/islands 정본 — 소속·current·상실 사유를 갈아 끼우고 로컬 joined 표시를 맞춘다
      const my = a.memberships as MyIslands,
        snap = serverSnap(s);
      if (!s.tutorialEnrollment) {
        // 로컬 onboarded·records 는 로그아웃 뒤에도 남는 이전 계정 값이라 판정에 쓰지 않는다 —
        // 새 계정에 속한 첫 서버 응답(상실 사유·current)만으로 가른다. 첫 pending 승인은 소속만 만들고
        // current 는 옮기지 않으므로 items 가 있어도 current 가 비어 있고 상실 이력이 없으면 최초 확정 전이다.
        s.tutorialEnrollment =
          !s.tutorial && !my.lossReason && my.currentIslandId == null
            ? 'awaiting-first-island'
            : 'existing';
      }
      if (s.tutorialEnrollment === 'awaiting-first-island' && my.currentIslandId != null) {
        if (!s.tutorial) {
          s.tutorial = { step: 0 };
          s.tutorialRevision = (s.tutorialRevision ?? 0) + 1;
        }
        s.tutorialEnrollment = 'existing';
      }
      // 강퇴로 잃은 섬을 남긴다 — 이번에 사라진 소속(직전 current 가 그 안에 있으면 그것), 사라진 게 없으면
      // 직전 current. 다른 기기에서 current 가 바뀌었어도 실제로 빠진 섬을 고른다. 덮어쓰기 전 소속 목록에만 있다.
      // 둘 다 없으면(새로 잃은 섬이 없다) 그대로 둔다
      if (my.lossReason !== 'KICKED' || my.currentIslandId != null) snap.kickedIsland = null;
      else {
        const kept = new Set(my.items.map((item) => item.id)),
          gone = snap.memberships.filter((item) => !kept.has(item.id)),
          lostId =
            (gone.find((item) => item.id === snap.currentIslandId) ?? gone[0])?.id ??
            snap.currentIslandId;
        if (lostId)
          snap.kickedIsland = {
            id: lostId,
            name: snap.memberships.find((item) => item.id === lostId)?.name ?? null,
          };
      }
      snap.memberships = my.items;
      // current 가 바뀌면 홈 스냅샷을 버린다 — 강퇴 뒤 같은 섬 재가입·전환 후 복귀에서 id 만 다시 맞아
      // 옛 방장 여부·완공 건물이 새 스냅샷 전에 그려지지 않게 한다(GROMO-2138)
      if (snap.currentIslandId !== my.currentIslandId) {
        snap.home = null;
        snap.playback = null;
        snap.clientConstruction = null;
        snap.visit = null;
        s.visitingIslandId = null;
      }
      snap.currentIslandId = my.currentIslandId;
      snap.lossReason = my.lossReason;
      if (a.requests) {
        const terminalIds = new Set(
          snap.requestStatus
            .filter((request) => request.status !== 'pending')
            .map((request) => request.id),
        );
        snap.joinRequests = (a.requests as MyJoinRequest[]).filter(
          (request) => !terminalIds.has(request.id),
        );
      }
      const ids = new Set(my.items.map((x) => x.id));
      for (const island of s.islands)
        if (island.joined && !ids.has(island.id)) island.joined = false;
      // 바다 세션의 islandId 는 목적지 — 가입하지 않은 섬으로도 항해한다(GROMO-2310). 섬 집중만 정리한다
      if (s.session && s.session.kind !== 'sea' && !ids.has(s.session.islandId)) s.session = null;
      if (s.visitingIslandId && snap.visit?.island.id !== s.visitingIslandId)
        s.visitingIslandId = null;
      // current가 null인데 items만 있으면 소속을 단정하지 않는다 — fail closed
      s.onboarded = my.currentIslandId != null;
      // /me 정본의 메인 섬 — 실렸을 때만 갈아 끼운다(explore 등 안 싣는 발신자는 현재 값 유지).
      // 로컬 islands 에 없는 서버 id 도 그대로 둔다 — mainIsland() 선택자가 fallback 을 처리한다.
      if (a.mainIslandId !== undefined) s.mainIslandId = a.mainIslandId as string | null;
      break;
    }
    case 'SERVER_HOME': {
      const snap = serverSnap(s);
      const facts = a.facts as HomeWorldFacts;
      if (facts.islandId !== snap.currentIslandId) return state;
      snap.home = facts;
      if (
        snap.clientConstruction &&
        (snap.clientConstruction.islandId !== facts.islandId ||
          facts.completedBuildings.includes(snap.clientConstruction.building))
      ) {
        snap.clientConstruction = null;
      }
      break;
    }
    case 'SERVER_CONSTRUCTION_STARTED': {
      const snap = serverSnap(s);
      const building = a.building as Building;
      const startedAt = Number(a.startedAt);
      const endsAt = Number(a.endsAt);
      if (
        snap.currentIslandId !== a.islandId ||
        !buildingOrder.includes(building) ||
        !Number.isFinite(startedAt) ||
        !Number.isFinite(endsAt) ||
        endsAt <= startedAt
      )
        return state;
      snap.clientConstruction = { islandId: a.islandId, building, startedAt, endsAt };
      break;
    }
    case 'SERVER_VILLAGE_POINTS': {
      const target = s.islands.find((island) => island.id === a.islandId),
        value = Number(a.value),
        version = Number(a.version);
      if (
        !target ||
        !Number.isFinite(value) ||
        value < 0 ||
        !Number.isInteger(version) ||
        version < (target.villagePointsVersion ?? -1)
      )
        return state;
      // 수령량을 더하지 않고 getBoard 지갑 정본으로 교체한다.
      target.fish = value;
      target.villagePointsVersion = version;
      break;
    }
    case 'SHOP_SYNC': {
      // GROMO-2017 — 서버 상점/인벤토리 응답 조각을 로컬 표시 상태에 옮긴다.
      // 가져온 조각만 갈아 끼우고, 지갑은 낮은 버전 스냅숏을 거절한다.
      const target = s.islands.find((island) => island.id === a.islandId);
      if (a.wallets && target) {
        const value = Number(a.wallets.villagePoints),
          version = Number(a.wallets.villagePointsVersion);
        if (
          Number.isFinite(value) &&
          value >= 0 &&
          Number.isInteger(version) &&
          version >= (target.villagePointsVersion ?? -1)
        ) {
          target.fish = value;
          target.villagePointsVersion = version;
        }
      }
      if (a.sharedInventory && target) {
        const inv = a.sharedInventory as SharedInventory;
        target.sharedOwned = [
          ...inv.audio,
          ...inv.islandThemes,
          ...inv.buildingThemes.map((theme) => theme.themeId),
        ];
        target.theme = inv.appearance.islandThemeId;
        target.buildingThemes = { ...inv.appearance.buildingThemes };
        target.buildingTheme = Object.values(inv.appearance.buildingThemes).some(
          (theme) => theme !== 'default',
        )
          ? 'custom'
          : 'default';
      }
      if (a.myInventory) {
        const inv = a.myInventory as PersonalInventory;
        s.owned = [...inv.clothes, ...inv.decor];
        s.equipped = {
          clothes: inv.equipped.clothes ?? 'default',
          decor: inv.equipped.decor ?? 'none',
          hull: inv.equipped.hull,
          position: inv.equipped.position,
          ...(inv.equipped.head !== undefined && { head: inv.equipped.head }),
          ...(inv.equipped.neck !== undefined && { neck: inv.equipped.neck }),
          ...(inv.equipped.shoes !== undefined && { shoes: inv.equipped.shoes }),
        };
      }
      break;
    }
    case 'PLAYBACK_SYNC': {
      if (s.serverIslands) {
        const snap = s.serverIslands;
        const playback = a.playback as PlaybackState;
        if (
          snap.currentIslandId !== a.islandId ||
          !playback ||
          !Number.isSafeInteger(playback.version) ||
          playback.version < (snap.playback?.version ?? -1)
        )
          return state;
        snap.playback = playback;
        break;
      }
      const target = s.islands.find((island) => island.id === a.islandId);
      if (!target) return state;
      const playback = a.playback as PlaybackState;
      if (
        !playback ||
        !Number.isSafeInteger(playback.version) ||
        (target.serverPlayback && playback.version < target.serverPlayback.version)
      )
        return state;
      const wasPlaying = target.playing;
      target.serverPlayback = playback;
      target.track = playback.trackId;
      target.playing = playback.trackId !== null && playback.playing;
      if (wasPlaying && !target.playing) target.playbackReset = (target.playbackReset ?? 0) + 1;
      break;
    }
    case 'ISLAND_CANDIDATES': {
      // 발견 페이지 반영 — reset이면 새 filter의 첫 페이지로 갈아 끼운다
      const snap = serverSnap(s),
        items = a.items as IslandSummary[];
      snap.candidates = a.reset
        ? items
        : [...snap.candidates, ...items.filter((x) => !snap.candidates.some((c) => c.id === x.id))];
      snap.nextCursor = a.nextCursor ?? null;
      break;
    }
    case 'ISLAND_VISIT':
      serverSnap(s).visit = a.visit as VisitScreen;
      break;
    case 'SERVER_VISITING':
      if (s.serverIslands?.visit?.island.id !== a.islandId) return state;
      s.visitingIslandId = a.islandId as string;
      delete s.visitLeaveAsked;
      delete s.visitGreeted;
      break;
    case 'ISLAND_REQUEST': {
      // 단건 상태는 표시 필드가 없다 — requestStatus에만 두고, 목록에 있는 항목은 status/version만 갱신한다.
      // 종결돼도 /me/join-requests 재조회 전까지는 상태가 남아 approval 화면이 결과를 보여줄 수 있다.
      const r = a.request as RequestStatusEntry,
        snap = serverSnap(s),
        prev =
          snap.requestStatus.find((x) => x.id === r.id) ??
          snap.joinRequests.find((x) => x.id === r.id);
      if (
        prev &&
        ((prev.status !== 'pending' && r.status === 'pending') ||
          (prev.version != null && r.version != null && r.version < prev.version))
      )
        break;
      // 서버가 안 준 필드(version 등)는 기존 값을 유지한다 — 합성하지 않는다
      snap.requestStatus = [...snap.requestStatus.filter((x) => x.id !== r.id), { ...prev, ...r }];
      snap.joinRequests = snap.joinRequests.map((x) =>
        x.id === r.id
          ? { ...x, status: r.status, ...(r.version != null ? { version: r.version } : {}) }
          : x,
      );
      break;
    }
    case 'ISLAND_SYNC_REQUESTS': {
      // 신청 목록 재조회 — pending만 오는 서버 목록으로 통째로 갈아 끼운다
      const snap = serverSnap(s);
      const terminalIds = new Set(
        snap.requestStatus
          .filter((request) => request.status !== 'pending')
          .map((request) => request.id),
      );
      snap.joinRequests = (a.requests as MyJoinRequest[]).filter(
        (request) => !terminalIds.has(request.id),
      );
      break;
    }
    // ── 집중 세션 ──
    case 'TUTORIAL_EXPERIENCE_CLEAR':
      delete s.tutorialExperience;
      break;
    case 'TUTORIAL_EXPERIENCE_START':
      if (
        s.session ||
        s.tutorialExperience?.session ||
        s.tutorial?.step !== 8 ||
        !(s.serverIslands ? s.serverIslands.currentIslandId : i.joined) ||
        s.visitingIslandId
      )
        return state;
      s.tutorialExperience = {
        session: {
          id: uuid(),
          islandId: s.serverIslands?.currentIslandId ?? s.islandId,
          subject: a.subject.trim() || t('focusFlow.setup.defaultSubject'),
          startedAt: now,
          seconds: 0,
          status: 'active',
        },
        result: null,
      };
      break;
    case 'TUTORIAL_EXPERIENCE_SPOT':
      if (
        s.session ||
        s.visitingIslandId ||
        !(s.serverIslands ? s.serverIslands.currentIslandId : i.joined)
      )
        return state;
      s.focusSpot = a.spot;
      break;
    case 'TUTORIAL_EXPERIENCE_PAUSE': {
      const session = s.tutorialExperience?.session;
      if (!s.session && session?.status === 'active') {
        session.seconds = sessionSeconds(session, now);
        session.status = 'paused';
        session.restStartedAt = now;
      }
      break;
    }
    case 'TUTORIAL_EXPERIENCE_RESUME': {
      const session = s.tutorialExperience?.session;
      if (!s.session && session?.status === 'paused') {
        session.startedAt = now;
        session.status = 'active';
        delete session.restStartedAt;
      }
      break;
    }
    case 'TUTORIAL_EXPERIENCE_REWARD': {
      const session = s.tutorialExperience?.session;
      if (s.session || !session || session.id !== a.sessionId || s.tutorial?.step !== 11)
        return state;
      // 서버 확정 사실만 표시한다. 실제 잔액은 다음 홈 조회에서 받는다.
      session.tutorialFish = true;
      break;
    }
    case 'TUTORIAL_EXPERIENCE_FINISH': {
      const experience = s.tutorialExperience;
      const session = experience?.session;
      if (s.session || !experience || !session) return state;
      experience.result = {
        id: session.id,
        islandId: session.islandId,
        subject: session.subject,
        seconds: Math.floor(sessionSeconds(session, now)),
        at: now,
        fish: session.tutorialFish ? 1 : 0,
        contributed: true,
      };
      experience.fromRest = session.status === 'paused';
      experience.session = null;
      break;
    }
    case 'FOCUS_SPOT':
      if (s.session) return state;
      s.focusSpot = a.spot;
      break;
    case 'START':
      if (s.session || !i.joined) return state;
      s.session = {
        id: uuid(),
        islandId: s.islandId,
        subject: a.subject.trim() || t('focusFlow.setup.defaultSubject'),
        startedAt: now,
        seconds: 0,
        status: 'active',
        intervals: [],
      };
      break;
    case 'PAUSE':
      if (s.session?.status === 'active') {
        s.session.intervals ??= [];
        s.session.intervals.push({ start: s.session.startedAt, end: now });
        s.session.seconds = sessionSeconds(s.session, now);
        s.session.status = 'paused';
        s.session.restStartedAt = now;
      }
      break;
    case 'RESUME':
      if (s.session?.status === 'paused') {
        s.session.startedAt = now;
        s.session.status = 'active';
        delete s.session.restStartedAt;
      }
      break;
    case 'ADVANCE':
      if (s.session?.status === 'active') s.session.seconds += a.seconds;
      break;
    case 'TUTORIAL_FISH_CONFIRMED': {
      // 서버가 지급한 사실만 표시한다. 섬 잔액과 종료 보상을 여기서 다시 더하지 않는다.
      if (!s.session || s.session.id !== a.sessionId || s.session.version == null) return state;
      s.session.tutorialFish = true;
      break;
    }
    case 'TUTORIAL_FISH': {
      if (
        !s.session ||
        s.session.version != null ||
        s.session.status !== 'active' ||
        sessionSeconds(s.session, now) < 5 ||
        s.records.length ||
        (s.session.creditedFish ?? 0) > 0
      )
        return state;
      const tutorialIsland = s.islands.find((x) => x.id === s.session!.islandId)!;
      s.session.creditedFish = 1;
      s.session.tutorialFish = true;
      tutorialIsland.fish = balance(tutorialIsland) + 1;
      tutorialIsland.earned ??= {};
      tutorialIsland.earned.me = earnedBy(tutorialIsland, 'me') + 1;
      tutorialIsland.ledger.unshift({
        id: uuid(),
        text: t('ui.policy.v0_first_focus_1_fish_0e5e5', { v0: s.name }),
        at: now,
        memberId: 'me',
      });
      break;
    }
    case 'FINISH': {
      if (!s.session) return state;
      const seconds = Math.floor(sessionSeconds(s.session, now)),
        fish = s.session.tutorialFish
          ? 1 + Math.floor(seconds / SECONDS_PER_FISH)
          : Math.floor(seconds / SECONDS_PER_FISH),
        island = s.islands.find((x) => x.id === s.session!.islandId)!;
      const contributed = true;
      const record = {
        id: s.session.id,
        islandId: island.id,
        subject: s.session.subject,
        seconds,
        at: now,
        fish,
        contributed,
        intervals: s.session.intervals
          ? [
              ...s.session.intervals,
              ...(s.session.status === 'active' ? [{ start: s.session.startedAt, end: now }] : []),
            ]
          : undefined,
      };
      if (s.records.some((r) => r.id === record.id)) return state;
      s.records.unshift(record);
      s.lastResult = record;
      const uncredited = fish - (s.session.creditedFish ?? 0);
      island.fish = balance(island) + uncredited;
      island.earned ??= {};
      island.earned.me = earnedBy(island, 'me') + uncredited;
      // 1분 미만 집중(적립 0마리)은 가계부에 남기지 않는다
      if (uncredited > 0)
        island.ledger.unshift({
          id: uuid(),
          text: t('ui.policy.v0_focus_v1_fish_04a32', { v0: s.name, v1: uncredited }),
          at: now,
          memberId: 'me',
        });
      s.resultFromRest = s.session.status === 'paused';
      s.session = null;
      break;
    }
    case 'SESSION_SYNC':
      // 서버 current 정본으로 진행 세션을 갈아 끼운다(GROMO-2009). null 이면 지운다 —
      // 서버에 없는 진행 세션은 이미 끝난 것이다.
      {
        let next = (a.session as Session | null) ?? null;
        if (next && next.id === s.session?.id && s.session.tutorialFish)
          next = { ...next, tutorialFish: true };
        s.session = next;
        // 응답 직후 종료돼도 서버의 실제 항해를 복구하면 온보딩을 다시 시작하지 않는다.
        if (
          next?.kind === 'sea' &&
          (s.onboardingStory === 'intro' || s.onboardingStory === 'scope')
        )
          s.onboardingStory = 'done';
        if (next) delete s.tutorialExperience;
      }
      break;
    case 'SESSION_RESULT': {
      delete s.tutorialExperience;
      // 서버 finish·pending-result 의 정산 뷰를 기록+결과창으로 반영하고 진행 세션을 닫는다.
      // earnedFish 는 서버가 이미 섬 통장에 적립한 확정값 — 로컬 잔액 표시만 맞춘다.
      const record = a.record as RecordItem;
      const prev = s.records.find((r) => r.id === record.id);
      if (!prev) s.records.unshift(record);
      // 구간 없이 먼저 저장된 기록(구버전 서버 시절 결과)이 재생되면 구간만 채운다(GROMO-2131).
      else if (!prev.intervals && record.intervals) prev.intervals = record.intervals;
      s.lastResult = record;
      const owner = s.islands.find((x) => x.id === record.islandId);
      // 재생된 결과(같은 recordId)는 이미 잔액·원장에 반영됐다 — 구간만 채우고 경제 효과는 건너뛴다.
      if (!prev && owner && record.fish > 0) {
        owner.fish = balance(owner) + record.fish;
        owner.earned ??= {};
        owner.earned.me = earnedBy(owner, 'me') + record.fish;
        owner.ledger.unshift({
          id: uuid(),
          text: t('ui.policy.v0_focus_v1_fish_04a32', { v0: s.name, v1: record.fish }),
          at: record.at,
          memberId: 'me',
        });
      }
      s.resultFromRest = a.fromRest === true;
      s.session = null;
      break;
    }
    case 'RESULT_ACK':
      // 결과 확인(acknowledge) 성공 — 같은 결과를 다시 확인하지 않게 표시를 지운다.
      if (s.lastResult && s.lastResult.ackId === a.id) delete s.lastResult.ackId;
      break;
    // ── 건물 공사·퀘스트 ──
    case 'SELECT_BUILDING': {
      const b = a.building as Building;
      if (canSelectBuilding(i, b)) return state;
      const targets = targetIds(i);
      const prevQuest = i.buildingQuest;
      const base: Record<string, number> = {};
      // 목표 변경 시 이어서 셈 — 추가 결정 필요: 계속 대상인 주민은 이전 스냅숏을 유지하고,
      // 새로 대상에 들어온 주민만 지금 시점 earned로 새로 스냅숏한다
      for (const id of targets)
        base[id] =
          prevQuest && prevQuest.targets.includes(id)
            ? (prevQuest.base?.[id] ?? 0)
            : earnedBy(i, id);
      i.buildingQuest = { building: b, targets, selectedAt: now, base };
      i.nextBuilding = b;
      delete i.completed;
      break;
    }
    case 'BUILD': {
      const b = a.building as Building;
      if (!buildingOrder.includes(b) || canBuild(s, b)) return state;
      const cost = buildingCost(i, b);
      i.fish = balance(i) - cost;
      i.construction = {
        building: b,
        startedAt: now,
        endsAt: now + buildMinutes[b] * 60000,
        cost,
      };
      log(t('ui.policy.started_v0_construction_v1_fish_770ed', { v0: buildingNames[b], v1: cost }));
      break;
    }
    case 'TICK': {
      // 섬 잔액은 집중이 끝날 때(FINISH) 한 번에 오른다 — 낚시하는 동안에는 오르지 않는다(FOCUS-ISLAND.md 2026-09-17)
      for (const island of s.islands)
        if (island.construction && now >= island.construction.endsAt) {
          const b = island.construction.building;
          if (!island.buildings.includes(b)) island.buildings.push(b);
          if (b === 'board') island.boardCompletedDay ??= dayKey(island.construction.endsAt);
          delete island.construction;
          delete island.buildingQuest;
          delete island.nextBuilding;
          if (nextBuildings.includes(b)) island.completed = { building: b, at: now };
          island.ledger.unshift({
            id: uuid(),
            text: t('ui.policy.v0_completed_6750f', { v0: buildingNames[b] }),
            at: now,
          });
        }
      if (
        s.settings.permission &&
        s.settings.screenTimeMeasurementReady &&
        (!s.settings.screenTimeMeasurementDay ||
          s.settings.screenTimeMeasurementDay === dayKey(now)) &&
        !s.screenTimeUnconfirmedDays?.includes(dayKey(now))
      ) {
        s.screenDays ??= {};
        s.screenDays[dayKey(now)] = s.screenMinutes;
      } else {
        s.screenDays ??= {};
        s.screenDays[dayKey(now)] = null;
      }
      evaluateQuests(s, now);
      if (JSON.stringify(s) !== JSON.stringify(state)) return s;
      idleTicks.set(state, dayKey(now));
      return state;
    }
    case 'CLAIM': {
      const reward = s.rewards?.find(
        (r) => r.id === a.id || (r.questId === a.id && r.kind === 'personal' && !r.acknowledged),
      );
      if (!reward || reward.acknowledged) return state;
      const owner = s.islands.find((x) => x.id === reward.islandId)!;
      // 닫힌(삭제된) 섬의 보상은 잔액·원장에 쓰지 않고 받은 것으로만 처리해 보상 창을 닫는다
      if (reward.kind === 'personal' && !owner.closed) {
        owner.fish = balance(owner) + reward.amount;
        owner.earned ??= {};
        owner.earned.me = earnedBy(owner, 'me') + reward.amount;
        owner.quests.find((q) => q.id === reward.questId)?.rounds?.[reward.day]?.claimed.push('me');
        owner.ledger.unshift({
          id: uuid(),
          text: t('ui.policy.quest_reward_v0_fish_2fa95', { v0: reward.amount }),
          at: now,
          memberId: 'me',
        });
      }
      reward.acknowledged = true;
      break;
    }
    case 'CLAIM_MEMBER': {
      const q = i.quests.find((q) => q.id === a.id),
        round = q?.rounds?.[a.day];
      if (!round || !round.achieved.includes(a.memberId) || round.claimed.includes(a.memberId))
        return state;
      round.claimed.push(a.memberId);
      i.fish = balance(i) + 10;
      i.earned ??= {};
      i.earned[a.memberId] = earnedBy(i, a.memberId) + 10;
      log(t('ui.policy.resident_quest_reward_10_fish_cd037'), a.memberId);
      break;
    }
    case 'QUEST_SAVE': {
      // 일일 퀘스트: 방장이 만들고 수정한다(주민은 hostOnly에서 막힌다). 매일 새 회차로 평가한다
      if (!Number.isInteger(a.target) || a.target < 1 || !a.title?.trim()) return state;
      if (a.kind === 'focus') {
        const start = clockMinutes(a.windowStart),
          end = clockMinutes(a.windowEnd);
        // 시간대 집중은 시작 < 종료이고 목표 분이 그 시간 안이어야 한다
        if (start == null || end == null || end <= start || a.target > end - start) return state;
      }
      const title = a.title.trim(),
        // 시간대는 언제나 HH:MM으로 저장한다 (웹 time 입력이 "9:00"을 못 읽는다)
        windowStart = a.kind === 'focus' ? clockText(a.windowStart) : undefined,
        windowEnd = a.kind === 'focus' ? clockText(a.windowEnd) : undefined;
      const q = a.id ? i.quests.find((x) => x.id === a.id) : undefined;
      if (a.id && !q) return state;
      if (q) {
        q.title = title;
        q.type = a.kind;
        q.target = a.target;
        q.windowStart = windowStart;
        q.windowEnd = windowEnd;
        // 오늘 회차는 대상(targets) 스냅숏을 그대로 두고 기준만 바꿔 바로 다시 평가한다
        const round = q.rounds?.[dayKey(now)];
        if (round) {
          round.kind = a.kind;
          round.target = a.target;
          round.windowStart = windowStart;
          round.windowEnd = windowEnd;
          // 이미 지급된 보상은 보존하되, 미수령 달성은 새 기준으로 다시 판정한다.
          const claimed = new Set(round.claimed);
          round.achieved = round.achieved.filter((id) => claimed.has(id));
          s.rewards = (s.rewards ?? []).filter(
            (reward) =>
              reward.acknowledged ||
              reward.kind !== 'personal' ||
              reward.islandId !== i.id ||
              reward.questId !== q.id ||
              reward.day !== dayKey(now),
          );
        }
      } else
        i.quests.push({
          id: uuid(),
          title,
          type: a.kind,
          target: a.target,
          windowStart,
          windowEnd,
          claimed: false,
          createdDay: dayKey(now),
        });
      break;
    }
    // ── 게시판·공지·댓글 ──
    case 'NOTICE_SAVE': {
      // 제목·본문은 공백만 있으면 저장하지 않는다
      if (!a.title?.trim() || !a.body?.trim()) return state;
      const title = a.title.trim(),
        body = a.body.trim();
      const n = i.notices.find((x) => x.id === a.id);
      if (n) {
        n.title = title;
        n.body = body;
      } else
        i.notices.unshift({
          id: uuid(),
          title,
          body,
          author: s.name,
          authorId: 'me',
          at: now,
          comments: [],
        });
      break;
    }
    case 'NOTICE_DELETE':
      i.notices = i.notices.filter((n) => n.id !== a.id);
      break;
    case 'COMMENT': {
      const n = i.notices.find((x) => x.id === a.id);
      if (n && a.text.trim())
        n.comments.push({
          id: uuid(),
          name: s.name,
          memberId: 'me',
          text: a.text.trim(),
          at: now,
        });
      break;
    }
    case 'COMMENT_DELETE': {
      const n = i.notices.find((x) => x.id === a.id),
        c = n?.comments.find((x) => x.id === a.commentId);
      // 방장은 모든 댓글을, 주민은 자기 댓글만 지운다
      if (!n || !c || (!isHost(i) && !isOwnComment(s, c))) return state;
      n.comments = n.comments.filter((x) => x !== c);
      break;
    }
    // ── 채팅 ──
    case 'CHAT_READ':
      // 읽음 기준은 뒤로 가지 않는다 — LOAD가 미래 시각 메시지까지 읽은 것으로 올려 둔 값을 지키기 위해.
      // 방을 연 채 도착한 시계 오차(미래 시각) 메시지도 이미 본 것이므로 기준에 넣는다
      i.chatReadAt = Math.max(
        i.chatReadAt ?? 0,
        now,
        ...i.messages.filter((m) => m.memberId !== 'me').map((m) => m.at),
      );
      break;
    case 'MESSAGE':
      if (a.text.trim())
        i.messages.push({
          id: uuid(),
          memberId: 'me',
          name: s.name,
          color: s.color,
          text: a.text.trim(),
          at: now,
          status: a.fail ? 'failed' : 'sent',
        });
      break;
    case 'RETRY_MESSAGE': {
      const m = i.messages.find((m) => m.id === a.id);
      if (m) m.status = 'sent';
      break;
    }
    // ── 상점·꾸미기 ──
    case 'BUY': {
      const p = products.find((x) => x.id === a.id);
      if (!p || canBuy(s, p)) return state;
      i.fish = balance(i) - p.price;
      i.sharedOwned.push(p.id);
      log(t('ui.policy.purchased_v0_v1_fish_4db4a', { v0: p.title, v1: p.price }));
      s.orders.unshift({
        id: uuid(),
        product: p.id,
        islandId: i.id,
        currency: 'fish',
        price: p.price,
        at: now,
        buyer: s.name,
      });
      break;
    }
    case 'DECOR_POSITION':
      return state;
    case 'THEME':
      if (a.value === 'default' || i.sharedOwned.includes(a.value)) {
        if (a.kind === 'building') {
          i.buildingThemes ??= {};
          i.buildingThemes[a.building || 'hall'] = a.value;
          i.buildingTheme = Object.values(i.buildingThemes).some((v) => v !== 'default')
            ? 'custom'
            : 'default';
        } else i.theme = a.value;
      }
      break;
    // ── 설정·화면시간 ──
    case 'TRACK':
      if (i.buildings.includes('gram') && i.sharedOwned.includes(a.value)) {
        i.track = a.value;
        i.playing = true;
      }
      break;
    case 'TRACK_SELECT':
      if (i.buildings.includes('gram') && i.sharedOwned.includes(a.value)) i.track = a.value;
      break;
    case 'PLAY':
      if (
        i.buildings.includes('gram') &&
        (!a.value || (typeof i.track === 'string' && i.sharedOwned.includes(i.track)))
      ) {
        i.playing = !!a.value;
        if (!a.value) i.playbackReset = (i.playbackReset ?? 0) + 1;
      }
      break;
    case 'RAFT_DESTINATION':
      s.lastRaftDestination = a.destination;
      break;
    case 'SETTING':
      (s.settings as any)[a.key] = a.value;
      break;
    // ── 섬 관리 (방장) ──
    case 'MANAGE':
      i.name = a.name?.trim() || i.name;
      i.intro = a.intro ?? i.intro;
      i.approval = a.approval ?? i.approval;
      break;
    case 'KICK': {
      const kicked = i.members.find((m) => m.id === a.id);
      if (!kicked) return state;
      i.formerMembers ??= [];
      i.formerMembers = [
        ...i.formerMembers.filter((member) => member.id !== kicked.id),
        { ...kicked, focusing: false, restStartedAt: undefined, role: 'member' },
      ];
      i.members = i.members.filter((m) => m.id !== a.id);
      if (i.buildingQuest)
        i.buildingQuest.targets = i.buildingQuest.targets.filter((id) => id !== a.id);
      break;
    }
    case 'REJECT_MEMBER':
      // id가 없으면(예전 화면) 남은 신청을 모두 거절한다
      i.requests = a.id ? joinRequests(i).filter((r) => r.id !== a.id) : [];
      i.requestResolved = !i.requests.length;
      break;
    case 'CAPACITY': {
      const v = Math.round(a.value);
      if (!(v <= CAPACITY_MAX) || v < Math.max(CAPACITY_MIN, residentCount(i))) return state;
      i.capacity = v;
      break;
    }
    case 'MAILBOX_GUIDE_DONE':
      if (typeof a.userId !== 'string' || !shouldShowMailboxGuide(s, a.userId)) return state;
      s.mailboxGuideSeenBy = [...(s.mailboxGuideSeenBy ?? []), a.userId];
      break;
    case 'SHOP_GUIDE_DONE':
      if (typeof a.userId !== 'string' || !shouldShowShopGuide(s, a.userId)) return state;
      s.shopGuideSeenBy = [...(s.shopGuideSeenBy ?? []), a.userId];
      break;
    case 'ISLAND_NAMING':
      // 무인도 항해로 새로 세운 섬 — 그 섬 홈에서 강제 이름 짓기 모달을 띄우게 전이 상태를 둔다(GROMO-2649)
      if (typeof a.islandId === 'string') s.pendingIslandNaming = a.islandId;
      break;
    case 'ISLAND_NAMING_DONE':
      // 이름 저장 성공 — 모달을 내린다
      delete s.pendingIslandNaming;
      break;
    case 'ADD_MEMBER': {
      const request = joinRequests(i).find((r) => !a.id || r.id === a.id);
      if (!request || isFull(i)) return state;
      i.requests = joinRequests(i).filter((r) => r.id !== request.id);
      i.requestResolved = !i.requests.length;
      // 강퇴·탈퇴로 떠났던 주민이 다시 들어오면 그때 기록을 이어받고 떠난 주민 목록에서 뺀다
      i.formerMembers ??= [];
      const former = i.formerMembers.find((m) => m.id === request.id);
      i.formerMembers = i.formerMembers.filter((m) => m.id !== request.id);
      i.members.push({
        ...(former ?? {}),
        id: i.members.some((m) => m.id === request.id) ? uuid() : request.id,
        name: request.name,
        color: request.color,
        subject: former?.subject ?? t('ui.policy.reading_task_cfc60'),
        seconds: former?.seconds ?? 0,
        focusing: false,
        restStartedAt: undefined,
        role: 'member',
      });
      break;
    }
    case 'TRANSFER':
      if (!i.members.some((m) => m.id === a.id)) return state;
      i.members.forEach((m) => (m.role = m.id === a.id ? 'host' : 'member'));
      break;
    case 'LEAVE':
      if (s.session || (isHost(i) && i.members.length > 0)) return state;
      removeOwnMembership(s, i, true);
      break;
    case 'KICKED_FROM_ISLAND': {
      const kickedIsland = s.islands.find((island) => island.id === a.id);
      if (!kickedIsland?.joined) return state;
      const shouldResetScreen =
        s.islandId === kickedIsland.id ||
        // 목적지 섬에서 강퇴돼도 바다 항해는 그 섬 소속이 아니다(서버 정본) — 항해 화면을 내리지 않는다
        (s.session?.kind !== 'sea' && s.session?.islandId === kickedIsland.id) ||
        s.visitingIslandId === kickedIsland.id;
      kickedIsland.kicked = true;
      removeOwnMembership(s, kickedIsland, false);
      if (shouldResetScreen) s.membershipRecovery = { reason: 'kicked', islandId: kickedIsland.id };
      break;
    }
    case 'MEMBERSHIP_RECOVERY_HANDLED': {
      delete s.membershipRecovery;
      break;
    }
    case 'SCREEN_TIME_SNAPSHOT': {
      const snapshot = a.snapshot;
      s.settings.permission = snapshot.approved;
      s.settings.screenTimeMeasurementDay = snapshot.date;
      s.settings.screenTimeMeasurementReady =
        snapshot.approved &&
        snapshot.minutes !== null &&
        snapshot.date === dayKey(now) &&
        !snapshot.unconfirmedDays.includes(snapshot.date) &&
        !s.screenTimeUnconfirmedDays?.includes(snapshot.date);
      s.settings.screenTimeHistoryReady = false;
      s.settings.screenTimeHistoryDay = snapshot.date;
      if (snapshot.minutes !== null) s.screenMinutes = snapshot.minutes;
      // 미확인 날짜를 먼저 적용한 뒤 과거 기록을 정산한다. 중간 상태로 0분 보상이 나가면 안 된다.
      const marked = reducer(s, {
        type: 'SCREEN_TIME_UNCONFIRMED',
        days: snapshot.unconfirmedDays,
      });
      return snapshot.approved && snapshot.minutes !== null
        ? reducer(marked, { type: 'SCREEN_TIME_HISTORY', buckets: snapshot.history, now })
        : marked;
    }
    case 'SCREEN_TIME':
      s.screenMinutes = Math.max(0, a.value);
      break;
    case 'SCREEN_TIME_DAY':
      s.screenDays ??= {};
      if (s.screenTimeUnconfirmedDays?.includes(a.day)) break;
      s.screenDays[a.day] = Math.max(0, a.value);
      for (const island of s.islands.filter(
        (candidate) => candidate.joined && candidate.buildings.includes('board'),
      ))
        for (const quest of island.quests) ensureQuestRound(island, quest, a.day);
      evaluateQuests(s, now);
      break;
    case 'SCREEN_TIME_HISTORY':
      s.screenDays ??= {};
      for (const bucket of a.buckets ?? []) {
        if (s.screenTimeUnconfirmedDays?.includes(bucket.date)) continue;
        s.screenDays[bucket.date] = Math.max(0, bucket.minutes);
        for (const island of s.islands.filter(
          (candidate) => candidate.joined && candidate.buildings.includes('board'),
        ))
          for (const quest of island.quests) ensureQuestRound(island, quest, bucket.date);
      }
      s.settings.screenTimeHistoryReady = true;
      evaluateQuests(s, now);
      break;
    case 'SCREEN_TIME_UNCONFIRMED':
      s.screenDays ??= {};
      s.screenTimeUnconfirmedDays = [
        ...new Set([...(s.screenTimeUnconfirmedDays ?? []), ...(a.days ?? [])]),
      ].sort();
      s.screenTimeUnconfirmedDays.forEach((day) => {
        s.screenDays![day] = null;
      });
      break;
    // ── 인증 — 로그아웃 ──
    case 'LOGOUT':
      s.loggedIn = false;
      delete s.tutorial;
      delete s.tutorialExperience;
      delete s.tutorialEnrollment;
      delete s.focusGuideDone;
      delete s.focusBlockingIntro;
      s.tutorialRevision = (s.tutorialRevision ?? 0) + 1;
      // 서버 온보딩 스냅샷도 계정과 함께 버린다 — A 계정의 orphan 신청이 B 계정에 섞이지 않게
      s.serverIslands = null;
      break;
    // ── 친구·편지 ──
    case 'FRIENDS_SYNC': {
      const previous = new Map((s.friends ?? []).map((friend) => [friend.id, friend]));
      s.friends = (a.friends as Friend[]).map((friend) => {
        const before = previous.get(friend.id);
        return {
          ...friend,
          // 서버에서 관계가 끊긴 뒤 재신청된 사용자는 새 관계다. 이전 편지를 되살리지 않는다.
          messages:
            before?.status === 'friend' && friend.status === 'friend'
              ? before.messages
              : (friend.messages ?? []),
        };
      });
      break;
    }
    case 'FRIEND_REQUEST': {
      s.friends ??= [];
      const f = s.friends.find((f) => f.id === a.id);
      if (f && f.status !== 'none') return state;
      if (f) f.status = 'sent';
      else if (a.friend && a.friend.id !== 'me')
        s.friends.push({ ...a.friend, status: 'sent', messages: [] });
      break;
    }
    case 'FRIEND_ACCEPT':
    case 'FRIEND_REJECT':
    case 'FRIEND_CANCEL':
    case 'FRIEND_DELETE': {
      const f = s.friends?.find((f) => f.id === a.id);
      if (!f) return state;
      if (a.type === 'FRIEND_ACCEPT' && f.status === 'received') f.status = 'friend';
      else if (
        (a.type === 'FRIEND_REJECT' && f.status === 'received') ||
        (a.type === 'FRIEND_CANCEL' && f.status === 'sent') ||
        (a.type === 'FRIEND_DELETE' && f.status === 'friend')
      ) {
        f.status = 'none';
        // 친구를 삭제하면 아직 확인하지 않은 편지도 지운다(정책)
        if (a.type === 'FRIEND_DELETE') f.messages = [];
      } else return state;
      break;
    }
    case 'FRIEND_MESSAGE': {
      const f = s.friends?.find((f) => f.id === a.id);
      if (!f || !canSendLetter(state, a.id) || !a.text.trim()) return state;
      f.messages.push({
        id: uuid(),
        memberId: 'me',
        name: s.name,
        color: s.color,
        text: a.text.trim(),
        at: now,
        status: a.fail ? 'failed' : 'sent',
      });
      break;
    }
    case 'LETTER_READ': {
      const m = s.friends
        ?.find((f) => f.id === a.friend)
        ?.messages.find((x) => x.id === a.id && x.memberId !== 'me');
      if (!m || m.readAt) return state;
      m.readAt = now;
      break;
    }
    case 'FRIEND_RETRY': {
      const f = s.friends?.find((f) => f.id === a.friend);
      const m = f?.messages.find((m) => m.id === a.id);
      if (!m || f?.status !== 'friend') return state;
      m.status = 'sent';
      break;
    }
    // ── 계정 — 탈퇴 ──
    case 'DELETE_ACCOUNT': {
      const clean = initialState();
      const profileNames = new Set([s.name, ...(s.profileNames ?? [])]);
      const isOwnLegacyLedger = (text: string) =>
        [...profileNames].some((name) =>
          SUPPORTED_LOCALES.some((locale) =>
            ['ui.policy.v0_focus_09b3f', 'ui.policy.v0_focus_reward_a8736'].some((key) =>
              text.startsWith(tForLocale(locale, key, { v0: name })),
            ),
          ),
        );
      clean.islands = s.islands.map((i) => ({
        ...i,
        kicked: undefined,
        joined: false,
        earned: Object.fromEntries(Object.entries(i.earned ?? {}).filter(([id]) => id !== 'me')),
        ledger: i.ledger.filter(
          (entry) =>
            entry.memberId !== 'me' && (entry.memberId != null || !isOwnLegacyLedger(entry.text)),
        ),
        notices: i.notices
          .filter(
            (notice) =>
              notice.authorId !== 'me' &&
              (notice.authorId != null || !notice.author || !profileNames.has(notice.author)),
          )
          .map((notice) => ({
            ...notice,
            comments: notice.comments.filter(
              (comment) =>
                comment.memberId !== 'me' &&
                (comment.memberId != null || !profileNames.has(comment.name)),
            ),
          })),
        messages: i.messages.filter((m) => m.memberId !== 'me'),
        quests: i.quests.map((quest) => ({
          ...quest,
          rounds: quest.rounds
            ? Object.fromEntries(
                Object.entries(quest.rounds).map(([day, round]) => [
                  day,
                  {
                    ...round,
                    targets: round.targets.filter((id) => id !== 'me'),
                    achieved: round.achieved.filter((id) => id !== 'me'),
                    claimed: round.claimed.filter((id) => id !== 'me'),
                  },
                ]),
              )
            : undefined,
        })),
        buildingQuest: i.buildingQuest
          ? {
              ...i.buildingQuest,
              targets: i.buildingQuest.targets.filter((id) => id !== 'me'),
              base: i.buildingQuest.base
                ? Object.fromEntries(
                    Object.entries(i.buildingQuest.base).filter(([id]) => id !== 'me'),
                  )
                : undefined,
            }
          : undefined,
      }));
      // 내가 마지막 주민이던 섬은 탈퇴(LEAVE)와 똑같이 닫는다
      s.islands.forEach((i, n) => {
        if (i.joined && i.members.length === 0) closeIsland(clean, clean.islands[n]);
      });
      return clean;
    }
    // ── QA·데모 전용 ──
    case 'QA_COMPLETE_ALL_BUILDINGS':
      if (!s.onboarded) return state;
      completeAllBuildings(i, now);
      break;
    case 'DEMO_CREDIT':
      i.fish = balance(i) + (a.fish || 0) + (a.points || 0) + (a.contribution || 0);
      i.earned ??= {};
      i.earned.me = earnedBy(i, 'me') + (a.earned || a.fish || 0);
      break;
    default:
      return state;
  }
  if (['FINISH', 'QUEST_SAVE', 'SCREEN_TIME', 'SCREEN_TIME_DAY'].includes(a.type))
    evaluateQuests(s, now);
  return s;
}
