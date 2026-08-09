import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { Skeleton, SkeletonGroup } from '@/components/Skeleton';
import { useUser } from '@/store/UserContext';
import { getGroupDetail, groupErrorCode, kickMember } from '@/services/groupApi';
import { logGroupMemberKicked } from '@/services/analyticsEvents';
import type { GroupDetailMemberResponse } from '@/types/dto/group';
import type { V2RootStackParamList } from '@/navigation/types';

// 멤버 관리 화면 (root stack 'GroupMemberManage') — A-3 멤버 강퇴 + 재가입 차단(방장 전용).
// 계약 정본: groupApi.kickMember(DELETE /groups/{id}/members/{uid}, 방장만·204, 강퇴 멤버 재가입 차단).
//
//   진입 → getGroupDetail() → 실패 [에러+재시도] / 강퇴 대상 없음 [빈 상태] / 멤버 목록
//
// · 강퇴 대상은 **본인(useUser().userId)·방장(role==='OWNER')을 제외한** 멤버뿐이다.
//   본인 강퇴는 서버가 CANNOT_KICK_SELF로 막고, 방장은 강퇴 개념이 없다(위임은 A-2 별도 화면).
// · 강퇴는 되돌릴 수 없다(재가입 차단) → 확인 Alert에서 그 사실을 함께 알린다.
// · 성공·이미 나감(NOT_FOUND·MEMBER_ONLY)은 결과가 같으므로 둘 다 목록에서 제거로 취급한다.
// · MemberTile은 그리드 타일이고 탭이 통계 비교로 고정돼(GROMO-1200) 재사용하지 않고, 강퇴 액션이
//   붙는 자체 행(KickRow)을 둔다.

type GroupMemberManageRoute = RouteProp<V2RootStackParamList, 'GroupMemberManage'>;

// 로딩 자리표시자(GROMO-1381) — 아래 s.row 규격에서 계산한 실제 행 높이.
// paddingVertical 12×2 + borderWidth 1×2 + 행 안에서 가장 높은 요소(강퇴 버튼 34) = 60.
const ROW_H = 60;
// 첫 화면에 들어오는 만큼만 그린다(화면당 동시 스켈레톤 상한 12).
const SKELETON_ROWS = 4;

// 강퇴 대상 한 행 — 닉네임 + 우측 '내보내기'(destructive). 진행 중이면 잠근다.
interface KickRowProps {
  member: GroupDetailMemberResponse;
  disabled: boolean;
  onKick: () => void;
}

function KickRow({ member, disabled, onKick }: KickRowProps) {
  return (
    <View style={s.row}>
      <Text style={s.rowName} numberOfLines={1}>
        {member.nickname}
      </Text>
      <TouchableOpacity
        style={[s.kickBtn, disabled && s.kickBtnOff]}
        activeOpacity={0.7}
        disabled={disabled}
        onPress={onKick}
        testID={`group.member.kick.${member.userId}`}
        accessibilityLabel={`${member.nickname} 내보내기`}
      >
        <Text style={[s.kickText, disabled && s.kickTextOff]}>내보내기</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function GroupMemberManageScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { groupId } = useRoute<GroupMemberManageRoute>().params;
  const { userId } = useUser();

  // null = 아직 한 번도 못 받음(로딩·에러 판정용). 성공 후엔 배열이며, 강퇴 성공 시 로컬에서 제거한다.
  const [members, setMembers] = useState<GroupDetailMemberResponse[] | null>(null);
  const [error, setError] = useState(false);
  // 진행 중인 강퇴의 대상 userId — 버튼을 잠가 재탭을 막는다(UI용).
  const [kickingIds, setKickingIds] = useState<string[]>([]);
  // 재탭 방어(동기 가드) — 상태 갱신은 비동기라 연타 시 setState 반영 전 두 번째 DELETE가 나갈 수
  // 있다. 확인 Alert의 onPress가 쥐는 건 ref라 stale 없이 최신 진행 상태를 본다.
  const kickingRef = useRef<Set<string>>(new Set());

  // 늦게 도착한 이전 조회가 최신 화면을 덮지 않게 최신 요청만 반영한다(NoticeScreen과 같은 패턴).
  const requestSeqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    setError(false);
    try {
      const detail = await getGroupDetail(groupId);
      if (seq !== requestSeqRef.current) return;
      setMembers(detail.members);
    } catch {
      if (seq !== requestSeqRef.current) return;
      setError(true);
    }
  }, [groupId]);

  // cleanup에서 시퀀스를 올려 진행 중이던 요청을 무효화한다(언마운트 뒤 setState 방지).
  useEffect(() => {
    load();
    return () => {
      // 노드 참조가 아니라 요청 카운터라 cleanup 시점 값을 그대로 올린다.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      requestSeqRef.current++;
    };
  }, [load]);

  // 목록에서 제거 + 진행 잠금 해제 — 성공/이미 나감 모두 같은 결말이라 한 곳에서 처리한다.
  const removeMember = useCallback((targetUserId: string) => {
    kickingRef.current.delete(targetUserId);
    setMembers((prev) => (prev ? prev.filter((m) => m.userId !== targetUserId) : prev));
    setKickingIds((prev) => prev.filter((id) => id !== targetUserId));
  }, []);

  // 잠금만 해제(목록은 유지) — 공통 실패로 버튼을 다시 눌러 재시도할 수 있게 한다.
  const unlockMember = useCallback((targetUserId: string) => {
    kickingRef.current.delete(targetUserId);
    setKickingIds((prev) => prev.filter((id) => id !== targetUserId));
  }, []);

  const doKick = useCallback(
    async (target: GroupDetailMemberResponse) => {
      if (kickingRef.current.has(target.userId)) return; // 재탭 방어
      kickingRef.current.add(target.userId);
      setKickingIds((prev) => [...prev, target.userId]);
      try {
        await kickMember(groupId, target.userId);
        logGroupMemberKicked({ group_id: groupId });
        removeMember(target.userId);
      } catch (e) {
        const code = groupErrorCode(e);
        // 이미 나간 멤버(NOT_FOUND·MEMBER_ONLY)는 결과가 강퇴와 같으므로 목록에서 제거로 취급한다.
        if (code === 'NOT_FOUND' || code === 'MEMBER_ONLY') {
          removeMember(target.userId);
          return;
        }
        unlockMember(target.userId);
        // 본인 강퇴 방어(CANNOT_KICK_SELF) — 본인은 애초에 목록에서 빠져 도달 불가지만, 서버
        // 계약을 존중해 사유를 그대로 알린다.
        if (code === 'CANNOT_KICK_SELF') {
          Alert.alert('내보낼 수 없어요', '자기 자신은 내보낼 수 없어요.');
          return;
        }
        Alert.alert('내보내기 실패', '잠시 후 다시 시도해주세요.');
      }
    },
    [groupId, removeMember, unlockMember],
  );

  // 확인 Alert 형식은 앱 관행대로 (동작명, 질문) — 되돌릴 수 없음(재가입 차단)을 함께 안내한다.
  const confirmKick = useCallback(
    (target: GroupDetailMemberResponse) => {
      Alert.alert(
        '내보내기',
        `${target.nickname}님을 내보낼까요?\n내보낸 멤버는 다시 들어올 수 없어요.`,
        [
          { text: '취소', style: 'cancel' },
          { text: '내보내기', style: 'destructive', onPress: () => doKick(target) },
        ],
      );
    },
    [doKick],
  );

  // 라우트 진입의 원형 백버튼 — 로딩·에러 분기에도 세운다(루트 스택 headerShown:false·탭바 없음이라
  // 없으면 목록으로 돌아갈 명시 경로가 0개가 된다). 규격은 그룹 만들기·공지 화면과 같다.
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
      <Text style={s.headerTitle}>멤버 관리</Text>
    </View>
  );

  // ── 최초 로딩 — 멤버 행 자리표시자(GROMO-1381, 옛 중앙 스피너 대체) ──
  // 행 높이가 규격으로 고정된 목록이라 실제 도착 화면과 같은 실루엣을 그릴 수 있다.
  // 펄스는 SkeletonGroup 한 겹에만 건다(무한 루프 1개) — 기존 컨테이너 View를 그대로 교체한 것이라
  // 노드 수·여백은 변하지 않는다. 백버튼이 있는 header는 묶음 밖이라 접근성 트리에 그대로 남는다.
  // 데이터가 오면 이 분기가 사라지며 펄스(무한 루프)도 함께 언마운트된다.
  if (members === null && !error) {
    return (
      <SafeAreaView style={s.root} edges={['top']} testID="group.member.manage.screen">
        {header}
        <SkeletonGroup style={s.listContent} testID="group.member.manage.skeleton">
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <Skeleton key={i} w="100%" h={ROW_H} radius={14} />
          ))}
        </SkeletonGroup>
      </SafeAreaView>
    );
  }

  // ── 에러 + 다시 시도 ──
  if (members === null) {
    return (
      <SafeAreaView style={s.root} edges={['top']} testID="group.member.manage.screen">
        {header}
        <View style={s.center}>
          <Text style={s.emptyTitle}>멤버를 불러오지 못했어요</Text>
          <Text style={s.emptyDesc}>잠시 후 다시 시도해주세요.</Text>
          <TouchableOpacity style={s.retryBtn} activeOpacity={0.85} onPress={() => load()}>
            <Text style={s.retryText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // 강퇴 대상 — 본인·방장을 제외한 멤버(위 주석). 서버 정렬 순서를 그대로 둔다(앱 재정렬 금지).
  const kickable = members.filter((m) => m.userId !== userId && m.role !== 'OWNER');

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="group.member.manage.screen">
      {header}
      {kickable.length === 0 ? (
        <View style={s.center}>
          <Text style={s.emptyTitle}>관리할 멤버가 없어요</Text>
          <Text style={s.emptyDesc}>내보낼 수 있는 멤버가 아직 없어요.</Text>
        </View>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
        >
          {kickable.map((m) => (
            <KickRow
              key={m.userId}
              member={m}
              disabled={kickingIds.includes(m.userId)}
              onKick={() => confirmKick(m)}
            />
          ))}
        </ScrollView>
      )}
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

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: T.space.xxl,
  },
  // 화면 전체를 차지하는 에러/빈 상태 헤드라인은 T.text.title(26/800) — 그룹 화면 공통 위계.
  emptyTitle: { ...T.text.title, color: T.ink, textAlign: 'center' },
  emptyDesc: { ...T.text.body, color: T.inkSub, marginTop: T.space.sm, textAlign: 'center' },
  // 인라인 재시도 = 48 / r16 / px xxl — 그룹 탭·공지 화면과 같은 값.
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
  listContent: { paddingHorizontal: T.space.xl, paddingTop: T.space.xs, gap: T.space.sm },

  // 멤버 행 — 카드 표면 위 닉네임 + 우측 강퇴 버튼.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: T.space.md,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
  },
  rowName: { ...T.text.subtitle, color: T.ink, flexShrink: 1 },
  // 강퇴 버튼은 파괴적 톤(accentAlt) — 되돌릴 수 없는 액션임을 색으로도 알린다.
  kickBtn: {
    height: 34,
    paddingHorizontal: T.space.md,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accentAltBg,
  },
  kickBtnOff: { opacity: 0.5 },
  kickText: { ...T.text.label, color: T.accentAlt },
  kickTextOff: { color: T.inkMuted },
});
