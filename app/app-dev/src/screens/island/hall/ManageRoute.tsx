import { CatAvatar } from '@/components/CatAvatar';
import { appearanceOutfit, outfitOf, type Outfit } from '@/components/CatOutfitLayers';
import { MAGAZINE_STAMP, MAGAZINE_UI } from '@/constants/magazineAssets';
import { CharCount, NavBtn, Wheel, art } from '@/design-system/patterns';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import type { ScreenProps } from '@/navigation/ScreenEnvironment';
import {
  managementErrorMessage,
  useIslandManagement,
} from '@/screens/interiors/useIslandManagement';
import { BROWN, T, web } from '@/design-system/sceneKit';
import {
  CARD_INK,
  MUTED,
  eul,
  hallLiveIslandId,
  ledgerMockMode,
} from '@/screens/island/hall/hallShared';
import { useHallFrame } from '@/screens/island/hall/useHallFrame';
import { useInviteShare } from '@/screens/island/useInviteShare';
import { useVisitorJoin } from '@/screens/island/useVisitorJoin';
import { AdCell } from '@/screens/magazine/AdCell';
import { CELL_ASPECT } from '@/screens/magazine/layout';
import { editorIsland } from '@/screens/magazine/PromotionEditor';
import { magazineApi } from '@/screens/magazine/usePromotionEditor';
import {
  ISLAND_GREETING_MAX,
  ISLAND_INTRO_MAX,
  ISLAND_NAME_MAX,
} from '@/services/api/islandManagement';
import type { NextPromotion } from '@/services/api/magazine';
import { sessionGeneration } from '@/services/api/session';
import { sharedWebIslandId, usesSharedWebIsland } from '@/services/webIsland';
import {
  CAPACITY_MAX,
  CAPACITY_MIN,
  State,
  capacityOf,
  isFull,
  isHost,
  joinRequests,
  residentCount,
  viewIsland,
} from '@/services/model';
import { clampCodePoints } from '@/utils/codePoints';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Image, Pressable, ScrollView, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

// 편집 칸에 미리 채울 인사말 — 섬장이 쓴 것만. 안 썼으면(기본 문구가 합성돼 온다) 빈 칸이고, 기본 문구는 힌트로만 보인다.
// 합성 문구를 그대로 채워 저장하면 섬 이름이 바뀌어도 안 따라가고, 이름이 길면 40 코드포인트를 넘을 수 있다.
const ownGreeting = (detail?: { greeting?: string; greetingIsDefault?: boolean } | null) =>
  detail?.greetingIsDefault === false ? (detail.greeting ?? '') : '';
// 섬 관리 카드의 잡지 홍보 칸 카드(GROMO-2894 시안 .slot) — 친구 초대 줄 아래의 편지지 색 종이
const promo = componentTokens.hallPromotion;
const promotionSlot = {
  marginTop: promo.marginTop,
  padding: promo.padding,
  gap: promo.gap,
  borderWidth: promo.borderWidth,
  borderColor: promo.border,
  borderRadius: promo.radius,
  backgroundColor: promo.background,
} as const;
const editPill = componentTokens.hallEditPill;
const nav = componentTokens.navButton;
// 회관이 읽은 다음 호 우리 섬 칸 — editable·feeFish 는 섬장(editor 조회)에게만 온다. null = 아직·못 읽음
type PromotionRead = {
  next: (NextPromotion & { editable?: boolean }) | null;
  feeFish?: number;
} | null;
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

// ── 043~051 섬 정보 카드 · 수정 · 방장 위임 · 탈퇴 (route manage·members) ──
export function ManageRoute({ e }: ScreenProps) {
  const s: State = e.state,
    i = viewIsland(s),
    r = e.route,
    host = isHost(i),
    // 다른 섬을 구경 중(주민 아님)이면 섬 정보 카드를 방문자 뷰로 보여 준다
    visitor = !!s.visitingIslandId,
    liveIslandId = hallLiveIslandId(e, s, i);
  // review/demo에는 서버가 없으므로 관리 hook을 열지 않고 기존 시연 섬 정보를 유지한다.
  const liveManagement = (r === 'manage' || r === 'members') && !visitor && !ledgerMockMode();
  // `manage`/`members`는 실제 App 경로(CurrentScreens → Hall)다. 로컬 Island를 서버 DTO로
  // 덮어쓰지 않고 이 표면에서만 관리 API snapshot을 직접 소비한다.
  const management = useIslandManagement({
    active: liveManagement,
    islandId: visitor ? null : liveIslandId,
  });
  const [panel, setPanel] = useState<'' | 'edit' | 'transfer'>('');
  // 안드로이드 뒤로 가기는 확인창 다음에 위임 → 수정 → 닫힘 순으로 창을 닫는다
  const closePanel = useMemo(
    () => (panel ? () => setPanel(panel === 'transfer' ? 'edit' : '') : null),
    [panel],
  );
  const { font, land, W, side, g, notify, setDialog, shell } = useHallFrame(e, closePanel);
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
          name: m.name ?? t('onboarding.residentFallbackName'),
          color: m.catColor ?? NO_CAT_COLOR,
          outfit: appearanceOutfit(m.appearance),
        }))
    : i.members;
  const inviteShare = useInviteShare(liveIslandId ?? '', management.detail?.name ?? i.name, notify);
  const {
    join,
    disabled: joinDisabled,
    label: joinLabel,
    busy: visitorJoinBusy,
    serverJoin,
  } = useVisitorJoin(e, s, i, notify);
  // 잡지 홍보 칸 카드(GROMO-2894) — 섬장은 쓰기 화면과 같은 editor 조회(다음 호 칸 next · 홍보비), 주민은 다음 호 우리 섬 칸만
  // 읽는다. 역할은 이 카드의 다른 섬장 전용 동작과 같은 근거(실서버는 관리 API 역할)이고, 확정 전(조회 중)에는 부르지 않는다.
  // 회관은 route 마다 다시 마운트되므로(CurrentScreenRouter key={r}) 쓰기 화면에서 돌아오면 새로 읽어 방금 신청·수정한 칸이 보인다.
  // 실패·404(서버 배포 전 포함)는 읽은 것 없음 — 섬장은 「홍보 쓰기」 카드, 주민은 카드 없음
  const promotionRole =
    (r === 'manage' || r === 'members') && !visitor
      ? liveManagement
        ? management.role
        : host
          ? 'host'
          : 'member'
      : null;
  // 읽은 역할·섬과 함께 둔다 — 위임으로 역할이 바뀐 직후 effect 가 돌기 전 렌더에서 옛 역할의 칸이 새 역할 분기로 그려지지 않게.
  // 같은 역할·섬의 다시 읽기(앱 복귀·발행 시각)는 지우지 않고 덮어써 카드가 「홍보 쓰기」로 잠깐 깜빡이지 않는다
  const [promotionRead, setPromotionRead] = useState<{
    role: string;
    islandId: string;
    value: PromotionRead;
  } | null>(null);
  const promotion =
    promotionRead?.role === promotionRole && promotionRead?.islandId === liveIslandId
      ? promotionRead.value
      : null;
  const [promotionNonce, setPromotionNonce] = useState(0);
  useEffect(() => {
    if (!promotionRole || !liveIslandId) return;
    let alive = true;
    const api = magazineApi();
    const read: Promise<PromotionRead> =
      promotionRole === 'host'
        ? api.getPromotionEditor(liveIslandId)
        : api.getNextPromotion(liveIslandId).then((next) => ({ next }));
    read
      .then((value) => {
        if (alive) setPromotionRead({ role: promotionRole, islandId: liveIslandId, value });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [promotionRole, liveIslandId, promotionNonce]);
  // 앱 복귀 때 다시 읽는다 — 다른 기기에서 신청·수정했거나 배경에 있는 사이 07시 발행이 지났을 수 있다(useMagazineToday 와 같은 방식)
  useEffect(() => {
    if (!promotionRole) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') setPromotionNonce((n) => n + 1);
    });
    return () => sub.remove();
  }, [promotionRole]);
  // 보이는 다음 호 칸은 그 호가 나오는 KST 07시(+1분 여유, useMagazineToday 와 같다)에 다시 읽는다 — 회관을 켜 둔 채 발행을 넘기면
  // 섬장은 「홍보 쓰기」로 돌아가고 주민 카드는 사라진다. 발행이 늦어 아직 next 가 오면 10분 뒤 다시(서버 발행 재시도 간격).
  // 읽을 때마다(promotionRead) 다시 건다
  const publishCheckAt = promotion?.next
    ? Date.parse(`${promotion.next.issueDate}T07:01:00+09:00`)
    : NaN;
  useEffect(() => {
    if (!Number.isFinite(publishCheckAt)) return;
    const wait = publishCheckAt - Date.now();
    const id = setTimeout(() => setPromotionNonce((n) => n + 1), wait > 0 ? wait : 10 * 60_000);
    return () => clearTimeout(id);
  }, [publishCheckAt, promotionRead]);

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
              {t('ui.hall.loadingIsland')}
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
              accessibilityLabel={t('common.retry')}
              onPress={() => void management.reload().catch(() => undefined)}
            >
              <T style={g(14, 22.4, { color: CARD_INK, textDecorationLine: 'underline' })}>
                {t('common.retry')}
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
              {t('ui.hall.manageResidentsOnly')}
            </T>
            <Pressable
              testID="hall-management-retry"
              accessibilityRole="button"
              accessibilityLabel={t('common.retry')}
              onPress={() => void management.reload().catch(() => undefined)}
            >
              <T style={g(14, 22.4, { color: CARD_INK, textDecorationLine: 'underline' })}>
                {t('common.retry')}
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
      notify(t('ui.hall.finishFocusFirst'));
      return;
    }
    if (
      (liveManagement ? managementHost : host) &&
      (liveManagement ? (management.members?.length ?? 0) > 1 : i.members.length > 0)
    ) {
      notify(t('ui.hall.hostMustTransfer'));
      setPanel('transfer');
      return;
    }
    if (liveManagement) {
      // 서버 모드(4-06): 확인창은 서버 섬 이름·주민 수로, 탈퇴는 서버 명령으로 보낸다.
      // 탈퇴 뒤 어느 섬이 current 가 될지는 서버 재조회가 정한다 — 이동 목적지를 약속하지 않는다.
      const liveSolo = (management.members?.length ?? 0) <= 1;
      const islandName = management.detail?.name ?? '';
      setDialog({
        title: t('ui.hall.leaveIsland', { v0: eul(islandName) }),
        text: t(liveSolo ? 'hall.leave.soloText' : 'hall.leave.memberText'),
        detail: t('hall.leave.detail'),
        ok: liveSolo ? t('ui.hall.deleteAndLeave') : t('ui.hall.leave'),
        danger: true,
        onOk: () =>
          void runManagement(async () => {
            const commands = e.islands;
            if (!commands || !liveIslandId) return;
            const my = await commands.leave(liveIslandId);
            // 재조회한 current 가 응답보다 최신이라 먼저 본다 — 다른 섬이 current 면 홈. current 가 비고 서버가
            // 먼바다라고 했으면 바다로(GROMO-2366), 다음 위치를 모르면(구 응답) App 이 보낸다.
            if (my.currentIslandId) e.home();
            else if (my.nextLocation?.islandId === null) e.reset('sea');
          }, t('ui.hall.leftIsland')),
      });
      return;
    }
    const solo = !i.members.length;
    setDialog({
      title: t('ui.hall.leaveIsland', { v0: eul(i.name) }),
      // 서버 경로와 같은 문구 — 행선지(다른 소속 섬·바다)는 약속하지 않는다.
      text: t(solo ? 'hall.leave.soloText' : 'hall.leave.memberText'),
      detail: t('hall.leave.detail'),
      ok: solo
        ? next
          ? t('ui.hall.deleteAndWithdraw')
          : t('ui.hall.deleteAndLeave')
        : t('ui.hall.leave'),
      danger: true,
      onOk: () => {
        e.dispatch({ type: 'LEAVE' });
        if (next) e.home();
        else e.reset('sea');
      },
    });
  };
  const close = (onPress: () => void, style?: object) => (
    <NavBtn close testID="hall-close" label={t('common.close')} onPress={onPress} style={style} />
  );
  // 섬장 왕관: 아바타 지름의 절반 크기로 테두리 1시 방향에 걸치고 시계 방향으로 18° 기울인다.
  // Avatar는 원 밖을 잘라 내므로(overflow hidden) 바깥 형제로 겹친다
  const crown = (
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
  );
  const person = (
    // userId: 외양을 조회할 사용자 id — 주민 칸은 id 가 곧 사용자 id 라 생략하고, 가입 신청 칸(id=신청 id)만 넘긴다
    m: { id: string; userId?: string; name: string; color: string; outfit?: Outfit },
    n: number,
    opts: any = {},
  ) => (
    <View
      key={m.id}
      // 방장 칸은 보조기기가 이름 뒤에 '방장'까지 읽는다
      accessible={opts.crown || undefined}
      accessibilityLabel={
        opts.crown
          ? t('ui.hall.hostName', { v0: m.id === 'me' ? t('focusFlow.common.me') : m.name })
          : undefined
      }
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
          userId={m.userId ?? m.id}
          color={m.color}
          outfit={m.outfit}
          n={n}
          size={opts.av ?? (land ? 31 : 38)}
        />
        {opts.crown && crown}
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
        {m.id === 'me' ? t('focusFlow.common.me') : m.name}
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
      accessibilityLabel={t('ui.hall.leaveMembership')}
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
      <T style={g(15, 24, { color: '#a3453e', fontWeight: '700' })}>
        {t('ui.hall.leaveMembership')}
      </T>
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
          name: m.name ?? t('onboarding.residentFallbackName'),
          color: m.catColor ?? NO_CAT_COLOR,
          outfit: appearanceOutfit(m.appearance),
          isHost: m.role === 'host',
        }))
      : [
          ...(visitor
            ? []
            : [
                {
                  id: 'me',
                  name: t('focusFlow.common.me'),
                  color: s.color,
                  outfit: outfitOf(s),
                  isHost: host,
                },
              ]),
          ...i.members.map((m) => ({
            id: m.id,
            name: m.name,
            color: m.color,
            isHost: m.role === 'host',
          })),
        ];
  const hostId = residents.find((m) => m.isHost)?.id;
  const transferDialog = (m: { id: string; name: string }) => ({
    title: t('ui.hall.transferHost'),
    text: t('ui.hall.transferConfirm', { v0: m.name }),
    ok: t('ui.hall.transfer'),
    onOk: () => {
      if (liveManagement) {
        void runManagement(
          () => management.transferHost(m.id),
          t('ui.hall.transferred', { v0: m.name }),
          () => setPanel(''),
        );
      } else {
        e.dispatch({ type: 'TRANSFER', id: m.id });
        setPanel('');
        notify(t('ui.hall.transferred', { v0: m.name }));
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
          {option(t('ui.hall.transferHost'), 'hall-member-transfer', () =>
            setDialog(transferDialog(m)),
          )}
          {option(
            t('ui.hall.removeResident'),
            'hall-member-kick',
            () =>
              setDialog({
                title: t('ui.hall.removeConfirm'),
                text: t('ui.hall.removeDetail', { v0: eul(m.name) }),
                ok: t('ui.hall.remove'),
                danger: true,
                onOk: () => {
                  if (liveManagement)
                    void runManagement(
                      () => management.kickMember(m.id),
                      t('ui.hall.removed', { v0: m.name }),
                    );
                  else {
                    e.dispatch({ type: 'KICK', id: m.id });
                    notify(t('ui.hall.removed', { v0: m.name }));
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
              <T style={g(22, 35.2, { color: CARD_INK, fontWeight: '600' })}>
                {t('ui.hall.transferHost')}
              </T>
              <T style={g(14, 22.4, { color: '#6d5b4a', marginTop: 4 })}>
                {t('ui.hall.chooseNewHost')}
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
                accessibilityLabel={t('ui.hall.transferTo', { v0: m.name })}
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
      t('ui.hall.joinApproval'),
      t('ui.hall.joinApprovalHint'),
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
      t('ui.hall.capacity'),
      t('ui.hall.capacityStatus', {
        v0: liveManagement ? (management.members?.length ?? 0) : residentCount(i),
        v1: CAPACITY_MAX,
      }),
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
            title: t('ui.hall.capacity'),
            text: t('ui.hall.capacityHint'),
            body: (
              <View style={{ height: 132 }}>
                <Wheel
                  label=""
                  a11yLabel={t('ui.hall.capacity')}
                  items={items}
                  value={items[picked - min]}
                  onChange={(v: string) => (picked = items.indexOf(v) + min)}
                />
              </View>
            ),
            ok: t('ui.hall.set'),
            onOk: () => setDraft((d) => ({ ...d, capacity: picked })),
          });
        },
      },
    );
    const transfer = setting(
      t('ui.hall.transferHost'),
      transferCandidates.length ? t('ui.hall.transferHint') : t('ui.hall.noTransferCandidate'),
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
        accessibilityLabel={t('ui.hall.save')}
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
              t('ui.hall.saved'),
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
        <T style={g(16, 25.6, { color: CARD_INK, fontWeight: '800' })}>{t('ui.hall.save')}</T>
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
        <T style={g(22, 35.2, { color: CARD_INK, fontWeight: '600' })}>{t('ui.hall.editIsland')}</T>
        {close(() => setPanel(''), { marginTop: -9, marginRight: -8 })}
      </View>
    );
    const fields = (
      <View style={{ gap: land ? 7 : 10 }}>
        {input(t('onboarding.createIsland.nameLabel'), 'name')}
        {input(t('onboarding.createIsland.introLabel'), 'intro')}
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
  // 닫기(×)와 그 바로 왼쪽 섬장 「✏ 수정」 알약(GROMO-2894 — 이름 옆 연필 대신). 세로는 이름 줄 오른쪽 위,
  // 가로는 240 머리 칸 맨 위 오른쪽(종전 닫기 자리)에 흐름대로 둬 긴 섬 이름과 겹치지 않는다
  const headActions = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: editPill.actionsGap,
        ...(land
          ? {
              alignSelf: 'flex-end',
              marginTop: editPill.landscapePullTop,
              marginRight: editPill.landscapePullRight,
            }
          : { alignSelf: 'flex-start' }),
      }}
    >
      {displayHost && (
        <Pressable
          testID="hall-edit"
          accessibilityRole="button"
          accessibilityLabel={t('ui.hall.editIsland')}
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
          // 누르는 자리는 44, 알약 그림은 34 — 옆 닫기(44 상자 안 34 원)와 높이를 맞춘다
          style={{ minHeight: semanticTokens.size.tapMin, justifyContent: 'center' }}
        >
          <View
            style={{
              minHeight: nav.size,
              flexDirection: 'row',
              alignItems: 'center',
              gap: editPill.gap,
              paddingHorizontal: editPill.paddingHorizontal,
              borderWidth: nav.borderWidth,
              borderColor: semanticTokens.color.outline,
              borderRadius: semanticTokens.radius.full,
              backgroundColor: componentTokens.button.secondaryBackground,
              boxShadow: `0px ${nav.shadowOffset}px 0px ${semanticTokens.color.outline}`,
            }}
          >
            <Icon d={PENCIL} size={editPill.iconSize} />
            <T style={g(14, 20, { color: CARD_INK, fontWeight: '700' })}>{t('ui.hall.edit')}</T>
          </View>
        </Pressable>
      )}
      {close(e.back)}
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
      {land && headActions}
      <View style={{ minWidth: 0, flexShrink: 1 }}>
        <T style={g(land ? 32 : 38, land ? 34.56 : 41.04, { color: CARD_INK, flexShrink: 1 })}>
          {liveManagement ? management.detail?.name : i.name}
        </T>
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
      {!land && headActions}
    </View>
  );
  // 주민 칸 폭: 카드 안쪽 폭(세로 W−80, 가로 W−side−16−4−240−28)을 열 수로 나눈다.
  // 세로는 한 줄에 한 명(2열은 빈 칸이 생겨 어색 — 오스카 결정), 가로는 넓으면 4열, 좁으면 2열
  const inner = land ? W - side - 288 : W - 80,
    cols = land ? (inner >= 280 ? 4 : 2) : 1,
    cell = Math.floor((inner - (cols - 1) * 7) / cols);
  // 쓰기 화면으로 가는 버튼(「홍보 쓰기」 분홍 · 「수정하기」 Paper) — 시각 38, 누르는 자리 44(hitSlop).
  // 섬장 판정은 이 카드의 다른 섬장 전용 동작과 같은 displayHost 다 — 실서버 관리 화면에서는 관리 API 의 지금 역할이라
  // 여기서 위임하거나 다른 기기에서 위임받은 것이 바로 반영된다(홈 스냅샷은 늦을 수 있다). 뒤로가기는 App 기록으로 이 카드에 돌아온다
  const editorButton = (
    testID: string,
    label: string,
    backgroundColor: string,
    children: React.ReactNode,
  ) => (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      // 위임 등 관리 쓰기가 끝나 역할이 다시 확정되기 전에는 못 들어간다 — 그 사이 회관을 떠나면 확정 역할(host)이
      // 위임 전 값으로 남아 쓰기 화면이 섬장으로 열린다
      accessibilityState={{ disabled: managementBusy }}
      disabled={managementBusy}
      onPress={() => e.go('promotionEditor')}
      hitSlop={(semanticTokens.size.tapMin - componentTokens.button.heightSmall) / 2}
      style={{
        minHeight: componentTokens.button.heightSmall,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: promo.buttonGap,
        paddingHorizontal: promo.buttonPaddingX,
        borderWidth: componentTokens.button.borderWidth,
        borderColor: semanticTokens.color.outline,
        borderRadius: componentTokens.button.radius,
        backgroundColor,
        boxShadow: managementBusy
          ? 'none'
          : `0px ${promo.buttonShadowOffset}px 0px ${semanticTokens.color.outline}`,
        opacity: managementBusy ? componentTokens.button.disabledOpacity : 1,
      }}
    >
      {children}
    </Pressable>
  );
  const buttonText = (text: string) => (
    <T style={g(14, 21, { color: CARD_INK, fontWeight: '700' })}>{text}</T>
  );
  // 잡지 홍보 칸 카드(GROMO-2894) — 친구 초대 줄 바로 아래. 섬장: 다음 호 칸이 없으면(조회 중·실패 포함) 잡지 표지 +
  // 「홍보 쓰기」, 있으면 쓰기 화면과 같은 AdCell 미리보기 + 접수 발도장 + 실릴 호(마감 전이면 「수정하기」).
  // 주민: 다음 호 칸이 있을 때만 칸 + 「○○ 섬장이 홍보를 신청했어요」. 07시에 실리면 서버가 next 를 주지 않아
  // 섬장은 「홍보 쓰기」로 돌아가고 주민 카드는 사라진다(실린 칸은 잡지에서 본다)
  const nextPromotion = promotion?.next ?? null;
  const facts = nextPromotion && editorIsland(s, !!e.islands).facts;
  const cellW = Math.floor(inner - 2 * (promotionSlot.padding + promotionSlot.borderWidth));
  const hostIndex = residents.findIndex((m) => m.isHost);
  const hostMember: { id: string; name: string; color: string; outfit?: Outfit } | undefined =
    residents[hostIndex];
  // 도장은 카드 종이(promotionSlot)의 직접 자식으로 칸 오른쪽 위 모서리에 찍는다 — 카드 바탕까지 곱해져야 칸 밖으로
  // 걸친 부분도 크림색 원이 안 보인다(웹은 View 마다 따로 겹침 맥락이라 칸만 감싼 View 안이면 바깥이 그대로 보였다)
  const preview = nextPromotion && facts && (
    <>
      <AdCell
        testID="hall-promotion-cell"
        width={cellW}
        // 쓰기 화면처럼 「주민·평균」 줄은 그리지 않는다 — 평균은 07시 발행 때 정해진다
        hideMeta
        cell={{ ...facts, body: nextPromotion.body, layout: nextPromotion.layout }}
      />
      <View
        testID="hall-promotion-stamp"
        pointerEvents="none"
        style={{
          position: 'absolute',
          right: promotionSlot.padding - cellW * promo.stamp.rightRatio,
          top: promotionSlot.padding - cellW * CELL_ASPECT * promo.stamp.topRatio,
          width: cellW * promo.stamp.widthRatio,
          height: cellW * promo.stamp.widthRatio,
          opacity: promo.stamp.opacity,
          // 도장 그림의 크림색 바탕이 칸·스티커를 덮지 않게 곱하기로 찍는다(시안과 같다). 섞기는 View 스타일이라 감싼다
          mixBlendMode: 'multiply',
          transform: [{ rotate: promo.stamp.rotation }],
        }}
      >
        <Image
          source={MAGAZINE_STAMP}
          accessible={false}
          resizeMode="contain"
          style={{ width: '100%', height: '100%' }}
        />
      </View>
    </>
  );
  const [, issueMonth, issueDay] = (nextPromotion?.issueDate ?? '').split('-').map(Number);
  const promotionCard = displayHost ? (
    preview ? (
      <View testID="hall-promotion-card" style={promotionSlot}>
        {preview}
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: promo.footerGap,
          }}
        >
          <T testID="hall-promotion-issue" style={g(14, 21, { color: MUTED })}>
            {t('magazine.hall.issue', { month: issueMonth, day: issueDay })}
          </T>
          {nextPromotion?.editable &&
            editorButton(
              'hall-promotion-edit',
              t('magazine.hall.edit'),
              componentTokens.button.secondaryBackground,
              buttonText(t('magazine.hall.edit')),
            )}
        </View>
      </View>
    ) : (
      <View
        testID="hall-promotion-card"
        style={[promotionSlot, { flexDirection: 'row', alignItems: 'center', gap: promo.rowGap }]}
      >
        <Image
          source={MAGAZINE_UI.cover}
          accessible={false}
          resizeMode="contain"
          style={{
            width: promo.cover.width,
            height: promo.cover.width * promo.cover.aspect,
            marginTop: promo.cover.top,
            marginBottom: promo.cover.bottom,
            marginLeft: promo.cover.left,
            transform: [{ rotate: promo.cover.rotation }],
          }}
        />
        <View style={{ flex: 1, alignItems: 'flex-start', gap: promo.stackGap }}>
          <T style={g(15, 20.25, { color: CARD_INK, fontWeight: '700' })}>
            {t('magazine.editor.entry')}
          </T>
          {editorButton(
            'hall-promotion-editor',
            t('magazine.editor.entry'),
            componentTokens.button.background,
            <>
              {buttonText(t('magazine.hall.write'))}
              {/* 홍보비는 서버가 준 값만 — 읽기 전·실패면 숫자를 지어내지 않고 버튼 글자만 둔다 */}
              {promotion?.feeFish != null && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: promo.fishGap }}>
                  <Image
                    source={art.fish}
                    accessible={false}
                    style={{ width: promo.fishSize, height: promo.fishSize }}
                  />
                  {buttonText(String(promotion.feeFish))}
                </View>
              )}
            </>,
          )}
        </View>
      </View>
    )
  ) : (
    preview && (
      <View testID="hall-promotion-card" style={promotionSlot}>
        {preview}
        {hostMember && (
          <View
            testID="hall-promotion-host"
            style={{ flexDirection: 'row', alignItems: 'center', gap: promo.hostGap }}
          >
            <View>
              <Avatar
                userId={hostMember.id}
                color={hostMember.color}
                outfit={hostMember.outfit}
                n={hostIndex}
                size={promo.hostAvatar}
              />
              {crown}
            </View>
            <T style={g(14, 21, { color: CARD_INK, fontWeight: '700', flexShrink: 1 })}>
              {t('magazine.hall.applied', { name: hostMember.name })}
            </T>
          </View>
        )}
      </View>
    )
  );
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
          t('onboarding.joinRequest'),
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
                  userId: 'applicantId' in q ? q.applicantId : undefined,
                  name: q.name ?? t('ui.hall.applicant'),
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
                accessibilityLabel={t('ui.hall.rejectApplicant', {
                  v0: q.name ?? t('ui.hall.applicant'),
                })}
                accessibilityState={{ disabled: managementBusy }}
                disabled={managementBusy}
                onPress={() => {
                  if (liveManagement)
                    void runManagement(
                      () => management.answerRequest(q.id, 'reject'),
                      t('ui.hall.rejectedApplicant', { v0: q.name ?? t('ui.hall.applicant') }),
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
                accessibilityLabel={t('ui.hall.approveApplicant', {
                  v0: q.name ?? t('ui.hall.applicant'),
                })}
                accessibilityState={{ disabled: managementBusy }}
                disabled={managementBusy}
                onPress={() => {
                  if (liveManagement)
                    void runManagement(
                      () => management.answerRequest(q.id, 'approve'),
                      t('ui.hall.approvedApplicant', { v0: q.name ?? t('ui.hall.applicant') }),
                      undefined,
                      'approve',
                    );
                  else if (isFull(i)) notify(t('ui.hall.roomFull'));
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
                <T style={g(14, 22.4, { color: CARD_INK, fontWeight: '700' })}>
                  {t('ui.hall.approve')}
                </T>
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
        t('ui.hall.residents'),
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          {residents.map((m, n) =>
            displayHost && !m.isHost ? (
              <Pressable
                key={m.id}
                testID={`hall-member-${m.id}`}
                accessibilityRole="button"
                accessibilityLabel={t('ui.hall.manageResident', { v0: m.name })}
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
        usesSharedWebIsland() && liveIslandId === sharedWebIslandId()
          ? t('ui.hall.unlimitedCapacity', { v0: residents.length })
          : t('ui.hall.residentCount', {
              v0: residents.length,
              v1: liveManagement ? (management.detail?.maxMembers ?? 0) : capacityOf(i),
            }),
      )}
      {!visitor && (
        <View style={{ marginTop: land ? 5 : 14, paddingTop: 6 }}>
          <View
            style={{
              minHeight: land ? 45 : 58,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <T style={g(16, 25.6, { color: CARD_INK, fontWeight: '700' })}>
              {t('ui.hall.inviteFriends')}
            </T>
            <Pressable
              testID="hall-invite"
              accessibilityRole="button"
              accessibilityLabel={t('ui.hall.inviteFriends')}
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
          {promotionCard}
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
