import {
  ConstructionPlanGrid,
  ConstructionPlanPreview,
  ConstructionWalletSummary,
  constructionFish,
  constructionPlanStyles,
} from '@/components/ConstructionPlanContent';
import { CatAvatar } from '@/components/CatAvatar';
import { appearanceOutfit } from '@/components/CatOutfitLayers';
import { Btn, NavBtn } from '@/design-system/patterns';
import { componentTokens, primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { errorTextOr, t, useLocale } from '@/i18n';
import { localizedJosa as josa } from '@/i18n/format';
import { Guestbook } from '@/screens/interiors/Guestbook';
import { useBoardNotices } from '@/screens/interiors/useBoardNotices';
import { HOME_QUEST_LIST_DETAIL } from '@/screens/island/HomeQuestIndicator';
import { normalizedConstructionProgress } from '@/screens/island/constructionProgress';
import { GOWUN } from '@/screens/island/sceneKit';
import { useConstruction } from '@/screens/island/useConstruction';
import { ApiError, CLIENT_STALE_SESSION } from '@/services/api/client';
import { getSession, sessionGeneration } from '@/services/api/session';
import { isMockMode } from '@/services/demoMode';
import { loadHomeSnapshot } from '@/services/homeSnapshot';
import {
  Building,
  buildingNames,
  clockText,
  displayIsland as currentIsland,
  dayKey,
  viewIsland,
} from '@/services/model';
import { captureProductEvent } from '@/services/posthog';
import { kstWindowCrossesUtcMidnight } from '@/utils/questWindowTz';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, PixelRatio, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { artSize, buildOptions, interiorArt } from '../assets';
import { Scroll } from '../shared/Scroll';
import { SceneObjectLabel, sceneObjectLabelSize } from '../shared/SceneObjectLabel';
import { boardScene } from '../shared/sceneGeometry';
import { INK, exact, fill, gradient, lh, webOnly } from '../shared/styles';
import { Text, boardFont } from '../shared/typography';
import { ArtifactProps, ArtifactRenderer } from '../types';
import {
  BoardField,
  BoardPaper,
  BoardPill,
  Handwriting,
  Link,
  PaperAction,
  PaperStamp,
  Picture,
  QuestTargetInput,
  QuestTimeInput,
  QuestTypeChoice,
  Track,
  inputStyle,
} from './BoardControls';
import { QuestCard } from './QuestCard';
import { LAND, NOTICES, OWNER, QUESTS, RESIDENTS, makeState } from './boardData';
import { blueprintOption, boardFromApp, boardTabs, buildingRoute, questError } from './boardModel';
import { handleBoardModalKeydown, syncBoardModalFocus } from './modalFocus';
import {
  BlueprintView,
  BoardState,
  NoticeView,
  Quest,
  QuestForm,
  QuestView,
  ResidentRate,
} from './types';

// 쓰기 종이가 키보드를 피해 올라갈 수 있는 맨 위. 종이 안 여백까지 더하면 내용이 장면의 뒤로 ×(위 31~75)·간판
// 아래에서 시작한다
const COMPOSE_TOP = 60;

export function Board({
  concept,
  width,
  height,
  reduceMotion,
  e,
  showToast,
  sceneHeight = height,
  higherModalOpen = false,
  onBoardModalChange,
}: ArtifactProps) {
  const locale = useLocale();
  const [local, setS] = useState(() => makeState(concept));
  const guestbookMore = useRef<(() => void) | null>(null);
  const [mockNotices, setNotices] = useState(() =>
    concept.boardPanel === 'notice' && concept.boardView === 'empty' ? [] : NOTICES,
  );
  const [mockQuests, setQuests] = useState(() =>
    concept.boardPanel === 'quest' && concept.boardView === 'empty' ? [] : QUESTS,
  );
  const noticeOverlayRef = useRef<HTMLElement | null>(null);
  const questOverlayRef = useRef<HTMLElement | null>(null);
  const boardSceneRef = useRef<HTMLElement | null>(null);
  const boardDrawerRef = useRef<HTMLElement | null>(null);
  const overlayOpenerRef = useRef<HTMLElement | null>(null);
  const overlayWasOpen = useRef(false);
  const overlayWasTopmost = useRef(false);
  // 앱 라우트에서도 화면 안에서만 잠깐 쓰는 상태: 댓글 입력 열림 · 삭제 확인 · 목표 분 · 오류
  const [ui, setUi] = useState({
    comment: false,
    confirm: null as null | { target: 'notice' | 'comment'; index: number; commentId?: string },
    target: '',
    error: '',
  });
  // 매초 오는 now로 다시 계산하지 않게, 상태가 바뀌거나 날짜가 넘어갈 때만 계산한다
  // (집중·공사 중에는 달성률·공사 진행률이 시간에 따라 변하므로 매번 계산)
  const live = !!e && (!!e.state.session || !!viewIsland(e.state).construction);
  const app = useMemo(
    () => (e ? boardFromApp(e) : null),
    [locale, e?.state, e ? dayKey(e.now) : '', live ? e.now : 0],
  );
  const routeKey = e ? `${e.route}/${e.detail}/${e.tab}` : '';
  useEffect(() => {
    if (!e) return;
    // 퀘스트 수정으로 들어오면 목표 분을 기존 값으로 채운다 (나머지 값은 App의 text·body·시간대)
    const editing =
      e.route === 'questEdit' && e.detail
        ? serverBoard
          ? board.quests.find((q) => q.occurrenceId === e.detail)
          : currentIsland(e.state).quests.find((q) => q.id === e.detail)
        : undefined;
    setUi((prev) => ({
      ...prev,
      comment: false,
      confirm: null,
      error: '',
      target: editing
        ? String('targetMinutes' in editing ? editing.targetMinutes : editing.target)
        : prev.target,
    }));
  }, [routeKey]);

  // e 는 App 이 렌더마다 새로 조립하고 e.back/setText/setBody 는 그 렌더의 history·초안을
  // 닫은 클로저다 — 쓰기가 끝날 때 옛 e 를 그대로 부르면 현재 화면을 엉뚱하게 바꾼다.
  // 콜백은 항상 최신 e(eRef)를 쓰고, route/detail(tab)이 바뀌면 올라가는 routeGen 으로
  // 「쓰기를 시작한 화면」인지 확인한다 — 나갔다 같은 화면으로 돌아와도 옛 작업은 무효다.
  const eRef = useRef(e);
  eRef.current = e;
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const routeGen = useRef(0);
  const seenRouteKey = useRef(routeKey);
  if (e && seenRouteKey.current !== routeKey) {
    seenRouteKey.current = routeKey;
    routeGen.current += 1;
  }
  // 쓰기를 시작한 화면이 그대로면 최신 e, 아니면 null — null 이면 back/setText/창 닫기를 안 한다.
  const liveE = (gen: number) =>
    mountedRef.current && eRef.current && routeGen.current === gen ? eRef.current : null;
  // 초안·입력창·확인창 상호작용 세대 — draft/comment 입력, editor·comment·confirm 의
  // 열기/닫기마다 올라간다. routeKey 가 같아도(취소 후 다시 열기, 같은 화면에서 계속 수정)
  // 세대가 다르면 진행 중이던 쓰기의 성공 부수효과는 무효다 — 옛 작업이 새 초안을 지우거나
  // 다시 연 입력창을 닫지 않는다. 값 비교가 아니라 단조 카운터라 A→B→A 도 무효가 된다.
  const draftEpoch = useRef(0);
  // 진행 중 쓰기의 의도 페이로드 — 같은 내용의 중복 탭만 무시하고 다른 내용은 훅에 맡겨
  // 명시 거절(CLIENT_WRITE_IN_PROGRESS)시킨다. 조용히 삼키면 새 초안이 어디도 안 간다.
  const noticeInflight = useRef<string | null>(null);
  const deleteInflight = useRef<string | null>(null);
  const commentInflight = useRef<string | null>(null);
  const questInflight = useRef<string | null>(null);
  const claimInflight = useRef<string | null>(null);
  const constructionInflight = useRef<string | null>(null);
  const buildingOpenPending = useRef(false);

  // 다른 섬 방문자: 공지·댓글·퀘스트는 읽기만 하고 청사진은 보지 않는다
  const visitor = app ? app.visitor : concept.boardView === 'visitor';
  // 라이브 앱 경로 — App.tsx 와 같은 판정(services/demoMode)으로 review·demo 목업을 걸러 낸다.
  // 목업에서도 e 가 있으므로 e 유무만으로는 서버 경로를 켤 수 없다.
  const liveApp = !!e && !isMockMode();
  // 서버 게시판: 라이브 앱 라우트 + 비방문자일 때만 API 를 부른다. 방문자·목업·갤러리는 0콜이다.
  const serverBoard = liveApp && !visitor;
  const board = useBoardNotices({
    active: serverBoard,
    scopeKey: app ? String(app.island.id) : 'mock',
  });
  const constructionIslandId = e?.state.serverIslands?.currentIslandId ?? app?.island.id ?? null;
  const clientConstruction = e?.state.serverIslands?.clientConstruction;
  const resumeConstruction =
    clientConstruction?.islandId === constructionIslandId
      ? {
          buildingId: clientConstruction.building,
          startedAt: clientConstruction.startedAt,
          completesAt: clientConstruction.endsAt,
        }
      : null;
  // 회관에서 저장한 목표를 게시판에서도 같은 서버 조회·착공 명령으로 읽고 변경한다.
  const construction = useConstruction({
    active: serverBoard,
    islandId: constructionIslandId,
    now: e?.now ?? 0,
    withMembers: false,
    resumeTiming: resumeConstruction,
    onStarted: (receipt, islandId) =>
      eRef.current?.dispatch({
        type: 'SERVER_CONSTRUCTION_STARTED',
        islandId,
        building: receipt.buildingId as Building,
        startedAt: Date.parse(receipt.startedAt),
        endsAt: Date.parse(receipt.completesAt),
      }),
  });
  useEffect(() => {
    if (!serverBoard || !e || !board.islandId || !board.wallets) return;
    e.dispatch({
      type: 'SERVER_VILLAGE_POINTS',
      islandId: board.islandId,
      value: board.wallets.villagePoints,
      version: board.wallets.villagePointsVersion,
    });
  }, [
    serverBoard,
    board.islandId,
    board.wallets?.villagePoints,
    board.wallets?.villagePointsVersion,
  ]);
  // 쓰기 권한은 서버 섬 role 이 정본 — 로딩·실패 중엔 추측하지 않고 숨긴다.
  // 목업·갤러리 경로는 기존 로컬 owner 판정 그대로다.
  const owner = serverBoard
    ? board.islandRole === 'host'
    : app
      ? app.owner
      : local.role === 'owner';
  const user = owner ? OWNER : t('firstVoyage.peerName');
  // 공지 상세는 라우트가 연다 — route 'notice' 의 detail id 를 따라 select 한다.
  const noticeDetailId = e && e.route === 'notice' ? e.detail : null;
  // 이 라우트 id 의 상세를 이미 요청했는지 — 요청 전 한 프레임과 「삭제로 비워진」 상태를 구분한다.
  const noticeAsked = useRef<string | null>(null);
  useEffect(() => {
    if (!serverBoard) return;
    noticeAsked.current = noticeDetailId;
    board.select(noticeDetailId).catch(() => {});
    // islandId 는 첫 getBoard 가 끝나야 생긴다 — 생기는 순간 다시 select 한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverBoard, noticeDetailId, board.islandId, board.select]);

  // 퀘스트 상세도 라우트가 연다 — 'quest' 의 detail(단, 청사진의 'building' 은 제외)을 따라 select 한다.
  const questDetailId =
    e && e.route === 'quest' && e.detail && e.detail !== 'building' ? e.detail : null;
  useEffect(() => {
    if (!serverBoard) return;
    board.selectQuest(questDetailId).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverBoard, questDetailId, board.islandId, board.selectQuest]);

  // 서버 목록 항목은 id·title·commentCount 만 온다 — 시간·본문·댓글을 합성하지 않는다.
  const serverNotices: NoticeView[] = board.items.map((n) => ({
    id: n.id,
    title: n.title,
    time: '',
    body: '',
    comments: [],
    commentCount: n.commentCount,
  }));
  // 서버 경로만 API 목록 — 방문자·목업·갤러리는 기존 로컬 공지 그대로다.
  const notices: NoticeView[] = serverBoard
    ? serverNotices
    : (app?.notices ??
      mockNotices.map((notice, i) => ({
        ...notice,
        id: String(i),
        comments: notice.comments.map(([name, text], j) => ({
          id: String(j),
          name,
          text,
          mine: name === user,
        })),
      })));
  // 서버 회차 헤더 → 화면 모양. 진행률·수령·보상은 응답 필드가 정본이다(rate===100 추정 금지).
  const serverQuests: QuestView[] = board.quests.map((q) => ({
    id: q.occurrenceId,
    questId: q.id,
    title: q.title,
    type: q.type === 'screen' ? 'phone' : 'focus',
    startTime: q.windowStart ?? undefined,
    endTime: q.windowEnd ?? undefined,
    target: q.targetMinutes,
    rate: q.myRate,
    claimable: q.claimable,
    claimed: q.claimed,
    claimBlockedReason: q.claimBlockedReason,
    rewardAmount: q.reward.amount,
    bonusAmount: q.bonusAmount,
    bonusGranted: q.bonusGranted,
  }));
  const quests: QuestView[] = serverBoard
    ? serverQuests
    : (app?.quests ?? mockQuests.map((q, i) => ({ ...q, id: String(i) })));
  const residentsOf = (quest: QuestView): ResidentRate[] => {
    // 서버 경로의 주민 목록은 progress GET 이 정본 — 털색·착용도 응답 값을 쓴다(GROMO-2389).
    if (serverBoard) {
      const open = board.questDetail?.occurrenceId === quest.id ? board.questDetail : null;
      return (open?.members ?? []).map((m) => ({
        id: m.userId,
        name: m.name ?? t('onboarding.residentFallbackName'),
        color: m.catColor ?? null,
        outfit: appearanceOutfit(m.appearance),
        rate: m.rate,
        achieved: m.achieved,
        claimed: m.claimed,
      }));
    }
    return (
      app?.ratesOf(quest) ??
      RESIDENTS.map(([name, color], i) => ({
        id: name,
        name: name === user ? t('ui.board.meSuffix', { v0: name }) : name,
        color,
        rate: local.screenUnknown && quest.type === 'phone' ? null : i < 2 ? quest.rate : 48,
      }))
    );
  };
  const mockReady = local.balance >= 60;
  const localBlueprintView: BlueprintView = app?.blueprint ?? {
    ...buildOptions[0],
    buildingId: 'library',
    state: ['building', 'complete'].includes(local.view)
      ? (local.view as 'building' | 'complete')
      : mockReady
        ? 'ready'
        : 'waiting',
    collected: local.balance,
    needed: 60,
    balance: local.balance,
    cost: 60,
    progress: 35,
    residents: [],
  };
  const constructionOptions = construction.options;
  // 서버 옵션은 미완공 건물만 포함하므로, 조회에 성공한 빈 목록은 전체 완공이다.
  const allBuildingsComplete =
    serverBoard && construction.status === 'ready' && constructionOptions?.items.length === 0;
  const constructionTiming = construction.timing;
  // 착공하면 서버 목표는 null이 된다. 서버가 알려 준 공사 구간으로 진행 건물을 잇는다.
  const selectedBuilding =
    constructionOptions?.selectedBuildingId ??
    (constructionOptions ? constructionTiming?.buildingId : null);
  const selectedOption = constructionOptions?.items.find((item) => item.id === selectedBuilding);
  const selectedArt = buildOptions.find(
    (item) => item.id === blueprintOption[selectedBuilding as Building],
  );
  const hasConstructionTiming =
    !!selectedBuilding && constructionTiming?.buildingId === selectedBuilding;
  const blueprintView: BlueprintView = serverBoard
    ? {
        buildingId: selectedBuilding ?? null,
        state: !selectedBuilding
          ? 'none'
          : !selectedOption
            ? 'complete' // options에는 미완공 건물만 있다.
            : selectedOption.blockedReason === 'IN_PROGRESS'
              ? 'building'
              : selectedOption.buildable
                ? 'ready'
                : 'waiting',
        name: selectedBuilding ? buildingNames[selectedBuilding as Building] : '',
        image:
          selectedArt?.image ??
          (selectedBuilding === 'hall'
            ? interiorArt.buildings.hall
            : interiorArt.buildings.noticeboard),
        price: selectedOption ? t('ui.board.totalFish', { v0: selectedOption.cost }) : '',
        time: '', // 조회 응답에는 공사 소요 시간이 없으므로 시안 값을 보여 주지 않는다.
        detail: selectedArt?.detail ?? '',
        balance: constructionOptions?.villagePoints ?? 0,
        cost: selectedOption?.cost ?? 0,
        // 모든 건물의 준비량은 섬 통장 잔액이다.
        collected: 0,
        needed: 0,
        residents: [],
        progress: hasConstructionTiming
          ? Math.round(normalizedConstructionProgress(constructionTiming, e.now) * 100)
          : 0,
      }
    : localBlueprintView;

  // 없는 공지·퀘스트 id로 상세를 열면 목록을 보여 주고 라우트도 목록으로 바꾼다
  // 서버 경로의 공지는 이 검사를 건너뛴다 — 목록은 첫 페이지뿐이라 없는 id 판정이 틀리고,
  // 진짜 없는 공지는 상세 GET 의 오류 화면이 담당한다.
  const homeQuestList = e?.route === 'quest' && e.detail === HOME_QUEST_LIST_DETAIL;
  const missing =
    !!e &&
    ((!serverBoard &&
      (e.route === 'notice' || (e.route === 'noticeEdit' && e.detail)) &&
      !notices.some((n) => n.id === e.detail)) ||
      // 서버 경로의 퀘스트도 이 검사를 건너뛴다 — 목록 로딩 중엔 모르고, 진짜 없는 회차는
      // progress GET 의 오류 화면(QUEST_GONE·404)이 담당한다.
      (!serverBoard &&
        ((e.route === 'quest' && e.detail !== 'building' && !homeQuestList) ||
          (e.route === 'questEdit' && e.detail)) &&
        !quests.some((q) => q.id === e.detail)));
  useEffect(() => {
    if (!missing) return;
    e.replace('board');
    e.setTab(e.route === 'quest' || e.route === 'questEdit' ? boardTabs.quest : boardTabs.notice);
  }, [missing]);
  // 앱 라우트 → 게시판 상태. 공지·퀘스트·청사진 종이와 상세·작성 화면은 route/detail/tab으로 정해진다
  const s: BoardState = (() => {
    if (!e) return local;
    const r = e.route,
      detail: string = e.detail;
    const routePanel: BoardState['panel'] =
      r === 'notice' || r === 'noticeEdit'
        ? 'notice'
        : r === 'questEdit' || (r === 'quest' && detail !== 'building')
          ? 'quest'
          : r === 'quest'
            ? 'blueprint'
            : ((Object.keys(boardTabs) as (keyof typeof boardTabs)[]).find(
                (k) => boardTabs[k] === e.tab,
              ) ?? '');
    const panel = visitor && routePanel === 'blueprint' ? '' : routePanel;
    const view = missing
      ? 'list'
      : ui.confirm
        ? 'confirm'
        : r === 'notice'
          ? ui.comment
            ? 'comment'
            : 'detail'
          : r === 'noticeEdit'
            ? detail
              ? 'edit'
              : 'write'
            : r === 'questEdit'
              ? 'write'
              : panel === 'quest' && r === 'quest'
                ? homeQuestList
                  ? 'list'
                  : 'detail'
                : panel === 'blueprint'
                  ? blueprintView.state
                  : 'list';
    return {
      ...local,
      role: owner ? 'owner' : 'resident',
      panel,
      view,
      noticeIndex: Math.max(
        0,
        notices.findIndex((n) => n.id === detail),
      ),
      questIndex: Math.max(
        0,
        quests.findIndex((q) => q.id === detail),
      ),
      draft: r === 'noticeEdit' ? { title: e.text, body: e.body } : null,
      commentDraft: e.text,
      error: ui.error,
      editing: (r === 'noticeEdit' || r === 'questEdit') && !!detail,
      deleteTarget: ui.confirm?.target ?? 'notice',
      commentIndex: ui.confirm?.index ?? 0,
      questForm:
        r === 'questEdit'
          ? {
              type: e.body === 'screen' ? 'phone' : 'focus',
              title: e.text,
              startTime: e.windowStart,
              endTime: e.windowEnd,
              target: ui.target,
            }
          : null,
    };
  })();
  const render = (change: Partial<BoardState>) => setS({ ...s, ...change, serial: s.serial + 1 });
  const setError = (error: string) =>
    e ? setUi((prev) => ({ ...prev, error })) : render({ error });
  const failCopy = t('ui.board.saveFailed');
  // 서버 오류 message 는 그대로 띄울 수 있는 계약이다 — 아니면 기존 문구로 떨어진다.
  const apiMessage = (err: unknown, fallback = failCopy) =>
    err instanceof ApiError ? errorTextOr(err, 'errors.GENERIC') : fallback;
  // stale(계정·범위 교체 중 시작된) 쓰기 오류는 새 화면에 띄우지 않는다.
  const apiWriteMessage = (err: unknown) =>
    err instanceof ApiError && err.code === CLIENT_STALE_SESSION ? '' : apiMessage(err);
  // 서버 상세 — 본문·댓글은 getNotice 만 준다. 탈퇴 작성자의 name 은 null 그대로 두고
  // 본인 여부는 서버 작성자 ID와 현재 세션으로 판단한다.
  const serverDetailView: NoticeView | null = board.detail
    ? {
        id: board.detail.id,
        title: board.detail.title,
        time: '',
        body: board.detail.body,
        comments: board.detail.comments.map((c) => ({
          id: c.id,
          name: c.name ?? '',
          text: c.text,
          mine: c.userId != null && c.userId === getSession()?.userId,
        })),
      }
    : null;

  // 화면 동작. 목업은 로컬 상태를, 앱은 라우트 이동과 reducer 액션을 쓴다
  const nav = {
    open: (panel: BoardState['panel']) => {
      if (visitor && panel === 'blueprint') return;
      if (!e) {
        if (s.panel === panel) return render({ panel: '', view: 'list', error: '' });
        return render({
          panel,
          view: panel === 'blueprint' ? (s.ready ? 'ready' : 'waiting') : 'list',
          error: '',
        });
      }
      // 열린 종이를 다시 누르면 닫고, 다른 종이는 기록을 쌓지 않고 바꿔 연다
      if (s.panel === panel) return e.back();
      if (serverBoard && panel === 'blueprint') void construction.reload().catch(() => undefined);
      if (s.panel) e.replace('board');
      else e.go('board');
      if (panel) e.setTab(boardTabs[panel]);
    },
    closePanel: () => (e ? e.back() : render({ panel: '' })),
    openNotice: (index: number) => {
      // 게시판 글 상세를 여는 사용자 행동 1회(탭당 1회) — 목록에서 글을 펼쳐 읽는 지점
      captureProductEvent('feature_used', { building: 'board', action: 'read' });
      return e
        ? e.go('notice', notices[index].id)
        : render({ noticeIndex: index, view: 'detail', error: '' });
    },
    backToNotices: () => (e ? e.back() : render({ view: 'list', commentDraft: '', error: '' })),
    newNotice: () => {
      if (!owner) return;
      draftEpoch.current += 1;
      if (e) return e.go('noticeEdit');
      render({
        view: 'write',
        editing: false,
        draft: s.draft ?? { title: '', body: '' },
        error: '',
      });
    },
    editNotice: () => {
      if (!owner) return;
      // 서버 경로의 본문은 상세 GET 에 있다 — 목록 항목엔 본문이 없다.
      const notice = serverBoard ? serverDetailView : notices[s.noticeIndex];
      if (!notice) return;
      draftEpoch.current += 1;
      if (!e)
        return render({
          editing: true,
          draft: { title: notice.title, body: notice.body },
          view: 'edit',
          error: '',
        });
      e.go('noticeEdit', notice.id);
      e.setText(notice.title);
      e.setBody(notice.body);
    },
    cancelEditor: () => {
      draftEpoch.current += 1;
      return e ? e.back() : render({ view: s.editing ? 'detail' : 'list', error: '' });
    },
    setDraft: (patch: { title?: string; body?: string }) => {
      draftEpoch.current += 1;
      if (!e)
        return setS((prev) => ({
          ...prev,
          draft: { ...(prev.draft ?? { title: '', body: '' }), ...patch },
        }));
      if (patch.title !== undefined) e.setText(patch.title);
      if (patch.body !== undefined) e.setBody(patch.body);
    },
    publish: () => {
      if (!owner) return;
      const draft = s.draft;
      if (!draft?.title.trim() || !draft.body.trim()) return setError(t('ui.board.requiredNotice'));
      const next = { title: draft.title.trim(), body: draft.body.trim() };
      if (e) {
        // 목업 서버: 다음 저장을 실패로 만들면 입력을 그대로 두고 문구만 보여 준다
        if (e.failNext) {
          e.setFailNext(false);
          return setError(failCopy);
        }
        if (!serverBoard) {
          // 목업(review/demo) 경로 — 기존 로컬 dispatch 그대로.
          e.dispatch({ type: 'NOTICE_SAVE', id: e.detail, ...next });
          return e.back();
        }
        // 서버 경로: 쓰기 성공 + 정본 재조회까지 끝나야 돌아간다.
        // 실패해도 e.text·e.body 초안은 건드리지 않는다.
        // 같은 의도의 중복 탭만 무시 — 다른 내용은 훅이 진행 중 거절로 명시 실패시켜
        // 문구를 띄우고 초안을 보존한다(조용히 삼키면 새 내용이 어디도 안 간다).
        const intent = `${s.editing ? e.detail : ''}${next.title}\n${next.body}`;
        if (noticeInflight.current === intent) return;
        const write =
          s.editing && e.detail ? board.updateNotice(e.detail, next) : board.createNotice(next);
        noticeInflight.current = intent;
        const op = routeGen.current;
        const draftOp = draftEpoch.current;
        write.then(
          () => {
            if (noticeInflight.current === intent) noticeInflight.current = null;
            // 시작한 화면 + 그대로인 초안일 때만 뒤로 간다 — 이동·재진입·추가 입력은 무효.
            const now = liveE(op);
            if (now && draftEpoch.current === draftOp) now.back();
          },
          (err: unknown) => {
            if (noticeInflight.current === intent) noticeInflight.current = null;
            if (liveE(op)) setError(apiWriteMessage(err));
          },
        );
        return;
      }
      if (s.editing && mockNotices[s.noticeIndex]) {
        setNotices(
          mockNotices.map((notice, i) => (i === s.noticeIndex ? { ...notice, ...next } : notice)),
        );
        return render({ view: 'detail', error: '', editing: false, draft: null });
      }
      setNotices([...mockNotices, { ...next, time: t('magazine.rack.today'), comments: [] }]);
      render({
        noticeIndex: mockNotices.length,
        view: 'detail',
        error: '',
        editing: false,
        draft: null,
      });
    },
    askDelete: (target: 'notice' | 'comment', index = 0) => {
      if (visitor) return;
      const comment = (serverBoard ? serverDetailView : notices[s.noticeIndex])?.comments[index];
      if (target === 'notice' ? !owner : !comment || (!owner && !comment.mine)) return;
      draftEpoch.current += 1;
      if (e)
        return setUi((prev) => ({ ...prev, confirm: { target, index, commentId: comment?.id } }));
      render(
        target === 'notice'
          ? { deleteTarget: 'notice', view: 'confirm' }
          : { deleteTarget: 'comment', commentIndex: index, view: 'confirm' },
      );
    },
    cancelDelete: () => {
      draftEpoch.current += 1;
      return e ? setUi((prev) => ({ ...prev, confirm: null })) : render({ view: 'detail' });
    },
    confirmDelete: () => {
      if (s.deleteTarget === 'notice') {
        if (!owner) return;
        if (e && !serverBoard) {
          // 목업(review/demo) 경로 — 기존 로컬 dispatch 그대로.
          const notice = notices[s.noticeIndex];
          if (!notice) return;
          e.dispatch({ type: 'NOTICE_DELETE', id: notice.id });
          return e.back();
        }
        if (serverBoard && e) {
          // 서버 경로의 삭제 대상 id 는 라우트 detail 이 정본이다 — 목록 첫 페이지에
          // 없는 공지도 지울 수 있다.
          const id = e.detail || notices[s.noticeIndex]?.id;
          if (!id || deleteInflight.current === id) return;
          const write = board.deleteNotice(id);
          deleteInflight.current = id;
          const op = routeGen.current;
          const draftOp = draftEpoch.current;
          write.then(
            () => {
              if (deleteInflight.current === id) deleteInflight.current = null;
              // 확인창을 취소·재열거나 화면이 바뀌면 옛 삭제의 닫기/back 은 실행하지 않는다.
              const now = liveE(op);
              if (!now || draftEpoch.current !== draftOp) return;
              setUi((prev) => ({ ...prev, confirm: null }));
              now.back();
            },
            (err: unknown) => {
              if (deleteInflight.current === id) deleteInflight.current = null;
              const now = liveE(op);
              if (!now || draftEpoch.current !== draftOp) return;
              setUi((prev) => ({ ...prev, confirm: null, error: apiWriteMessage(err) }));
            },
          );
          return;
        }
        const notice = notices[s.noticeIndex];
        if (!notice) return;
        setNotices(mockNotices.filter((_, i) => i !== s.noticeIndex));
        return render({ noticeIndex: 0, view: 'list' });
      }
      if (e && serverBoard) {
        const notice = serverDetailView;
        const comment = notice?.comments.find((item) => item.id === ui.confirm?.commentId);
        if (!notice || !comment || (!owner && !comment.mine)) return;
        const intent = `comment:${notice.id}:${comment.id}`;
        if (deleteInflight.current === intent) return;
        deleteInflight.current = intent;
        const op = routeGen.current;
        const draftOp = draftEpoch.current;
        board.deleteComment(notice.id, comment.id).then(
          () => {
            if (deleteInflight.current === intent) deleteInflight.current = null;
            if (!liveE(op) || draftEpoch.current !== draftOp) return;
            setUi((prev) => ({ ...prev, confirm: null, error: '' }));
          },
          (err: unknown) => {
            if (deleteInflight.current === intent) deleteInflight.current = null;
            if (!liveE(op) || draftEpoch.current !== draftOp) return;
            setUi((prev) => ({ ...prev, confirm: null, error: apiWriteMessage(err) }));
          },
        );
        return;
      }
      const notice = notices[s.noticeIndex];
      if (!notice) return;
      const comment = notice.comments[s.commentIndex];
      if (!comment || (!owner && !comment.mine)) return;
      if (e) {
        // 목업(review/demo) 경로 — 기존 로컬 dispatch 그대로.
        e.dispatch({ type: 'COMMENT_DELETE', id: notice.id, commentId: comment.id });
        return setUi((prev) => ({ ...prev, confirm: null }));
      }
      setNotices(
        mockNotices.map((n, i) =>
          i === s.noticeIndex
            ? { ...n, comments: n.comments.filter((_, j) => j !== s.commentIndex) }
            : n,
        ),
      );
      render({ view: 'detail' });
    },
    openComment: () => {
      if (visitor) return;
      draftEpoch.current += 1;
      if (e) return setUi((prev) => ({ ...prev, comment: true }));
      render({ view: 'comment', error: '' });
    },
    cancelComment: () => {
      draftEpoch.current += 1;
      if (!e) return render({ view: 'detail', commentDraft: '', error: '' });
      e.setText('');
      setUi((prev) => ({ ...prev, comment: false }));
    },
    setCommentDraft: (commentDraft: string) => {
      draftEpoch.current += 1;
      return e ? e.setText(commentDraft) : setS((prev) => ({ ...prev, commentDraft }));
    },
    submitComment: () => {
      const text = s.commentDraft.trim(),
        // 서버 경로의 대상 id 는 라우트 detail — 목록 첫 페이지 밖의 공지에도 달 수 있다.
        noticeId = serverBoard ? e?.detail : notices[s.noticeIndex]?.id;
      if (visitor || !text || !noticeId) return;
      if (e) {
        if (!serverBoard) {
          // 목업(review/demo) 경로 — 기존 로컬 dispatch 그대로.
          e.dispatch({ type: 'COMMENT', id: noticeId, text });
          e.setText('');
          return setUi((prev) => ({ ...prev, comment: false }));
        }
        // 성공(쓰기 + 정본 재조회)해야 입력을 비우고 닫는다 — 실패하면 댓글 초안이 남는다.
        // 입력창을 닫았다 열거나 내용이 한 글자라도 바뀌면 옛 작업의 비우기·닫기는 무효다 —
        // e.text 는 공유 필드라 새 초안을 지울 수 있다. 같은 내용 중복 탭만 무시한다.
        const intent = `${noticeId}${text}`;
        if (commentInflight.current === intent) return;
        const write = board.addComment(noticeId, text);
        commentInflight.current = intent;
        const op = routeGen.current;
        const draftOp = draftEpoch.current;
        write.then(
          () => {
            e.onBoardCommentRead?.();
            if (commentInflight.current === intent) commentInflight.current = null;
            const now = liveE(op);
            if (!now || draftEpoch.current !== draftOp) return;
            now.setText('');
            setUi((prev) => ({ ...prev, comment: false, error: '' }));
          },
          (err: unknown) => {
            if (commentInflight.current === intent) commentInflight.current = null;
            if (liveE(op)) setError(apiWriteMessage(err));
          },
        );
        return;
      }
      setNotices(
        mockNotices.map((n, i) =>
          i === s.noticeIndex ? { ...n, comments: [...n.comments, [user, text]] } : n,
        ),
      );
      render({ commentDraft: '', view: 'detail', error: '' });
    },
    openQuest: (index: number) =>
      e
        ? e.go('quest', quests[index].id)
        : render({ questIndex: index, view: 'detail', screenUnknown: false }),
    backToQuests: () =>
      e
        ? e.back()
        : render({
            view: s.editing ? 'detail' : 'list',
            questForm: null,
            editing: false,
            error: '',
          }),
    newQuest: () => {
      if (!owner) return;
      if (!e) return render({ view: 'write', questForm: null, editing: false, error: '' });
      e.go('questEdit');
      e.setBody('focus');
      // 드럼 피커는 빈 값을 00:00 으로 보이기만 하고 폼엔 안 쓴다 — 보이는 값이 곧 폼 값이도록
      // 렌더-스테이트 기본(19:00–22:00·50분)과 똑같이 실제 기본 시각으로 초기화한다(GROMO-2672, 코드리뷰 반영).
      e.setWindowStart('19:00');
      e.setWindowEnd('22:00');
      setUi((prev) => ({ ...prev, target: '50' }));
    },
    // 방장만: 기존 값을 채운 만들기 종이를 연다. 저장하면 상세로 돌아온다
    editQuest: (quest: QuestView) => {
      if (!owner) return;
      const form: QuestForm = {
        type: quest.type,
        title: quest.title,
        startTime: quest.startTime ?? '',
        endTime: quest.endTime ?? '',
        target: String(quest.target),
      };
      if (!e) return render({ view: 'write', editing: true, questForm: form, error: '' });
      e.go('questEdit', quest.id);
      e.setText(form.title);
      e.setBody(quest.type === 'phone' ? 'screen' : 'focus');
      e.setWindowStart(form.startTime);
      e.setWindowEnd(form.endTime);
      // 목표 분은 routeKey effect 가 서버 목록에서 못 찾을 수 있으니 여기서도 채운다.
      if (serverBoard) setUi((prev) => ({ ...prev, target: String(quest.target) }));
    },
    setQuestForm: (form: QuestForm, patch: Partial<QuestForm>) => {
      // 저장 요청 후에 입력을 바꾸면 이전 성공 콜백이 새 초안을 닫지 못하게 한다.
      draftEpoch.current += 1;
      if (!e)
        return setS((prev) => ({
          ...prev,
          error: '',
          questForm: { ...form, ...prev.questForm, ...patch },
        }));
      if (patch.type) e.setBody(patch.type === 'phone' ? 'screen' : 'focus');
      if (patch.title !== undefined) e.setText(patch.title);
      if (patch.startTime !== undefined) e.setWindowStart(patch.startTime);
      if (patch.endTime !== undefined) e.setWindowEnd(patch.endTime);
      // 목표 분은 정수만 받는다
      setUi((prev) => ({
        ...prev,
        error: '',
        target: patch.target === undefined ? prev.target : patch.target.replace(/\D/g, ''),
      }));
    },
    submitQuest: (form: QuestForm) => {
      if (!owner) return;
      // serverEdit: 서버 PATCH 는 창을 안 받고 UI 도 읽기 전용이라 창 검증을 건너뛴다(GROMO-2672).
      const serverEdit = Boolean(serverBoard && s.editing);
      const error = questError(form, serverEdit);
      if (error) return e ? setError(error) : render({ view: 'write', questForm: form, error });
      // UTC 자정을 가로지르는 창은 서버가 거절한다(결정 Q-6) — 입력칸 아래 안내가 이유를 보이므로
      // 제출만 조용히 막는다. 변환 자체는 서버 어댑터(quests.ts createQuest)가 한다(GROMO-2672).
      if (
        !serverEdit &&
        form.type === 'focus' &&
        kstWindowCrossesUtcMidnight(form.startTime, form.endTime)
      )
        return;
      const title = form.title.trim(),
        target = Number(form.target);
      if (e) {
        if (!serverBoard) {
          // 목업(review/demo) 경로 — 기존 로컬 dispatch 그대로.
          e.dispatch({
            type: 'QUEST_SAVE',
            id: s.editing ? e.detail : undefined,
            title,
            kind: form.type === 'phone' ? 'screen' : 'focus',
            target,
            windowStart: clockText(form.startTime),
            windowEnd: clockText(form.endTime),
          });
          return e.back();
        }
        // 서버 경로: PATCH 는 title/targetMinutes 만 받는다 — 종류·창·expectedVersion 을 섞으면 400.
        // 성공(쓰기 + getBoard 재조회)해야 돌아간다 — 실패해도 초안은 그대로다.
        const intent = `${s.editing ? e.detail : ''}${title}|${target}|${form.type}|${form.startTime}|${form.endTime}`;
        if (questInflight.current === intent) return;
        const write =
          s.editing && e.detail
            ? board.updateQuest(
                quests.find((quest) => quest.id === e.detail)?.questId ?? e.detail,
                { title, targetMinutes: target },
              )
            : board.createQuest({
                title,
                type: form.type === 'phone' ? 'screen' : 'focus',
                targetMinutes: target,
                ...(form.type === 'focus'
                  ? {
                      // KST 벽시계 그대로 보낸다 — UTC 변환·24:00 방어는 서버 어댑터(quests.ts createQuest)가 한다.
                      windowStart: clockText(form.startTime),
                      windowEnd: clockText(form.endTime),
                      timezone: 'UTC',
                    }
                  : {}),
              });
        questInflight.current = intent;
        const op = routeGen.current;
        const draftOp = draftEpoch.current;
        write.then(
          () => {
            if (questInflight.current === intent) questInflight.current = null;
            const now = liveE(op);
            if (now && draftEpoch.current === draftOp) now.back();
          },
          (err: unknown) => {
            if (questInflight.current === intent) questInflight.current = null;
            if (liveE(op)) setError(apiWriteMessage(err));
          },
        );
        return;
      }
      const next: Quest =
        form.type === 'phone'
          ? { title, type: 'phone', target, rate: 0 }
          : {
              title,
              type: 'focus',
              startTime: form.startTime,
              endTime: form.endTime,
              target,
              rate: 0,
            };
      if (s.editing && mockQuests[s.questIndex]) {
        setQuests(mockQuests.map((q, i) => (i === s.questIndex ? { ...next, rate: q.rate } : q)));
        return render({ view: 'detail', questForm: null, editing: false, error: '' });
      }
      setQuests([...mockQuests, next]);
      render({ view: 'list', questForm: null, error: '' });
    },
    // 개인 몫 수령 — 본문·지급량은 서버 판정이다. 성공하면 훅이 목록·지갑을 다시 읽고
    // 여기서는 응답의 적립량을 알리기만 한다(로컬 재화 가산 없음).
    claimQuest: (quest: QuestView) => {
      if (!serverBoard || !quest.claimable || quest.claimed) return;
      const item = board.quests.find((q) => q.occurrenceId === quest.id);
      if (!item || claimInflight.current === item.occurrenceId) return;
      claimInflight.current = item.occurrenceId;
      const op = routeGen.current;
      board.claimQuest(item).then(
        (result) => {
          if (claimInflight.current === item.occurrenceId) claimInflight.current = null;
          if (!liveE(op)) return;
          showToast?.(
            result.bonusAdded > 0
              ? t('ui.board.rewardAndBonus', {
                  v0: result.villagePointsAdded,
                  v1: result.bonusAdded,
                })
              : t('ui.board.rewardAdded', { v0: result.villagePointsAdded }),
          );
        },
        (err: unknown) => {
          if (claimInflight.current === item.occurrenceId) claimInflight.current = null;
          if (liveE(op)) setError(apiWriteMessage(err));
        },
      );
    },
    build: () => {
      if (!owner || blueprintView.state !== 'ready') return;
      if (serverBoard) {
        if (!selectedBuilding || constructionInflight.current !== null) return;
        const target = selectedBuilding;
        const op = routeGen.current;
        e.confirm(
          t('constructionPlan.confirmTitle', { name: blueprintView.name }),
          t('constructionPlan.confirmBody', {
            cost: constructionFish(blueprintView.cost),
            remaining: constructionFish(blueprintView.balance - blueprintView.cost),
          }),
          () => {
            if (!liveE(op) || constructionInflight.current !== null) return;
            constructionInflight.current = target;
            setError('');
            construction
              .build(target, blueprintView.cost)
              .catch((error: unknown) => {
                if (liveE(op)) setError(apiWriteMessage(error));
              })
              .finally(() => {
                if (constructionInflight.current === target) constructionInflight.current = null;
              });
          },
          { ok: t('constructionPlan.start') },
        );
        return;
      }
      if (e) return app?.building && e.build(app.building);
      if (s.balance < 60) return;
      render({ balance: s.balance - 60, view: 'building' });
    },
    openBuilding: () => {
      const building = serverBoard ? selectedBuilding : app?.building;
      const r = building && buildingRoute[building as Building];
      if (!r) return;
      if (!serverBoard) return e?.go(r);
      if (buildingOpenPending.current) return;
      const op = routeGen.current;
      const gen = sessionGeneration();
      const islandId = constructionIslandId;
      const current = () => {
        const latest = liveE(op);
        return (
          latest &&
          sessionGeneration() === gen &&
          latest.state.serverIslands?.currentIslandId === islandId &&
          !latest.state.visitingIslandId
        );
      };
      buildingOpenPending.current = true;
      setError('');
      loadHomeSnapshot({
        date: dayKey(e.now),
        timezone: 'Asia/Seoul',
        isCurrent: () => !!current(),
      })
        .then((snapshot) => {
          if (!current()) return;
          if (
            snapshot.status !== 'loaded' ||
            snapshot.facts.islandId !== islandId ||
            !snapshot.facts.completedBuildings.includes(building as Building)
          ) {
            setError(t('ui.board.completionFailed'));
            return;
          }
          const latest = liveE(op);
          if (!latest) return;
          latest.dispatch({ type: 'SERVER_HOME', facts: snapshot.facts });
          latest.go(r);
        })
        .catch((error: unknown) => {
          if (current()) setError(apiWriteMessage(error));
        })
        .finally(() => {
          buildingOpenPending.current = false;
        });
    },
  };

  const h4 = boardFont(20, 1.35, '700', INK, GOWUN);
  const body = [boardFont(14, 1.6), webOnly({ whiteSpace: 'pre-line', overflowWrap: 'anywhere' })];
  const muted = (style: any) => [boardFont(14, 1.5, '400', '#786151'), style];
  const formError = s.error !== '' && (
    <Text style={boardFont(13, 1.45, '400', '#a35952')}>{s.error}</Text>
  );
  // 종이 오른쪽 위 × 하나로 현재 단계를 닫고 이전 단계로 돌아간다.
  // 쓰기 종이는 제목을 × 와 같은 줄에 두어 키보드 위에 입력칸이 한 줄이라도 더 보이게 한다.
  const detailHead = (close: React.ReactNode, title?: string) => (
    <View
      style={{
        minHeight: 44,
        marginRight: -5,
        marginBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 8,
      }}
    >
      {title !== undefined && <Text style={[h4, { flex: 1 }]}>{title}</Text>}
      {close}
    </View>
  );

  const noticeList = () => (
    <View>
      <View>
        <Text style={[boardFont(14, 1.2, '400', '#9b7058'), { marginBottom: 1 }]}>
          {app ? t('ui.board.islandBoard', { v0: app.island.name }) : t('ui.board.sampleBoard')}
        </Text>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            marginBottom: 6,
          }}
        >
          <Text style={boardFont(28, 1.15, '700', INK)}>
            {t('ui.board.notice')}{' '}
            <Text style={{ fontSize: 16, lineHeight: lh(16 * 1.15), color: '#9b7058' }}>
              {notices.length}
            </Text>
          </Text>
          {owner && (
            <Btn
              small
              id="board-notice-new"
              title={t('ui.board.newNotice')}
              onPress={nav.newNotice}
            />
          )}
        </View>
      </View>
      <View>
        {serverBoard && board.loading ? (
          <Text style={muted({ marginTop: 4, marginBottom: 14 })}>
            {t('account.blocked.loading')}
          </Text>
        ) : serverBoard && board.error ? (
          <View>
            <Text style={muted({ marginTop: 4, marginBottom: 8 })}>
              {apiMessage(board.error, t('ui.board.loadFailed'))}
            </Text>
            <PaperAction
              testID="board-notices-retry"
              label={t('common.retry')}
              onPress={() => board.retry().catch(() => {})}
            />
          </View>
        ) : notices.length ? (
          notices.map((notice, i) => (
            <Pressable
              key={notice.id}
              testID={`board-notice-item-${i}`}
              accessibilityRole="button"
              onPress={() => nav.openNotice(i)}
              style={({ pressed }) => ({
                minHeight: 66,
                gap: 5,
                paddingVertical: 10,
                paddingHorizontal: 2,
                borderBottomWidth: 1,
                borderColor: '#b48c704d',
                borderStyle: 'dashed',
                backgroundColor: pressed ? exact('#b67c4d14') : 'transparent',
              })}
            >
              <Text style={[boardFont(17, 1.25, '700', INK), webOnly({ wordBreak: 'keep-all' })]}>
                {notice.title}
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <Text style={boardFont(12, 1.3, '400', '#786151', GOWUN)}>{notice.time}</Text>
                <Text
                  style={[
                    boardFont(12, 1.3, '400', '#786151', GOWUN),
                    webOnly({ whiteSpace: 'nowrap' }),
                  ]}
                >
                  {t('ui.board.commentCount', {
                    v0: notice.commentCount ?? notice.comments.length,
                  })}
                  <Text
                    style={{
                      fontSize: 19,
                      lineHeight: lh(19 * 1.3),
                      color: '#73533e',
                      marginLeft: 3,
                    }}
                  >
                    ›
                  </Text>
                </Text>
              </View>
            </Pressable>
          ))
        ) : (
          <Text style={muted({ marginTop: 4, marginBottom: 14 })}>{t('ui.board.noNotices')}</Text>
        )}
        {serverBoard && board.nextCursor !== null && (
          <PaperAction
            testID="board-notices-more"
            label={board.loadingMore ? t('account.blocked.loading') : t('developerNotices.more')}
            onPress={() => board.loadMore()}
          />
        )}
      </View>
    </View>
  );

  // 댓글 입력칸과 등록 — 늘 공지 본문 스크롤 밖 아래에 고정해 키보드 바로 위에 보이게 한다. 키보드로 높이가
  // 바뀌어도 자리를 옮기지 않는다(옮기면 입력칸이 새로 마운트돼 포커스·키보드를 잃는다).
  const commentComposer = () => (
    <View
      style={{ gap: 8, borderColor: '#d7bea0', marginTop: 8, paddingTop: 8, borderTopWidth: 1 }}
    >
      <TextInput
        testID="board-comment-input"
        accessibilityLabel={t('ui.board.commentBody')}
        autoFocus
        multiline
        textAlignVertical="top"
        value={s.commentDraft}
        onChangeText={nav.setCommentDraft}
        placeholder={t('ui.board.commentPlaceholder')}
        placeholderTextColor="#8d796a"
        style={[
          inputStyle(),
          {
            height: 76,
            borderWidth: 0,
            borderBottomWidth: 1.5,
            borderRadius: 0,
            paddingHorizontal: 2,
            backgroundColor: 'transparent',
          },
        ]}
      />
      {formError}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
        <PaperAction
          testID="board-comment-submit"
          label={t('ui.board.postComment')}
          onPress={nav.submitComment}
          style={!s.commentDraft.trim() && { opacity: 0.38 }}
        />
      </View>
    </View>
  );

  const noticeDetail = () => {
    // 서버 경로의 상세는 hook 의 detail 이 정본이다 — 목록 항목엔 본문·댓글이 없다.
    const notice = serverBoard ? serverDetailView : notices[s.noticeIndex];
    if (serverBoard && board.detailError)
      return (
        <View>
          {detailHead(
            <NavBtn
              testID="board-notice-close"
              close
              boardPaper
              label={t('ui.board.closeNotice')}
              onPress={nav.backToNotices}
            />,
          )}
          <Text style={muted({ marginTop: 4, marginBottom: 8 })}>
            {apiMessage(board.detailError, t('ui.board.loadFailed'))}
          </Text>
          <PaperAction
            testID="board-notice-retry"
            label={t('common.retry')}
            onPress={() => board.select(e.detail).catch(() => {})}
          />
        </View>
      );
    if (serverBoard && !notice)
      return (
        <View>
          {detailHead(
            <NavBtn
              testID="board-notice-close"
              close
              boardPaper
              label={t('ui.board.closeNotice')}
              onPress={nav.backToNotices}
            />,
          )}
          {/* 요청을 냈고 로딩도 끝났는데 detail 이 없으면 종결 — 삭제로 비워진 공지다. */}
          <Text style={muted({ marginTop: 4 })}>
            {board.detailLoading || !board.islandId || noticeAsked.current !== noticeDetailId
              ? t('account.blocked.loading')
              : t('ui.board.noticeUnavailable')}
          </Text>
        </View>
      );
    if (!notice) return noticeList();
    const comments = notice.comments.map((comment, i) => [comment, i] as const);
    return (
      <View>
        {detailHead(
          <NavBtn
            testID="board-notice-close"
            close
            boardPaper
            label={t('ui.board.closeNotice')}
            onPress={nav.backToNotices}
          />,
        )}
        <Text
          style={[
            boardFont(23, 1.2, '700', INK),
            { marginTop: 4, marginBottom: 3 },
            webOnly({ wordBreak: 'keep-all', textWrap: 'pretty' }),
          ]}
        >
          {notice.title}
        </Text>
        {notice.time !== '' && (
          <Text style={[boardFont(11, 1.45, '400', '#8a7364', GOWUN), { marginBottom: 14 }]}>
            {t('ui.board.postedOn', { v0: notice.time })}
          </Text>
        )}
        <Text style={[body, { marginBottom: 14 }]}>{notice.body}</Text>
        {formError}
        {owner && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 14 }}>
            <PaperAction
              testID="board-notice-edit"
              label={t('magazine.editor.editOk')}
              onPress={nav.editNotice}
            />
            <Link
              testID="board-notice-delete"
              label={t('ui.social.delete')}
              danger
              onPress={() => nav.askDelete('notice')}
            />
          </View>
        )}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginTop: 8,
            marginBottom: 12,
          }}
        >
          <Text style={boardFont(15, 1.4, '700')}>
            {t('ui.remaining.copy0')}{' '}
            <Text style={{ marginLeft: 4, color: '#99644f' }}>{notice.comments.length}</Text>
          </Text>
          {!visitor &&
            (s.view === 'comment' ? (
              <PaperAction
                testID="board-comment-cancel"
                label={t('common.cancel')}
                onPress={nav.cancelComment}
              />
            ) : (
              <PaperAction
                testID="board-comment-new"
                label={t('ui.board.writeComment')}
                onPress={nav.openComment}
              />
            ))}
        </View>
        {/* 방문자는 댓글 입력칸 자리에 주민 안내만 둔다 */}
        {visitor && (
          <View
            testID="board-comment-visitor"
            style={{
              marginBottom: 14,
              paddingVertical: 12,
              paddingHorizontal: 14,
              borderWidth: 1,
              borderColor: '#b49472',
              borderStyle: 'dashed',
              borderRadius: 8,
              backgroundColor: '#fffaf0',
            }}
          >
            <Text style={muted({ textAlign: 'center' })}>{t('ui.board.joinToComment')}</Text>
          </View>
        )}
        <View>
          {comments.length ? (
            comments.map(([{ id, name, text, mine }, commentIndex]) => (
              <View
                key={id}
                style={{
                  flexDirection: 'row',
                  gap: 8,
                  paddingVertical: 10,
                  borderTopWidth: 1,
                  borderColor: '#d7bea0',
                }}
              >
                <Text style={[boardFont(13, 1.5, '700', '#815742'), { width: 38 }]}>{name}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={[
                      boardFont(14, 1.5),
                      webOnly({ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }),
                    ]}
                  >
                    {text}
                  </Text>
                  {!visitor && (owner || mine) && (
                    <View style={{ flexDirection: 'row', marginTop: 5 }}>
                      <Link
                        testID={`board-comment-delete-${commentIndex}`}
                        label={t('ui.social.delete')}
                        danger
                        size={12}
                        onPress={() => nav.askDelete('comment', commentIndex)}
                      />
                    </View>
                  )}
                </View>
              </View>
            ))
          ) : (
            <Text style={muted({ marginTop: 4, marginBottom: 14 })}>
              {visitor ? t('ui.board.noComments') : t('ui.board.firstComment')}
            </Text>
          )}
          {serverBoard && board.detail?.nextCommentsCursor !== null && board.detail && (
            <PaperAction
              testID="board-comments-more"
              label={
                board.loadingMoreComments
                  ? t('account.blocked.loading')
                  : t('visitorBoard.moreComments')
              }
              onPress={() => board.loadMoreComments()}
            />
          )}
        </View>
      </View>
    );
  };

  const noticeEditor = () => {
    if (!owner) return noticeList();
    const draft = s.draft ?? { title: '', body: '' };
    const setDraft = nav.setDraft;
    // 쓰기 종이(noticeCompose)는 스크롤 없이 본문 칸이 남은 높이를 다 채운다 — 긴 글은 칸 안에서 스크롤돼
    // 제목·마지막 줄·게시하기가 키보드 위에 같이 남는다. 너무 낮으면 예전처럼 종이 안 스크롤에 106 칸이다.
    const grow = noticeCompose && { flex: 1, minHeight: 0 };
    return (
      <View style={grow}>
        {detailHead(
          <NavBtn
            testID="board-notice-cancel"
            close
            boardPaper
            label={s.editing ? t('ui.board.closeEditNotice') : t('ui.board.closeNewNotice')}
            onPress={nav.cancelEditor}
          />,
          t('ui.board.noticeAction', {
            v0: s.editing ? t('magazine.editor.editOk') : t('ui.board.write'),
          }),
        )}
        <View style={[{ gap: 12 }, grow]}>
          <BoardField label={t('ui.board.title')}>
            <TextInput
              testID="board-notice-title"
              accessibilityLabel={t('ui.board.noticeTitle')}
              value={draft.title}
              onChangeText={(title) => setDraft({ title })}
              placeholder={t('ui.board.noticeTitlePlaceholder')}
              placeholderTextColor="#757575"
              style={inputStyle()}
            />
          </BoardField>
          <BoardField label={t('ui.board.body')} style={grow}>
            <TextInput
              testID="board-notice-body"
              accessibilityLabel={t('ui.board.noticeBody')}
              multiline
              textAlignVertical="top"
              value={draft.body}
              onChangeText={(text) => setDraft({ body: text })}
              placeholder={t('ui.board.noticeBodyPlaceholder')}
              placeholderTextColor="#757575"
              style={[inputStyle(), noticeCompose ? { flex: 1 } : { height: 106 }]}
            />
          </BoardField>
          {formError}
          <PaperStamp
            testID="board-notice-submit"
            label={s.editing ? t('ui.board.saveChanges') : t('ui.board.publish')}
            onPress={nav.publish}
          />
        </View>
      </View>
    );
  };

  const noticeContent = () => {
    switch (s.view) {
      case 'detail':
        return noticeDetail();
      case 'write':
      case 'edit':
        return noticeEditor();
      case 'confirm':
        return (
          <View>
            <Text style={[h4, { marginTop: 4, marginRight: 34, marginBottom: 12 }]}>
              {t('ui.board.confirmDelete', {
                v0:
                  s.deleteTarget === 'notice'
                    ? t('ui.board.noticeObject')
                    : t('ui.board.commentObject'),
              })}
            </Text>
            <Text style={[boardFont(14, 1.6), { marginTop: 2, marginBottom: 18 }]}>
              {t('ui.board.cannotUndo')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <BoardPill
                testID="board-delete-cancel"
                label={t('common.cancel')}
                style={{ flex: 1 }}
                onPress={nav.cancelDelete}
              />
              <BoardPill
                testID="board-delete-confirm"
                label={t('ui.social.delete')}
                primary
                style={{ flex: 1 }}
                onPress={nav.confirmDelete}
              />
            </View>
          </View>
        );
      default:
        return noticeList();
    }
  };

  // 서버가 내려주는 수령 불가 사유 — 값을 만들지 않고 알려진 코드만 번역한다.
  const questBlockedText = (reason: string | null | undefined) =>
    reason === 'NOT_ACHIEVED'
      ? t('ui.board.reachGoalToClaim')
      : reason === 'MEASUREMENT_PENDING'
        ? t('ui.board.waitForMeasurement')
        : reason
          ? t('ui.board.rewardUnavailable')
          : '';

  const questFormValue = (): QuestForm =>
    s.questForm ?? {
      type: 'focus',
      title: '',
      startTime: '19:00',
      endTime: '22:00',
      target: '50',
    };
  const questSave = (form: QuestForm) => (
    <BoardPill
      testID="board-quest-save"
      label={s.editing ? t('ui.board.saveChanges') : t('ui.board.startQuest')}
      primary
      onPress={() => nav.submitQuest(form)}
    />
  );

  const questContent = (listOnly = false) => {
    if (!listOnly && s.view === 'detail') {
      const quest = quests[s.questIndex] ?? quests[0];
      if (!quest) return questContent(true);
      // 서버 경로의 상세 본문은 progress GET 이 정본이다 — 목록 항목엔 주민 목록이 없다.
      const progress = serverBoard
        ? board.questDetail?.occurrenceId === quest.id
          ? board.questDetail
          : null
        : null;
      return (
        <>
          {detailHead(
            <NavBtn
              testID="board-quest-close"
              close
              boardPaper
              label={t('ui.board.closeQuest')}
              onPress={nav.backToQuests}
            />,
          )}
          <Text style={[h4, { marginTop: 4, marginRight: 34, marginBottom: 4 }]}>
            {progress?.title ?? quest.title}
          </Text>
          <Text style={[boardFont(13, 1.55, '400', '#786151', GOWUN), { marginBottom: 12 }]}>
            {quest.type === 'phone'
              ? t('ui.board.phoneLimit', { v0: quest.target })
              : quest.startTime
                ? t('ui.board.focusWindow', {
                    v0: quest.startTime,
                    v1: quest.endTime ?? '—',
                    v2: quest.target,
                  })
                : t('ui.board.focusGoal', { v0: quest.target })}
          </Text>
          {owner && (
            <View style={{ flexDirection: 'row', marginTop: -6, marginBottom: 4 }}>
              <PaperAction
                testID="board-quest-edit"
                label={t('magazine.editor.editOk')}
                onPress={() => nav.editQuest(quest)}
              />
            </View>
          )}
          {serverBoard && board.questDetailError ? (
            <View>
              <Text style={muted({ marginTop: 4, marginBottom: 8 })}>
                {apiMessage(board.questDetailError, t('ui.board.loadFailed'))}
              </Text>
              <PaperAction
                testID="board-quest-detail-retry"
                label={t('common.retry')}
                onPress={() => board.selectQuest(quest.id).catch(() => {})}
              />
            </View>
          ) : serverBoard && !progress ? (
            <Text style={muted({ marginTop: 4, marginBottom: 14 })}>
              {t('account.blocked.loading')}
            </Text>
          ) : (
            <>
              <Text style={[boardFont(13, 1.65, '400', '#786151'), { marginBottom: 4 }]}>
                {t('ui.board.residentProgress')}
              </Text>
              <View>
                {residentsOf(quest).map(({ id, name, color, outfit, rate, achieved, claimed }) => {
                  const unknown = rate == null;
                  return (
                    <View
                      key={id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 9,
                        minHeight: 62,
                        paddingVertical: 9,
                        paddingHorizontal: 2,
                        borderBottomWidth: 1,
                        borderColor: '#b9965866',
                        borderStyle: 'dashed',
                      }}
                    >
                      <View accessible accessibilityLabel={t('ui.board.catProfile', { v0: name })}>
                        <CatAvatar
                          userId={id}
                          color={color}
                          outfit={color ? outfit : undefined}
                          size={42}
                        />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={boardFont(14, 1.6, '700')}>
                          {name}
                          {claimed
                            ? t('ui.board.claimedSuffix')
                            : achieved
                              ? t('ui.board.achievedSuffix')
                              : ''}
                        </Text>
                        {!unknown && <Track rate={rate} color="#91b67e" style={{ marginTop: 7 }} />}
                      </View>
                      <Text style={[boardFont(14, 1.6, '700'), { width: unknown ? 52 : 42 }]}>
                        {unknown ? t('focusFlow.result.notMeasuredYet') : `${rate}%`}
                      </Text>
                    </View>
                  );
                })}
              </View>
              {/* 개인 몫 수령은 받기 버튼으로만 — 전원 보너스는 서버가 자동 적립한 값을 보여 준다 */}
              {serverBoard && (
                <View style={{ marginTop: 12, gap: 6 }}>
                  {quest.claimed ? (
                    <Text style={muted({})}>{t('ui.board.alreadyClaimed')}</Text>
                  ) : quest.claimable ? (
                    <BoardPill
                      testID="board-quest-claim"
                      label={t('ui.board.claimWithAmount', {
                        v0:
                          quest.rewardAmount != null
                            ? t('ui.board.fishSuffix', { v0: quest.rewardAmount })
                            : '',
                      })}
                      primary
                      onPress={() => nav.claimQuest(quest)}
                    />
                  ) : quest.claimBlockedReason ? (
                    <Text style={muted({})}>{questBlockedText(quest.claimBlockedReason)}</Text>
                  ) : null}
                  {quest.bonusGranted && !!quest.bonusAmount && (
                    <Text style={muted({})}>
                      {t('ui.board.teamBonusAdded', { v0: quest.bonusAmount })}
                    </Text>
                  )}
                  {formError}
                </View>
              )}
            </>
          )}
        </>
      );
    }
    if (!listOnly && s.view === 'write') {
      const form = questFormValue();
      const setForm = (patch: Partial<QuestForm>) => nav.setQuestForm(form, patch);
      // 서버 PATCH 는 title/targetMinutes 만 받는다 — 수정할 때 종류·창은 읽기 전용으로 보여 준다.
      const serverEdit = serverBoard && s.editing;
      return (
        <>
          <Text style={[h4, { marginTop: 4, marginRight: 34, marginBottom: 12 }]}>
            {s.editing ? t('ui.board.editQuest') : t('ui.board.createQuest')}
          </Text>
          <View style={{ gap: 12 }}>
            <BoardField label={t('ui.board.questType')}>
              {serverEdit ? (
                <Text style={[inputStyle(), { paddingTop: 13 }]}>
                  {form.type === 'phone'
                    ? t('ui.board.dailyPhoneUse')
                    : t('ui.board.scheduledFocus')}
                </Text>
              ) : (
                <QuestTypeChoice value={form.type} onChange={(type) => setForm({ type })} />
              )}
            </BoardField>
            <BoardField label={t('ui.board.questTitle')}>
              <TextInput
                testID="board-quest-title"
                accessibilityLabel={t('ui.board.questTitle')}
                value={form.title}
                onChangeText={(title) => setForm({ title })}
                placeholder={
                  form.type === 'focus' ? t('ui.board.focusExample') : t('ui.board.phoneExample')
                }
                placeholderTextColor="#757575"
                style={inputStyle()}
              />
            </BoardField>
            {form.type === 'focus' && serverEdit ? (
              <BoardField label={t('ui.board.schedule')}>
                <Text style={[inputStyle(), { paddingTop: 13 }]}>
                  {form.startTime}–{form.endTime}
                </Text>
              </BoardField>
            ) : (
              form.type === 'focus' && (
                <BoardField label={t('ui.board.schedule')}>
                  {/* 좁은 화면(320pt 이하)에서도 각 휠의 터치 폭 44pt 를 지키려고 시작·종료를 세로로
                      쌓는다 — 한 줄에 휠 두 개만 두면 종이 폭을 반씩 나눠 넉넉하다(AGENTS 44pt). */}
                  <View style={{ gap: semanticTokens.spacing.control }}>
                    <View style={{ gap: 4 }}>
                      <Text style={boardFont(12, 1.4, '400', '#786151', GOWUN)}>
                        {t('ui.board.start')}
                      </Text>
                      <QuestTimeInput
                        testID="board-quest-start"
                        label={t('ui.board.startTime')}
                        value={form.startTime}
                        onChange={(startTime) => setForm({ startTime })}
                      />
                    </View>
                    <View style={{ gap: 4 }}>
                      <Text style={boardFont(12, 1.4, '400', '#786151', GOWUN)}>
                        {t('ui.board.end')}
                      </Text>
                      {/* 종료는 23:59 까지만 고른다(GROMO-2886) — 24:00 KST 는 15:00 UTC 로 가는데
                          운영 DB 가 창을 KST 로 밀어 저장해 00:00 이 되고 window_start < window_end CHECK 에
                          걸려 생성이 실패한다. 폰 사용 상한 피커(하루 1440분)의 24 는 길이라 그대로 둔다. */}
                      <QuestTimeInput
                        testID="board-quest-end"
                        label={t('ui.board.endTime')}
                        value={form.endTime}
                        onChange={(endTime) => setForm({ endTime })}
                      />
                    </View>
                  </View>
                  {/* UTC 자정을 가로지르는 창은 서버가 거절한다(결정 Q-6) — 입력칸 바로 아래에 이유를 보인다. */}
                  {kstWindowCrossesUtcMidnight(form.startTime, form.endTime) && (
                    <Text
                      testID="board-quest-window-error"
                      style={boardFont(13, 1.45, '400', semanticTokens.color.danger)}
                    >
                      {t('board.quest.crossMidnight')}
                    </Text>
                  )}
                </BoardField>
              )
            )}
            {serverEdit && (
              <Text style={muted({ marginTop: -2 })}>{t('ui.board.scheduleLocked')}</Text>
            )}
            <BoardField
              label={form.type === 'focus' ? t('ui.board.focusTarget') : t('ui.board.phoneTarget')}
            >
              <QuestTargetInput
                testID="board-quest-target"
                label={
                  form.type === 'focus' ? t('ui.board.focusTarget') : t('ui.board.phoneTarget')
                }
                value={form.target}
                onChange={(target) => setForm({ target })}
              />
            </BoardField>
            {!questCompose && formError}
            <Text
              style={[
                muted({ marginTop: 4, marginBottom: 14 }),
                webOnly({ wordBreak: 'keep-all' }),
              ]}
            >
              {form.type === 'focus' ? t('ui.board.focusHint') : t('ui.board.phoneHint')}
            </Text>
            {!questCompose && questSave(form)}
          </View>
        </>
      );
    }
    return (
      <>
        <View style={{ marginBottom: 4 }}>
          <Text style={[boardFont(14, 1.2, '400', '#98713d'), { marginBottom: 1 }]}>
            {t('ui.board.newDailyChallenge')}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Text style={boardFont(27, 1.15, '700', INK)}>
              {t('ui.shop.quest')}{' '}
              <Text style={{ fontSize: 16, lineHeight: lh(16 * 1.15), color: '#92713f' }}>
                {quests.length}
              </Text>
            </Text>
            {owner && (
              <Btn small id="board-quest-new" title={t('ui.board.create')} onPress={nav.newQuest} />
            )}
          </View>
        </View>
        <View
          key={e ? routeKey : s.serial}
          style={[{ paddingHorizontal: 2 }, webOnly({ perspective: 700 })]}
        >
          {serverBoard && board.loading ? (
            <Text style={muted({ marginTop: 4, marginBottom: 14 })}>
              {t('account.blocked.loading')}
            </Text>
          ) : serverBoard && board.error ? (
            <View>
              <Text style={muted({ marginTop: 4, marginBottom: 8 })}>
                {apiMessage(board.error, t('ui.board.loadFailed'))}
              </Text>
              <PaperAction
                testID="board-quests-retry"
                label={t('common.retry')}
                onPress={() => board.retry().catch(() => {})}
              />
            </View>
          ) : quests.length ? (
            quests.map((quest, i) => (
              <QuestCard
                key={quest.id}
                quest={quest}
                index={i}
                reduceMotion={reduceMotion}
                onDetail={() => nav.openQuest(i)}
                visitor={visitor}
              />
            ))
          ) : (
            <View style={{ paddingVertical: 28, alignItems: 'center' }}>
              <Text style={[h4, { marginBottom: 7, textAlign: 'center' }]}>
                {t('ui.board.noQuests')}
              </Text>
              <Text style={muted({ textAlign: 'center' })}>{t('ui.board.questHint')}</Text>
            </View>
          )}
        </View>
      </>
    );
  };

  const blueprint = () => {
    const bp = blueprintView;
    if (serverBoard && construction.status !== 'ready')
      return (
        <View style={{ paddingTop: 32, gap: semanticTokens.spacing.control }}>
          <Text testID="board-construction-status" style={boardFont(14, 1.6, '700', '#f7fcff')}>
            {construction.status === 'error' ? t('ui.board.goalFailed') : t('ui.board.goalLoading')}
          </Text>
          {construction.status === 'error' && (
            <BoardPill
              testID="board-construction-retry"
              label={t('common.retry')}
              onPress={() => void construction.retry().catch(() => undefined)}
            />
          )}
        </View>
      );
    if (allBuildingsComplete || bp.state === 'none')
      return (
        <Text
          style={[boardFont(14, 1.6, '700', '#f7fcff'), { paddingTop: 32, textAlign: 'center' }]}
        >
          {allBuildingsComplete ? t('ui.board.allComplete') : t('ui.board.chooseNext')}
        </Text>
      );
    return (
      <View
        style={[
          constructionPlanStyles.content,
          { paddingTop: componentTokens.constructionPlan.closeSpace },
        ]}
      >
        <ConstructionPlanPreview
          testID="board-blueprint-grid"
          name={bp.name}
          image={bp.image}
          description={bp.detail}
        />
        {bp.state === 'building' ? (
          <View style={{ gap: semanticTokens.spacing.control }}>
            <Text style={constructionPlanStyles.notice}>
              {t('ui.board.buildingInProgress', { v0: josa(bp.name, '을', '를') })}
            </Text>
            {(!serverBoard || hasConstructionTiming) && (
              <Track rate={bp.progress} color={semanticTokens.color.primary} />
            )}
          </View>
        ) : bp.state === 'complete' ? (
          <Text style={constructionPlanStyles.notice}>
            {t('ui.board.buildingCompleted', { v0: josa(bp.name, '이', '가') })}
          </Text>
        ) : (
          <ConstructionWalletSummary
            testID="board-wallet-summary"
            balance={bp.balance}
            cost={bp.cost}
            progress
          />
        )}
        {serverBoard && !!s.error && (
          <Text accessibilityRole="alert" style={constructionPlanStyles.notice}>
            {s.error}
          </Text>
        )}
      </View>
    );
  };
  const blueprintFooter = () => {
    const bp = blueprintView;
    if (
      (serverBoard && construction.status !== 'ready') ||
      allBuildingsComplete ||
      bp.state === 'none' ||
      bp.state === 'building'
    )
      return null;
    return (
      <View
        style={{
          paddingTop: semanticTokens.spacing.component,
          gap: semanticTokens.spacing.control,
        }}
      >
        {bp.state === 'complete' ? (
          <Btn
            id="board-open-library"
            title={t('ui.board.goToBuilding', { v0: josa(bp.name, '으로', '로') })}
            font={GOWUN}
            dynamicHeight
            onPress={nav.openBuilding}
          />
        ) : owner ? (
          <>
            <Btn
              id="board-build-start"
              title={t('home.buildAction')}
              font={GOWUN}
              dynamicHeight
              disabled={bp.state !== 'ready'}
              onPress={nav.build}
            />
            {selectedOption?.blockedReason === 'FACILITY_LOCKED' && (
              <Text style={constructionPlanStyles.notice}>
                {t('ui.board.finishRequiredFacilities')}
              </Text>
            )}
          </>
        ) : (
          <Text style={constructionPlanStyles.notice}>{t('constructionPlan.ownerOnly')}</Text>
        )}
      </View>
    );
  };

  // 배경과 라벨·터치 영역이 원본 2:3 좌표계에서 함께 스케일되도록 높이 기준으로 맞춘다.
  const land = width / sceneHeight > artSize.background[0] / artSize.background[1];
  const scene = boardScene(width, land ? height : sceneHeight);
  const initialSceneOffset = land ? Math.max(0, scene.height - sceneHeight) * 0.38 : 0;
  const sceneScrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (land) sceneScrollRef.current?.scrollTo({ x: 0, y: initialSceneOffset, animated: false });
  }, [land, initialSceneOffset]);
  const labelScale = Math.min(1, scene.width / 402);
  const fontScale = Math.max(1, PixelRatio.getFontScale());
  const sceneHitbox = (
    centerX: number,
    centerY: number,
    widthRatio: number,
    heightRatio: number,
    maxHeight = Number.POSITIVE_INFINITY,
  ) => {
    const hitWidth = Math.max(scene.width * widthRatio, 44);
    const hitHeight = Math.min(Math.max(scene.height * heightRatio, 44), maxHeight);
    return {
      left: scene.width * centerX - hitWidth / 2,
      top: scene.height * centerY - hitHeight / 2,
      width: hitWidth,
      height: hitHeight,
    };
  };
  const questHitHeight = Math.max(scene.height * 0.09, 44);
  const accessibleQuestHeight = (22 * 1.1 * fontScale + 20 + 3 + 6) * labelScale;
  const questLabelHitHeight = Math.max(questHitHeight, accessibleQuestHeight);
  const noticeCenterY = 0.348;
  const noticeHitWidth = Math.max(scene.width * 0.253, 44);
  const noticeBaseHitHeight = Math.max(scene.height * 0.226, 44);
  const accessibleNoticeHeight =
    (28 * 1.1 * fontScale + 9 + 24) * labelScale +
    Math.max(0, noticeHitWidth - 24 * labelScale) * 0.7;
  const noticeHitHeight = Math.max(noticeBaseHitHeight, accessibleNoticeHeight);
  const questCenterY =
    noticeHitHeight > noticeBaseHitHeight
      ? Math.max(
          (questLabelHitHeight / 2 + 1) / scene.height,
          Math.min(
            0.285,
            noticeCenterY - (noticeHitHeight / 2 + questLabelHitHeight / 2 + 1) / scene.height,
          ),
        )
      : 0.285;
  const blueprintCenterY = Math.max(
    0.406,
    questCenterY + (questLabelHitHeight / 2 + 44 / 2 + 1) / scene.height,
  );
  const blueprintHitHeight = Math.min(
    Math.max(scene.height * 0.128, 44),
    // Keep a one-pixel gap below the quest target, including large accessibility text.
    Math.max(
      44,
      2 * (scene.height * (blueprintCenterY - questCenterY) - questLabelHitHeight / 2 - 1),
    ),
  );
  const noticeBox = sceneHitbox(0.3495, noticeCenterY, 0.253, noticeHitHeight / scene.height);
  const questBox = sceneHitbox(0.645, questCenterY, 0.27, questLabelHitHeight / scene.height);
  const blueprintArtBox = sceneHitbox(0.705, blueprintCenterY, 0.19, 0.128, blueprintHitHeight);
  const blueprintLabel = t('ui.hall.constructionStatus');
  const blueprintLeftLimit = Math.max(0, -scene.left, noticeBox.left + noticeBox.width + 1);
  const blueprintRightLimit = Math.min(scene.width, width - scene.left);
  const blueprintLabelSize = sceneObjectLabelSize(
    blueprintLabel,
    labelScale,
    fontScale,
    Math.max(semanticTokens.size.tapMin, blueprintRightLimit - blueprintLeftLimit),
  );
  const blueprintLabelHeight = Math.max(semanticTokens.size.tapMin, blueprintLabelSize.height);
  const blueprintWidth = Math.max(blueprintArtBox.width, blueprintLabelSize.width);
  // 청사진 아랫변에 이름표를 붙이고 누르는 영역도 함께 늘린다. 화면 밖으로 잘리는 번역은 안쪽으로 옮긴다.
  const blueprintBox = {
    ...blueprintArtBox,
    left: Math.max(
      blueprintLeftLimit,
      Math.min(scene.width * 0.705 - blueprintWidth / 2, blueprintRightLimit - blueprintWidth),
    ),
    width: blueprintWidth,
    height: blueprintArtBox.height + primitiveTokens.space[1] + blueprintLabelHeight / 2,
  };
  // 방명록 = 선반 위 펜꽂이(그림 비율 1024×1536 기준 중심 0.54, 0.535). 알약 라벨이 큰 글자에서도 한 줄로 들어가도록
  // 터치 영역을 글자 수·글자 배율로 키운다(글자 한 칸을 1em 으로 넉넉히 잡아 어떤 글꼴에서도 줄바꿈이 없다).
  const { height: guestbookPillHeight, width: guestbookPillWidth } = sceneObjectLabelSize(
    t('guestbook.title'),
    labelScale,
    fontScale,
    Number.POSITIVE_INFINITY,
  );
  const guestbookBase = sceneHitbox(
    0.54,
    0.535,
    Math.min(1, Math.max(0.2, guestbookPillWidth / scene.width)),
    Math.max(0.07, guestbookPillHeight / scene.height),
  );
  const boardHitboxes = {
    notice: noticeBox,
    quest: questBox,
    blueprint: blueprintBox,
    // 위쪽 공지·청사진 터치 영역은 큰 글자에서 커진다 — 방명록은 그 1px 아래로 밀어 서로 겹치지 않게 하고(위 영역의
    // 터치를 가로채지 않게), 넓어진 영역이 장면 밖으로 나가지 않게 가로·세로를 장면 안으로 맞춘다.
    // 퀘스트 상자는 직접 비교하지 않는다 — 청사진 상자가 그 아래에 있어 청사진 아래면 퀘스트 아래이기도 하다.
    // 아주 작은 창에서 눌려 남는 겹침은 zIndex(1 < 공지·청사진 2)로 위 영역이 이긴다.
    guestbook: {
      ...guestbookBase,
      left: Math.min(Math.max(0, guestbookBase.left), scene.width - guestbookBase.width),
      top: Math.min(
        Math.max(
          guestbookBase.top,
          noticeBox.top + noticeBox.height + 1,
          blueprintBox.top + blueprintBox.height + 1,
        ),
        scene.height - guestbookBase.height,
      ),
    },
  };
  // 상세 패널은 원본 874px 가로 시안의 화면 폭 비율을 유지한다.
  const landScale = land ? width / 874 : 1;
  const landDrawer = { left: LAND.drawer.left * landScale, right: LAND.drawer.right * landScale };
  const landBlueprint = {
    left: LAND.blueprint.left * landScale,
    right: LAND.blueprint.right * landScale,
  };
  const landOverlay = {
    left: LAND.overlay.left * landScale,
    right: LAND.overlay.right * landScale,
    top: LAND.overlay.top * landScale,
    maxHeight: LAND.overlay.maxHeight,
  };
  const pressedFilter = (panel: BoardState['panel']) =>
    s.panel === panel && webOnly({ filter: 'brightness(1.08)' });
  const paperPanel = s.panel === 'notice' || s.panel === 'quest' || s.panel === 'guestbook';
  const noticeDetailOpen = s.panel === 'notice' && (s.view === 'detail' || s.view === 'comment');
  const noticeEditorOpen = s.panel === 'notice' && (s.view === 'write' || s.view === 'edit');
  const noticeOverlayOpen = noticeDetailOpen || noticeEditorOpen;
  const dismissNoticeOverlay = () =>
    e ? e.back() : render({ view: noticeEditorOpen && s.editing ? 'detail' : 'list', error: '' });
  const questDetailOpen = s.panel === 'quest' && s.view === 'detail';
  const questEditorOpen = s.panel === 'quest' && s.view === 'write';
  const dismissQuestDetail = () => (e ? e.back() : render({ view: 'list', error: '' }));
  const paperSource =
    s.panel === 'quest' ? interiorArt.boardPaper.quest : interiorArt.boardPaper.notice;
  const blueprintPanelContentHeight = ['waiting', 'ready'].includes(blueprintView.state)
    ? componentTokens.constructionPlan.maxHeight
    : { complete: 380, building: 326, none: 236 }[
        blueprintView.state as 'complete' | 'building' | 'none'
      ];
  const blueprintPanelHeight = Math.min(height - 48, blueprintPanelContentHeight);
  // 청사진 대신 안내 한 줄(불러오는 중·실패·목표 없음·전체 완공)만 있으면 상자를 내용 높이로 줄인다(GROMO-2412)
  const blueprintMessageOnly =
    (serverBoard && construction.status !== 'ready') ||
    allBuildingsComplete ||
    blueprintView.state === 'none';
  const panelNavigationOpen = paperPanel && !noticeOverlayOpen && !questDetailOpen;
  const panelNavigationHeight = panelNavigationOpen ? 52 : 0;
  // 쓰기 종이(공지 작성·수정·댓글, 퀘스트 작성) — 키보드가 올라와 줄어든 높이(height)를 종이가 다 쓰고 올리기
  // 버튼은 스크롤 밖 아래에 고정해, 쓰는 칸·쓴 글·버튼이 키보드 위에 같이 보이게 한다. 위로는 장면의 뒤로 ×·간판
  // 아래(COMPOSE_TOP)까지만 올리고, 키보드가 없을 때는 창 높이(sceneHeight) 기준 예전 크기를 넘지 않는다.
  const composeMinTop = land ? landOverlay.top : COMPOSE_TOP;
  // 종이 목록 높이. 키보드가 떠서 스크롤 칸이 너무 낮아지면 위쪽에 붙이고 화면 높이를 다 쓴다.
  // 방명록은 목록뿐 아니라 제목+입력 칸+글자 수+[남기기](약 203px)가 한 번에 보여야 해서 바닥을 더 높게 둔다
  const sheetHeight = questEditorOpen
    ? Math.max(0, Math.min(height - composeMinTop - 10, sceneHeight * 0.58, 492 * landScale))
    : Math.min(height * 0.58, 492 * landScale);
  const minPaperScroll = s.panel === 'guestbook' ? 210 : 140;
  const sheetCramped = sheetHeight - 110 * landScale - panelNavigationHeight < minPaperScroll;
  // 퀘스트 쓰기 종이 — 너무 낮으면(가로 폰 키보드) 예전처럼 저장 버튼까지 종이 안에서 스크롤한다
  const questCompose = questEditorOpen && !sheetCramped;
  const paperHeight = sheetCramped ? Math.max(0, height - 8) : sheetHeight;
  const paperPad =
    sheetCramped || questCompose
      ? { top: 38 * landScale, bottom: 28 * landScale }
      : { top: 68 * landScale, bottom: 42 * landScale };
  const paperScroll = Math.max(
    0,
    paperHeight - paperPad.top - paperPad.bottom - panelNavigationHeight,
  );
  // 상세 종이 안쪽 스크롤은 바깥 여백 88px(반응형 배율 적용)을 뺀 높이까지만 쓴다
  const overlayFrame = height * (land ? 0.65 : 0.58);
  const overlayVerticalPadding = 88 * landScale;
  const overlayCramped = overlayFrame - overlayVerticalPadding < 140;
  const overlayScroll = overlayCramped
    ? Math.max(0, height - 8 - overlayVerticalPadding)
    : Math.min(height * 0.49, overlayFrame - overlayVerticalPadding);
  // 공지 쓰기 종이 — 키보드가 없으면 예전 자리(세로 20%)·크기(창의 58%)이고, 키보드가 올라오면 COMPOSE_TOP 까지
  // 올라가 남은 높이를 다 쓴다. 세로에서는 폭도 넓혀 큰 글자에서 입력칸 안내 글이 잘리지 않게 하되, 오른쪽 아래
  // 접힌 귀퉁이(종이 그림 폭의 82% 지점부터)에 게시하기·등록이 얹히지 않게 화면 폭의 13% 를 안쪽 여백으로 둔다
  // (폭 440 까지 귀퉁이를 비킨다).
  const composeFrame = Math.max(
    0,
    Math.min(height - composeMinTop - 4, sceneHeight * (land ? 0.65 : 0.58)),
  );
  const composePad = { top: 32 * landScale, bottom: 28 * landScale };
  // 댓글은 공지 본문을 실제로 그릴 때만(불러오는 중·실패 화면엔 입력칸이 없다)
  const commentOpen =
    s.view === 'comment' &&
    noticeDetailOpen &&
    !(serverBoard && board.detailError) &&
    !!(serverBoard ? serverDetailView : notices[s.noticeIndex]);
  // 머리·제목 칸·본문 한 줄·게시하기(글자 배율 반영)가 다 들어갈 때만 쓰기 종이로 — 아니면(가로 폰 키보드)
  // 예전처럼 종이 안 전체를 스크롤한다
  const noticeCompose =
    ((noticeEditorOpen && owner) || commentOpen) &&
    composeFrame - composePad.top - composePad.bottom >= 206 + 66 * fontScale;
  const noticeComposeStyle = noticeCompose && {
    ...(!land && { left: 12, right: 12, paddingHorizontal: Math.round(width * 0.13) }),
    top: Math.max(
      composeMinTop,
      Math.min(land ? landOverlay.top : height * 0.2, height - 4 - composeFrame),
    ),
    height: composeFrame,
    maxHeight: composeFrame,
    paddingTop: composePad.top,
    paddingBottom: composePad.bottom,
  };
  // 세로 화면의 안내 한 줄 상자는 「건설 현황」과 그 아래 「방명록」 이름표를 비켜 그 아래에 둔다 — 높이 한도(236)
  // 기준 가운데 자리에서는 내용만큼 줄어든 상자가 이름표를 덮었다(GROMO-2888). 방명록 영역은 늘 청사진 영역 아래다.
  // 가로는 장면이 스크롤되어 예전처럼 가운데
  const blueprintPanelTop =
    blueprintMessageOnly && !land
      ? Math.max(
          24,
          Math.min(
            boardHitboxes.guestbook.top + boardHitboxes.guestbook.height + primitiveTokens.space[2],
            height - 24 - blueprintPanelHeight,
          ),
        )
      : Math.max(24, (height - blueprintPanelHeight) / 2);
  const boardOverlayOpen = noticeOverlayOpen || questDetailOpen;

  useEffect(() => {
    onBoardModalChange?.(boardOverlayOpen);
  }, [boardOverlayOpen, onBoardModalChange]);

  useEffect(() => () => onBoardModalChange?.(false), [onBoardModalChange]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const backgrounds = [boardSceneRef.current, boardDrawerRef.current];
    const overlay = noticeOverlayOpen ? noticeOverlayRef.current : questOverlayRef.current;
    const isTopmost = boardOverlayOpen && !higherModalOpen;
    overlayOpenerRef.current = syncBoardModalFocus(
      boardOverlayOpen,
      overlayWasOpen.current,
      isTopmost,
      overlayWasTopmost.current,
      overlay,
      document,
      backgrounds,
      overlayOpenerRef.current,
    );
    overlayWasOpen.current = boardOverlayOpen;
    overlayWasTopmost.current = isTopmost;
  }, [boardOverlayOpen, higherModalOpen, noticeOverlayOpen]);

  useEffect(() => {
    if (
      Platform.OS !== 'web' ||
      !boardOverlayOpen ||
      higherModalOpen ||
      typeof document === 'undefined'
    )
      return;
    const modalDocument = document;
    const onKeyDown = (event: KeyboardEvent) => {
      const overlay = noticeOverlayOpen ? noticeOverlayRef.current : questOverlayRef.current;
      if (!overlay) return;
      handleBoardModalKeydown(event, overlay, modalDocument, () => {
        if (noticeOverlayOpen) dismissNoticeOverlay();
        else dismissQuestDetail();
      });
    };
    modalDocument.addEventListener('keydown', onKeyDown);
    return () => modalDocument.removeEventListener('keydown', onKeyDown);
  }, [
    boardOverlayOpen,
    higherModalOpen,
    noticeOverlayOpen,
    dismissNoticeOverlay,
    dismissQuestDetail,
  ]);

  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
      <ScrollView
        ref={sceneScrollRef}
        testID="board-scene-scroll"
        horizontal={false}
        scrollEnabled={land && !s.panel}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        bounces={false}
        alwaysBounceVertical={false}
        alwaysBounceHorizontal={false}
        contentOffset={{ x: 0, y: initialSceneOffset }}
        style={[
          { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
          webOnly({ overscrollBehavior: 'none' }),
        ]}
        contentContainerStyle={{ width, height: land ? scene.height : height, overflow: 'hidden' }}
      >
        <View
          testID="board-scene"
          ref={boardSceneRef as any}
          {...(boardOverlayOpen ? webOnly({ 'aria-hidden': true } as any) : null)}
          style={{ position: 'relative', ...scene }}
        >
          <Image
            testID="board-scene-image"
            source={interiorArt.boardBackground}
            resizeMode="stretch"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: scene.width,
              height: scene.height,
              zIndex: 0,
            }}
          />
          <View
            testID="board-scene-gradient"
            pointerEvents="none"
            style={[
              { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 1 },
              gradient(
                'linear-gradient(180deg,#37271d12 0%,transparent 24%,transparent 70%,#37271d0c 100%)',
              ),
            ]}
          />
          {/* 세로에서는 공지 종이 질감을 덧입혀 목록 UI와 맞춘다 */}
          {!land && (
            <Picture
              source={interiorArt.boardPaper.notice}
              label=""
              style={{
                position: 'absolute',
                zIndex: 1,
                left: '19.7%',
                top: '20.5%',
                width: '30.5%',
                height: '27.5%',
              }}
            />
          )}
          <View testID="board-label-scene" style={[fill, { zIndex: 2 }]}>
            <Pressable
              testID="board-notice-area"
              accessibilityRole="button"
              accessibilityLabel={t('ui.board.notice')}
              onPress={() => nav.open('notice')}
              style={[
                {
                  position: 'absolute',
                  zIndex: 2,
                  ...boardHitboxes.notice,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 9 * labelScale,
                  padding: 12 * labelScale,
                },
                pressedFilter('notice'),
              ]}
            >
              <Text
                allowFontScaling
                style={[
                  boardFont(28 * labelScale, 1.1, '400', '#76503c'),
                  {
                    width: scene.width * 0.45,
                    letterSpacing: 0.56 * labelScale,
                    textAlign: 'center',
                  },
                ]}
              >
                {t('ui.board.notice')}
              </Text>
              <Handwriting scale={labelScale} />
            </Pressable>
            <Pressable
              testID="board-quest-area"
              accessibilityRole="button"
              accessibilityLabel={t('ui.board.expandQuests')}
              onPress={() => nav.open('quest')}
              style={[
                {
                  position: 'absolute',
                  ...boardHitboxes.quest,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3 * labelScale,
                  paddingTop: 4 * labelScale,
                  paddingHorizontal: 8 * labelScale,
                  paddingBottom: 2 * labelScale,
                },
                pressedFilter('quest'),
              ]}
            >
              <Text
                allowFontScaling
                style={[
                  boardFont(22 * labelScale, 1.1, '700', '#82652c'),
                  { width: scene.width * 0.52, textAlign: 'center' },
                ]}
              >
                {t('ui.shop.quest')}
              </Text>
              <Handwriting short scale={labelScale} />
            </Pressable>
            {/* 청사진은 주민만 연다. 선택한 건물 미리보기는 열린 청사진 안에서만 보여 준다. */}
            {!visitor && (
              <Pressable
                testID="board-blueprint-area"
                accessibilityRole="button"
                accessibilityLabel={
                  allBuildingsComplete
                    ? t('ui.board.allBuildingsStatus')
                    : t('ui.board.constructionStatus', {
                        v0: blueprintView.name || t('ui.board.nextBuilding'),
                      })
                }
                onPress={() => nav.open('blueprint')}
                style={[
                  {
                    position: 'absolute',
                    zIndex: 2,
                    ...boardHitboxes.blueprint,
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                  },
                  pressedFilter('blueprint'),
                ]}
              >
                <View
                  pointerEvents="none"
                  style={{
                    height: blueprintLabelHeight,
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  <SceneObjectLabel scale={labelScale} maxWidth={blueprintLabelSize.width}>
                    {blueprintLabel}
                  </SceneObjectLabel>
                </View>
              </Pressable>
            )}
            {/* 방명록은 선반 위 펜꽂이로 연다. 서버 게시판(주민)에서만 — 방문자는 VisitorBoard 에 방명록이 있다 */}
            {serverBoard && (
              <Pressable
                testID="board-guestbook-area"
                accessibilityRole="button"
                accessibilityLabel={t('guestbook.title')}
                onPress={() => nav.open('guestbook')}
                style={[
                  {
                    position: 'absolute',
                    // 공지·청사진(zIndex 2)보다 낮게 — 어떤 글자 배율에서 겹침이 남아도 그쪽 터치가 먼저다
                    zIndex: 1,
                    ...boardHitboxes.guestbook,
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                  },
                  pressedFilter('guestbook'),
                ]}
              >
                <SceneObjectLabel scale={labelScale}>{t('guestbook.title')}</SceneObjectLabel>
              </Pressable>
            )}
          </View>
        </View>
      </ScrollView>
      {s.panel === 'blueprint' && (
        <Pressable
          testID="board-blueprint-backdrop"
          accessibilityRole="button"
          accessibilityLabel={t('constructionPlan.close')}
          onPress={nav.closePanel}
          style={[fill, { zIndex: 3 }]}
        />
      )}
      <View
        testID="board-drawer"
        ref={boardDrawerRef as any}
        {...(boardOverlayOpen ? webOnly({ 'aria-hidden': true } as any) : null)}
        // 상세 종이가 떠 있어 감춘(opacity 0) 목록 종이는 누를 수도, 읽을 수도 없게 한다 — opacity 0 은 터치와
        // 안드로이드 TalkBack 을 막지 않는다(iOS 는 상세의 accessibilityViewIsModal, 웹은 aria-hidden·inert 가 막는다)
        pointerEvents={boardOverlayOpen ? 'none' : 'auto'}
        accessibilityElementsHidden={boardOverlayOpen}
        importantForAccessibility={boardOverlayOpen ? 'no-hide-descendants' : 'auto'}
        style={[
          {
            position: 'absolute',
            zIndex: 4,
            padding: 16,
            borderWidth: 2,
            borderColor: '#75533d',
            backgroundColor: '#fff2d8',
            boxShadow: '0 8px 18px #3b281b77',
            ...(s.panel === 'blueprint'
              ? {
                  ...(land ? landBlueprint : { left: 14, right: 14 }),
                  top: blueprintPanelTop,
                  ...(blueprintMessageOnly
                    ? { maxHeight: blueprintPanelHeight }
                    : { height: blueprintPanelHeight, maxHeight: blueprintPanelHeight }),
                  borderRadius: 18,
                }
              : {
                  ...(land ? landDrawer : { left: 0, right: 0 }),
                  ...(paperPanel && sheetCramped ? { top: 4 } : { bottom: 10 }),
                  maxHeight:
                    paperPanel && (sheetCramped || questCompose) ? paperHeight : height - 105,
                  borderTopLeftRadius: 18,
                  borderTopRightRadius: 18,
                }),
          },
          // 닫힘: 높이 50%(좁은 화면 74%)로 아래로 내려가 투명
          s.panel
            ? { transform: [{ translateY: 0 }] }
            : {
                height: width <= 290 ? '74%' : '50%',
                minHeight: 340,
                opacity: 0,
                transform: [{ translateY: '125%' }],
              },
          paperPanel && {
            height: paperHeight,
            minHeight: 0,
            paddingTop: paperPad.top,
            paddingHorizontal: 50 * landScale,
            paddingBottom: paperPad.bottom,
            borderWidth: 0,
            borderRadius: 0,
            backgroundColor: 'transparent',
            boxShadow: 'none',
          },
          // 공지 상세·쓰기·퀘스트 상세 종이가 떠 있는 동안 뒤 목록 종이를 감춘다 — 상세 종이보다 넓고 길어
          // 아래·옆으로 날짜·댓글 줄이 삐져나온다. 닫으면 스크롤 위치 그대로 다시 보인다(터치·스크린리더는 위 prop 이 막는다)
          boardOverlayOpen && { opacity: 0 },
        ]}
      >
        {paperPanel && (
          <BoardPaper
            source={paperSource}
            style={{
              left: -34 * landScale,
              right: -34 * landScale,
              top: -38 * landScale,
              bottom: -30 * landScale,
            }}
          />
        )}
        {panelNavigationOpen && (
          <View
            testID="board-panel-navigation"
            style={{
              zIndex: 2,
              flexDirection: 'row',
              justifyContent: 'flex-end',
              gap: 8,
              marginBottom: 8,
            }}
          >
            <NavBtn
              boardPaper
              close
              testID="board-panel-close"
              label={
                questEditorOpen
                  ? s.editing
                    ? t('ui.board.closeQuestEditor')
                    : t('ui.board.closeNewQuest')
                  : t('ui.board.closeBoard')
              }
              onPress={questEditorOpen ? nav.backToQuests : nav.closePanel}
            />
          </View>
        )}
        {s.panel === 'blueprint' && (
          <NavBtn
            boardPaper
            close
            testID="board-drawer-close"
            label={t('ui.board.closeContent')}
            onPress={nav.closePanel}
            style={{ position: 'absolute', zIndex: 3, top: 8, right: 8 }}
          />
        )}
        {s.panel === 'notice' && (
          <Scroll
            testID="board-notice-scroll"
            style={[
              {
                flexGrow: 1,
                flexShrink: 1,
                minHeight: 0,
                maxHeight: paperScroll,
              },
              webOnly({ overscrollBehavior: 'contain' }),
            ]}
          >
            {noticeOverlayOpen ? noticeList() : noticeContent()}
          </Scroll>
        )}
        {s.panel === 'quest' && (
          <Scroll style={questCompose ? { flex: 1, minHeight: 0 } : { maxHeight: paperScroll }}>
            {questContent(questDetailOpen)}
          </Scroll>
        )}
        {/* 퀘스트 쓰기 종이의 오류·저장은 스크롤 밖 아래에 고정 — 제목을 치는 동안에도 키보드 위에 보인다 */}
        {questCompose && (
          <View testID="board-quest-footer" style={{ gap: 8, paddingTop: 10 }}>
            {formError}
            {questSave(questFormValue())}
          </View>
        )}
        {/* 섬 id·섬장 여부는 공지와 같은 getBoard 응답이 정본이다 — 그 첫 조회가 끝나기 전·실패했을 때는 빈 종이가
            아니라 공지·퀘스트와 같은 불러오는 중·오류+다시 시도를 보인다(다시 시도 = board.retry).
            키보드는 공지 댓글·편지 입력과 같은 길로 피한다 — App 루트 KeyboardAvoidingView(iOS padding)·adjustResize(안드로이드)가
            InteriorRoute 높이를 줄이면 paperScroll·sheetCramped 가 그 높이를 따른다(방명록은 minPaperScroll 바닥이 더 높다).
            automaticallyAdjustKeyboardInsets 는 줄어들기 전 좌표로 inset 을 잡아 이중 보정이 될 수 있어 두지 않는다. */}
        {s.panel === 'guestbook' && serverBoard && (
          <Scroll
            testID="board-guestbook-scroll"
            style={{ maxHeight: paperScroll }}
            onEndReached={() => guestbookMore.current?.()}
          >
            {board.islandId ? (
              <Guestbook
                islandId={board.islandId}
                host={owner}
                e={e}
                onLoadMoreReady={(load) => {
                  guestbookMore.current = load;
                }}
              />
            ) : board.error && !board.loading ? (
              <View>
                <Text style={muted({ marginTop: 4, marginBottom: 8 })}>
                  {errorTextOr(board.error, 'guestbook.loadFailed')}
                </Text>
                <PaperAction
                  testID="board-guestbook-retry"
                  label={t('common.retry')}
                  onPress={() => board.retry().catch(() => {})}
                />
              </View>
            ) : (
              <Text style={muted({ marginTop: 4, marginBottom: 14 })}>
                {t('guestbook.loading')}
              </Text>
            )}
          </Scroll>
        )}
        {s.panel === 'blueprint' && (
          <View
            style={[
              constructionPlanStyles.card,
              {
                flexShrink: 1,
                minHeight: 0,
                margin: -16,
                ...(blueprintMessageOnly ? {} : { flex: 1 }),
              },
            ]}
          >
            <ConstructionPlanGrid />
            <Scroll
              style={{ flexShrink: 1, minHeight: 0, ...(blueprintMessageOnly ? {} : { flex: 1 }) }}
            >
              {blueprint()}
            </Scroll>
            {blueprintFooter()}
          </View>
        )}
      </View>
      {noticeOverlayOpen && (
        <>
          <Pressable
            testID="board-notice-overlay-scrim"
            accessibilityLabel={t('ui.board.closeNoticeWindow')}
            accessibilityElementsHidden={higherModalOpen}
            disabled={higherModalOpen}
            onPress={dismissNoticeOverlay}
            {...webOnly(higherModalOpen ? { 'aria-hidden': true, inert: true, tabIndex: -1 } : {})}
            style={{
              position: 'absolute',
              zIndex: 5,
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              backgroundColor: exact('#3f302f2b'),
            }}
          />
          <View
            testID="board-notice-overlay"
            accessibilityViewIsModal={!higherModalOpen}
            accessibilityElementsHidden={higherModalOpen}
            ref={noticeOverlayRef as any}
            accessibilityRole={Platform.OS === 'web' ? ('dialog' as any) : undefined}
            {...(Platform.OS === 'web'
              ? {
                  'aria-modal': !higherModalOpen,
                  'aria-label': noticeEditorOpen
                    ? t('ui.board.newNoticeTitle')
                    : t('ui.board.noticeDetails'),
                  tabIndex: -1,
                  ...(higherModalOpen && { 'aria-hidden': true }),
                }
              : null)}
            style={{
              position: 'absolute',
              zIndex: 6,
              ...(land ? landOverlay : { left: 32, right: 32, top: '20%', maxHeight: '58%' }),
              ...(overlayCramped && { top: 4, maxHeight: height - 8 }),
              paddingTop: 48 * landScale,
              paddingHorizontal: 58 * landScale,
              paddingBottom: 40 * landScale,
              boxShadow: '0 8px 18px #2f211d45',
              ...noticeComposeStyle,
            }}
          >
            <BoardPaper
              source={interiorArt.boardPaper.detail}
              style={{
                left: -28 * landScale,
                right: -28 * landScale,
                top: -32 * landScale,
                bottom: -26 * landScale,
              }}
            />
            {/* 쓰기 종이(noticeCompose)여도 같은 Scroll 을 두고 스크롤만 잠근다 — 키보드로 높이가 임계값을 넘나들 때
                감싸는 요소가 바뀌면 제목·본문 TextInput 이 새로 마운트돼 포커스와 키보드를 잃는다 */}
            <Scroll
              testID="board-notice-overlay-content"
              scrollEnabled={!(noticeCompose && noticeEditorOpen)}
              contentContainerStyle={
                noticeCompose && noticeEditorOpen ? { flexGrow: 1 } : undefined
              }
              style={[
                noticeCompose
                  ? { flex: 1, minHeight: 0 }
                  : { minHeight: 0, maxHeight: overlayScroll, flexShrink: 1 },
                webOnly({ overscrollBehavior: 'contain' }),
              ]}
            >
              {noticeDetailOpen ? noticeDetail() : noticeEditor()}
            </Scroll>
            {/* 댓글 입력칸·등록은 공지 본문 스크롤 밖 아래, 키보드 바로 위에 고정한다 */}
            {commentOpen && commentComposer()}
          </View>
        </>
      )}
      {questDetailOpen && (
        <>
          <Pressable
            testID="board-quest-overlay-scrim"
            accessibilityLabel={t('ui.board.closeQuestDetails')}
            accessibilityElementsHidden={higherModalOpen}
            disabled={higherModalOpen}
            onPress={dismissQuestDetail}
            {...webOnly(higherModalOpen ? { 'aria-hidden': true, inert: true, tabIndex: -1 } : {})}
            style={{
              position: 'absolute',
              zIndex: 5,
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              backgroundColor: exact('#3f302f2b'),
            }}
          />
          <View
            testID="board-quest-overlay"
            accessibilityViewIsModal={!higherModalOpen}
            accessibilityElementsHidden={higherModalOpen}
            ref={questOverlayRef as any}
            accessibilityRole={Platform.OS === 'web' ? ('dialog' as any) : undefined}
            {...(Platform.OS === 'web'
              ? {
                  'aria-modal': !higherModalOpen,
                  'aria-label': t('ui.board.questDetails'),
                  tabIndex: -1,
                  ...(higherModalOpen && { 'aria-hidden': true }),
                }
              : null)}
            style={{
              position: 'absolute',
              zIndex: 6,
              ...(land ? landOverlay : { left: 32, right: 32, top: '20%', maxHeight: '58%' }),
              ...(overlayCramped && { top: 4, maxHeight: height - 8 }),
              paddingTop: 48 * landScale,
              paddingHorizontal: 58 * landScale,
              paddingBottom: 40 * landScale,
              boxShadow: '0 8px 18px #2f211d45',
            }}
          >
            <BoardPaper
              source={interiorArt.boardPaper.detail}
              style={{
                left: -28 * landScale,
                right: -28 * landScale,
                top: -32 * landScale,
                bottom: -26 * landScale,
              }}
            />
            <Scroll
              testID="board-quest-overlay-content"
              style={[
                { minHeight: 0, maxHeight: overlayScroll },
                webOnly({ overscrollBehavior: 'contain' }),
              ]}
            >
              {questContent()}
            </Scroll>
          </View>
        </>
      )}
    </View>
  );
}

export const boardArtifacts: Record<string, ArtifactRenderer> = {
  // 시안이 바뀌면 상태를 새로 만든다
  'board-view': (props) => <Board key={props.index} {...props} />,
};
