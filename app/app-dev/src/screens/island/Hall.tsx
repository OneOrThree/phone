import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Image, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { isMockMode } from '@/services/demoMode';
import { art, CharCount, NavBtn, Wheel } from '@/design-system/patterns';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { CatAvatar } from '@/components/CatAvatar';
import { appearanceOutfit, outfitOf, type Outfit } from '@/components/CatOutfitLayers';
import { useAppLayout } from '@/utils/layout';
import {
  State,
  Building,
  viewIsland,
  buildingNames,
  costs,
  buildMinutes,
  balance,
  buildingShare,
  collectedBy,
  isHost,
  isFull,
  residentCount,
  capacityOf,
  shopPrerequisitesMet,
  inviteCodeOf,
  joinRequests,
  ledgerParts,
  canSelectBuilding,
  dayKey,
  kstMonthDay,
  CAPACITY_MAX,
  CAPACITY_MIN,
} from '@/services/model';
import { BROWN, T, fill, hm, safeOffset, useGowun, web } from '@/screens/island/sceneKit';
import {
  useLedgerScreen,
  shiftMonth,
  type LedgerScreenState,
  type LedgerTab,
} from '@/screens/island/useLedgerScreen';
import { useConstruction } from '@/screens/island/useConstruction';
import {
  managementErrorMessage,
  useIslandManagement,
} from '@/screens/interiors/useIslandManagement';
import { getSession, sessionGeneration } from '@/services/api/session';
import { captureProductEvent } from '@/services/posthog';
import { t } from '@/i18n';
import { useVisitorJoin } from '@/screens/island/useVisitorJoin';
import { useInviteShare } from '@/screens/island/useInviteShare';
import { useIslandNews } from '@/screens/magazine/useIslandNews';
import {
  ISLAND_GREETING_MAX,
  ISLAND_INTRO_MAX,
  ISLAND_NAME_MAX,
} from '@/services/api/islandManagement';
import { clampCodePoints } from '@/utils/codePoints';

// v2 시안(042~061) 마을회관: 책상 장면 → 섬 정보 카드·수정·위임·탈퇴 / 공동 가계부 / 목각 건물·청사진
// App.tsx 의 REVIEW/DEMO 와 같은 판정(services/demoMode) — 모크 모드는 서버가 없으므로 가계부도 로컬 원장으로 그린다.
const ledgerMockMode = () => isMockMode();
// 편집 칸에 미리 채울 인사말 — 섬장이 쓴 것만. 안 썼으면(기본 문구가 합성돼 온다) 빈 칸이고, 기본 문구는 힌트로만 보인다.
// 합성 문구를 그대로 채워 저장하면 섬 이름이 바뀌어도 안 따라가고, 이름이 길면 40 코드포인트를 넘을 수 있다.
const ownGreeting = (detail?: { greeting?: string; greetingIsDefault?: boolean } | null) =>
  detail?.greetingIsDefault === false ? (detail.greeting ?? '') : '';
const CARD_INK = '#3e352e';
const MUTED = '#665348';
// 섬 관리 카드의 「냐옹잡지에 섬 홍보하기 ›」 줄
const promotionRow = {
  minHeight: semanticTokens.size.tapMin,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: semanticTokens.spacing.control,
} as const;
// 관리 쓰기(위임 · 승인 · 강퇴 · 저장) 중에는 홍보 쓰기 줄을 흐리게 막는다 — 공용 버튼의 꺼짐 투명도
const promotionRowBusy = {
  ...promotionRow,
  opacity: componentTokens.button.disabledOpacity,
} as const;
const completionStamp = componentTokens.hallCompletionStamp;
// 공동 가계부 장부 한 장과 잔액·적립·지출 고양이 포스트잇(GROMO-2487) — 새 그림이라 OTA 경로(src/assets/ota/)에 둔다
const ledgerArt = {
  book: require('@/assets/ota/interiors/ui/ledger-book-v2.png'),
  tabs: [
    require('@/assets/ota/interiors/ui/tab-pink.png'),
    require('@/assets/ota/interiors/ui/tab-yellow.png'),
    require('@/assets/ota/interiors/ui/tab-blue.png'),
  ],
};
// 받침 유무로 조사 고르기 (을/를, 으로/로: ㄹ받침은 로)
const final = (word: string) => {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return c < 0 || c > 11171 ? -1 : c % 28;
};
const eul = (w: string) => w + (final(w) > 0 ? '을' : '를');
const ro = (w: string) => w + (final(w) > 0 && final(w) !== 8 ? '으로' : '로');
const grid = ['library', 'tower', 'mail', 'gram', 'shop'] as const satisfies readonly Building[];
const cardDesc: Record<string, string> = {
  hall: '주민이 모이는 곳',
  board: '섬 공지와 퀘스트',
  library: '집중과 스크린타임',
  tower: '섬 순위와 탐색',
  mail: '주민·친구 편지',
  gram: '공동 음원 재생',
  shop: '의상·섬 테마 구매',
};
const planDesc: Record<string, string> = {
  hall: '주민이 모여 섬 소식과 가계부를 보는 곳이에요.',
  board: '공지와 퀘스트를 올리고 확인해요.',
  library: '나와 주민들의 집중 기록, 스크린타임, 누적 물고기를 일·주·월로 확인해요.',
  tower: '다른 섬 순위를 보고 구경하거나 가입해요.',
  mail: '주민·친구와 편지를 주고받아요.',
  gram: '섬 물고기로 음원을 사서 함께 들어요.',
  shop: '물고기로 의상과 섬 테마를 사요.',
};
const bldArt: Record<string, string> = {
  hall: 'bld/hall',
  board: 'bld/notice-board',
  library: 'bld/library',
  tower: 'bld/observatory',
  mail: 'bld/mailbox',
  gram: 'bld/gramophone',
  shop: 'bld/shop',
};
// 정책 C01: 회관·게시판은 섬 통장 합산, 나머지는 주민별 n빵 — 서버 옵션에 구분 필드가 없어
// 건물 id 로만 나눈다. 각자 몫 = 총액 ÷ 대상 주민 수(올림).
const walletTotal = (b: string) => b === 'hall' || b === 'board';
// blockedReason 은 서버 evaluator 의 UI 사유다 — 앱이 권한·선행을 다시 추론하지 않는다.
const blockedText = (reason: string | null) =>
  reason === 'FORBIDDEN'
    ? '섬장이 목표를 정해요'
    : reason === 'FACILITY_LOCKED'
      ? '먼저 지어야 할 건물이 있어요'
      : reason === 'REQUIRES_TOWER_AND_MAIL'
        ? '나머지 건물을 모두 완공한 뒤에 지을 수 있어요'
        : reason === 'INSUFFICIENT_FUNDS'
          ? '섬 물고기가 부족해요'
          : reason === 'IN_PROGRESS'
            ? '지금 다른 건물을 짓고 있어요'
            : '지금은 선택할 수 없어요';
export const buildBlockedText = (reason: string | null) =>
  reason === 'FORBIDDEN'
    ? '섬장이 건설을 시작해요'
    : reason === 'INSUFFICIENT_FUNDS'
      ? '물고기가 모이면 건설할 수 있어요'
      : reason === 'IN_PROGRESS'
        ? '다른 공사가 끝난 뒤에 지을 수 있어요'
        : '지금은 건설할 수 없어요';
const bldRoute: Record<string, string> = {
  library: 'library',
  tower: 'tower',
  mail: 'mail',
  gram: 'sound',
  shop: 'shop',
};
const avBg = ['#dfe9cc', '#f3d4d4', '#d4e7e9'];
const PENCIL = 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4';
const SHARE = 'M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M6 12v7h12v-7';
const CHEV = 'm9 5 7 7-7 7';
function Icon({ d, size }: { d: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d={d}
        fill="none"
        stroke="#725e4d"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
// 고양이 색 미선택(null)·모름 — 남의 칸을 내 색으로 칠하지 않고 빈 자리표시자 원으로 둔다(2-16 H21)
const NO_CAT_COLOR = '';
function Avatar({ color, outfit, userId, n, size }: any) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.3,
        borderColor: '#c4af88',
        backgroundColor: avBg[n % 3],
        overflow: 'hidden',
      }}
    >
      <CatAvatar
        userId={userId}
        color={color}
        outfit={outfit}
        size={size - 2.6}
        style={{ transform: [{ scale: 1.2 }], transformOrigin: 'center bottom' }}
      />
    </View>
  );
}

export function Hall({ e }: any) {
  const font = useGowun();
  const s: State = e.state,
    i = viewIsland(s),
    L = useAppLayout(),
    land = L.landscape,
    W = L.width,
    H = L.height,
    r = e.route,
    host = isHost(i),
    // 다른 섬을 구경 중(주민 아님)이면 섬 정보 카드를 방문자 뷰로 보여 준다
    visitor = !!s.visitingIslandId,
    // 서버 훅이 부를 섬 — 서버 모드 current 는 로컬 목업 섬 목록에 없다(GROMO-2138). 서버 모드(e.islands)에선
    // 서버 id 가 도착하기 전(null)에 목업 id 로 소식·관리를 부르지 않는다(GROMO-2460). 목업은 기존 섬 id
    liveIslandId = e.islands ? (s.serverIslands?.currentIslandId ?? null) : i.id;
  // review/demo에는 서버가 없으므로 관리 hook을 열지 않고 기존 시연 섬 정보를 유지한다.
  const liveManagement = (r === 'manage' || r === 'members') && !visitor && !ledgerMockMode();
  // `manage`/`members`는 실제 App 경로(CurrentScreens → Hall)다. 로컬 Island를 서버 DTO로
  // 덮어쓰지 않고 이 표면에서만 관리 API snapshot을 직접 소비한다.
  const management = useIslandManagement({
    active: liveManagement,
    islandId: visitor ? null : liveIslandId,
  });
  const [panel, setPanel] = useState<'' | 'edit' | 'transfer'>(''),
    [plan, setPlan] = useState<Building | null>(null),
    [toast, setToast] = useState(''),
    [dialog, setDialog] = useState<{
      title: string;
      text: string;
      detail?: React.ReactNode;
      // ok가 없으면 취소만 있는 선택창
      ok?: string;
      onOk?: () => void;
      // 되돌릴 수 없는 행동(탈퇴·강퇴)만 붉은 확인 버튼을 쓴다
      danger?: boolean;
      body?: React.ReactNode;
    } | null>(null);
  const [draft, setDraft] = useState({
    name: i.name,
    intro: i.intro,
    approval: i.approval,
    capacity: capacityOf(i),
    greeting: '',
  });
  const [managementError, setManagementError] = useState('');
  const [managementBusy, setManagementBusy] = useState(false);
  const managementRun = useRef(0);
  // 같은 섬의 관리 화면이라도 route 또는 인증 세대가 바뀌면 이전 요청의 UI 완료를 버린다.
  // 세대는 렌더 때 snapshot으로 잡아 effect dependency에 넣는다.
  const managementSessionGeneration = sessionGeneration();
  useEffect(() => {
    managementRun.current += 1;
    setManagementError('');
    return () => {
      managementRun.current += 1;
    };
  }, [liveManagement, i.id, r, managementSessionGeneration]);
  const managementHost = management.role === 'host';
  const displayHost = liveManagement ? managementHost : host;
  const managementMessage = liveManagement
    ? managementError || (management.error ? managementErrorMessage(management.error) : '')
    : '';
  const runManagement = async (
    work: () => Promise<void>,
    success: string,
    afterSuccess?: () => void,
    operation?: 'approve' | 'settings',
  ) => {
    const run = managementRun.current;
    setManagementError('');
    setManagementBusy(true);
    try {
      await work();
      if (run !== managementRun.current) return;
      afterSuccess?.();
      notify(success);
    } catch (error) {
      if (run !== managementRun.current) return;
      // 게스트 섬장이 인사말을 저장하면 서버가 403 SOCIAL_LOGIN_REQUIRED 로 거절한다 — 회원 전환 시트로 보낸다(GROMO-2005)
      if (e.conversion?.offer(error)) return;
      const message = managementErrorMessage(error, operation);
      setManagementError(message);
      // 정보 수정·위임 패널에는 주민 카드의 오류 줄이 안 보인다 — 패널에서는 토스트로 알린다(H5)
      if (panel) notify(message);
    } finally {
      if (run === managementRun.current) setManagementBusy(false);
    }
  };
  const transferCandidates = liveManagement
    ? (management.members ?? [])
        .filter((m) => m.role !== 'host')
        .map((m) => ({
          id: m.id,
          name: m.name ?? '주민',
          color: m.catColor ?? NO_CAT_COLOR,
          outfit: appearanceOutfit(m.appearance),
        }))
    : i.members;
  // 가계부: 서버 원장·지갑 조각이 정본이다 — 로컬 i.ledger 문자열·로컬 잔액 합산을 쓰지 않는다.
  // 방문자에게는 조회 자체를 하지 않는다(서버도 403). 리뷰·데모 모크 모드는 서버가 아예 없다 —
  // 거기서는 로컬 원장으로 그리던 기존 화면을 유지하고 API 호출은 0회다.
  const thisMonth = dayKey(e.now).slice(0, 7);
  const mockLedger = ledgerMockMode();
  const serverLedger = useLedgerScreen({
    active: r === 'ledger' && !visitor && !mockLedger,
    islandId: liveIslandId ?? i.id, // URL 에 안 쓰는 값이라 타입만 지킨다
    currentMonth: thisMonth,
  });
  // 건설 화면도 같은 서버 정본 규칙 — 방문자·모크 모드는 로컬 시연 UI 를 유지한다.
  const liveConstruction = r === 'construction' && !visitor && !mockLedger;
  const clientConstruction = s.serverIslands?.clientConstruction;
  const construction = useConstruction({
    active: liveConstruction,
    withMembers: false,
    islandId: visitor ? null : liveIslandId,
    now: e.now,
    resumeTiming:
      clientConstruction?.islandId === liveIslandId
        ? {
            buildingId: clientConstruction.building,
            startedAt: clientConstruction.startedAt,
            completesAt: clientConstruction.endsAt,
          }
        : null,
    onStarted: (receipt, serverIslandId) =>
      e.dispatch({
        type: 'SERVER_CONSTRUCTION_STARTED',
        islandId: serverIslandId,
        building: receipt.buildingId as Building,
        startedAt: Date.parse(receipt.startedAt),
        endsAt: Date.parse(receipt.completesAt),
      }),
  });
  const [mockMonth, setMockMonth] = useState(0);
  const [mockTab, setMockTab] = useState<LedgerTab>('balance');
  // 모크 모드용 로컬 view model — 서버 모델과 같은 모양으로 맞춰 아래 렌더를 공유한다.
  // reason 자리에는 표시용 로컬 제목(l.title)을 싣는다(아래 렌더가 mockLedger 면 그대로 그린다).
  const mockLedgerState = useMemo<LedgerScreenState>(() => {
    const key = shiftMonth(thisMonth, mockMonth);
    const rows = i.ledger
      .map((l) => ({ ...l, ...ledgerParts(l) }))
      .filter((l) => l.amount !== 0 && dayKey(l.at).slice(0, 7) === key);
    const items = rows
      .filter((l) => mockTab === 'balance' || (mockTab === 'earn' ? l.amount > 0 : l.amount < 0))
      .map((l, n) => ({
        id: `local-${n}`,
        direction: (l.amount > 0 ? 'earn' : 'spend') as 'earn' | 'spend',
        reason: l.title,
        amount: Math.abs(l.amount),
        createdAt: new Date(l.at).toISOString(),
        groupedUntil: new Date(l.at).toISOString(),
        entryCount: 1,
      }));
    return {
      month: key,
      offset: mockMonth,
      canNext: mockMonth < 0,
      prevMonth: () => setMockMonth((n) => n - 1),
      nextMonth: () => setMockMonth((n) => Math.min(0, n + 1)),
      tab: mockTab,
      setTab: setMockTab,
      status: 'ready',
      error: null,
      items,
      villagePoints: balance(i),
      earnedTotal: rows.reduce((n, l) => n + Math.max(0, l.amount), 0),
      spentTotal: Math.abs(rows.reduce((n, l) => n + Math.min(0, l.amount), 0)),
      nextCursor: null,
      loadingMore: false,
      moreError: null,
      loadMore: () => {},
      retry: () => {},
      refresh: () => {},
    };
  }, [i, mockMonth, mockTab, thisMonth]);
  const ledger = mockLedger ? mockLedgerState : serverLedger;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  // 안드로이드 뒤로 가기: 확인창 → 청사진 → 수정·위임 창 순으로 하나만 닫고 회관에 머문다.
  // 열린 창이 있을 때만 등록해 App 전역 리스너보다 나중에 등록되므로 먼저 불린다
  useEffect(() => {
    if (!dialog && !plan && !panel) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (dialog) setDialog(null);
      else if (plan) setPlan(null);
      else setPanel(panel === 'transfer' ? 'edit' : '');
      return true;
    });
    return () => sub.remove();
  }, [dialog, plan, panel]);
  const notify = (text: string) => {
    setToast(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(''), 2400);
  };
  const inviteShare = useInviteShare(liveIslandId ?? '', management.detail?.name ?? i.name, notify);
  const {
    join,
    disabled: joinDisabled,
    label: joinLabel,
    busy: visitorJoinBusy,
    serverJoin,
  } = useVisitorJoin(e, s, i, notify);
  // 섬 소식(GROMO-2282) — 주민 전용 목록이라 구경 중이 아닐 때 관리·주민 카드에서만 부른다. 실패·403 은 빈 목록이다
  const news = useIslandNews((r === 'manage' || r === 'members') && !visitor, liveIslandId);
  // .hl 글자: 고운돋움, 자간 −0.15
  const g = (size: number, lh: number, extra?: object) => ({
    fontFamily: font,
    fontSize: size,
    lineHeight: lh,
    ...extra,
  });

  // 방 그림은 cover로 잘리므로, 시안(402×874 / 874×402) 좌표를 화면 가운데 기준으로 옮긴다
  const k = land
    ? Math.max(W / 1024, H / 471) / (874 / 1024)
    : Math.max(W / 1024, H / 1536) / (874 / 1536);
  // 가로 패널 왼쪽: 874 폭은 시안대로 300, 좁은 폰(SE 667·640dp)은 패널 폭 558을 지키다가
  // 뒤로 버튼(오른쪽 끝 100) 옆 120까지만 줄인다. 확인창·토스트는 그보다 60 안쪽
  const off = safeOffset(L);
  const side = Math.min(300, Math.max(120, W - 574)),
    over = side + 60;
  const sx = (x: number) => W / 2 + (x - (land ? 437 : 201)) * k,
    sy = (y: number) => H / 2 + (y - (land ? 201 : 437)) * k;
  const blurred = r !== 'hall' && r !== 'construction';
  const scene = (
    <>
      <Image
        source={art[(land ? 'L/' : '') + (blurred ? 'hall/room-blur' : 'hall/room')]}
        style={fill}
        resizeMode="cover"
      />
      <View
        pointerEvents="none"
        style={[
          fill,
          web({
            backgroundImage:
              'linear-gradient(rgba(55, 39, 29, 0.07), transparent 24%, transparent 70%, rgba(55, 39, 29, 0.047)), linear-gradient(90deg, rgba(57, 40, 27, 0.086), transparent 24%, transparent 76%, rgba(57, 40, 27, 0.086))',
          }),
        ]}
      />
      {blurred && (
        <View pointerEvents="none" style={[fill, { backgroundColor: 'rgba(78, 61, 41, 0.094)' }]} />
      )}
    </>
  );
  // 목적지가 정해진 ‹ 는 목적지를 읽고(책상 → 섬), 이전 화면으로 가는 ‹ 는 「뒤로」다(DESIGN §7.14)
  const back = (onPress: () => void, label = '뒤로') => (
    <NavBtn
      label={label}
      testID="hall-back"
      onPress={onPress}
      style={{
        position: 'absolute',
        zIndex: 12,
        left: (land ? 56 : 18) + off.left,
        top: (land ? 14 : 46.5) + off.top,
      }}
    />
  );
  const toastView = toast !== '' && (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        zIndex: 22,
        left: land ? over : 28,
        right: land ? 75 : 28,
        bottom: land ? 24 : 65,
        paddingVertical: 13,
        paddingHorizontal: 16,
        borderRadius: 12,
        backgroundColor: 'rgba(73, 59, 57, 0.91)',
        boxShadow: '0px 6px 18px rgba(45, 33, 27, 0.333)',
      }}
    >
      <T style={g(14, 20.3, { color: '#fffaf0', textAlign: 'center' })}>{toast}</T>
    </View>
  );
  const dialogView = dialog && (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="닫기"
        onPress={() => setDialog(null)}
        style={[fill, { zIndex: 20, backgroundColor: 'rgba(51, 42, 38, 0.45)' }]}
      />
      <View
        pointerEvents="box-none"
        style={[
          fill,
          {
            zIndex: 21,
            justifyContent: 'center',
            paddingLeft: land ? over : 31,
            paddingRight: land ? 75 : 31,
          },
        ]}
      >
        <View
          accessibilityViewIsModal
          style={{
            gap: land ? 7 : 11,
            paddingTop: land ? 16 : 22,
            paddingHorizontal: land ? 18 : 19,
            paddingBottom: land ? 16 : 18,
            borderWidth: 2,
            borderColor: '#806449',
            borderRadius: 17,
            backgroundColor: '#fff8e9',
            boxShadow: '0px 14px 34px rgba(45, 33, 27, 0.5)',
          }}
        >
          <T style={g(21, 33.6, { color: CARD_INK, fontWeight: '700' })}>{dialog.title}</T>
          {!!dialog.text && (
            <T
              style={g(land ? 14 : 15, land ? 21.7 : 23.25, {
                color: MUTED,
                ...web({ wordBreak: 'keep-all' }),
              })}
            >
              {dialog.text}
            </T>
          )}
          {dialog.body}
          {!!dialog.detail && (
            <View
              style={{
                padding: land ? 8 : 11,
                borderWidth: 1,
                borderColor: '#d1b995',
                borderRadius: 9,
                backgroundColor: '#fffdf8',
              }}
            >
              <T style={g(14, 20.3, { color: CARD_INK })}>{dialog.detail}</T>
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 3 }}>
            {(dialog.ok ? [false, true] : [false]).map((ok) => (
              <Pressable
                key={String(ok)}
                testID={ok ? 'hall-dialog-ok' : 'hall-dialog-cancel'}
                accessibilityRole="button"
                accessibilityLabel={ok ? dialog.ok : '취소'}
                onPress={() => {
                  setDialog(null);
                  if (ok) dialog.onOk?.();
                }}
                style={{
                  flex: ok ? 1.35 : 1,
                  minHeight: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1.5,
                  borderColor: BROWN,
                  borderRadius: 99,
                  // 주 행동은 Pink(DESIGN §7.2), 위험 행동만 빨강
                  backgroundColor: ok
                    ? dialog.danger
                      ? '#e9a49d'
                      : componentTokens.button.background
                    : undefined,
                }}
              >
                <T
                  style={g(14, 22.4, {
                    color: ok && dialog.danger ? '#6f2d2a' : CARD_INK,
                    fontWeight: ok ? '700' : '400',
                  })}
                >
                  {ok ? dialog.ok : '취소'}
                </T>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </>
  );
  const shell = (children: React.ReactNode, backPress?: () => void, backLabel?: string) => (
    <View style={{ flex: 1 }}>
      {/* 확인창이 열린 동안 뒤 장면은 보조기기에서 숨긴다 */}
      <View
        style={fill}
        aria-hidden={!!dialog}
        accessibilityElementsHidden={!!dialog}
        importantForAccessibility={dialog ? 'no-hide-descendants' : 'auto'}
      >
        {scene}
        {backPress && back(backPress, backLabel)}
        {children}
      </View>
      {dialogView}
      {toastView}
    </View>
  );

  // ── 042 회관 책상: 이름표 없이 점만 ──
  if (r === 'hall') {
    const spots = [
      {
        label: '섬 관리',
        route: 'manage',
        on: true,
        box: land ? [309.4, 85.8, 255.1, 236] : [116, 375.8, 170.1, 157.3],
      },
      {
        label: '목각 건물 고르기',
        route: 'construction',
        on: false,
        box: land ? [337, 5, 200, 100] : [85, 270.9, 231.9, 131.1],
      },
      {
        label: '공동 가계부',
        route: 'ledger',
        on: false,
        box: land ? [529.7, 243, 156.5, 196.7] : [262.9, 480.7, 104.4, 131.1],
      },
    ];
    return shell(
      <>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            zIndex: 9,
            top: (land ? 18 : 55.5) + off.top,
            left: land ? 112 + off.left : 0,
            right: land ? undefined : 0,
            alignItems: 'center',
          }}
        >
          <View
            style={[
              {
                minWidth: 148.5,
                paddingTop: 6.5,
                paddingHorizontal: 18.1,
                paddingBottom: 7.7,
                borderWidth: 1.9,
                borderColor: '#65462f',
                borderTopLeftRadius: 7.7,
                borderTopRightRadius: 7.7,
                borderBottomLeftRadius: 11.6,
                borderBottomRightRadius: 11.6,
                backgroundColor: '#c58a55',
                boxShadow: '0px 3.9px 0px rgb(101, 70, 47)',
                transform: [{ rotate: '-1deg' }],
              },
              web({
                backgroundImage:
                  'linear-gradient(90deg, rgb(184, 120, 72), rgb(209, 155, 97), rgb(184, 120, 72))',
              }),
            ]}
          >
            <T
              style={g(20.7, 33.12, {
                color: '#fff7e7',
                textAlign: 'center',
                textShadowColor: 'rgb(104, 74, 52)',
                textShadowOffset: { width: 0, height: 1.3 },
                textShadowRadius: 0,
              })}
            >
              마을회관
            </T>
          </View>
        </View>
        {spots.map((o) => (
          <Pressable
            key={o.route}
            testID={`hall-spot-${o.route}`}
            accessibilityRole="button"
            accessibilityLabel={o.label}
            onPress={() => e.go(o.route)}
            style={{
              position: 'absolute',
              zIndex: 7,
              left: sx(o.box[0]),
              top: sy(o.box[1]),
              width: o.box[2] * k,
              height: o.box[3] * k,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: 46.5,
                height: 46.5,
                borderRadius: 23.25,
                backgroundColor: 'rgba(255, 255, 255, 0.45)',
                boxShadow: o.on
                  ? '0px 0px 0px 2.6px rgba(255, 240, 173, 0.8), 0px 0px 0px 9px rgba(244, 167, 187, 0.44)'
                  : '0px 0px 0px 2.6px rgba(255, 255, 255, 0.44), 0px 0px 0px 7.7px rgba(244, 167, 187, 0.333)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View
                style={{
                  width: 20.7,
                  height: 20.7,
                  borderRadius: 10.35,
                  backgroundColor: o.on ? '#e8517d' : '#f4a7bb',
                }}
              />
            </View>
          </Pressable>
        ))}
      </>,
      e.home,
      '섬으로 돌아가기',
    );
  }

  // ── 052·053 공동 가계부 ──
  if (r === 'ledger') {
    // 방문자에게 공동 가계부는 열리지 않는다(서버도 403) — 조회도, 빈 장부로 위장도 하지 않는다
    if (visitor) {
      return shell(
        <View
          style={{
            position: 'absolute',
            zIndex: 7,
            left: land ? side : 36,
            right: land ? side : 36,
            top: '40%',
            alignItems: 'center',
            gap: 8,
            paddingVertical: 23.2,
            paddingHorizontal: 16,
            borderWidth: 1.9,
            borderStyle: 'dashed',
            borderColor: '#c5ad8a',
            borderRadius: 12.9,
            backgroundColor: '#fff3d8',
          }}
        >
          <T
            testID="ledger-member-only"
            style={g(16.8, 26.88, { fontWeight: '700', textAlign: 'center' })}
          >
            섬 주민만 볼 수 있어요
          </T>
          <T style={g(15.5, 21.7, { color: MUTED, textAlign: 'center' })}>
            공동 가계부는 주민에게만 공개돼요
          </T>
        </View>,
        e.back,
      );
    }
    const [ledgerYear, ledgerMonth] = ledger.month.split('-').map(Number);
    // 포스트잇 라벨 ↔ 서버 direction scope. 잔액은 무필터(최근 두 줄), 적립·지출은 해당 방향 전체
    const TAB_KEY = { 잔액: 'balance', 적립: 'earn', 지출: 'spend' } as const;
    const TAB_LABEL = { balance: '잔액', earn: '적립', spend: '지출' } as const;
    // 서버 원장 사유 → 한 줄 표시 (GROMO-1786 · IslandWalletTransactionType). 거래 주체는 계약에 없다
    const REASON: Record<string, string> = {
      contribution: '집중 적립',
      quest_settlement: '퀘스트 보상',
      construction_debit: '건설 사용',
      shop_purchase: '공동 구매',
      golden_fish: '황금 물고기',
      promotion_fee: t('magazine.ledger.promotionFee'),
    };
    const shown = ledger.tab === 'balance' ? ledger.items.slice(0, 2) : ledger.items;
    const numberText = (n: number, sign: '+' | '−') =>
      `${sign}${Math.abs(n).toLocaleString('ko-KR')}`;
    const LG = componentTokens.ledger;
    // 세 장짜리 책: 장부 그림 한 장을 비율 그대로 깔고(세로는 폭은 좌우 여백 안, 높이는 위~아래 여백 안 — 작은 쪽에 맞춰
    // 가운데) 그림 속 종이 영역 비율로 글을 둔다
    const A = LG.art;
    const bookLeft = land ? side : LG.side;
    const room = W - bookLeft - (land ? LG.landRight : LG.side);
    // 세로: 874 화면은 시안 높이 635.3 그대로, 낮은 화면은 뒤로 버튼·명판 아래에서 시작
    const bookTop = land
      ? LG.landTop
      : Math.max(L.insets.top + LG.topBelowInset, H - LG.bottom - LG.maxHeight);
    const visibleH = H - bookTop - (land ? LG.landBottom : LG.bottom);
    // 가로는 높이에 맞춰 줄이지 않는다 — 세로 폰과 비슷한 폭으로 크게 두고 아래쪽을 화면 밖으로 잘라 낸다(2026-10-27 오스카)
    const sc = land
      ? Math.min(room, LG.landscapeBookWidth) / A.width
      : Math.min(room / A.width, visibleH / A.height);
    const artH = A.height * sc;
    const bookW = A.width * sc;
    // 보이는 책 몸통 높이 — 세로는 그림 높이 그대로, 가로는 화면 아래 여백에서 잘린다
    const bodyH = Math.min(artH, visibleH);
    const paper = {
      left: A.paperLeft * sc,
      top: A.paperTop * sc,
      right: (A.width - A.paperRight) * sc,
      bottom: (A.height - A.paperBottom) * sc,
    };
    // 큰 글자·좁은 종이는 날짜·내용 아래에 금액을 따로 놓아 어느 열도 밀려 사라지지 않게 한다.
    const contentWidth = bookW - paper.left - paper.right - LG.contentInsetX * 2;
    const stackedRows =
      (L.fontScale ?? 1) >= semanticTokens.typography.largeTextThreshold ||
      contentWidth < LG.rowStackWidth * Math.max(1, L.fontScale ?? 1);
    // 토큰의 { 크기, 줄높이 } 로 고운돋움 글자 스타일을 만든다
    const lt = (type: { fontSize: number; lineHeight: number }, extra?: object) =>
      g(type.fontSize, type.lineHeight, extra);
    const tnum = { fontVariant: ['tabular-nums'] };
    // 이번 달이 아니면 「그 달」
    const monthWord = ledger.offset ? '그 달' : '이번 달';
    // 통장 표 한 줄: 날짜 | 내용(묶인 줄은 · N회) | 물고기 금액. 금액 줄높이 22 > 크기 18 이라 고운돋움 숫자 윗부분이 잘리지 않는다
    const list = shown.map((l) => {
      const spend = l.direction === 'spend';
      return (
        <View
          key={l.id}
          testID={`ledger-row-${l.id}`}
          style={{
            flexDirection: stackedRows ? 'column' : 'row',
            alignItems: 'center',
            gap: LG.columnGap,
            paddingVertical: LG.rowPaddingVertical,
            paddingHorizontal: LG.cellPaddingHorizontal,
            borderBottomWidth: LG.rowRule,
            borderStyle: 'dashed',
            borderBottomColor: LG.dash,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: LG.columnGap,
              flex: stackedRows ? undefined : 1,
              alignSelf: stackedRows ? 'stretch' : undefined,
              minWidth: 0,
            }}
          >
            <T style={lt(LG.date, { minWidth: LG.dateWidth, color: LG.faint, ...tnum })}>
              {kstMonthDay(Date.parse(l.createdAt))}
            </T>
            {/* 모크 모드의 reason 자리에는 로컬 제목이 실려 있다 — 그대로 보여 준다 */}
            <T style={lt(LG.reason, { flex: 1, minWidth: 0 })}>
              {mockLedger ? l.reason : (REASON[l.reason] ?? '기타')}
              {l.entryCount > 1 ? (
                <T
                  style={{ fontSize: LG.countFontSize, color: LG.faint }}
                >{` · ${l.entryCount}회`}</T>
              ) : null}
            </T>
          </View>
          {/* 서버 amount 는 항상 양수 — 부호는 direction 이 정한다 */}
          <T
            testID={`ledger-amount-${l.id}`}
            numberOfLines={1}
            adjustsFontSizeToFit
            style={lt(LG.amount, {
              minWidth: stackedRows ? 0 : LG.amountMinWidth,
              maxWidth: stackedRows ? '100%' : '50%',
              alignSelf: stackedRows ? 'stretch' : undefined,
              flexShrink: 1,
              textAlign: 'right',
              fontWeight: '700',
              color: spend ? LG.spend : LG.earn,
              ...tnum,
            })}
          >
            {numberText(l.amount, spend ? '−' : '+')}
          </T>
        </View>
      );
    });
    // 다음 쪽(같은 월·방향의 서명 커서) 더 보기. 잔액 장은 최근 두 줄만 보는 자리라 붙이지 않는다
    const more =
      ledger.tab !== 'balance' && ledger.nextCursor ? (
        <Pressable
          testID="ledger-more"
          accessibilityRole="button"
          accessibilityLabel="이전 내역 더 보기"
          accessibilityState={{ disabled: ledger.loadingMore }}
          disabled={ledger.loadingMore}
          onPress={ledger.loadMore}
          style={{
            alignSelf: 'center',
            marginTop: 7.7,
            paddingVertical: 9,
            paddingHorizontal: 19.4,
            opacity: ledger.loadingMore ? 0.5 : 1,
          }}
        >
          <T style={g(15.5, 24.8, { color: MUTED, fontWeight: '700' })}>
            {ledger.loadingMore ? '불러오는 중…' : '이전 내역 더 보기'}
          </T>
        </Pressable>
      ) : null;
    const moreRetry = ledger.moreError && (
      <Pressable
        testID="ledger-more-retry"
        accessibilityRole="button"
        accessibilityLabel="다시 시도"
        onPress={ledger.loadMore}
        style={{ alignSelf: 'center', paddingVertical: 9 }}
      >
        <T style={g(15.5, 21.7, { color: '#8a4a3f', textAlign: 'center' })}>
          내역을 더 불러오지 못했어요 · 다시 시도
        </T>
      </Pressable>
    );
    const stateBox =
      ledger.status === 'loading' ? (
        <View
          testID="ledger-loading"
          style={{
            alignItems: 'center',
            paddingVertical: 23.2,
            borderWidth: 1.9,
            borderStyle: 'dashed',
            borderColor: '#c5ad8a',
            borderRadius: 12.9,
          }}
        >
          <T style={g(16.8, 26.88, { fontWeight: '700' })}>불러오는 중이에요</T>
        </View>
      ) : ledger.status === 'error' ? (
        <View
          testID="ledger-error"
          style={{
            alignItems: 'center',
            gap: 9,
            paddingVertical: 23.2,
            paddingHorizontal: 12.9,
            borderWidth: 1.9,
            borderStyle: 'dashed',
            borderColor: '#c5ad8a',
            borderRadius: 12.9,
          }}
        >
          <T style={g(16.8, 26.88, { fontWeight: '700', textAlign: 'center' })}>
            {ledger.error?.message ?? '가계부를 불러오지 못했어요'}
          </T>
          <Pressable
            testID="ledger-retry"
            accessibilityRole="button"
            accessibilityLabel="다시 시도"
            onPress={ledger.retry}
            style={{
              minHeight: 44,
              paddingHorizontal: 19.4,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1.5,
              borderColor: BROWN,
              borderRadius: 99,
            }}
          >
            <T style={g(14, 22.4, { color: CARD_INK })}>다시 시도</T>
          </Pressable>
        </View>
      ) : null;
    const tableHead = (
      <View
        style={{
          flexDirection: 'row',
          gap: LG.columnGap,
          paddingTop: LG.tableHeadPadding.top,
          paddingBottom: LG.tableHeadPadding.bottom,
          paddingHorizontal: LG.cellPaddingHorizontal,
          borderBottomWidth: LG.headRule,
          borderBottomColor: LG.rule,
        }}
      >
        <T style={lt(LG.tableHead, { minWidth: LG.dateWidth, color: LG.faint })}>날짜</T>
        <T style={lt(LG.tableHead, { flex: 1, color: LG.faint })}>내용</T>
        <T
          style={lt(LG.tableHead, {
            minWidth: LG.amountMinWidth,
            textAlign: 'right',
            color: LG.faint,
          })}
        >
          🐟
        </T>
      </View>
    );
    const empty = (
      <View
        testID="ledger-empty"
        style={{
          alignItems: 'center',
          gap: 5.2,
          paddingVertical: 23.2,
          paddingHorizontal: 12.9,
          borderWidth: 1.9,
          borderStyle: 'dashed',
          borderColor: '#c5ad8a',
          borderRadius: 12.9,
        }}
      >
        <T style={g(16.8, 26.88, { fontWeight: '700', textAlign: 'center' })}>
          {ledger.tab === 'balance'
            ? '아직 쌓인 내역이 없어요'
            : `이 달 ${TAB_LABEL[ledger.tab]} 내역이 없어요`}
        </T>
        <T style={g(15.5, 21.7, { color: MUTED, textAlign: 'center' })}>
          주민이 함께 모으고 쓰면 여기 쌓여요
        </T>
      </View>
    );
    // 잔액 장: 물고기 + 잔액 + 단위, 그 아래 이번 달 적립·사용 한 줄. 적립·지출 장: 그 달 합계 하나
    // 큰 숫자는 줄높이 40 > 크기 34. 긴 금액·큰 글자는 자르지 않고 한 줄에 맞게 줄인다
    const head =
      ledger.tab === 'balance' ? (
        <>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'baseline',
              gap: LG.headGap,
              marginTop: LG.headTop,
            }}
          >
            <Image
              source={art.fish}
              accessible={false}
              style={{ width: LG.fishSize, height: LG.fishSize }}
            />
            <T
              testID="ledger-balance"
              numberOfLines={1}
              adjustsFontSizeToFit
              style={lt(LG.balance, { flexShrink: 1, ...tnum })}
            >
              {ledger.villagePoints === null ? '—' : ledger.villagePoints.toLocaleString('ko-KR')}
            </T>
            <T style={lt(LG.unit, { color: MUTED })}>마리</T>
          </View>
          <T style={lt(LG.caption, { marginTop: LG.summaryTop, color: MUTED })}>
            {`${monthWord} 적립 `}
            <T style={{ color: LG.earn, ...tnum }}>{numberText(ledger.earnedTotal, '+')}</T>
            {` · ${monthWord} 사용 `}
            <T style={{ color: LG.spend, ...tnum }}>{numberText(ledger.spentTotal, '−')}</T>
          </T>
        </>
      ) : (
        <>
          <T style={lt(LG.caption, { marginTop: LG.headTop, color: MUTED })}>
            {`${monthWord} ${ledger.tab === 'earn' ? '적립' : '사용'}`}
          </T>
          <T
            testID="ledger-total"
            numberOfLines={1}
            adjustsFontSizeToFit
            style={lt(LG.balance, { color: ledger.tab === 'earn' ? LG.earn : LG.spend, ...tnum })}
          >
            {ledger.tab === 'earn'
              ? numberText(ledger.earnedTotal, '+')
              : numberText(ledger.spentTotal, '−')}
          </T>
        </>
      );
    // 월 이동 ‹ › — 글자만 보이고 버튼 상자 자체가 44×44 다(hitSlop 은 부모 행·스크롤 경계를 못 넘어 44 가 안 나온다).
    // 화살표는 시안 자리대로 ‹ 는 왼쪽 끝, › 는 오른쪽 끝에 붙이고 세로 가운데. 두 상자 폭이 같아 월 글자는 가운데 그대로
    const nav = (dir: -1 | 1) => {
      const disabled = dir === 1 && !ledger.canNext;
      return (
        <Pressable
          testID={dir < 0 ? 'ledger-prev' : 'ledger-next'}
          accessibilityRole="button"
          accessibilityLabel={dir < 0 ? '이전 달' : '다음 달'}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => (dir < 0 ? ledger.prevMonth() : ledger.nextMonth())}
          style={{
            minWidth: semanticTokens.size.tapMin,
            minHeight: semanticTokens.size.tapMin,
            alignItems: dir < 0 ? 'flex-start' : 'flex-end',
            justifyContent: 'center',
            opacity: disabled ? LG.navDisabledOpacity : 1,
          }}
        >
          <T style={lt(LG.navArrow, { fontWeight: '800', color: LG.faint })}>
            {dir < 0 ? '‹' : '›'}
          </T>
        </Pressable>
      );
    };
    const labels = ['잔액', '적립', '지출'] as const;
    const tabLeft = (n: number) => paper.left + LG.tabLeft + n * (LG.tabSize + LG.tabGap);
    // 포스트잇은 책 위로(좁은 화면은 오른쪽으로도) 나온다. 안드로이드는 부모 상자 밖 터치를 자르므로 바깥 상자를
    // 누르는 자리(hitSlop 포함)까지 위·오른쪽으로 늘리고, 책은 그 안에서 rise 만큼 내려 화면상 자리는 그대로 둔다.
    // rise 는 장과 상관없이 가장 높이 오는 자리(가장 위 단면 또는 펼친 자리) 기준이라 장을 넘겨도 책이 움직이지 않는다
    const rise = Math.max(
      0,
      LG.tabSize * LG.tabArtBottom +
        LG.tabHitSlop -
        Math.min(
          A.bandBottom * sc + LG.tabOpenOverlap,
          ...LG.pageEdges.map((y) => y * sc + LG.tabRestOverlap),
        ),
    );
    const frameW = Math.max(bookW, tabLeft(labels.length - 1) + LG.tabSize + LG.tabHitSlop);
    // 고양이 포스트잇 — 세 장 모두 책 그림 앞. 펼친 장은 아래가 단면 띠 바닥 +4(종이에 붙음), 나머지는 제 색 단면 +6 에 걸친다.
    // 누르면 그 장이 펼쳐진다(넘김 애니메이션 없음)
    const postIt = (label: (typeof labels)[number], n: number) => {
      const on = ledger.tab === TAB_KEY[label];
      const artBottom = on
        ? A.bandBottom * sc + LG.tabOpenOverlap
        : LG.pageEdges[n] * sc + LG.tabRestOverlap;
      return (
        <Pressable
          key={label}
          testID={`ledger-tab-${label}`}
          accessibilityRole="tab"
          accessibilityLabel={label}
          accessibilityState={{ selected: on }}
          hitSlop={LG.tabHitSlop}
          onPress={() => {
            const next = TAB_KEY[label];
            // 거래내역(적립·지출) 장을 실제로 펼치는 순간 1회 — 기본 잔액 요약·같은 장 재탭은 제외
            if (next !== ledger.tab && next !== 'balance')
              captureProductEvent('feature_used', { building: 'ledger', action: 'open' });
            ledger.setTab(next);
          }}
          style={{
            position: 'absolute',
            zIndex: on ? LG.tabOpenZ : LG.tabZ,
            left: tabLeft(n),
            top: rise + artBottom - LG.tabSize * LG.tabArtBottom,
            width: LG.tabSize,
            height: LG.tabSize,
          }}
        >
          <Image source={ledgerArt.tabs[n]} resizeMode="contain" style={fill} />
          <T
            style={lt(LG.tabLabel, {
              position: 'absolute',
              left: 0,
              right: 0,
              top: LG.tabSize * LG.tabLabelTop,
              textAlign: 'center',
              fontWeight: '800',
            })}
          >
            {label}
          </T>
        </Pressable>
      );
    };
    return shell(
      // 바깥 상자 = 책 + 포스트잇 누르는 자리. 빈 부분은 터치를 받지 않는다(box-none)
      <View
        testID="ledger-book"
        pointerEvents="box-none"
        style={[
          {
            position: 'absolute',
            zIndex: 7,
            left: bookLeft + (room - bookW) / 2,
            top: bookTop - rise,
            width: frameW,
            height: bodyH + rise,
          },
          web({ filter: 'drop-shadow(rgba(60, 38, 27, 0.384) 0px 14.2px 15.5px)' }),
        ]}
      >
        {/* 책 몸통은 보이는 높이에서 그림을 자른다. 포스트잇은 몸통 밖 형제라 잘리지 않는다 */}
        <View
          testID="ledger-book-body"
          style={{
            position: 'absolute',
            zIndex: LG.artZ,
            left: 0,
            top: rise,
            width: bookW,
            height: bodyH,
            overflow: 'hidden',
          }}
        >
          <Image
            testID="ledger-book-art"
            source={ledgerArt.book}
            resizeMode="contain"
            style={{
              position: 'absolute',
              zIndex: LG.artZ,
              left: 0,
              top: 0,
              width: bookW,
              height: artH,
            }}
          />
          {/* 펼친 장 종이에 그 장 포스트잇 색을 곱하기로 옅게 덮는다 */}
          <View
            testID="ledger-tint"
            pointerEvents="none"
            style={{
              position: 'absolute',
              zIndex: LG.tintZ,
              left: paper.left,
              right: paper.right,
              top: paper.top,
              height: artH - paper.top - paper.bottom,
              borderRadius: LG.tintRadius,
              backgroundColor: LG.tabColors[labels.findIndex((x) => TAB_KEY[x] === ledger.tab)],
              opacity: LG.tintOpacity,
              mixBlendMode: 'multiply',
            }}
          />
          {/* 종이 안: 낮은 화면·긴 내역은 종이 안에서 스크롤한다. 아래 끝은 그림의 종이 바닥과 보이는 몸통 아래 끝 중
              위쪽(− 여백) — 가로에서 잘린 책이어도 글이 화면 밖으로 숨지 않고 스크롤된다 */}
          <ScrollView
            testID="ledger-page"
            showsVerticalScrollIndicator={false}
            style={{
              position: 'absolute',
              zIndex: LG.contentZ,
              left: paper.left + LG.contentInsetX,
              right: paper.right + LG.contentInsetX,
              top: paper.top + LG.contentInsetY,
              bottom: Math.max(0, bodyH - artH + paper.bottom) + LG.contentInsetY,
            }}
          >
            <View
              testID="ledger-month-row"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: LG.navGap,
                minHeight: semanticTokens.size.tapMin,
              }}
            >
              {nav(-1)}
              <T style={lt(LG.month, { flex: 1, textAlign: 'center', color: LG.faint })}>
                {ledgerYear}년 {ledgerMonth}월
              </T>
              {nav(1)}
            </View>
            {head}
            {/* 조회 실패·로딩·진짜 빈 달은 서로 다른 상태다 — 실패를 빈 내역으로 접지 않는다 */}
            <View style={{ marginTop: LG.tableTop }}>
              {stateBox ??
                (shown.length ? (
                  <>
                    {tableHead}
                    {list}
                    {more}
                    {moreRetry}
                  </>
                ) : (
                  empty
                ))}
            </View>
          </ScrollView>
        </View>
        {labels.map(postIt)}
      </View>,
      e.back,
    );
  }

  // ── 054~061 목각 건물 고르기 · 청사진 ──
  if (r === 'construction') {
    // live 경로는 서버 옵션이 정본이다 — 로컬 buildings·construction·buildingQuest·shop 선행은
    // 모크(review/demo) 경로에서만 쓴다.
    const opts = liveConstruction ? construction.options : null;
    const liveItem = (b: string) => opts?.items.find((it) => it.id === b);
    const status = (b: Building) =>
      liveConstruction
        ? !liveItem(b)
          ? 'done'
          : liveItem(b)?.blockedReason === 'IN_PROGRESS'
            ? 'build'
            : opts?.selectedBuildingId === b
              ? 'collect'
              : liveItem(b) !== undefined && !liveItem(b)!.selectable
                ? 'locked'
                : 'none'
        : i.buildings.includes(b)
          ? 'done'
          : i.construction?.building === b
            ? 'build'
            : b === 'shop' && !shopPrerequisitesMet(i)
              ? 'locked'
              : i.buildingQuest?.building === b
                ? 'collect'
                : 'none';
    // 한 번에 한 건물만 짓는다: 공사 중에는 다른 건물을 고를 수 없어 흐리게
    const dim = (b: Building) => {
      const st = status(b);
      return liveConstruction
        ? st === 'locked' || st === 'build'
        : st === 'locked' || (!!i.construction && st === 'none');
    };
    const gap = land ? 10 : 12.9,
      // 격자 폭 = 패널 폭 − 테두리 2.6×2 − 안쪽 여백 (세로 18.1·16.8, 가로 side+16·16).
      // 테두리를 4 로 빼면 393(iPhone 15)·375(SE)에서 두 카드 + 간격이 실제 안쪽 폭을 넘어 둘째 카드가 다음 줄로 밀렸다(GROMO-2486)
      gridW = land ? W - side - 16 - 5.2 - 32 : W - 36.2 - 5.2 - 33.6,
      // 가로는 격자가 450 이상(카드 약 143)일 때만 3열
      cols = land && gridW >= 450 ? 3 : 2,
      // 내림: 소수 폭이면 iOS 가 둘째 카드를 다음 줄로 넘긴다
      cardW = Math.floor((gridW - gap * (cols - 1)) / cols);
    const pickFrame = (children: React.ReactNode) => (
      <View
        style={{
          position: 'absolute',
          zIndex: 7,
          left: land ? side : 18.1,
          right: land ? 16 : 18.1,
          top: land ? 14 : undefined,
          bottom: land ? 14 : 28.4,
          minHeight: land ? undefined : Math.min(454.5, H - off.top - L.insets.bottom - 56.8),
          maxHeight: H - off.top - L.insets.bottom - (land ? 28 : 56.8),
          paddingTop: land ? 14 : 20.7,
          paddingHorizontal: land ? 16 : 16.8,
          paddingBottom: land ? 14 : 22,
          borderWidth: 2.6,
          borderColor: '#8b6248',
          borderTopLeftRadius: 23.2,
          borderTopRightRadius: 23.2,
          borderBottomLeftRadius: 12.9,
          borderBottomRightRadius: 12.9,
          backgroundColor: '#fff3d8',
          boxShadow:
            'inset 0px 0px 0px 5.2px rgb(238, 212, 170), 0px 10.3px 23.2px rgba(75, 45, 30, 0.4)',
          overflow: 'hidden',
        }}
      >
        <ScrollView
          bounces={false}
          contentContainerStyle={{ paddingBottom: completionStamp.inset }}
        >
          {children}
        </ScrollView>
      </View>
    );
    // 서버 화면의 비정상 상태 — 목업 데이터로 메우지 않는다
    if (liveConstruction && construction.status !== 'ready') {
      return shell(
        pickFrame(
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            {construction.status === 'error' ? (
              <>
                <T
                  testID="hall-construction-error"
                  style={g(16.8, 26.88, { fontWeight: '700', textAlign: 'center' })}
                >
                  {construction.error?.message ?? '건설 정보를 불러오지 못했어요.'}
                </T>
                <Pressable
                  testID="hall-construction-retry"
                  accessibilityRole="button"
                  accessibilityLabel="다시 시도"
                  onPress={() => void construction.retry().catch(() => undefined)}
                  style={{
                    minHeight: 44,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingVertical: 11.6,
                    paddingHorizontal: 19.4,
                    borderWidth: 2.6,
                    borderColor: BROWN,
                    borderRadius: 999,
                    backgroundColor: componentTokens.button.background,
                    boxShadow: `0px 5.2px 0px ${BROWN}`,
                  }}
                >
                  <T style={g(16.8, 21, { fontWeight: '800' })}>다시 시도</T>
                </Pressable>
              </>
            ) : (
              <T
                testID="hall-construction-loading"
                style={g(16.8, 26.88, { fontWeight: '700', textAlign: 'center' })}
              >
                서버에서 건설 정보를 불러오고 있어요
              </T>
            )}
          </View>,
        ),
        e.back,
      );
    }
    // 미완공 옵션의 순서는 유지하고, 완료한 건물도 기존 그리드에서 지우지 않는다.
    // options는 canonical 건물 중 미완공 목록 전체이므로 응답에서 빠진 건물은 완공이다.
    const cards: Building[] = liveConstruction
      ? [...opts!.items.map((it) => it.id as Building), ...grid.filter((b) => !liveItem(b))]
      : [...grid];
    const allDone = cards.every((b) => status(b) === 'done');
    const pick = pickFrame(
      <>
        <View style={{ gap: 1.3, marginBottom: 11.6 }}>
          <T style={g(25.8, 32.25)}>{allDone ? '건설 현황' : '어떤 건물을 지을까요?'}</T>
        </View>
        <View
          testID="hall-bld-grid"
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap,
            // GROMO — 패널을 열고 닫을 때 이 값이 배열↔undefined 로 바뀌면 RN 이 이전 렌더의
            // transform 을 지우려고 null 을 native 로 보내 processTransform 의 _validateTransforms
            // 가 `null.forEach`로 죽는다(패널을 닫을 때 재현). transform 자체는 항상 배열로 두고
            // 값만 바꾼다 — undefined/null 로 만들지 않는다.
            transform: [{ scale: plan ? 0.985 : 1 }],
          }}
        >
          {cards.map((b, idx) => {
            const st = status(b),
              off = dim(b),
              item = liveConstruction ? liveItem(b) : undefined,
              cardName = item?.name ?? buildingNames[b];
            // 흐린 카드도 눌러서 잠금 사유·공사 상태 패널을 본다
            const tappable =
              !(liveConstruction && st === 'done') && (!off || st === 'locked' || st === 'build');
            return (
              <Pressable
                key={b}
                testID={`hall-bld-${b}`}
                accessibilityRole="button"
                accessibilityLabel={`${cardName}${st === 'done' ? ' 완공' : st === 'build' ? ' 공사 중' : ''}`}
                accessibilityState={{ disabled: !tappable }}
                disabled={!tappable}
                onPress={() => setPlan(b)}
                style={{
                  // 마지막 줄에 혼자 남는 카드(2열의 상점)는 한 줄 전체 폭(GROMO-2486 — 2413 의 같은 폭 규칙을 뒤집음).
                  // 3열 가로에서는 5장이 3+2 라 혼자 남지 않는다
                  width: idx === cards.length - 1 && cards.length % cols === 1 ? gridW : cardW,
                  gap: 3.9,
                  minHeight: land ? 100 : 113.6,
                  paddingVertical: 9,
                  paddingHorizontal: 6.5,
                  borderWidth: 2.6,
                  borderColor: BROWN,
                  borderRadius: 16.8,
                  backgroundColor: '#fffdfa',
                  boxShadow: `0px 3.9px 0px ${BROWN}`,
                  opacity: off ? 0.6 : 1,
                }}
              >
                {st === 'build' && (
                  <View
                    style={{
                      alignSelf: 'flex-end',
                      paddingVertical: 1.3,
                      paddingHorizontal: 7.7,
                      borderRadius: 99,
                      backgroundColor: '#ffe1ea',
                    }}
                  >
                    <T
                      style={g(12.9, 20.64, {
                        fontWeight: '800',
                        fontStyle: 'italic',
                        color: '#a33d5c',
                      })}
                    >
                      공사 중
                    </T>
                  </View>
                )}
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6.5 }}>
                  <Image
                    source={art[bldArt[b]]}
                    resizeMode="contain"
                    style={[
                      { width: 69.7, height: 69.7, marginHorizontal: -6.5 },
                      web({ filter: 'drop-shadow(rgba(104, 72, 50, 0.25) 0px 3.9px 2.6px)' }),
                    ]}
                  />
                  <View style={{ flex: 1, minWidth: 0, gap: 2.6 }}>
                    <T style={g(18.1, 23.53, { fontWeight: '800' })}>{cardName}</T>
                    {/* 설명은 두 줄까지 — 좁은 폰(375)에서도 단어가 한 줄에 들도록 라벨 크기(sm 14)로 둔다 */}
                    <T
                      numberOfLines={2}
                      style={g(semanticTokens.typography.label, 19.6, {
                        color: MUTED,
                        ...(land ? web({ wordBreak: 'keep-all' }) : null),
                      })}
                    >
                      {cardDesc[b]}
                    </T>
                  </View>
                </View>
                {/* 완공 도장은 그림·글 위에 겹쳐 찍는다(10/26 오스카) — 흐름에 두면 글이 아래로 밀려 도장 띠가 생긴다 */}
                {st === 'done' && (
                  <Image
                    testID={`hall-completion-stamp-${b}`}
                    source={require('@/assets/ui/construction-complete.png')}
                    accessible={false}
                    resizeMode="contain"
                    fadeDuration={0}
                    style={{
                      // 오른쪽 아래 — 건물 이름은 가리지 않고 설명 위에 비스듬히 찍힌다(10/26 오스카). 살짝 비쳐 밑 글이 읽힌다
                      position: 'absolute',
                      bottom: completionStamp.bottomInset,
                      right: completionStamp.inset,
                      width: completionStamp.width,
                      height: completionStamp.height,
                      opacity: completionStamp.opacity,
                      transform: [{ rotate: completionStamp.rotation }],
                    }}
                  />
                )}
              </Pressable>
            );
          })}
        </View>
      </>,
    );
    let planView = null;
    // live: 옵션 재조회로 계획 중이던 건물이 items 에서 빠지면(완공 등) 패널을 열지 않는다 — 추정 금지
    const planItem = liveConstruction && plan ? liveItem(plan) : undefined;
    if (plan && (!liveConstruction || planItem !== undefined)) {
      const st = status(plan),
        name = liveConstruction ? planItem!.name : buildingNames[plan],
        // 로컬 시연의 몫. 실서버 본문은 아래 residentProgress만 사용한다.
        share = buildingShare(i, plan),
        q = i.buildingQuest;
      const meId = liveConstruction ? getSession()?.userId : undefined;
      const residentProgress =
        opts?.selectedBuildingId === plan && opts.residentProgress?.buildingId === plan
          ? opts.residentProgress
          : null;
      const row = (label: string, value: string) => (
        <View
          key={label}
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            gap: 6.5,
            paddingVertical: 3.9,
            borderTopWidth: 1.3,
            borderStyle: 'dashed',
            borderTopColor: 'rgba(223, 247, 255, 0.667)',
          }}
        >
          <T style={g(15.5, 20.925, { color: '#f7fcff' })}>{label}</T>
          <T style={g(15.5, 20.925, { color: '#f7fcff', fontWeight: '700' })}>{value}</T>
        </View>
      );
      const bar = (pct: number) => (
        <View
          style={{
            height: 8.78,
            paddingVertical: 3.9,
            borderTopWidth: 1.3,
            borderStyle: 'dashed',
            borderTopColor: 'rgba(223, 247, 255, 0.667)',
            borderRadius: 3,
            backgroundColor: '#eadfd2',
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${Math.max(0, Math.min(100, pct))}%`,
              borderRadius: 3,
              backgroundColor: '#ffa6bc',
            }}
          />
        </View>
      );
      // 시안은 블록 여백이 겹쳐(h4 아래 9·몫 칩 아래 7.7) 바로 앞이 줄 칸일 때만 위 여백 7.7이 보인다
      const para = (text: string, afterRow = false) => (
        <View
          style={{
            marginTop: afterRow ? 7.7 : 0,
            paddingTop: 7.7,
            borderTopWidth: 1.3,
            borderStyle: 'dashed',
            borderTopColor: 'rgba(223, 247, 255, 0.667)',
          }}
        >
          <T style={g(15.5, 22.475, { color: '#f7fcff' })}>{text}</T>
        </View>
      );
      const btn = (label: string, onPress: () => void, disabled = false) => (
        <Pressable
          testID="hall-plan-action"
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onPress}
          style={{
            opacity: disabled ? componentTokens.button.disabledOpacity : 1,
            marginTop: 10.3,
            minHeight: 56.8,
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 11.6,
            paddingHorizontal: 19.4,
            borderWidth: 2.6,
            borderColor: BROWN,
            borderRadius: 999,
            backgroundColor: componentTokens.button.background,
            boxShadow: `0px 5.2px 0px ${BROWN}`,
          }}
        >
          <T style={g(16.8, 21, { fontWeight: '800' })}>{label}</T>
        </Pressable>
      );
      // 서버 응답의 startedAt/completesAt 만 표시한다 — 기기 시각으로 완공을 판정하지 않는다.
      // completesAt 경과는 hook 의 재조회 신호일 뿐 완공 표시가 아니다.
      const startedInfo = liveConstruction ? construction.started : null;
      const left = liveConstruction
        ? startedInfo !== null && startedInfo.buildingId === plan
          ? Math.max(0, Date.parse(startedInfo.completesAt) - e.now)
          : 0
        : i.construction
          ? Math.max(0, i.construction.endsAt - e.now)
          : 0;
      const reason = liveConstruction ? null : canSelectBuilding(i, plan);
      const select = () => {
        e.dispatch({ type: 'SELECT_BUILDING', building: plan });
        notify('게시판에 건설 퀘스트가 등록됐어요.');
      };
      // 쓰기 실패는 성공으로 바꾸지 않는다 — 서버 오류 메시지를 그대로 알린다.
      const liveSelect = () => {
        construction.select(plan!).then(
          () => notify(`${eul(name)} 목표로 정했어요.`),
          (error) => notify(error instanceof Error ? error.message : '목표를 정하지 못했어요.'),
        );
      };
      const liveBuild = () => {
        construction.build(plan!).then(
          () => notify(`${eul(name)} 공사를 시작했어요.`),
          (error) => notify(error instanceof Error ? error.message : '건설을 시작하지 못했어요.'),
        );
      };
      const note = (text: string) => (
        <T
          style={g(15.5, 23.25, {
            color: 'rgba(223, 247, 255, 0.7)',
            marginTop: land ? 8 : 12.9,
          })}
        >
          {text}
        </T>
      );
      const shareRow = walletTotal(plan)
        ? row('모으는 법', '섬 통장 합산')
        : row(
            '각자 몫',
            residentProgress
              ? residentProgress.requiredPerResident === null
                ? '대상 주민이 없어요'
                : `${residentProgress.requiredPerResident.toLocaleString('ko-KR')}마리 · ${residentProgress.residents.length}명`
              : opts?.selectedBuildingId === plan
                ? '조회 불가'
                : '목표를 정한 뒤 확인해 주세요',
          );
      // 서버 본문은 서버 모드에서만 계산한다. 데모에는 opts·planItem이 없다.
      const liveCopy = !liveConstruction ? null : st === 'locked' ? (
        para(`${name} — ${blockedText(planItem!.blockedReason)}`)
      ) : st === 'build' ? (
        startedInfo !== null && startedInfo.buildingId === plan && left > 0 ? (
          <>
            {row('공사 중', `남은 시간 ${hm(Math.ceil(left / 60000) * 60)}`)}
            {bar(
              ((e.now - Date.parse(startedInfo.startedAt)) /
                Math.max(
                  1,
                  Date.parse(startedInfo.completesAt) - Date.parse(startedInfo.startedAt),
                )) *
                100,
            )}
          </>
        ) : startedInfo !== null && startedInfo.buildingId === plan ? (
          para('완공 예정 시각이 지났어요. 서버에서 상태를 확인하고 있어요.')
        ) : (
          para('지금 공사가 진행 중이에요.')
        )
      ) : st === 'collect' ? (
        <>
          {row(
            '섬 잔액',
            `${opts!.villagePoints.toLocaleString('ko-KR')} / ${planItem!.cost.toLocaleString('ko-KR')}마리`,
          )}
          {bar((opts!.villagePoints / Math.max(1, planItem!.cost)) * 100)}
          {shareRow}
          {!walletTotal(plan) && residentProgress && (
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 6.5,
                marginVertical: 7.7,
                paddingVertical: 3.9,
                borderTopWidth: 1.3,
                borderStyle: 'dashed',
                borderTopColor: 'rgba(223, 247, 255, 0.667)',
              }}
            >
              {residentProgress.residents.map((m) => (
                <View
                  key={m.userId}
                  style={{
                    paddingVertical: 1.3,
                    paddingHorizontal: 7.7,
                    borderRadius: 99,
                    backgroundColor: 'rgba(255, 255, 255, 0.125)',
                  }}
                >
                  <T style={g(13, 17.55, { color: '#f7fcff' })}>
                    {m.userId === meId ? '나' : (m.name ?? '주민')}
                  </T>
                </View>
              ))}
            </View>
          )}
          {para(planDesc[plan] ?? '')}
        </>
      ) : (
        <>
          {row('총액', `${planItem!.cost.toLocaleString('ko-KR')}마리`)}
          {shareRow}
          {para(planDesc[plan] ?? '', true)}
        </>
      );
      const copy = liveConstruction ? (
        liveCopy
      ) : st === 'locked' ? (
        para(`${name}은 도서관·전망대·우체통·축음기를 모두 완공한 뒤에 목표로 정할 수 있어요.`)
      ) : st === 'done' ? (
        para(planDesc[plan])
      ) : st === 'build' ? (
        <>
          {row('공사 중', `남은 시간 ${hm(Math.ceil(left / 60000) * 60)}`)}
          {bar(
            ((e.now - i.construction!.startedAt) /
              Math.max(1, i.construction!.endsAt - i.construction!.startedAt)) *
              100,
          )}
        </>
      ) : st === 'collect' && q ? (
        <>
          {row(
            '섬 잔액',
            `${balance(i).toLocaleString('ko-KR')} / ${costs[plan].toLocaleString('ko-KR')}마리`,
          )}
          {bar((balance(i) / costs[plan]) * 100)}
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              gap: 6.5,
              marginVertical: 7.7,
              paddingVertical: 3.9,
              borderTopWidth: 1.3,
              borderStyle: 'dashed',
              borderTopColor: 'rgba(223, 247, 255, 0.667)',
            }}
          >
            {q.targets.map((id) => {
              const got = Math.max(0, collectedBy(i, id)),
                done = got >= share,
                who = id === 'me' ? '나' : (i.members.find((m) => m.id === id)?.name ?? '');
              return (
                <View
                  key={id}
                  style={{
                    paddingVertical: 1.3,
                    paddingHorizontal: 7.7,
                    borderRadius: 99,
                    backgroundColor: done ? '#bff5d0' : 'rgba(255, 255, 255, 0.125)',
                  }}
                >
                  <T
                    style={g(13, 17.55, {
                      color: done ? '#1f5c34' : '#f7fcff',
                      fontWeight: done ? '800' : '400',
                    })}
                  >
                    {who} {done ? `${share}✓` : `${got}/${share}`}
                  </T>
                </View>
              );
            })}
          </View>
          {para(planDesc[plan])}
        </>
      ) : (
        <>
          {row('총액', `${costs[plan].toLocaleString('ko-KR')}마리`)}
          {row('각자 몫', `${share}마리 · ${residentCount(i)}명`)}
          {row('공사 시간', hm(buildMinutes[plan] * 60))}
          {para(planDesc[plan], true)}
        </>
      );
      planView = (
        <View
          testID="hall-building-plan"
          style={[
            {
              position: 'absolute',
              zIndex: 8,
              left: land ? side + 16 : 10.3,
              right: land ? 32 : 10.3,
              top: land ? 36 : 276,
              height: land ? 330 : 356.4,
              padding: 15.5,
              borderWidth: 2.6,
              borderColor: '#d9f3f7',
              borderRadius: 15.5,
              backgroundColor: 'rgba(79, 148, 177, 0.97)',
              boxShadow:
                'inset 0px 0px 0px 5.2px rgb(74, 137, 159), 0px 15.5px 33.6px rgba(39, 60, 70, 0.66)',
            },
            web({
              backgroundImage:
                'linear-gradient(rgba(223, 247, 255, 0.14) 1.3px, transparent 1.3px), linear-gradient(90deg, rgba(223, 247, 255, 0.14) 1.3px, transparent 1.3px), linear-gradient(rgba(223, 247, 255, 0.07) 1.3px, transparent 1.3px), linear-gradient(90deg, rgba(223, 247, 255, 0.07) 1.3px, transparent 1.3px)',
              backgroundSize: '41.3px 41.3px, 41.3px 41.3px, 10.3px 10.3px, 10.3px 10.3px',
            }),
          ]}
        >
          {st === 'collect' && !liveConstruction && (
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'flex-end',
                alignItems: 'center',
                marginBottom: 12.9,
              }}
            >
              <Pressable
                testID="hall-plan-quest"
                accessibilityRole="link"
                accessibilityLabel="게시판에서 건설 퀘스트 보기"
                hitSlop={8}
                onPress={() => e.go('quest', 'building')}
              >
                <T style={g(13, 24.8, { color: '#e8faff', textDecorationLine: 'underline' })}>
                  게시판에서 보기 ›
                </T>
              </Pressable>
            </View>
          )}
          <View style={{ flex: 1, minHeight: 0, flexDirection: 'row', gap: 12.9 }}>
            <View
              style={{
                width: '36%',
                alignItems: 'center',
                paddingTop: 6.5,
                paddingHorizontal: 6.5,
                paddingBottom: 5.2,
                borderWidth: 1.3,
                borderColor: 'rgba(223, 247, 255, 0.667)',
                backgroundColor: 'rgba(234, 248, 251, 0.098)',
                overflow: 'hidden',
                opacity: st === 'locked' ? 0.45 : 1,
              }}
            >
              <View
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: 7.7,
                  bottom: 7.7,
                  width: 1.3,
                  backgroundColor: 'rgba(223, 247, 255, 0.333)',
                }}
              />
              <View
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: 7.7,
                  right: 7.7,
                  height: 1.3,
                  backgroundColor: 'rgba(223, 247, 255, 0.333)',
                }}
              />
              <T
                style={{
                  position: 'absolute',
                  right: 6.5,
                  top: 3.9,
                  fontSize: 14.2,
                  lineHeight: 22.72,
                  color: 'rgba(223, 247, 255, 0.667)',
                }}
              >
                ＋
              </T>
              {/* 시안 격자처럼 그림이 칸보다 넓으면 그림 폭 기준으로 가운데를 잡는다 */}
              <View
                style={{ flex: 1, minWidth: '100%', alignSelf: 'flex-start', alignItems: 'center' }}
              >
                <View style={{ flex: 1, justifyContent: 'center' }}>
                  <Image
                    source={art[bldArt[plan]]}
                    resizeMode="contain"
                    style={[
                      { width: land ? 110 : 134.3, height: land ? 110 : 134.3 },
                      web({ filter: 'drop-shadow(rgba(36, 76, 92, 0.5) 0px 5.2px 2.6px)' }),
                    ]}
                  />
                </View>
                <View
                  style={{
                    paddingVertical: 1.3,
                    paddingHorizontal: 6.5,
                    borderWidth: 1.3,
                    borderColor: 'rgba(223, 247, 255, 0.667)',
                    borderRadius: 99,
                    backgroundColor: '#4f94b1',
                  }}
                >
                  <T style={g(14.2, 22.72, { color: '#fff' })}>예상 모습</T>
                </View>
              </View>
            </View>
            <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
              <T style={g(28.4, 31.24, { color: '#f7fcff', marginBottom: 9 })}>{name}</T>
              {copy}
            </View>
          </View>
          {liveConstruction ? (
            <>
              {st === 'none' &&
                (planItem!.selectable
                  ? btn('이 건물을 목표로 정하기', () =>
                      opts!.selectedBuildingId !== null && opts!.selectedBuildingId !== plan
                        ? setDialog({
                            title: '목표를 바꿀까요?',
                            text: `지금 목표인 ${opts!.items.find((it) => it.id === opts!.selectedBuildingId)?.name ?? opts!.selectedBuildingId} 대신 ${eul(name)} 목표로 정해요.\n대상 주민은 지금 주민으로 다시 정해요.`,
                            ok: '바꾸기',
                            onOk: liveSelect,
                          })
                        : liveSelect(),
                    )
                  : // 서버가 막은 사유 그대로 안내한다 — 권한·중복·선행 조건은 서버 판정
                    note(blockedText(planItem!.blockedReason)))}
              {st === 'collect' && (
                <>
                  {btn('건설하기', liveBuild, !planItem!.buildable)}
                  {!planItem!.buildable && note(buildBlockedText(planItem!.blockedReason))}
                </>
              )}
            </>
          ) : (
            <>
              {st === 'done' && btn(`${ro(name)} 가기`, () => e.go(bldRoute[plan]))}
              {st === 'none' &&
                (host && !reason
                  ? btn('이 건물을 목표로 정하기', () =>
                      q
                        ? setDialog({
                            title: '목표를 바꿀까요?',
                            text: `지금 목표인 ${buildingNames[q.building]} 대신 ${eul(name)} 목표로 정해요.\n대상 주민은 지금 주민으로 다시 정해요.`,
                            ok: '바꾸기',
                            onOk: select,
                          })
                        : select(),
                    )
                  : // 주민은 섬장 안내, 섬장은 게시판 완공 전·공사 중 같은 이유 안내
                    note(host ? reason! : '섬장이 목표를 정해요'))}
            </>
          )}
        </View>
      );
    }
    return shell(
      <>
        {pick}
        {planView}
      </>,
      plan ? () => setPlan(null) : e.back,
      plan ? '건물 목록으로 돌아가기' : undefined,
    );
  }

  const managementFrame = (children: React.ReactNode) => (
    <View
      style={{
        position: 'absolute',
        zIndex: 10,
        left: land ? side : 18,
        right: land ? 16 : 18,
        top: land ? 10 : 80,
        bottom: land ? 10 : 45,
        borderWidth: 2.6,
        borderColor: '#806449',
        borderRadius: 18,
        backgroundColor: '#fff3d8',
      }}
    >
      {children}
    </View>
  );
  // 관리 표면은 server snapshot을 받기 전 로컬 Island를 대체 화면으로 쓰지 않는다.
  if (liveManagement) {
    // 서버 섬 id 가 오기 전(GROMO-2460)에도 같은 로딩 화면 — 빈 카드·초대·탈퇴를 그리지 않는다
    if (!liveIslandId || (management.loading && !management.detail)) {
      return shell(
        managementFrame(
          <View
            testID="hall-management-loading"
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          >
            <T style={g(16, 25.6, { color: MUTED, fontWeight: '700' })}>
              섬 정보를 불러오는 중이에요
            </T>
          </View>,
        ),
        e.back,
      );
    }
    if (management.error) {
      return shell(
        managementFrame(
          <View
            testID="hall-management-error"
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              paddingHorizontal: 20,
            }}
          >
            <T style={g(16, 25.6, { color: MUTED, fontWeight: '700', textAlign: 'center' })}>
              {managementErrorMessage(management.error)}
            </T>
            <Pressable
              testID="hall-management-retry"
              accessibilityRole="button"
              accessibilityLabel="다시 시도"
              onPress={() => void management.reload().catch(() => undefined)}
            >
              <T style={g(14, 22.4, { color: CARD_INK, textDecorationLine: 'underline' })}>
                다시 시도
              </T>
            </Pressable>
          </View>,
        ),
        e.back,
      );
    }
    if (management.accessLost) {
      return shell(
        managementFrame(
          <View
            testID="hall-management-forbidden"
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              paddingHorizontal: 20,
            }}
          >
            <T style={g(16, 25.6, { color: MUTED, fontWeight: '700', textAlign: 'center' })}>
              섬 주민만 관리할 수 있어요
            </T>
            <Pressable
              testID="hall-management-retry"
              accessibilityRole="button"
              accessibilityLabel="다시 시도"
              onPress={() => void management.reload().catch(() => undefined)}
            >
              <T style={g(14, 22.4, { color: CARD_INK, textDecorationLine: 'underline' })}>
                다시 시도
              </T>
            </Pressable>
          </View>,
        ),
        e.back,
      );
    }
  }

  // ── 043~051 섬 정보 카드 · 수정 · 방장 위임 · 탈퇴 ──
  const next = s.islands.find((j) => j.joined && j.id !== i.id);
  const leave = () => {
    if (s.session) {
      notify('집중 중에는 섬을 떠날 수 없어요.\n집중을 마친 뒤 다시 시도해 주세요.');
      return;
    }
    if (
      (liveManagement ? managementHost : host) &&
      (liveManagement ? (management.members?.length ?? 0) > 1 : i.members.length > 0)
    ) {
      notify('섬장은 바로 섬을 나갈 수 없어요.\n섬장을 위임한 뒤 나가주세요.');
      setPanel('transfer');
      return;
    }
    if (liveManagement) {
      // 서버 모드(4-06): 확인창은 서버 섬 이름·주민 수로, 탈퇴는 서버 명령으로 보낸다.
      // 탈퇴 뒤 어느 섬이 current 가 될지는 서버 재조회가 정한다 — 이동 목적지를 약속하지 않는다.
      const liveSolo = (management.members?.length ?? 0) <= 1;
      const islandName = management.detail?.name ?? '';
      setDialog({
        title: `${eul(islandName)} 떠날까요?`,
        text: t(liveSolo ? 'hall.leave.soloText' : 'hall.leave.memberText'),
        detail: t('hall.leave.detail'),
        ok: liveSolo ? '삭제하고 나가기' : '탈퇴하기',
        danger: true,
        onOk: () =>
          void runManagement(async () => {
            const my = await e.islands.leave(liveIslandId);
            // 재조회한 current 가 응답보다 최신이라 먼저 본다 — 다른 섬이 current 면 홈. current 가 비고 서버가
            // 먼바다라고 했으면 바다로(GROMO-2366), 다음 위치를 모르면(구 응답) App 이 보낸다.
            if (my.currentIslandId) e.home();
            else if (my.nextLocation?.islandId === null) e.reset('sea');
          }, '섬을 떠났어요.'),
      });
      return;
    }
    const solo = !i.members.length;
    setDialog({
      title: `${eul(i.name)} 떠날까요?`,
      // 서버 경로와 같은 문구 — 행선지(다른 소속 섬·바다)는 약속하지 않는다.
      text: t(solo ? 'hall.leave.soloText' : 'hall.leave.memberText'),
      detail: t('hall.leave.detail'),
      ok: solo ? (next ? '삭제하고 탈퇴' : '삭제하고 나가기') : '탈퇴하기',
      danger: true,
      onOk: () => {
        e.dispatch({ type: 'LEAVE' });
        if (next) e.home();
        else e.reset('sea');
      },
    });
  };
  const close = (onPress: () => void, style?: object) => (
    <NavBtn close testID="hall-close" label="닫기" onPress={onPress} style={style} />
  );
  const person = (
    m: { id: string; name: string; color: string; outfit?: Outfit },
    n: number,
    opts: any = {},
  ) => (
    <View
      key={m.id}
      // 방장 칸은 보조기기가 이름 뒤에 '방장'까지 읽는다
      accessible={opts.crown || undefined}
      accessibilityLabel={opts.crown ? `${m.id === 'me' ? '나' : m.name}, 섬장` : undefined}
      style={[
        {
          minWidth: 0,
          minHeight: land ? 45 : 54,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingVertical: land ? 4 : 6,
          paddingHorizontal: land ? 6 : 9,
          borderWidth: 1,
          borderColor: '#d5bea0',
          borderRadius: 10,
          backgroundColor: '#fffaf0',
        },
        opts.style,
      ]}
    >
      <View pointerEvents="none">
        <Avatar
          userId={m.id}
          color={m.color}
          outfit={m.outfit}
          n={n}
          size={opts.av ?? (land ? 31 : 38)}
        />
        {/* 섬장 왕관: 아바타 지름의 절반 크기로 테두리 1시 방향에 걸치고 시계 방향으로 18° 기울인다.
            Avatar는 원 밖을 잘라 내므로(overflow hidden) 바깥 형제로 겹친다 */}
        {opts.crown && (
          <Image
            source={art['ui/crown']}
            resizeMode="contain"
            style={{
              position: 'absolute',
              top: '-18%',
              right: 0,
              width: '50%',
              height: '50%',
              transform: [{ rotate: '18deg' }],
            }}
          />
        )}
      </View>
      <T
        numberOfLines={1}
        style={g(opts.size ?? 15, opts.size ? 25.6 : 24, {
          color: CARD_INK,
          fontWeight: '700',
          flexShrink: 1,
          ...(opts.grow ? { flex: 1 } : null),
        })}
      >
        {m.id === 'me' ? '나' : m.name}
      </T>
      {opts.tail}
    </View>
  );
  const frame = (children: React.ReactNode, style?: object, testID?: string) => (
    <View
      testID={testID}
      style={[
        {
          position: 'absolute',
          zIndex: 10,
          left: land ? side : 18,
          right: land ? 16 : 18,
          top: land ? 10 : 80,
          bottom: land ? 10 : 45,
          borderWidth: 2.6,
          borderColor: '#806449',
          borderRadius: 18,
          backgroundColor: '#fff3d8',
          boxShadow:
            'inset 0px 0px 0px 5px rgb(234, 214, 177), 0px 15px 34px rgba(59, 44, 35, 0.5)',
          overflow: 'hidden',
        },
        web({
          backgroundImage: 'linear-gradient(90deg, rgba(234, 214, 177, 0.15), transparent 12%)',
        }),
        style,
      ]}
    >
      {children}
    </View>
  );
  const leaveBtn = (style?: object) => (
    <Pressable
      testID="hall-leave"
      accessibilityRole="button"
      accessibilityLabel="섬 탈퇴"
      onPress={leave}
      style={[
        {
          minHeight: 44,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 18,
          paddingTop: 13,
          borderTopWidth: 1,
          borderTopColor: '#d7bea0',
        },
        style,
      ]}
    >
      <T style={g(15, 24, { color: '#a3453e', fontWeight: '700' })}>섬 탈퇴</T>
    </Pressable>
  );
  // 방문자는 이 섬 주민이 아니므로 '나'를 앞에 붙이지 않는다
  const visitorMembers =
    visitor && s.serverIslands?.visit?.island.id === i.id
      ? s.serverIslands.visit.members.items
      : null;
  const residents =
    liveManagement || visitorMembers
      ? (visitorMembers ?? management.members ?? []).map((m) => ({
          id: m.id,
          name: m.name ?? '주민',
          color: m.catColor ?? NO_CAT_COLOR,
          outfit: appearanceOutfit(m.appearance),
          isHost: m.role === 'host',
        }))
      : [
          ...(visitor
            ? []
            : [{ id: 'me', name: '나', color: s.color, outfit: outfitOf(s), isHost: host }]),
          ...i.members.map((m) => ({
            id: m.id,
            name: m.name,
            color: m.color,
            isHost: m.role === 'host',
          })),
        ];
  const hostId = residents.find((m) => m.isHost)?.id;
  const transferDialog = (m: { id: string; name: string }) => ({
    title: '섬장 위임',
    text: `${m.name}에게 섬장을 위임하시겠습니까?`,
    ok: '위임하기',
    onOk: () => {
      if (liveManagement) {
        void runManagement(
          () => management.transferHost(m.id),
          `${m.name}에게 섬장을 위임했어요.`,
          () => setPanel(''),
        );
      } else {
        e.dispatch({ type: 'TRANSFER', id: m.id });
        setPanel('');
        notify(`${m.name}에게 섬장을 위임했어요.`);
      }
    },
  });
  // 방장이 주민 칸을 누르면: 방장 위임 / 섬에서 내보내기(강퇴) 선택창 → 내보내기는 빨간 확인창
  const memberMenu = (m: { id: string; name: string }) => {
    const option = (label: string, testID: string, onPress: () => void, danger = false) => (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={{
          minHeight: 44,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1.5,
          borderColor: BROWN,
          borderRadius: 99,
          backgroundColor: danger ? '#e9a49d' : '#fffaf0',
        }}
      >
        <T style={g(14, 22.4, { color: danger ? '#6f2d2a' : CARD_INK, fontWeight: '700' })}>
          {label}
        </T>
      </Pressable>
    );
    setDialog({
      title: m.name,
      text: '',
      body: (
        <View style={{ gap: 8 }}>
          {option('섬장 위임', 'hall-member-transfer', () => setDialog(transferDialog(m)))}
          {option(
            '섬에서 내보내기',
            'hall-member-kick',
            () =>
              setDialog({
                title: '섬에서 내보낼까요?',
                text: `${eul(m.name)} 섬에서 내보내요.\n모은 물고기와 기록은 섬에 남고, 건설 목표 대상에서 빠져요.`,
                ok: '내보내기',
                danger: true,
                onOk: () => {
                  if (liveManagement)
                    void runManagement(
                      () => management.kickMember(m.id),
                      `${m.name}님을 섬에서 내보냈어요.`,
                    );
                  else {
                    e.dispatch({ type: 'KICK', id: m.id });
                    notify(`${m.name}님을 섬에서 내보냈어요.`);
                  }
                },
              }),
            true,
          )}
        </View>
      ),
    });
  };

  if (panel === 'transfer') {
    return shell(
      frame(
        <ScrollView
          contentContainerStyle={{
            paddingVertical: land ? 12 : 17,
            paddingHorizontal: land ? 16 : 18,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 10,
              marginBottom: land ? 7 : 13,
            }}
          >
            <View>
              <T style={g(22, 35.2, { color: CARD_INK, fontWeight: '600' })}>섬장 위임</T>
              <T style={g(14, 22.4, { color: '#6d5b4a', marginTop: 4 })}>
                섬장을 위임할 주민을 골라요.
              </T>
            </View>
            {close(() => setPanel('edit'), { marginTop: -9, marginRight: -8 })}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 7, columnGap: 10 }}>
            {transferCandidates.map((m, n) => (
              <Pressable
                key={m.id}
                testID={`hall-transfer-${m.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${m.name}에게 섬장 위임`}
                onPress={() => setDialog(transferDialog({ id: m.id, name: m.name }))}
                // 가로 2열: 목록 폭 = 화면 − 왼쪽 side − 오른쪽 16 − 테두리 4 − 안쪽 여백 32
                style={{ width: land ? (W - side - 52 - 10) / 2 : '100%' }}
              >
                {person(m, n, {
                  size: 16,
                  grow: true,
                  style: {
                    minHeight: land ? 47 : 59,
                    paddingVertical: land ? 4 : 8,
                    paddingHorizontal: land ? 8 : 10,
                  },
                  tail: (
                    <View
                      style={{
                        width: 28,
                        height: 44,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Icon d={CHEV} size={18} />
                    </View>
                  ),
                })}
              </Pressable>
            ))}
          </View>
        </ScrollView>,
        { top: land ? 10 : 70, bottom: land ? 10 : 44 },
      ),
    );
  }

  if (panel === 'edit') {
    const setting = (
      title: string,
      sub: string,
      tail: React.ReactNode,
      opts: {
        onPress?: () => void;
        disabled?: boolean;
        testID?: string;
        style?: object;
        checked?: boolean;
      } = {},
    ) => (
      <Pressable
        testID={opts.testID}
        accessibilityRole={opts.checked === undefined ? 'button' : 'switch'}
        accessibilityLabel={title}
        accessibilityState={{ disabled: opts.disabled, checked: opts.checked }}
        disabled={opts.disabled || !opts.onPress}
        onPress={opts.onPress}
        style={[
          {
            minHeight: land ? 50 : 58,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingVertical: land ? 4 : 8,
            paddingHorizontal: 1,
            borderBottomWidth: 1,
            borderStyle: 'dashed',
            borderBottomColor: '#cdb58e',
            opacity: opts.disabled ? 0.4 : 1,
          },
          opts.style,
        ]}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <T style={g(16, 25.6, { color: CARD_INK, fontWeight: '700' })}>{title}</T>
          <T style={g(13, 17.55, { color: '#6d5b4a' })}>{sub}</T>
        </View>
        {tail}
      </Pressable>
    );
    const input = (label: string, key: 'name' | 'intro' | 'greeting') => (
      <View style={{ gap: 5 }}>
        <T style={g(13, 20.8, { color: '#6d5b4a', fontWeight: '700' })}>{label}</T>
        <TextInput
          testID={`hall-${key}`}
          accessibilityLabel={label}
          value={draft[key]}
          // 인사말은 코드포인트 40 — TextInput maxLength 는 UTF-16 이라 🐟 가 2로 세어 여기서 자른다
          onChangeText={(v) =>
            setDraft((d) => ({
              ...d,
              [key]: key === 'greeting' ? clampCodePoints(v, ISLAND_GREETING_MAX) : v,
            }))
          }
          multiline={key === 'intro'}
          maxLength={
            key === 'name' ? ISLAND_NAME_MAX : key === 'intro' ? ISLAND_INTRO_MAX : undefined
          }
          placeholder={key === 'greeting' ? t('hall.greetingPlaceholder') : undefined}
          placeholderTextColor={componentTokens.input.placeholder}
          style={{
            // 이름·인사말 한 줄 칸은 가로에서도 실제 터치 높이 44 — 접근성 최소 터치 영역(DESIGN.md)
            height: key === 'intro' ? (land ? 57 : 62) : 44,
            paddingVertical: land ? 7 : 10,
            paddingHorizontal: land ? 9 : 11,
            borderWidth: 1.5,
            borderColor: '#b9a081',
            borderRadius: 9,
            backgroundColor: '#fffaf0',
            fontFamily: font,
            fontSize: land ? 14 : 16,
            lineHeight: land ? 18.9 : 21.6,
            letterSpacing: -0.15,
            color: CARD_INK,
            textAlignVertical: 'top',
          }}
        />
        <CharCount
          value={draft[key]}
          max={
            key === 'name'
              ? ISLAND_NAME_MAX
              : key === 'intro'
                ? ISLAND_INTRO_MAX
                : ISLAND_GREETING_MAX
          }
          codePoints={key === 'greeting'}
        />
      </View>
    );
    const approval = setting(
      '가입 승인',
      '섬장이 확인한 후 주민이 돼요.',
      <View
        style={{
          width: 50,
          height: 29,
          borderWidth: 1.5,
          borderColor: draft.approval ? '#4d897a' : '#b9a081',
          borderRadius: 99,
          backgroundColor: draft.approval ? '#4eb29c' : '#e6d8c2',
        }}
      >
        <View
          style={{
            position: 'absolute',
            top: 3,
            [draft.approval ? 'right' : 'left']: 3,
            width: 20,
            height: 20,
            borderRadius: 10,
            backgroundColor: '#fff',
            boxShadow: '0px 1px 3px rgba(54, 89, 79, 0.4)',
          }}
        />
      </View>,
      {
        testID: 'hall-approval',
        checked: draft.approval,
        onPress: () => setDraft((d) => ({ ...d, approval: !d.approval })),
        style: land ? { flex: 1 } : undefined,
      },
    );
    const capacity = setting(
      '주민 정원',
      `현재 ${liveManagement ? (management.members?.length ?? 0) : residentCount(i)}명 · 최대 ${CAPACITY_MAX}명`,
      <T style={g(15, 24, { color: CARD_INK, fontWeight: '700' })}>
        {t('onboarding.createIsland.capacityUnit', { count: draft.capacity })}
      </T>,
      {
        testID: 'hall-capacity',
        onPress: () => {
          const min = Math.max(
            CAPACITY_MIN,
            liveManagement ? (management.members?.length ?? CAPACITY_MIN) : residentCount(i),
          );
          let picked: number = draft.capacity;
          // 라벨은 숫자에서 만든다 — 고른 값은 숫자로만 든다(로케일을 바꿔도 저장값 유지)
          const items = Array.from({ length: CAPACITY_MAX - min + 1 }, (_, n) =>
            t('onboarding.createIsland.capacityUnit', { count: n + min }),
          );
          setDialog({
            title: '주민 정원',
            text: '현재 주민 수보다 작게 줄일 수는 없어요.',
            body: (
              <View style={{ height: 132 }}>
                <Wheel
                  label=""
                  a11yLabel="주민 정원"
                  items={items}
                  value={items[picked - min]}
                  onChange={(v: string) => (picked = items.indexOf(v) + min)}
                />
              </View>
            ),
            ok: '정하기',
            onOk: () => setDraft((d) => ({ ...d, capacity: picked })),
          });
        },
      },
    );
    const transfer = setting(
      '섬장 위임',
      transferCandidates.length ? '다른 주민에게 섬장을 넘겨요.' : '위임할 주민이 없어요.',
      <View style={{ width: 28, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Icon d={CHEV} size={18} />
      </View>,
      {
        testID: 'hall-transfer',
        disabled: !transferCandidates.length,
        onPress: () => setPanel('transfer'),
      },
    );
    const save = (
      <Pressable
        testID="hall-save"
        accessibilityRole="button"
        accessibilityLabel="저장하기"
        accessibilityState={{ disabled: !draft.name.trim() }}
        disabled={!draft.name.trim()}
        onPress={() => {
          if (liveManagement)
            void runManagement(
              () =>
                management.saveSettings({
                  name: draft.name.trim(),
                  intro: draft.intro,
                  approvalRequired: draft.approval,
                  maxMembers: draft.capacity,
                  // 인사말은 바꾼 때만 싣는다 — 안 바꾼 저장이 구서버(모르는 키 400)·게스트(403)에 걸리지 않게.
                  // 앞뒤 공백만 다른 것은 안 바꾼 것이다(서버에 보내는 값도 앞뒤를 뗀 글이다).
                  // 빈 값은 기본 문구로 되돌리는 값이라 그대로 보낸다
                  ...(draft.greeting.trim() !== ownGreeting(management.detail).trim() && {
                    greeting: draft.greeting.trim(),
                  }),
                }),
              '섬 정보를 저장했어요.',
              () => setPanel(''),
              'settings',
            );
          else {
            e.dispatch({
              type: 'MANAGE',
              name: draft.name,
              intro: draft.intro,
              approval: draft.approval,
            });
            if (draft.capacity !== capacityOf(i))
              e.dispatch({ type: 'CAPACITY', value: draft.capacity });
            setPanel('');
          }
        }}
        style={{
          minHeight: land ? 43 : 48,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: land ? 7 : 14,
          borderWidth: 2,
          borderColor: BROWN,
          borderRadius: 99,
          backgroundColor: componentTokens.button.background,
          boxShadow: `0px 3px 0px ${BROWN}`,
          opacity: draft.name.trim() ? 1 : 0.5,
        }}
      >
        <T style={g(16, 25.6, { color: CARD_INK, fontWeight: '800' })}>저장하기</T>
      </Pressable>
    );
    const header = (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 10,
          marginBottom: land ? 6 : 13,
        }}
      >
        <T style={g(22, 35.2, { color: CARD_INK, fontWeight: '600' })}>섬 정보 수정</T>
        {close(() => setPanel(''), { marginTop: -9, marginRight: -8 })}
      </View>
    );
    const fields = (
      <View style={{ gap: land ? 7 : 10 }}>
        {input('섬 이름', 'name')}
        {input('섬 소개', 'intro')}
        {/* 인사말은 서버 모드(실제 섬)에서만 — 목업 로컬 섬에는 필드가 없다 */}
        {liveManagement && input(t('hall.greeting'), 'greeting')}
      </View>
    );
    return shell(
      frame(
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingVertical: land ? 12 : 17,
            paddingHorizontal: land ? 16 : 18,
          }}
        >
          {header}
          {land ? (
            // 가로: 시안 격자처럼 왼쪽(이름·소개·정원·위임·저장) | 오른쪽(가입 승인·탈퇴)
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <View style={{ flex: 1 }}>
                {fields}
                {capacity}
                {transfer}
                {save}
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ height: 154.59 }}>{approval}</View>
                {leaveBtn({
                  minHeight: 43,
                  height: 47.11,
                  marginTop: 7,
                  paddingTop: 0,
                  borderWidth: 1,
                  borderColor: '#d7bea0',
                  borderRadius: 99,
                })}
              </View>
            </View>
          ) : (
            <>
              {fields}
              {approval}
              {capacity}
              {transfer}
              {save}
              {leaveBtn()}
            </>
          )}
        </ScrollView>,
        { top: land ? 10 : 70, bottom: land ? 10 : 44 },
      ),
    );
  }

  // 043 방장 기본 뷰 / 045 주민 뷰 / 45V 방문자 뷰(수정·가입 신청·주민 관리·초대·탈퇴 없이 가입 버튼 하나)
  const requests = liveManagement
    ? managementHost
      ? (management.requests ?? [])
      : []
    : host
      ? joinRequests(i)
      : [];
  const section = (title: string, children: React.ReactNode, right?: string) => (
    <View
      style={{
        paddingTop: land ? 7 : 11,
        paddingBottom: land ? 9 : 14,
        borderBottomWidth: 1,
        borderStyle: 'dashed',
        borderBottomColor: '#cdb58e',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 9,
        }}
      >
        <T style={g(17, 27.2, { color: CARD_INK, fontWeight: '700' })}>{title}</T>
        {!!right && <T style={g(15, 24, { color: MUTED })}>{right}</T>}
      </View>
      {children}
    </View>
  );
  const head = (
    <View
      style={
        land
          ? {
              width: 240,
              paddingVertical: 24,
              paddingHorizontal: 16,
              borderRightWidth: 1,
              borderRightColor: '#d3bc98',
            }
          : {
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: 10,
              paddingTop: 22,
              paddingHorizontal: 20,
              paddingBottom: 15,
              borderBottomWidth: 1,
              borderBottomColor: '#d3bc98',
            }
      }
    >
      <View style={{ minWidth: 0, flexShrink: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <T style={g(land ? 32 : 38, land ? 34.56 : 41.04, { color: CARD_INK, flexShrink: 1 })}>
            {liveManagement ? management.detail?.name : i.name}
          </T>
          {displayHost && (
            <Pressable
              testID="hall-edit"
              accessibilityRole="button"
              accessibilityLabel="섬 정보 수정"
              onPress={() => {
                setDraft({
                  name: liveManagement ? (management.detail?.name ?? '') : i.name,
                  intro: liveManagement ? (management.detail?.intro ?? '') : i.intro,
                  approval: liveManagement
                    ? (management.detail?.approvalRequired ?? false)
                    : i.approval,
                  capacity: liveManagement
                    ? (management.detail?.maxMembers ?? CAPACITY_MIN)
                    : capacityOf(i),
                  greeting: liveManagement ? ownGreeting(management.detail) : '',
                });
                setPanel('edit');
              }}
              style={{
                width: 44,
                height: 44,
                marginTop: -1,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon d={PENCIL} size={22} />
            </Pressable>
          )}
        </View>
        {!!(liveManagement ? management.detail?.intro : i.intro) && (
          <T
            style={g(land ? 14 : 15, land ? 20.3 : 21.75, {
              color: MUTED,
              marginTop: 7,
              maxWidth: 275,
              ...web({ wordBreak: 'keep-all' }),
            })}
          >
            {liveManagement ? management.detail?.intro : i.intro}
          </T>
        )}
      </View>
      {close(e.back, land ? { position: 'absolute', right: 8, top: 7 } : undefined)}
    </View>
  );
  // 주민 칸 폭: 카드 안쪽 폭(세로 W−80, 가로 W−side−16−4−240−28)을 열 수로 나눈다.
  // 세로는 한 줄에 한 명(2열은 빈 칸이 생겨 어색 — 오스카 결정), 가로는 넓으면 4열, 좁으면 2열
  const inner = land ? W - side - 288 : W - 80,
    cols = land ? (inner >= 280 ? 4 : 2) : 1,
    cell = Math.floor((inner - (cols - 1) * 7) / cols);
  const body = (
    <ScrollView
      style={{ flex: 1, minHeight: 0 }}
      contentContainerStyle={{
        paddingTop: land ? 10 : 13,
        paddingHorizontal: land ? 14 : 20,
        paddingBottom: land ? 10 : 20,
      }}
    >
      {requests.length > 0 &&
        section(
          '가입 신청',
          requests.map((q, n) => (
            <View
              key={q.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
                minHeight: land ? 48 : 56,
                paddingVertical: 5,
                borderTopWidth: 1,
                borderTopColor: '#e2d2b7',
              }}
            >
              {person(
                {
                  ...q,
                  name: q.name ?? '신청자',
                  // 서버 모드는 신청자 본인의 색, 목업은 로컬 신청 데이터의 색
                  color: liveManagement
                    ? ((q as { catColor?: string | null }).catColor ?? NO_CAT_COLOR)
                    : ((q as { color?: string }).color ?? s.color),
                  outfit: liveManagement
                    ? appearanceOutfit((q as { appearance?: unknown }).appearance)
                    : undefined,
                },
                n,
                {
                  size: 16,
                  style: {
                    flex: 1,
                    borderWidth: 0,
                    paddingVertical: land ? 4 : 0,
                    paddingHorizontal: land ? 6 : 0,
                  },
                },
              )}
              <Pressable
                testID={`hall-reject-${q.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${q.name ?? '신청자'} 가입 거절`}
                accessibilityState={{ disabled: managementBusy }}
                disabled={managementBusy}
                onPress={() => {
                  if (liveManagement)
                    void runManagement(
                      () => management.answerRequest(q.id, 'reject'),
                      `${q.name ?? '신청자'}님의 가입을 거절했어요.`,
                    );
                  else e.dispatch({ type: 'REJECT_MEMBER', id: q.id });
                }}
                style={{
                  minWidth: 44,
                  height: 44,
                  opacity: managementBusy ? 0.5 : 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1.5,
                  borderColor: BROWN,
                  borderRadius: 99,
                  backgroundColor: '#fffaf0',
                }}
              >
                <T style={g(21, 33.6, { color: CARD_INK })}>×</T>
              </Pressable>
              <Pressable
                testID={`hall-approve-${q.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${q.name ?? '신청자'} 가입 승인`}
                accessibilityState={{ disabled: managementBusy }}
                disabled={managementBusy}
                onPress={() => {
                  if (liveManagement)
                    void runManagement(
                      () => management.answerRequest(q.id, 'approve'),
                      `${q.name ?? '신청자'}님의 가입을 승인했어요.`,
                      undefined,
                      'approve',
                    );
                  else if (isFull(i)) notify('정원이 가득 찼어요.\n정원을 늘린 뒤 승인해 주세요.');
                  else e.dispatch({ type: 'ADD_MEMBER', id: q.id });
                }}
                style={{
                  minWidth: 52,
                  height: 44,
                  opacity: managementBusy ? 0.5 : 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1.5,
                  borderColor: BROWN,
                  borderRadius: 99,
                  backgroundColor: componentTokens.button.background,
                }}
              >
                <T style={g(14, 22.4, { color: CARD_INK, fontWeight: '700' })}>승인</T>
              </Pressable>
            </View>
          )),
        )}
      {!!managementMessage && (
        <View testID="hall-management-action-error" style={{ paddingVertical: 10 }}>
          <T style={g(14, 22.4, { color: '#a3453e', textAlign: 'center' })}>{managementMessage}</T>
        </View>
      )}
      {section(
        '함께 사는 주민',
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          {residents.map((m, n) =>
            displayHost && !m.isHost ? (
              <Pressable
                key={m.id}
                testID={`hall-member-${m.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${m.name} 관리`}
                onPress={() => memberMenu(m)}
                style={{ width: cell }}
              >
                {person(m, n, { style: { width: cell } })}
              </Pressable>
            ) : (
              person(m, visitor ? n + 1 : n, { style: { width: cell }, crown: m.id === hostId })
            ),
          )}
        </View>,
        `${residents.length} / ${liveManagement ? (management.detail?.maxMembers ?? 0) : capacityOf(i)}명`,
      )}
      {news.length > 0 &&
        section(
          t('magazine.news.title'),
          news.map((n) => (
            <View
              key={n.id}
              testID={`hall-news-${n.id}`}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 5,
              }}
            >
              <T style={g(15, 24, { color: CARD_INK, flexShrink: 1 })}>
                {t('magazine.news.promotionRow')}
              </T>
              <T style={g(15, 24, { color: MUTED })}>{kstMonthDay(Date.parse(n.createdAt))}</T>
            </View>
          )),
        )}
      {!visitor && (
        <View style={{ marginTop: land ? 5 : 14, paddingTop: 6 }}>
          {displayHost && (
            // 냐옹잡지에 섬 홍보하기(GROMO-2289 · P3) — 홍보는 마을회관에서(10/5 · 10/14 확정). 내 섬 섬장만, 구경 중에는 없다.
            // 친구 초대 줄보다 위에 둔다(10/15).
            // 섬장 판정은 이 카드의 다른 섬장 전용 동작과 같은 displayHost 다 — 실서버 관리 화면에서는 관리 API 의 지금 역할이라
            // 여기서 위임하거나 다른 기기에서 위임받은 것이 바로 반영된다(홈 스냅샷은 늦을 수 있다). 뒤로가기는 App 기록으로 이 카드에 돌아온다
            <Pressable
              testID="hall-promotion-editor"
              accessibilityRole="button"
              accessibilityLabel={t('magazine.editor.entry')}
              // 위임 등 관리 쓰기가 끝나 역할이 다시 확정되기 전에는 못 들어간다 — 그 사이 회관을 떠나면 확정 역할(host)이
              // 위임 전 값으로 남아 쓰기 화면이 섬장으로 열린다
              accessibilityState={{ disabled: managementBusy }}
              disabled={managementBusy}
              onPress={() => e.go('promotionEditor')}
              style={managementBusy ? promotionRowBusy : promotionRow}
            >
              <T style={g(16, 25.6, { color: CARD_INK, fontWeight: '700', flex: 1 })}>
                {t('magazine.editor.entry')}
              </T>
              <Icon d={CHEV} size={22} />
            </Pressable>
          )}
          <View
            style={{
              minHeight: land ? 45 : 58,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <T style={g(16, 25.6, { color: CARD_INK, fontWeight: '700' })}>섬에 친구 초대하기</T>
            <Pressable
              testID="hall-invite"
              accessibilityRole="button"
              accessibilityLabel="섬에 친구 초대하기"
              disabled={inviteShare.busy}
              accessibilityState={{ disabled: inviteShare.busy, busy: inviteShare.busy }}
              onPress={inviteShare.share}
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                borderWidth: 1.5,
                borderColor: '#a78d6e',
                backgroundColor: '#fffaf0',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon d={SHARE} size={22} />
            </Pressable>
          </View>
        </View>
      )}
      {visitor ? (
        // 방문자: 탈퇴 자리에 가입 버튼. 정원이 차면 흐리게만 두고 누를 수 없다
        <Pressable
          testID="hall-join"
          accessibilityRole="button"
          accessibilityLabel={joinLabel}
          accessibilityState={{ disabled: joinDisabled, busy: visitorJoinBusy }}
          disabled={joinDisabled}
          onPress={() => {
            if (e.islands) {
              void serverJoin();
              return;
            }
            if (join === 'cancel') {
              e.dispatch({ type: 'CANCEL_JOIN', id: i.id });
              return;
            }
            e.dispatch({ type: 'JOIN', id: i.id });
            if (join === 'apply') notify(t('islandVisit.visitorJoin.requested'));
            else {
              // 바로 가입: 이 섬 주민이 되어 구경이 끝나므로 새 섬 홈으로 간다
              e.notify(t('islandVisit.visitorJoin.joined', { name: i.name }));
              e.home();
            }
          }}
          style={{
            minHeight: land ? 43 : 48,
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 18,
            borderWidth: 2,
            borderColor: BROWN,
            borderRadius: 99,
            backgroundColor: semanticTokens.color.accent,
            boxShadow: `0px 3px 0px ${BROWN}`,
            opacity: joinDisabled ? 0.5 : 1,
          }}
        >
          <T style={g(16, 25.6, { color: CARD_INK, fontWeight: '800' })}>{joinLabel}</T>
        </Pressable>
      ) : (
        leaveBtn()
      )}
    </ScrollView>
  );
  return shell(
    frame(
      <View style={{ flex: 1, flexDirection: land ? 'row' : 'column' }}>
        {head}
        {body}
      </View>,
      undefined,
      'hall-card',
    ),
  );
}
