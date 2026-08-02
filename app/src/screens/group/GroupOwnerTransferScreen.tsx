import { useCallback, useEffect, useState } from 'react';
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
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { useUser } from '@/store/UserContext';
import {
  getGroupDetail,
  groupErrorCode,
  transferOwner,
  withdrawGroup,
} from '@/services/groupApi';
import { logGroupOwnerTransferred } from '@/services/analyticsEvents';
import type { GroupDetailMemberResponse, GroupDetailResponse } from '@/types/dto/group';
import type { V2RootStackParamList } from '@/navigation/types';

// 방장 위임 화면 (root stack 'GroupOwnerTransfer') — A-2, 명세 docs/app/group-plan.md §A-2.
//
// 방장 전용. 여러 진입 경로가 이 한 화면을 재사용하고, 위임 성공 뒤 동작만 source로 갈린다:
//   · settings : 위임만 하고 설정 허브로 복귀(허브가 포커스 재조회로 갱신)
//   · withdraw : 위임 직후 그룹 나가기까지 실행(방장은 곧장 못 나가므로 넘기고 나간다)
//   · account  : 계정 탈퇴 흐름 — 위임만 하고 계정 화면으로 복귀(소유 그룹 수만큼 반복)
//
// 대상 목록은 **본인을 제외한 전 멤버**다(방장은 자기 자신에게 넘길 수 없다). 행은 탭으로
// 단일 선택되고, 선택이 있어야 하단 '넘기기'가 활성된다. 위임(+후속)이 진행되는 동안에는
// 재탭·재선택·뒤로가기를 모두 잠근다 — 위임은 되돌릴 수 없어 한 번만 나가야 한다.

type GroupOwnerTransferRoute = RouteProp<V2RootStackParamList, 'GroupOwnerTransfer'>;

// 분 → '0분' / '45분' / '2시간' / '2시간 30분'. 누적 집중 시간(리더보드 지표)의 축약 표기 —
// MemberTile.fmtFocus와 같은 규칙이지만 그 파일은 default export뿐이라 여기서 다시 둔다.
function fmtFocus(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total}분`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

// 위임 대상 행 — 표시 전용 MemberTile과 달리 **탭 가능·단일 선택 하이라이트**가 필요해 자체로 둔다.
interface TransferRowProps {
  member: GroupDetailMemberResponse;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}

function TransferRow({ member, selected, disabled, onPress }: TransferRowProps) {
  return (
    <TouchableOpacity
      style={[s.row, selected ? s.rowOn : null]}
      activeOpacity={0.8}
      disabled={disabled}
      onPress={onPress}
      testID={`group.owner.transfer.member.${member.userId}`}
    >
      <View style={s.rowTexts}>
        <Text style={[s.rowName, selected ? s.rowNameOn : null]} numberOfLines={1}>
          {member.nickname}
        </Text>
        <Text style={s.rowSub} numberOfLines={1}>
          누적 {fmtFocus(member.totalFocusMinutes)}
        </Text>
      </View>
      {/* 단일 선택 표시 — 선택된 행만 채워진 체크 원 */}
      <View style={[s.radio, selected ? s.radioOn : null]}>
        {selected && <Ionicons name="checkmark" size={14} color={T.white} />}
      </View>
    </TouchableOpacity>
  );
}

export default function GroupOwnerTransferScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { params } = useRoute<GroupOwnerTransferRoute>();
  const { groupId, source } = params;
  const { userId } = useUser();

  const [detail, setDetail] = useState<GroupDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 위임(+source별 후속)이 진행 중인가 — 재탭·재선택·뒤로가기를 잠근다.
  const [submitting, setSubmitting] = useState(false);

  // 마운트 시 1회(재시도 시 재호출) — 멤버 목록만 있으면 되므로 date 없이 부른다(오늘 집중분은 안 쓴다).
  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await getGroupDetail(groupId);
      setDetail(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  // 본인을 제외한 전 멤버가 위임 대상이다(방장은 자기에게 넘길 수 없다).
  const members = detail?.members ?? [];
  const candidates = members.filter((m) => m.userId !== userId);
  const selectedMember = candidates.find((m) => m.userId === selectedId) ?? null;

  // 위임 확정 — transferOwner 성공 후 source별로 후속이 갈린다. 진행 중 재진입은 위에서 막는다.
  const doTransfer = useCallback(
    async (target: GroupDetailMemberResponse) => {
      if (submitting) return;
      setSubmitting(true);
      try {
        await transferOwner(groupId, target.userId);
        // 계측은 위임이 실제로 성공한 뒤에만 발행한다(source는 시작 경로).
        logGroupOwnerTransferred({ group_id: groupId, source });

        if (source === 'withdraw') {
          // 위임 직후 나가기 — 이제 나는 MEMBER라 서버가 나가기를 허용한다.
          try {
            await withdrawGroup(groupId);
            // 그룹 목록 루트(그룹 탭)로 복귀 — 중간의 그룹방·설정 스택을 모두 걷어낸다.
            navigation.popToTop();
          } catch {
            // 위임은 이미 끝났다 — 나가기만 실패했음을 따로 알린다(재시도는 그룹방에서).
            Alert.alert(
              '그룹 나가기 실패',
              '방장은 넘겼지만 나가기에 실패했어요. 그룹에서 직접 나가주세요.',
            );
            navigation.goBack();
          }
          return;
        }

        // settings·account 공통 — 위임만 하고 이전 화면으로 돌아간다(허브·계정 화면이 재조회).
        Alert.alert('방장을 넘겼어요', `${target.nickname}님이 새 방장이 되었어요.`);
        navigation.goBack();
      } catch (e) {
        // HTTP status가 아니라 code로 분기한다(§3-2). NOT_FOUND·MEMBER_ONLY는 방어적으로 나눈다.
        switch (groupErrorCode(e)) {
          case 'NOT_FOUND':
            Alert.alert('그룹을 찾을 수 없어요', '이미 사라졌거나 나간 그룹이에요.');
            break;
          case 'MEMBER_ONLY':
            Alert.alert('권한이 없어요', '방장만 넘길 수 있어요.');
            break;
          default:
            Alert.alert('방장을 넘기지 못했어요', '잠시 후 다시 시도해주세요.');
        }
      } finally {
        setSubmitting(false);
      }
    },
    [groupId, source, submitting, navigation],
  );

  // '넘기기' 탭 — 확인 Alert를 거친 뒤에만 위임한다(되돌릴 수 없는 동작).
  const onSubmit = useCallback(() => {
    if (submitting || selectedMember === null) return;
    const target = selectedMember;
    // withdraw 경로는 위임 뒤 곧바로 나가므로 그 사실을 확인 문구에 함께 알린다.
    const withdrawNote = source === 'withdraw' ? '\n넘긴 뒤 그룹에서 나갑니다.' : '';
    Alert.alert('방장 넘기기', `${target.nickname}님에게 방장을 넘길까요?${withdrawNote}`, [
      { text: '취소', style: 'cancel' },
      { text: '넘기기', style: 'destructive', onPress: () => doTransfer(target) },
    ]);
  }, [submitting, selectedMember, source, doTransfer]);

  // 로딩·에러 분기에도 원형 백버튼을 세운다 — 첫 조회가 도는 동안·실패했을 때 탈출구가 필요하다.
  const header = (
    <View style={s.header}>
      <TouchableOpacity
        style={[s.backBtn, submitting ? s.backBtnOff : null]}
        onPress={() => navigation.goBack()}
        activeOpacity={0.7}
        disabled={submitting}
        accessibilityLabel="뒤로"
      >
        <Ionicons name="chevron-back" size={18} color={T.inkSub} />
      </TouchableOpacity>
      <Text style={s.headerTitle}>방장 넘기기</Text>
    </View>
  );

  // ── 최초 로딩 — 중앙 스피너 ──
  if (loading) {
    return (
      <SafeAreaView style={s.root} edges={['top']} testID="group.owner.transfer.screen">
        {header}
        <View style={s.center}>
          <ActivityIndicator color={T.accent} />
        </View>
      </SafeAreaView>
    );
  }

  // ── 에러 + 다시 시도 ──
  if (error) {
    return (
      <SafeAreaView style={s.root} edges={['top']} testID="group.owner.transfer.screen">
        {header}
        <View style={s.center}>
          <Text style={s.errorTitle}>멤버를 불러오지 못했어요</Text>
          <Text style={s.errorDesc}>잠시 후 다시 시도해주세요.</Text>
          <TouchableOpacity style={s.retryBtn} activeOpacity={0.85} onPress={load}>
            <Text style={s.retryText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const canSubmit = selectedMember !== null && !submitting;
  const bottomPad = insets.bottom + T.space.md;

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="group.owner.transfer.screen">
      {header}
      {candidates.length === 0 ? (
        // 1인 그룹 — 넘길 대상이 없다.
        <View style={s.center}>
          <Text style={s.emptyTitle}>넘길 멤버가 없어요</Text>
          <Text style={s.emptyDesc}>그룹에 다른 멤버가 있어야 방장을 넘길 수 있어요.</Text>
        </View>
      ) : (
        <>
          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={s.guide}>새 방장이 될 멤버를 선택해주세요.</Text>
            <View style={s.list}>
              {candidates.map((m) => (
                <TransferRow
                  key={m.userId}
                  member={m}
                  selected={selectedId === m.userId}
                  disabled={submitting}
                  onPress={() => setSelectedId(m.userId)}
                />
              ))}
            </View>
          </ScrollView>

          {/* 하단 고정 CTA */}
          <View style={[s.footer, { paddingBottom: bottomPad }]}>
            <TouchableOpacity
              style={[s.submitBtn, canSubmit ? null : s.submitBtnOff]}
              activeOpacity={0.85}
              disabled={!canSubmit}
              onPress={onSubmit}
              testID="group.owner.transfer.submit"
            >
              {submitting ? (
                <ActivityIndicator color={T.white} />
              ) : (
                <Text style={s.submitText}>넘기기</Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },

  // 헤더 — 원형 백버튼 + 좌측 정렬 제목(그룹 만들기·공지 화면 관행, §5-1).
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
  backBtnOff: { opacity: 0.5 },
  headerTitle: { ...T.text.heading, fontWeight: '800', color: T.ink },

  // 로딩·에러·빈 상태 공통 중앙 블록.
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: T.space.xxl },
  errorTitle: { ...T.text.title, color: T.ink, textAlign: 'center' },
  errorDesc: { ...T.text.body, color: T.inkSub, marginTop: T.space.xs, textAlign: 'center' },
  // 인라인 재시도 = 48 / r16 / px xxl — 그룹 화면 공통 규격(§G-4).
  retryBtn: {
    marginTop: T.space.lg,
    height: 48,
    paddingHorizontal: T.space.xxl,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
  },
  retryText: { ...T.text.label, color: T.white },
  emptyTitle: { ...T.text.title, color: T.ink, textAlign: 'center' },
  emptyDesc: { ...T.text.body, color: T.inkSub, marginTop: T.space.xs, textAlign: 'center' },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: T.space.xl, paddingBottom: T.space.xl },
  guide: {
    ...T.text.body,
    color: T.inkSub,
    marginTop: T.space.xs,
    marginBottom: T.space.lg,
  },

  list: { gap: T.space.sm },
  // 선택형 멤버 행 — 카드 표면 T.paperLight, 선택 시 accent 테두리 + 인디고 틴트로 하이라이트.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: T.space.md,
    backgroundColor: T.paperLight,
    borderWidth: 1.5,
    borderColor: T.border,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
  },
  rowOn: { borderColor: T.accent, backgroundColor: T.accentBg },
  rowTexts: { flex: 1, gap: 2 },
  rowName: { ...T.text.label, fontWeight: '700', color: T.ink },
  rowNameOn: { color: T.accentDeep },
  rowSub: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },
  // 단일 선택 표시 원 — 미선택은 빈 테두리 원, 선택은 accent로 채운다.
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: T.borderDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: T.accent, backgroundColor: T.accent },

  // 하단 고정 CTA 영역 — 리스트와 분리해 늘 화면 아래에 붙인다.
  footer: {
    paddingHorizontal: T.space.xl,
    paddingTop: T.space.md,
    backgroundColor: T.bg,
    borderTopWidth: 1,
    borderTopColor: T.border,
  },
  // 화면 CTA = 52 / r16 (그룹 화면 공통 규격).
  submitBtn: {
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
  },
  submitBtnOff: { opacity: 0.5 },
  submitText: { ...T.text.subtitle, color: T.white },
});
