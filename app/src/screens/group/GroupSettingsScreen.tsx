import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { useUser } from '@/store/UserContext';
import { getGroupDetail, groupErrorCode, withdrawGroup } from '@/services/groupApi';
import type { GroupDetailResponse } from '@/types/dto/group';
import type { V2RootStackParamList } from '@/navigation/types';

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

export default function GroupSettingsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { groupId } = useRoute<GroupSettingsRoute>().params;
  const { userId } = useUser();

  const [detail, setDetail] = useState<GroupDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // 요청 시퀀스 — 겹친 조회 중 늦게 온 이전 응답이 최신을 덮지 않게 한다(그룹 3화면 공통 패턴).
  const requestSeqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(false);
    try {
      const d = await getGroupDetail(groupId);
      if (seq !== requestSeqRef.current) return;
      setDetail(d);
    } catch {
      if (seq !== requestSeqRef.current) return;
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

  // 내 권한 판정 — 상세 응답에 내 role이 없어 멤버 목록에서 직접 계산한다(GroupRoomScreen과 동일).
  const me = userId ? detail?.members.find((m) => m.userId === userId) : undefined;
  const isOwner = me?.role === 'OWNER';
  const groupName = detail?.name ?? '';

  const doLeave = useCallback(async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      await withdrawGroup(groupId);
      navigation.popToTop(); // 그룹 목록(스택 최하단)으로 복귀
    } catch (e) {
      switch (groupErrorCode(e)) {
        case 'HOST_WITHDRAW':
          // A-2: 방장은 바로 나갈 수 없다 — 위임 화면으로 유도(위임 직후 자동 나가기까지).
          Alert.alert(
            '방장은 바로 나갈 수 없어요',
            '그룹을 이어갈 멤버에게 방장을 넘기면 나갈 수 있어요.',
            [
              { text: '취소', style: 'cancel' },
              {
                text: '방장 넘기고 나가기',
                onPress: () =>
                  navigation.navigate('GroupOwnerTransfer', { groupId, source: 'withdraw' }),
              },
            ],
          );
          break;
        case 'NOT_FOUND':
        case 'MEMBER_ONLY':
          // 이미 빠져 있는 상태 — 성공과 같게 취급한다.
          navigation.popToTop();
          break;
        default:
          Alert.alert('그룹 나가기 실패', '잠시 후 다시 시도해주세요.');
      }
    } finally {
      setLeaving(false);
    }
  }, [groupId, leaving, navigation]);

  const confirmLeave = useCallback(() => {
    // 확인 Alert 형식은 앱 관행대로 (동작명, 질문) — 대상에 인용부호를 쓰지 않는다.
    Alert.alert('그룹 나가기', `${groupName}에서 나갈까요?`, [
      { text: '취소', style: 'cancel' },
      { text: '나가기', style: 'destructive', onPress: () => doLeave() },
    ]);
  }, [groupName, doLeave]);

  // 헤더 — 원형 백버튼 + 좌측 정렬 제목(그룹 만들기·프로필 화면과 같은 규격, §5-1).
  const header = (
    <View style={s.header}>
      <TouchableOpacity
        style={s.backBtn}
        onPress={() => navigation.goBack()}
        activeOpacity={0.7}
        accessibilityLabel="뒤로"
      >
        <Ionicons name="chevron-back" size={18} color={T.inkSub} />
      </TouchableOpacity>
      <Text style={s.headerTitle}>그룹 설정</Text>
    </View>
  );

  // 관리 진입 행 — 라벨 + 우측 chevron. 각각 다른 라우트로 push한다.
  function navRow(
    icon: keyof typeof Ionicons.glyphMap,
    label: string,
    onPress: () => void,
    testID: string,
  ) {
    return (
      <TouchableOpacity style={s.navRow} activeOpacity={0.7} onPress={onPress} testID={testID}>
        <View style={s.navIcon}>
          <Ionicons name={icon} size={17} color={T.accent} />
        </View>
        <Text style={s.navLabel}>{label}</Text>
        <Ionicons name="chevron-forward" size={16} color={T.inkMuted} />
      </TouchableOpacity>
    );
  }

  const leaveButton = (
    <TouchableOpacity
      style={s.leaveRow}
      activeOpacity={0.7}
      onPress={confirmLeave}
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
      <Text style={s.leaveLabel}>그룹 나가기</Text>
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
        <Text style={s.emptyTitle}>그룹을 불러오지 못했어요</Text>
        <Text style={s.emptyDesc}>잠시 후 다시 시도해주세요.</Text>
        <TouchableOpacity style={s.retryBtn} activeOpacity={0.85} onPress={() => load()}>
          <Text style={s.retryText}>다시 시도</Text>
        </TouchableOpacity>
      </View>
    );
  } else {
    // ── 허브 — 방장은 관리 행 + 나가기, 비방장은 나가기만 ──
    body = (
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + T.space.xxl }]}
        showsVerticalScrollIndicator={false}
      >
        {isOwner && (
          <>
            <Text style={s.sectionTitle}>그룹 관리</Text>
            <View style={s.navGroup}>
              {navRow(
                'create-outline',
                '그룹 프로필 설정하기',
                () => navigation.navigate('GroupProfileEdit', { groupId }),
                'group.settings.profile',
              )}
              {navRow(
                'swap-horizontal',
                '방장 넘기기',
                () => navigation.navigate('GroupOwnerTransfer', { groupId, source: 'settings' }),
                'group.settings.transfer',
              )}
              {navRow(
                'people-outline',
                '멤버 관리',
                () => navigation.navigate('GroupMemberManage', { groupId }),
                'group.settings.members',
              )}
              {navRow(
                'megaphone-outline',
                '공지 권한',
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
    height: 48,
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
  navLabel: { ...T.text.label, flex: 1, color: T.ink },

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
