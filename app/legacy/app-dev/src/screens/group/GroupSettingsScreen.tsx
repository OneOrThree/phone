import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { t } from '@/i18n';
import ConfirmCardModal from '@/components/ConfirmCardModal';
import { useOverlayBlocker, useOverlayPreclaim } from '@/store/OverlaySlotContext';
import { useUser } from '@/store/UserContext';
import { getAuthSessionGeneration } from '@/services/api';
import { getGroupDetail, groupErrorCode, withdrawGroup } from '@/services/groupApi';
import { promptSessionExpired, USER_NOT_FOUND } from '@/services/sessionErrors';
import type { GroupDetailResponse } from '@/types/dto/group';
import type { V2RootStackParamList } from '@/navigation/types';
import {
  groupCardEmojiLabel,
  readGroupCardEmojiForEdit,
  type GroupCardEmoji,
} from './groupCardEmojiStore';

// 그룹 설정 = 관리 허브 (root stack 'GroupSettings') — 3차 A-1. 그룹방 ⋯ 버튼에서 바로 진입한다.
//
// 진입 → getGroupDetail(groupId) → 실패 [에러+재시도] / 로드 완료 [허브]
//
// 형태: 헤더(항상 원형 백버튼) + 행(row) 허브.
//   방장  : 그룹 프로필 설정하기(→ GroupProfileEdit) · 방장 넘기기 · 멤버 관리 · 공지 권한
//           + 맨 아래 '그룹 나가기'
//   비방장: '그룹 나가기'만 (프로필/관리는 방장 전용)
//
// ⚠️ 나가기는 여기서 처리한다(그룹방 ⋯ 메뉴에서 이관, A안). 성공하면 popToTop으로 그룹 목록으로
//    복귀한다(허브·그룹방이 모두 목록 위에 push된 라우트라 목록이 스택 최하단이다). 방장은
//    HOST_WITHDRAW로 튕기므로 위임 화면(source:'withdraw')으로 유도한다.
// ⚠️ 편집·관리 행은 방장 전용 — 멤버십은 다른 기기에서 바뀔 수 있어(위임·강퇴) 상세의 내 role이
//    OWNER일 때만 노출한다(포커스마다 재조회로 재동기화).

type GroupSettingsRoute = RouteProp<V2RootStackParamList, 'GroupSettings'>;

// 나가기 플로우 카드 모달 상태 머신 — 하나만 열린다(GROMO-1251, AccountScreen 탈퇴 플로우와 같은 형태).
//   leaveConfirm : 나가기 재확인(파괴적 동작 — 정책 D8 「확인이 필요한 2버튼」이라 토스트 대상이 아니다)
//   hostBlocked  : 방장 블록(HOST_WITHDRAW) — 위임 화면으로 유도
//   leaveFailed  : 나가기 실패(재시도 유효) — 문구는 종전 네이티브 Alert 그대로
// ⚠️ 확인 카드를 닫았다가 다른 카드/Alert를 새로 띄우면 iOS에서 연속 present/dismiss가 경합해
//    **뒤엣것이 안 뜬다**(GROMO-1210에서 확인한 실패 모드). 그래서 종결 안내는 닫고 새로 띄우는
//    대신 한 인스턴스의 **내용만 갈아** 보여준다.
type LeaveModalState = { kind: 'leaveConfirm' } | { kind: 'hostBlocked' } | { kind: 'leaveFailed' };

export default function GroupSettingsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { groupId } = useRoute<GroupSettingsRoute>().params;
  const { userId } = useUser();

  const [detail, setDetail] = useState<GroupDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [cardEmoji, setCardEmoji] = useState<GroupCardEmoji | null>(null);
  const [cardEmojiLoadFailed, setCardEmojiLoadFailed] = useState(false);
  // 나가기 확인 + 방장 블록(HOST_WITHDRAW) 안내 — 네이티브 Alert 대신 앱 컨셉 카드 모달
  // (GROMO-1210 블록 안내 · GROMO-1251 확인 이관).
  const [leaveModal, setLeaveModal] = useState<LeaveModalState | null>(null);
  // ⚠️ 이건 **우리 트리 안의 RN Modal**이다 — 조정자가 원래 덮어야 할 대상인데 빠져 있었다.
  //    등록하지 않으면 나가기 확인 카드가 열린 채로 결과 모달이 함께 마운트된다.
  //    사용자 탭으로 열리므로 승인을 기다리지 않는다(A/B 기준 — OverlaySlotContext 헤더).
  useOverlayBlocker('groupSettings.leaveConfirm', leaveModal !== null);
  // ⚠️ 여는 이벤트에서 **먼저** 자리를 잡는다 — 선언형 등록은 커밋 **뒤**라, 시트 열기와
  //    결과 claim 완료가 같은 배치에 들어가면 호스트가 아직 없는 blocker를 못 보고
  //    결과 모달을 함께 커밋한다(useOverlayPreclaim 주석).
  const preclaimLeaveConfirm = useOverlayPreclaim('groupSettings.leaveConfirm');

  // 요청 시퀀스 — 겹친 조회 중 늦게 온 이전 응답이 최신을 덮지 않게 한다(그룹 3화면 공통 패턴).
  const requestSeqRef = useRef(0);
  const emojiRequestSeqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(false);
    const requestSessionGeneration = getAuthSessionGeneration();
    try {
      const d = await getGroupDetail(groupId);
      if (seq !== requestSeqRef.current) return;
      setDetail(d);
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      // 진입 조회의 유저 부재(GROMO-1247) — 액션 실패와 **다른 자리**다. 여기서 코드를 안 보면
      // 활성 users 행이 이미 없는 세션은 '다시 시도' 버튼만 무한히 누르게 된다(재시도로 안 풀린다).
      // 에러 상태는 그대로 세운다 — 로그아웃 언마운트 전까지 화면이 성공처럼 보이면 안 된다.
      if (groupErrorCode(e) === USER_NOT_FOUND) promptSessionExpired(requestSessionGeneration);
      setError(true);
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, [groupId]);

  // 포커스마다 재조회 — 프로필편집·위임·강퇴에서 돌아오면 role/이름이 바뀌어 있을 수 있다.
  useFocusEffect(
    useCallback(() => {
      load();
      return () => {
        requestSeqRef.current++;
      };
    }, [load]),
  );

  // 편집 화면에서 돌아올 때 현재 계정×그룹의 로컬 선택을 다시 읽는다. 저장소 오류를 기본
  // 아이콘으로 위장하지 않아, 설정 행이 실제 선택과 다른 값을 현재값으로 안내하지 않게 한다.
  useFocusEffect(
    useCallback(() => {
      const seq = ++emojiRequestSeqRef.current;
      setCardEmoji(null);
      setCardEmojiLoadFailed(false);
      readGroupCardEmojiForEdit(userId, groupId).then(
        (emoji) => {
          if (seq !== emojiRequestSeqRef.current) return;
          setCardEmoji(emoji);
        },
        () => {
          if (seq !== emojiRequestSeqRef.current) return;
          setCardEmojiLoadFailed(true);
        },
      );
      return () => {
        emojiRequestSeqRef.current++;
      };
    }, [groupId, userId]),
  );

  // 내 권한 판정 — 상세 응답에 내 role이 없어 멤버 목록에서 직접 계산한다(GroupRoomScreen과 동일).
  const me = userId ? detail?.members.find((m) => m.userId === userId) : undefined;
  const isOwner = me?.role === 'OWNER';
  const groupName = detail?.name ?? '';

  const doLeave = useCallback(async () => {
    if (leaving) return;
    setLeaving(true);
    // 요청 직전의 인증 세대 — 유저 부재 분기의 로그아웃 판정용(sessionErrors.ts 주석).
    const requestSessionGeneration = getAuthSessionGeneration();
    try {
      await withdrawGroup(groupId);
      setLeaveModal(null); // 화면이 사라지기 전에 카드를 내린다(모달을 띄운 채 언마운트하지 않는다)
      navigation.popToTop(); // 그룹 목록(스택 최하단)으로 복귀
    } catch (e) {
      switch (groupErrorCode(e)) {
        case 'HOST_WITHDRAW':
          // A-2: 방장은 바로 나갈 수 없다 — 카드 모달로 위임 화면 유도(위임 직후 자동 나가기까지).
          // 확인 카드를 닫지 않고 **내용만** 블록 안내로 바꾼다(위 상태 머신 주석).
          setLeaveModal({ kind: 'hostBlocked' });
          break;
        // 유저 부재(GROMO-1247) — 없어진 건 그룹이 아니라 **내 계정**이다. 아래 '이미 빠져
        // 있음'과 같이 묶으면 탈퇴·비활성 세션을 「나가기 성공」으로 위장해 목록으로 돌려보낸다.
        // 그룹은 그대로 있고 사용자는 그 사실을 모른 채 로그인만 만료돼 있다.
        case USER_NOT_FOUND:
          // ⚠️ 카드를 **닫지 않는다.** 닫으면서 Alert를 띄우면 iOS에서 Modal dismiss와 Alert
          //    present가 같은 틱에 경합해 안내가 안 뜰 수 있는데, 그러면 **확인 버튼에만 있는
          //    로그아웃 경로가 통째로 사라진다**(세션 복구 유실). 카드는 그대로 둔 채 그 위에
          //    띄운다 — 확인하면 로그아웃이 트리를 갈아치우고, 낡은 세대라 안내가 생략되면
          //    (sessionErrors ①) 카드는 취소 가능한 상태로 남는다.
          promptSessionExpired(requestSessionGeneration);
          break;
        case 'NOT_FOUND':
        case 'MEMBER_ONLY':
          // 이미 빠져 있는 상태 — 성공과 같게 취급한다(화면 자체가 사라지므로 카드를 먼저 내린다).
          setLeaveModal(null);
          navigation.popToTop();
          break;
        default:
          // 실패 안내도 같은 카드 인스턴스의 내용 교체로 보여준다 — 닫고 Alert를 띄우던 종전
          // 순서가 위와 같은 경합을 만든다. 문구는 종전 Alert 그대로다.
          setLeaveModal({ kind: 'leaveFailed' });
      }
    } finally {
      setLeaving(false);
    }
  }, [groupId, leaving, navigation]);

  // ⚠️ 나가기 요청이 나가 있는 동안엔 **어떤 닫기도 받지 않는다**(보조 버튼·스크림 탭·하드웨어 백).
  //    닫히면 사용자는 취소했다고 믿는데 요청은 그대로 진행돼 **성공하면 실제로 그룹에서 나간다** —
  //    되돌릴 수 없는 동작에 "취소한 척하고 나가지는" 경로를 열어 두면 안 된다.
  //    (요청을 중간에 끊을 수단이 없으므로 '닫힘 = 취소'가 참이 되도록 닫힘 쪽을 막는다.)
  const closeLeaveModal = useCallback(() => {
    if (leaving) return;
    setLeaveModal(null);
  }, [leaving]);

  // 닫힘 페이드아웃 동안 내용이 확인 카드로 되튀지 않게 마지막 내용을 ref로 유지한다(AccountScreen 선례).
  const lastLeaveModalRef = useRef<LeaveModalState>({ kind: 'leaveConfirm' });
  if (leaveModal !== null) lastLeaveModalRef.current = leaveModal;
  const shownLeaveModal = leaveModal ?? lastLeaveModalRef.current;

  // 상태별 카드 내용 — 문구는 기존 네이티브 Alert 그대로다(표면만 바꾼다, GROMO-1210 원칙).
  let leaveCard: {
    title: string;
    body: string;
    primaryLabel: string;
    onPrimary: () => void;
    primaryDisabled?: boolean;
    destructive?: boolean;
    secondaryLabel?: string;
    testID: string;
  };
  switch (shownLeaveModal.kind) {
    case 'hostBlocked':
      leaveCard = {
        title: t('group.settingsScreen.hostBlockedTitle'),
        body: t('group.settingsScreen.hostBlockedBody'),
        primaryLabel: t('group.settingsScreen.hostBlockedPrimary'),
        onPrimary: () => {
          setLeaveModal(null);
          navigation.navigate('GroupOwnerTransfer', { groupId, source: 'withdraw' });
        },
        secondaryLabel: t('common.cancel'),
        testID: 'group.settings.hostBlocked',
      };
      break;
    case 'leaveFailed':
      leaveCard = {
        title: t('group.settingsScreen.leaveFailedTitle'),
        body: t('common.retryLater'),
        primaryLabel: t('common.confirm'),
        onPrimary: closeLeaveModal,
        testID: 'group.settings.leaveFailed',
      };
      break;
    default:
      leaveCard = {
        // 확인 문구 형식은 앱 관행대로 (동작명, 질문) — 대상에 인용부호를 쓰지 않는다.
        title: t('group.settingsScreen.leaveTitle'),
        body: t('group.settingsScreen.leaveConfirm', { name: groupName }),
        primaryLabel: t('group.settingsScreen.leavePrimary'),
        onPrimary: () => doLeave(),
        // 요청이 나가 있는 동안 재탭을 막는다(doLeave의 leaving 가드와 이중 방어).
        primaryDisabled: leaving,
        destructive: true,
        // 진행 중엔 '취소' 자체를 렌더하지 않는다 — 위 closeLeaveModal 가드가 눌러도 무시하지만,
        // 누를 수 있게 두면 "눌렀는데 아무 일도 없다"가 되어 그 또한 거짓 신호다.
        secondaryLabel: leaving ? undefined : t('common.cancel'),
        testID: 'group.settings.leave.confirm',
      };
  }

  // 헤더 — 원형 백버튼 + 좌측 정렬 제목(그룹 만들기·프로필 화면과 같은 규격, §5-1).
  const header = (
    <View style={s.header}>
      <TouchableOpacity
        style={s.backBtn}
        onPress={() => navigation.goBack()}
        activeOpacity={0.7}
        accessibilityLabel={t('common.back')}
      >
        <Ionicons name="chevron-back" size={18} color={T.inkSub} />
      </TouchableOpacity>
      <Text style={s.headerTitle}>{t('group.settingsScreen.title')}</Text>
    </View>
  );

  // 관리 진입 행 — 라벨 + 우측 chevron. 각각 다른 라우트로 push한다.
  function navRow(
    icon: keyof typeof Ionicons.glyphMap,
    label: string,
    onPress: () => void,
    testID: string,
    helper?: string,
    accessibilityLabel?: string,
  ) {
    return (
      <TouchableOpacity
        style={s.navRow}
        activeOpacity={0.7}
        onPress={onPress}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
      >
        <View style={s.navIcon}>
          <Ionicons name={icon} size={17} color={T.accent} />
        </View>
        <View style={s.navText}>
          <Text style={s.navLabel}>{label}</Text>
          {helper && <Text style={s.navHelper}>{helper}</Text>}
        </View>
        <Ionicons name="chevron-forward" size={16} color={T.inkMuted} />
      </TouchableOpacity>
    );
  }

  const leaveButton = (
    <TouchableOpacity
      style={s.leaveRow}
      activeOpacity={0.7}
      onPress={() => {
        preclaimLeaveConfirm();
        setLeaveModal({ kind: 'leaveConfirm' });
      }}
      disabled={leaving || detail === null}
      testID="group.settings.leave"
    >
      <View style={s.leaveIcon}>
        {leaving ? (
          <ActivityIndicator color={T.accentAlt} size="small" />
        ) : (
          <Ionicons name="exit-outline" size={17} color={T.accentAlt} />
        )}
      </View>
      <Text style={s.leaveLabel}>{t('group.settingsScreen.leaveTitle')}</Text>
    </TouchableOpacity>
  );

  let body: ReactNode;
  if (loading && detail === null) {
    // ── 최초 로딩 — 중앙 스피너(§5-4) ──
    body = (
      <View style={s.center}>
        <ActivityIndicator color={T.accent} />
      </View>
    );
  } else if (error && detail === null) {
    // ── 에러 + 다시 시도 ──
    body = (
      <View style={s.center}>
        <Text style={s.emptyTitle}>{t('group.settingsScreen.loadFailed')}</Text>
        <Text style={s.emptyDesc}>{t('common.retryLater')}</Text>
        <TouchableOpacity style={s.retryBtn} activeOpacity={0.85} onPress={() => load()}>
          <Text style={s.retryText}>{t('common.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  } else {
    const currentEmojiLabel = cardEmoji === null ? null : groupCardEmojiLabel(cardEmoji);
    const cardEmojiHelper = cardEmojiLoadFailed
      ? t('group.settingsScreen.cardEmojiHelperFailed')
      : currentEmojiLabel === null
        ? t('group.settingsScreen.cardEmojiHelperLoading')
        : t('group.settingsScreen.cardEmojiHelper', { emoji: cardEmoji, label: currentEmojiLabel });
    const cardEmojiAccessibilityLabel = cardEmojiLoadFailed
      ? t('group.settingsScreen.cardEmojiA11yFailed')
      : currentEmojiLabel === null
        ? t('group.settingsScreen.cardEmojiA11yLoading')
        : t('group.settingsScreen.cardEmojiA11y', { label: currentEmojiLabel });
    // ── 허브 — 내 카드 아이콘은 역할 공통, 서버 운영 행만 방장 전용 ──
    body = (
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + T.space.xxl }]}
        showsVerticalScrollIndicator={false}
      >
        {me && (
          <>
            <Text style={s.sectionTitle}>{t('group.settingsScreen.mySection')}</Text>
            <View style={s.navGroup}>
              {navRow(
                'color-palette-outline',
                t('group.settingsScreen.cardEmojiRow'),
                () => navigation.navigate('GroupCardEmojiEdit', { groupId }),
                'group.settings.cardEmoji',
                cardEmojiHelper,
                cardEmojiAccessibilityLabel,
              )}
            </View>
          </>
        )}
        {isOwner && (
          <>
            <Text style={s.sectionTitle}>{t('group.settingsScreen.manageSection')}</Text>
            <View style={s.navGroup}>
              {navRow(
                'create-outline',
                t('group.settingsScreen.profileRow'),
                () => navigation.navigate('GroupProfileEdit', { groupId }),
                'group.settings.profile',
              )}
              {navRow(
                'swap-horizontal',
                t('group.settingsScreen.transferRow'),
                () => navigation.navigate('GroupOwnerTransfer', { groupId, source: 'settings' }),
                'group.settings.transfer',
              )}
              {navRow(
                'people-outline',
                t('group.settingsScreen.membersRow'),
                () => navigation.navigate('GroupMemberManage', { groupId }),
                'group.settings.members',
              )}
              {navRow(
                'megaphone-outline',
                t('group.settingsScreen.noticePermissionRow'),
                () => navigation.navigate('GroupNoticePermission', { groupId }),
                'group.settings.noticePermission',
              )}
            </View>
          </>
        )}
        <View style={s.navGroup}>{leaveButton}</View>
      </ScrollView>
    );
  }

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="group.settings.screen">
      {header}
      {body}

      {/* 나가기 확인 + 방장 블록 안내 — 문구는 기존 Alert에서 그대로 이식(카피 정본,
          GROMO-1210·1251). 한 인스턴스의 내용만 바꾼다(위 상태 머신 주석). */}
      <ConfirmCardModal
        visible={leaveModal !== null}
        {...leaveCard}
        onSecondary={closeLeaveModal}
        onRequestClose={closeLeaveModal}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    paddingHorizontal: T.space.xl,
    paddingTop: T.space.sm,
    paddingBottom: T.space.md,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { ...T.text.heading, fontWeight: '800', color: T.ink },

  // 로딩·에러 분기 공통 중앙 블록
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: T.space.xxl,
  },
  emptyTitle: { ...T.text.title, color: T.ink, textAlign: 'center' },
  emptyDesc: { ...T.text.body, color: T.inkSub, marginTop: T.space.sm, textAlign: 'center' },
  retryBtn: {
    minHeight: 48,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.xxl,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
    marginTop: T.space.xl,
  },
  retryText: { ...T.text.label, color: T.white },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: T.space.xl, paddingTop: T.space.xs },

  // 관리 진입 섹션
  sectionTitle: { ...T.text.label, color: T.ink, marginTop: T.space.md, marginBottom: T.space.sm },
  navGroup: { gap: T.space.sm, marginTop: T.space.md },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 14,
    paddingVertical: T.space.lg,
    paddingHorizontal: T.space.lg,
  },
  navIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accentBg,
  },
  navText: { flex: 1, gap: 2 },
  navLabel: { ...T.text.label, color: T.ink },
  navHelper: { ...T.text.caption, color: T.inkSub },

  // 그룹 나가기 — 관리 행과 같은 카드 규격, 위험 색(accentAlt)
  leaveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 14,
    paddingVertical: T.space.lg,
    paddingHorizontal: T.space.lg,
  },
  leaveIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.dangerBg,
  },
  leaveLabel: { ...T.text.label, flex: 1, color: T.accentAlt, fontWeight: '700' },
});
