import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Share,
  TextInput,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { art, Wheel } from '@/design-system/patterns';
import { useAppLayout } from '@/utils/layout';
import {
  State,
  Building,
  viewIsland,
  visitorJoinState,
  visitorJoinLabel,
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
import { useIslandManagement } from '@/screens/interiors/useIslandManagement';
import { sessionGeneration } from '@/services/api/session';

// v2 시안(042~061) 마을회관: 책상 장면 → 섬 정보 카드·수정·위임·탈퇴 / 공동 가계부 / 목각 건물·청사진
// App.tsx 의 REVIEW/DEMO 와 같은 판정 — 모크 모드는 서버가 없으므로 가계부도 로컬 원장으로 그린다.
// 모듈 상수가 아니라 렌더 때 읽는 함수다(테스트에서 Platform.OS·location 을 바꿔 끼우기 위해).
const ledgerMockMode = () =>
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  (new URLSearchParams(window.location.search).has('review') ||
    new URLSearchParams(window.location.search).has('demo'));
const CARD_INK = '#3e352e';
const MUTED = '#665348';
// 받침 유무로 조사 고르기 (을/를, 으로/로: ㄹ받침은 로)
const final = (word: string) => {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return c < 0 || c > 11171 ? -1 : c % 28;
};
const eul = (w: string) => w + (final(w) > 0 ? '을' : '를');
const ro = (w: string) => w + (final(w) > 0 && final(w) !== 8 ? '으로' : '로');
const grid = ['library', 'tower', 'mail', 'gram', 'shop'] as const satisfies readonly Building[];
const cardDesc: Record<string, string> = {
  library: '집중·스크린타임 기록',
  tower: '다른 섬 랭킹과 탐색',
  mail: '주민·친구 편지',
  gram: '공동 음원 재생',
  shop: '의상·섬 테마 구매',
};
const planDesc: Record<string, string> = {
  library: '나와 주민들의 집중 기록, 스크린타임, 누적 물고기를 일·주·월로 확인해요.',
  tower: '다른 섬 순위를 보고 구경하거나 가입해요.',
  mail: '주민·친구와 편지를 주고받아요.',
  gram: '섬 물고기로 음원을 사서 함께 들어요.',
  shop: '물고기로 의상과 섬 테마를 사요.',
};
const bldArt: Record<string, string> = {
  library: 'bld/library',
  tower: 'bld/observatory',
  mail: 'bld/mailbox',
  gram: 'bld/gramophone',
  shop: 'bld/shop',
};
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
function Avatar({ color, n, size }: any) {
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
      <Image
        source={art[`avatar/${color}`]}
        resizeMode="contain"
        style={{
          width: '100%',
          height: '100%',
          transform: [{ scale: 1.2 }],
          transformOrigin: 'center bottom',
        }}
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
    visitor = !!s.visitingIslandId;
  // review/demo에는 서버가 없으므로 관리 hook을 열지 않고 기존 시연 섬 정보를 유지한다.
  const liveManagement = (r === 'manage' || r === 'members') && !visitor && !ledgerMockMode();
  // `manage`/`members`는 실제 App 경로(CurrentScreens → Hall)다. 로컬 Island를 서버 DTO로
  // 덮어쓰지 않고 이 표면에서만 관리 API snapshot을 직접 소비한다.
  const management = useIslandManagement({
    active: liveManagement,
    islandId: visitor ? null : i.id,
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
      body?: React.ReactNode;
    } | null>(null);
  const [draft, setDraft] = useState({
    name: i.name,
    intro: i.intro,
    approval: i.approval,
    capacity: capacityOf(i),
  });
  const [managementError, setManagementError] = useState('');
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
    ? managementError || management.error?.message || ''
    : '';
  const runManagement = async (
    work: () => Promise<void>,
    success: string,
    afterSuccess?: () => void,
  ) => {
    const run = managementRun.current;
    setManagementError('');
    try {
      await work();
      if (run !== managementRun.current) return;
      afterSuccess?.();
      notify(success);
    } catch (error) {
      if (run !== managementRun.current) return;
      setManagementError(
        error instanceof Error ? error.message : '처리하지 못했어요. 다시 시도해 주세요.',
      );
    }
  };
  const transferCandidates = liveManagement
    ? (management.members ?? [])
        .filter((m) => m.role !== 'host')
        .map((m) => ({ id: m.id, name: m.name ?? '주민', color: m.catColor ?? s.color }))
    : i.members;
  // 가계부: 서버 원장·지갑 조각이 정본이다 — 로컬 i.ledger 문자열·로컬 잔액 합산을 쓰지 않는다.
  // 방문자에게는 조회 자체를 하지 않는다(서버도 403). 리뷰·데모 모크 모드는 서버가 아예 없다 —
  // 거기서는 로컬 원장으로 그리던 기존 화면을 유지하고 API 호출은 0회다.
  const thisMonth = dayKey(e.now).slice(0, 7);
  const mockLedger = ledgerMockMode();
  const serverLedger = useLedgerScreen({
    active: r === 'ledger' && !visitor && !mockLedger,
    islandId: i.id,
    currentMonth: thisMonth,
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
  const back = (onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="뒤로"
      testID="hall-back"
      onPress={onPress}
      style={{
        position: 'absolute',
        zIndex: 12,
        left: (land ? 56 : 18) + off.left,
        top: (land ? 14 : 46.5) + off.top,
        width: 43.9,
        height: 43.9,
        borderRadius: 22,
        borderWidth: 2.6,
        borderColor: BROWN,
        backgroundColor: '#fff7eb',
        boxShadow: `0px 3.9px 0px ${BROWN}`,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <T style={g(29.7, 29.7, { fontWeight: '800' })}>‹</T>
    </Pressable>
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
                  backgroundColor: ok ? '#e9a49d' : undefined,
                }}
              >
                <T
                  style={g(14, 22.4, {
                    color: ok ? '#6f2d2a' : CARD_INK,
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
  const shell = (children: React.ReactNode, backPress?: () => void) => (
    <View style={{ flex: 1 }}>
      {/* 확인창이 열린 동안 뒤 장면은 보조기기에서 숨긴다 */}
      <View
        style={fill}
        aria-hidden={!!dialog}
        accessibilityElementsHidden={!!dialog}
        importantForAccessibility={dialog ? 'no-hide-descendants' : 'auto'}
      >
        {scene}
        {backPress && back(backPress)}
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
    // 책갈피 라벨 ↔ 서버 direction scope. 잔액은 무필터(최근 두 줄), 적립·지출은 해당 방향 전체
    const TAB_KEY = { 잔액: 'balance', 적립: 'earn', 지출: 'spend' } as const;
    const TAB_LABEL = { balance: '잔액', earn: '적립', spend: '지출' } as const;
    // 서버 원장 사유 → 한 줄 표시 (GROMO-1786 · IslandWalletTransactionType). 거래 주체는 계약에 없다
    const REASON: Record<string, string> = {
      contribution: '집중 적립',
      quest_settlement: '퀘스트 보상',
      construction_debit: '건설 사용',
      shop_purchase: '공동 구매',
      golden_fish: '황금 물고기',
    };
    const shown = ledger.tab === 'balance' ? ledger.items.slice(0, 2) : ledger.items;
    const bookmark = (label: keyof typeof TAB_KEY, n: number) => {
      const key = TAB_KEY[label];
      const on = ledger.tab === key;
      const color = ['#f2c1c8', '#f1d77f', '#acd5df'][n];
      return (
        <Pressable
          key={label}
          testID={`ledger-tab-${label}`}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ selected: on }}
          onPress={() => ledger.setTab(key)}
          style={[
            {
              width: 72.3,
              height: 51.6,
              alignItems: 'center',
              justifyContent: 'center',
              paddingTop: 6.5,
              paddingBottom: 10.3,
              transform: [{ translateY: on ? -7.7 : 0 }],
            },
            on && web({ filter: 'brightness(1.04)' }),
          ]}
        >
          {/* 아래가 제비꼬리로 파인 책갈피. 테두리는 위·양옆만 */}
          <Svg width={72.3} height={51.6} style={{ position: 'absolute', left: 0, top: 0 }}>
            <Path d="M0 0H72.3V51.6L36.15 41.28L0 51.6Z" fill={color} />
            <Path
              d="M0.95 51.6V6.15Q0.95 0.95 6.15 0.95H66.15Q71.35 0.95 71.35 6.15V51.6"
              fill="none"
              stroke="#775846"
              strokeWidth={1.9}
            />
          </Svg>
          <T style={g(15.5, 19.375, { fontWeight: '800' })}>{label}</T>
        </Pressable>
      );
    };
    const numberText = (n: number, sign: '+' | '−') =>
      `${sign}${Math.abs(n).toLocaleString('ko-KR')}`;
    const list = shown.map((l) => {
      const [mm, dd] = kstMonthDay(Date.parse(l.createdAt)).split('/');
      return (
        <View
          key={l.id}
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10.3,
            paddingVertical: 9,
            paddingHorizontal: 1.3,
            borderBottomWidth: 1.3,
            borderStyle: 'dashed',
            borderBottomColor: '#c9ad87',
          }}
        >
          <View style={{ flexShrink: 1 }}>
            {/* 모크 모드의 reason 자리에는 로컬 제목이 실려 있다 — 그대로 보여 준다 */}
            <T style={g(16.8, 26.88, { fontWeight: '700' })}>
              {mockLedger ? l.reason : (REASON[l.reason] ?? '기타')}
            </T>
            <T style={g(15.5, 24.8, { color: MUTED })}>
              {mm}월 {dd}일{l.entryCount > 1 ? ` · ${l.entryCount}회 적립` : ''}
            </T>
          </View>
          {/* 서버 amount 는 항상 양수 — 부호는 direction 이 정한다 */}
          <T style={g(20.7, 20.7)}>{numberText(l.amount, l.direction === 'spend' ? '−' : '+')}</T>
        </View>
      );
    });
    // 다음 쪽(같은 월·방향의 서명 커서) 더 보기. 잔액 책갈피는 최근 두 줄만 보는 자리라 붙이지 않는다
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
    const left = (
      <View style={land ? { flex: 1, minWidth: 0 } : undefined}>
        <T style={g(15.5, 24.8, { color: MUTED, letterSpacing: 0.465 })}>
          {inviteCodeOf(i)} ISLAND LEDGER
        </T>
        <T style={g(28.4, 35.5, { marginTop: 1.3 })}>우리 섬 물고기</T>
        <T style={g(36.2, 45.25, { marginTop: 2.6 })} numberOfLines={1}>
          🐟 {ledger.villagePoints === null ? '—' : ledger.villagePoints.toLocaleString('ko-KR')}
          마리
        </T>
        <View
          style={{
            alignSelf: 'flex-start',
            marginTop: 6.5,
            marginBottom: 11.6,
            paddingVertical: 2.6,
            paddingHorizontal: 9,
            borderWidth: 1.3,
            borderColor: '#886b53',
            borderRadius: 6.5,
            backgroundColor: '#efd070',
            transform: [{ rotate: '-2deg' }],
          }}
        >
          <T style={g(15.5, 20.15)}>섬 주민이 함께 모은 물고기</T>
        </View>
      </View>
    );
    const right = (
      <View style={land ? { flex: 1, minWidth: 0 } : undefined}>
        <View
          style={{ flexDirection: 'row', gap: 9, marginTop: land ? 0 : 11.6, marginBottom: 11.6 }}
        >
          {[
            ['이번 달 적립', numberText(ledger.earnedTotal, '+')],
            ['이번 달 사용', numberText(ledger.spentTotal, '−')],
          ].map(([label, value]) => (
            <View
              key={label}
              style={{
                flex: 1,
                padding: 9,
                borderWidth: 1.3,
                borderColor: '#c7aa83',
                backgroundColor: '#fff8e7',
              }}
            >
              <T style={g(15.5, 24.8)}>{ledger.offset ? label.replace('이번', '그') : label}</T>
              <T style={g(22, 30.8, { marginBottom: 1.24 })}>{value}</T>
            </View>
          ))}
        </View>
        {/* 조회 실패·로딩·진짜 빈 달은 서로 다른 상태다 — 실패를 빈 내역으로 접지 않는다 */}
        {stateBox ? (
          stateBox
        ) : shown.length ? (
          land ? (
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {list}
              {more}
              {moreRetry}
            </ScrollView>
          ) : (
            <>
              {list}
              {more}
              {moreRetry}
            </>
          )
        ) : (
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
        )}
      </View>
    );
    const perBtn = (dir: -1 | 1) => {
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
            width: 41.3,
            height: 41.3,
            borderRadius: 20.65,
            borderWidth: 2.6,
            borderColor: BROWN,
            backgroundColor: '#fff7eb',
            boxShadow: disabled ? undefined : `0px 3.9px 0px ${BROWN}`,
            opacity: disabled ? 0.35 : 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <T style={g(16.8, 26.88, { fontWeight: '800' })}>{dir < 0 ? '‹' : '›'}</T>
        </Pressable>
      );
    };
    return shell(
      <View
        style={[
          {
            position: 'absolute',
            zIndex: 7,
            left: land ? side : 18.1,
            right: land ? 18 : 18.1,
            // 세로: 874 화면은 시안 높이 635.3 그대로, 낮은 화면은 뒤로 버튼·명판 아래에서 시작
            top: land ? 46 : Math.max(L.insets.top + 94, H - 28.4 - 635.3),
            bottom: land ? 12 : 28.4,
          },
          web({ filter: 'drop-shadow(rgba(60, 38, 27, 0.384) 0px 14.2px 15.5px)' }),
        ]}
      >
        {/* 종이 겹과 초록 표지 */}
        <View
          style={[
            {
              position: 'absolute',
              top: 11.6,
              right: -3.9,
              bottom: -6.5,
              left: 12.9,
              borderWidth: 2.6,
              borderColor: '#6f503a',
              borderTopLeftRadius: 9,
              borderTopRightRadius: 16.8,
              borderBottomRightRadius: 16.8,
              borderBottomLeftRadius: 7.7,
              backgroundColor: '#f1e4c9',
              boxShadow: 'inset 9px 0px 0px rgb(72, 99, 77)',
            },
            web({
              backgroundImage:
                'repeating-linear-gradient(rgb(241, 228, 201) 0px, rgb(241, 228, 201) 3.9px, rgb(185, 155, 118) 5.2px, rgb(241, 228, 201) 6.5px)',
            }),
          ]}
        />
        <View
          style={{
            position: 'absolute',
            top: 5.2,
            right: 5.2,
            bottom: 1.3,
            left: 6.5,
            borderWidth: 2.6,
            borderColor: '#684d39',
            borderTopLeftRadius: 7.7,
            borderTopRightRadius: 15.5,
            borderBottomRightRadius: 15.5,
            borderBottomLeftRadius: 7.7,
            backgroundColor: '#678268',
            boxShadow: 'inset 10.3px 0px 0px rgb(64, 94, 72)',
          }}
        />
        <View
          style={[
            {
              position: 'absolute',
              top: 12.9,
              right: 10.3,
              bottom: 9,
              left: 19.4,
              paddingTop: land ? 66 : 60.7,
              paddingRight: land ? 20 : 28.4,
              paddingBottom: land ? 12 : 23.2,
              paddingLeft: land ? 30 : 37.4,
              borderWidth: 1.9,
              borderColor: '#937154',
              borderTopLeftRadius: 5.2,
              borderTopRightRadius: 12.9,
              borderBottomRightRadius: 12.9,
              borderBottomLeftRadius: 6.5,
              backgroundColor: '#fff3d8',
              boxShadow: 'inset 9px 0px 11.6px rgba(141, 112, 67, 0.2)',
            },
            web({
              backgroundImage:
                'linear-gradient(90deg, rgba(195, 167, 125, 0.133) 0px, rgba(195, 167, 125, 0.133) 3%, transparent 8%), repeating-linear-gradient(rgb(255, 243, 216) 0px, rgb(255, 243, 216) 31px, rgb(234, 216, 185) 32.3px)',
            }),
          ]}
        >
          <View
            style={{
              position: 'absolute',
              left: 5.2,
              top: '4%',
              bottom: '4%',
              width: 12.9,
              borderRadius: 6.45,
              backgroundColor: 'rgba(153, 118, 75, 0.133)',
              // 시안은 50% 둥글기(세로로 긴 타원)
              ...web({ borderRadius: '50%' }),
              boxShadow: 'inset -3.9px 0px 5.2px rgba(122, 90, 56, 0.2)',
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: 41.3,
              right: 28.4,
              top: 18.1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6.5,
            }}
          >
            {perBtn(-1)}
            <T style={g(15.5, 24.8, { flex: 1, textAlign: 'center' })}>
              {ledgerYear}년 {ledgerMonth}월
            </T>
            {perBtn(1)}
          </View>
          {land ? (
            <View style={{ flex: 1, flexDirection: 'row', gap: 24 }}>
              {left}
              {right}
            </View>
          ) : (
            // 세로는 화면이 낮으면 책 안에서 스크롤한다
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {left}
              {right}
            </ScrollView>
          )}
        </View>
        <View
          style={[
            {
              position: 'absolute',
              zIndex: 4,
              left: 12.9,
              top: -43.9,
              minWidth: 133,
              paddingTop: 7.7,
              paddingHorizontal: 19.4,
              paddingBottom: 9,
              borderWidth: 1.9,
              borderColor: '#68482f',
              borderTopLeftRadius: 7.7,
              borderTopRightRadius: 7.7,
              borderBottomLeftRadius: 11.6,
              borderBottomRightRadius: 11.6,
              backgroundColor: '#c78e58',
              boxShadow: '0px 3.9px 0px rgb(104, 72, 47)',
              transform: [{ rotate: '-1deg' }],
            },
            web({
              backgroundImage:
                'linear-gradient(90deg, rgb(185, 121, 73), rgb(210, 160, 100), rgb(189, 129, 77))',
            }),
          ]}
        >
          <T
            style={g(19.4, 23.28, {
              color: '#fff8e8',
              textAlign: 'center',
              textShadowColor: 'rgb(102, 68, 46)',
              textShadowOffset: { width: 0, height: 1.3 },
              textShadowRadius: 0,
            })}
          >
            공동 가계부
          </T>
        </View>
        <View
          style={{
            position: 'absolute',
            zIndex: 5,
            right: 19.4,
            top: -22,
            flexDirection: 'row',
            gap: 3.9,
          }}
        >
          {(['잔액', '적립', '지출'] as const).map(bookmark)}
        </View>
      </View>,
      e.back,
    );
  }

  // ── 054~061 목각 건물 고르기 · 청사진 ──
  if (r === 'construction') {
    const status = (b: Building) =>
      i.buildings.includes(b)
        ? 'done'
        : i.construction?.building === b
          ? 'build'
          : b === 'shop' && !shopPrerequisitesMet(i)
            ? 'locked'
            : i.buildingQuest?.building === b
              ? 'collect'
              : 'none';
    // 한 번에 한 건물만 짓는다: 공사 중에는 다른 건물을 고를 수 없어 흐리게
    const dim = (b: Building) =>
      status(b) === 'locked' || (!!i.construction && status(b) === 'none');
    const gap = land ? 10 : 12.9,
      // 격자 폭 = 패널 폭 − 테두리 4 − 안쪽 여백 (세로 18.1·16.8, 가로 side+16·16)
      gridW = land ? W - side - 16 - 4 - 32 : W - 36.2 - 4 - 33.6,
      // 가로는 카드가 140 이상일 때만 3열
      cols = land && gridW >= 450 ? 3 : 2,
      // 내림: 소수 폭이면 iOS 가 둘째 카드를 다음 줄로 넘긴다
      cardW = Math.floor((gridW - gap * (cols - 1)) / cols);
    const pick = (
      <View
        style={{
          position: 'absolute',
          zIndex: 7,
          left: land ? side : 18.1,
          right: land ? 16 : 18.1,
          top: land ? 14 : undefined,
          bottom: land ? 14 : 28.4,
          minHeight: land ? undefined : 454.5,
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
        <View style={{ gap: 1.3, marginBottom: 11.6 }}>
          <View
            style={{
              alignSelf: 'flex-start',
              marginBottom: 3.9,
              paddingVertical: 2.6,
              paddingHorizontal: 10.3,
              borderWidth: 1.3,
              borderColor: '#7f624f',
              borderRadius: 99,
              backgroundColor: '#fff8e9',
            }}
          >
            <T style={g(15.5, 24.8, { fontWeight: '800' })}>목각 건물 고르기</T>
          </View>
          <T style={g(25.8, 32.25)}>어떤 건물을 지을까요?</T>
        </View>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap,
            transform: plan ? [{ scale: 0.985 }] : undefined,
          }}
        >
          {grid.map((b, n) => {
            const st = status(b),
              off = dim(b),
              wide = n === grid.length - 1 && n % 2 === 0;
            // 흐린 카드 중 잠긴 상점만 눌러서 잠금 안내를 본다
            const tappable = !off || st === 'locked';
            return (
              <Pressable
                key={b}
                testID={`hall-bld-${b}`}
                accessibilityRole="button"
                accessibilityLabel={`${buildingNames[b]}${st === 'done' ? ' 완공' : ''}`}
                accessibilityState={{ disabled: !tappable }}
                disabled={!tappable}
                onPress={() => setPlan(b)}
                style={{
                  // 홀수 마지막 카드는 세로 두 칸 전체, 가로 두 칸을 차지한다
                  width: wide ? (cols === 3 ? cardW * 2 + gap : gridW) : cardW,
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
                {st === 'done' && (
                  <View
                    style={{
                      alignSelf: 'flex-end',
                      paddingVertical: 1.3,
                      paddingHorizontal: 7.7,
                      borderRadius: 99,
                      backgroundColor: '#dff0d0',
                    }}
                  >
                    <T
                      style={g(12.9, 20.64, {
                        fontWeight: '800',
                        fontStyle: 'italic',
                        color: '#3f6b34',
                      })}
                    >
                      완공
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
                    <T style={g(18.1, 23.53, { fontWeight: '800' })}>{buildingNames[b]}</T>
                    <T
                      style={g(15.5, 21.7, {
                        color: MUTED,
                        ...(land ? web({ wordBreak: 'keep-all' }) : null),
                      })}
                    >
                      {cardDesc[b]}
                    </T>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
    let planView = null;
    if (plan) {
      const st = status(plan),
        name = buildingNames[plan],
        share = buildingShare(i, plan),
        q = i.buildingQuest;
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
      const btn = (label: string, onPress: () => void) => (
        <Pressable
          testID="hall-plan-action"
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={onPress}
          style={{
            marginTop: 10.3,
            minHeight: 56.8,
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 11.6,
            paddingHorizontal: 19.4,
            borderWidth: 2.6,
            borderColor: BROWN,
            borderRadius: 999,
            backgroundColor: '#ffa6bc',
            boxShadow: `0px 5.2px 0px ${BROWN}`,
          }}
        >
          <T style={g(16.8, 21, { fontWeight: '800' })}>{label}</T>
        </Pressable>
      );
      const left = i.construction ? Math.max(0, i.construction.endsAt - e.now) : 0;
      const reason = canSelectBuilding(i, plan);
      const select = () => {
        e.dispatch({ type: 'SELECT_BUILDING', building: plan });
        notify('게시판에 건설 퀘스트가 등록됐어요.');
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
      const copy =
        st === 'locked' ? (
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
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12.9,
            }}
          >
            <T style={g(15.5, 24.8, { color: '#e8faff', letterSpacing: 0.62 })}>
              BUILDING PLAN · 01
            </T>
            {st === 'collect' && (
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
            )}
          </View>
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
              : // 주민은 방장 안내, 방장은 게시판 완공 전·공사 중 같은 이유 안내
                note(host ? reason! : '방장이 목표를 정해요'))}
        </View>
      );
    }
    return shell(
      <>
        {pick}
        {planView}
      </>,
      plan ? () => setPlan(null) : e.back,
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
    if (management.loading) {
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
              {management.error.message}
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
      notify('방장은 바로 섬을 나갈 수 없어요.\n방장을 위임한 뒤 나가주세요.');
      setPanel('transfer');
      return;
    }
    const solo = !i.members.length;
    setDialog({
      title: `${eul(i.name)} 떠날까요?`,
      text: solo
        ? '현재 이 섬에는 나만 남아 있어요.\n탈퇴하면 섬에 쌓인 공동 데이터가 모두 삭제돼요.'
        : '내가 모은 물고기와 기록은 섬에 남아요.',
      detail: next ? (
        <>
          이후 <T style={g(14, 20.3, { color: CARD_INK, fontWeight: '700' })}>{next.name}</T>
          {ro(next.name).slice(next.name.length)} 이동해요.
        </>
      ) : (
        '이후 「혼자 시작 / 기존 섬 참여」 화면으로 이동해요.\n계정·고양이·닉네임·친구·개인 보유품·개인 집중 기록은 그대로 유지돼요.'
      ),
      ok: solo ? (next ? '삭제하고 탈퇴' : '삭제하고 나가기') : '탈퇴하기',
      onOk: () => {
        e.dispatch({ type: 'LEAVE' });
        if (next) e.home();
        else e.reset('chooseIsland');
      },
    });
  };
  const close = (onPress: () => void, style?: object) => (
    <Pressable
      testID="hall-close"
      accessibilityRole="button"
      accessibilityLabel="닫기"
      onPress={onPress}
      style={[
        { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
        style,
      ]}
    >
      <T style={{ fontSize: 27, lineHeight: 27, color: '#5e4d42' }}>×</T>
    </Pressable>
  );
  const person = (m: { id: string; name: string; color: string }, n: number, opts: any = {}) => (
    <View
      key={m.id}
      // 방장 칸은 보조기기가 이름 뒤에 '방장'까지 읽는다
      accessible={opts.crown || undefined}
      accessibilityLabel={opts.crown ? `${m.id === 'me' ? '나' : m.name}, 방장` : undefined}
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
        <Avatar color={m.color} n={n} size={opts.av ?? (land ? 31 : 38)} />
        {/* 방장 왕관: 아바타 지름의 절반 크기로 테두리 1시 방향에 걸치고 시계 방향으로 18° 기울인다.
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
  const residents = liveManagement
    ? (management.members ?? []).map((m) => ({
        id: m.id,
        name: m.name ?? '주민',
        color: m.catColor ?? s.color,
        isHost: m.role === 'host',
      }))
    : [
        ...(visitor ? [] : [{ id: 'me', name: '나', color: s.color, isHost: host }]),
        ...i.members.map((m) => ({
          id: m.id,
          name: m.name,
          color: m.color,
          isHost: m.role === 'host',
        })),
      ];
  const hostId = residents.find((m) => m.isHost)?.id;
  const transferDialog = (m: { id: string; name: string }) => ({
    title: '방장 위임',
    text: `${m.name}에게 방장을 위임하시겠습니까?`,
    ok: '위임하기',
    onOk: () => {
      if (liveManagement) {
        void runManagement(
          () => management.transferHost(m.id),
          `${m.name}에게 방장을 위임했어요.`,
          () => setPanel(''),
        );
      } else {
        e.dispatch({ type: 'TRANSFER', id: m.id });
        setPanel('');
        notify(`${m.name}에게 방장을 위임했어요.`);
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
          {option('방장 위임', 'hall-member-transfer', () => setDialog(transferDialog(m)))}
          {option(
            '섬에서 내보내기',
            'hall-member-kick',
            () =>
              setDialog({
                title: '섬에서 내보낼까요?',
                text: `${eul(m.name)} 섬에서 내보내요.\n모은 물고기와 기록은 섬에 남고, 건설 목표 대상에서 빠져요.`,
                ok: '내보내기',
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
              <T style={g(22, 35.2, { color: CARD_INK, fontWeight: '600' })}>방장 위임</T>
              <T style={g(14, 22.4, { color: '#6d5b4a', marginTop: 4 })}>
                방장을 위임할 주민을 골라요.
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
                accessibilityLabel={`${m.name}에게 방장 위임`}
                onPress={() => setDialog(transferDialog({ id: m.id, name: m.name }))}
                // 가로 2열: 목록 폭 = 화면 − 왼쪽 side − 오른쪽 16 − 테두리 4 − 안쪽 여백 32
                style={{ width: land ? (W - side - 52 - 10) / 2 : '100%' }}
              >
                {person({ ...m, name: m.name, color: m.color }, n, {
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
    const input = (label: string, key: 'name' | 'intro') => (
      <View style={{ gap: 5 }}>
        <T style={g(13, 20.8, { color: '#6d5b4a', fontWeight: '700' })}>{label}</T>
        <TextInput
          testID={key === 'name' ? 'hall-name' : 'hall-intro'}
          accessibilityLabel={label}
          value={draft[key]}
          onChangeText={(v) => setDraft((d) => ({ ...d, [key]: v }))}
          multiline={key === 'intro'}
          maxLength={key === 'name' ? 20 : 60}
          style={{
            height: key === 'intro' ? (land ? 57 : 62) : land ? 39 : 44,
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
      </View>
    );
    const approval = setting(
      '가입 승인',
      '방장이 확인한 후 주민이 돼요.',
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
      <T style={g(15, 24, { color: CARD_INK, fontWeight: '700' })}>{draft.capacity}명</T>,
      {
        testID: 'hall-capacity',
        onPress: () => {
          const min = Math.max(
            CAPACITY_MIN,
            liveManagement ? (management.members?.length ?? CAPACITY_MIN) : residentCount(i),
          );
          let picked = `${draft.capacity}명`;
          setDialog({
            title: '주민 정원',
            text: '현재 주민 수보다 작게 줄일 수는 없어요.',
            body: (
              <View style={{ height: 132 }}>
                <Wheel
                  label=""
                  a11yLabel="주민 정원"
                  items={Array.from({ length: CAPACITY_MAX - min + 1 }, (_, n) => `${n + min}명`)}
                  value={picked}
                  onChange={(v: string) => (picked = v)}
                />
              </View>
            ),
            ok: '정하기',
            onOk: () => setDraft((d) => ({ ...d, capacity: parseInt(picked, 10) })),
          });
        },
      },
    );
    const transfer = setting(
      '방장 위임',
      transferCandidates.length ? '다른 주민에게 방장을 넘겨요.' : '위임할 주민이 없어요.',
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
                }),
              '섬 정보를 저장했어요.',
              () => setPanel(''),
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
          backgroundColor: '#f3d77d',
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
  const join = visitorJoinState(s, i);
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
              {person({ ...q, name: q.name ?? '신청자', color: s.color }, n, {
                size: 16,
                style: {
                  flex: 1,
                  borderWidth: 0,
                  paddingVertical: land ? 4 : 0,
                  paddingHorizontal: land ? 6 : 0,
                },
              })}
              <Pressable
                testID={`hall-reject-${q.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${q.name} 가입 거절`}
                onPress={() => {
                  if (liveManagement)
                    void runManagement(
                      () => management.answerRequest(q.id, 'reject'),
                      `${q.name ?? '신청자'}님의 가입을 거절했어요.`,
                    );
                  else e.dispatch({ type: 'REJECT_MEMBER', id: q.id });
                }}
                style={{
                  minWidth: 40,
                  height: 40,
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
                accessibilityLabel={`${q.name} 가입 승인`}
                onPress={() => {
                  if (liveManagement)
                    void runManagement(
                      () => management.answerRequest(q.id, 'approve'),
                      `${q.name ?? '신청자'}님의 가입을 승인했어요.`,
                    );
                  else if (isFull(i)) notify('정원이 가득 찼어요.\n정원을 늘린 뒤 승인해 주세요.');
                  else e.dispatch({ type: 'ADD_MEMBER', id: q.id });
                }}
                style={{
                  minWidth: 52,
                  height: 40,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1.5,
                  borderColor: BROWN,
                  borderRadius: 99,
                  backgroundColor: '#f3d77d',
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
      {!visitor && (
        <View
          style={{
            minHeight: land ? 45 : 58,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginTop: land ? 5 : 14,
            paddingTop: 6,
          }}
        >
          <T style={g(16, 25.6, { color: CARD_INK, fontWeight: '700' })}>섬에 친구 초대하기</T>
          <Pressable
            testID="hall-invite"
            accessibilityRole="button"
            accessibilityLabel="섬에 친구 초대하기"
            onPress={() =>
              Share.share({
                message: `${i.name}에서 같이 집중해요! 초대 코드: ${inviteCodeOf(i)}`,
              }).catch(() => notify(`초대 코드 ${inviteCodeOf(i)}를 친구에게 알려 주세요.`))
            }
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
      )}
      {visitor ? (
        // 방문자: 탈퇴 자리에 가입 버튼. 정원이 차면 흐리게만 두고 누를 수 없다
        <Pressable
          testID="hall-join"
          accessibilityRole="button"
          accessibilityLabel={visitorJoinLabel[join]}
          accessibilityState={{ disabled: join === 'full' || join === 'blocked' }}
          disabled={join === 'full' || join === 'blocked'}
          onPress={() => {
            if (join === 'cancel') {
              e.dispatch({ type: 'CANCEL_JOIN', id: i.id });
              return;
            }
            e.dispatch({ type: 'JOIN', id: i.id });
            if (join === 'apply') notify('참여 신청이 완료됐어요. 방장이 확인하면 알려드릴게요.');
            else {
              // 바로 가입: 이 섬 주민이 되어 구경이 끝나므로 새 섬 홈으로 간다
              e.notify(`${i.name} 주민이 됐어요`);
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
            backgroundColor: '#f3d77d',
            boxShadow: `0px 3px 0px ${BROWN}`,
            opacity: join === 'full' || join === 'blocked' ? 0.5 : 1,
          }}
        >
          <T style={g(16, 25.6, { color: CARD_INK, fontWeight: '800' })}>
            {visitorJoinLabel[join]}
          </T>
        </Pressable>
      ) : (
        !displayHost && leaveBtn()
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
