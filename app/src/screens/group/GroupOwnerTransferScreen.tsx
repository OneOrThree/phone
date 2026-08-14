import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { useOverlayAlert } from '@/store/useOverlayAlert';
import { Skeleton, SkeletonGroup } from '@/components/Skeleton';
import ConfirmCardModal from '@/components/ConfirmCardModal';
import { useOverlayBlocker } from '@/store/OverlaySlotContext';
import { useUser } from '@/store/UserContext';
import { useToast } from '@/store/ToastContext';
import { getAuthSessionGeneration } from '@/services/api';
import { getGroupDetail, groupErrorCode, transferOwner, withdrawGroup } from '@/services/groupApi';
import { promptSessionExpired, USER_NOT_FOUND } from '@/services/sessionErrors';
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

// 로딩 자리표시자(GROMO-1381) — 아래 규격에서 계산한 실제 치수.
// 안내 문구 한 줄(T.text.body 17pt, lineHeight 25)
const GUIDE_H = 25;
// 멤버 행: paddingVertical 12×2 + borderWidth 1.5×2 + 이름 18 + gap 2 + 보조 16 = 63
const ROW_H = 63;
// 첫 화면에 들어오는 만큼만 그린다(화면당 동시 스켈레톤 상한 12).
const SKELETON_ROWS = 4;

// 분 → '0분' / '45분' / '2시간' / '2시간 30분'. 누적 집중 시간(리더보드 지표)의 축약 표기 —
// MemberTile.fmtFocus와 같은 규칙이지만 그 파일은 default export뿐이라 여기서 다시 둔다.
function fmtFocus(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total}분`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

// 위임 대상 행 — MemberTile은 탭이 통계 비교로 고정돼(GROMO-1200) **단일 선택 하이라이트**를 붙일 수
// 없어 자체로 둔다.
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
  // 네이티브 Alert는 RN Modal **위에** 뜬다 — 떠 있는 동안 결과 모달이 그 아래에서
  // 마운트되면 사용자는 못 봤는데 seen 마커와 ack이 찍힌다. 이 훅이 Alert 수명 동안
  // 조정자 slot을 점유해 그걸 막는다(store/useOverlayAlert 헤더).
  const showAlert = useOverlayAlert('groupOwnerTransfer.alert');
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { params } = useRoute<GroupOwnerTransferRoute>();
  const { groupId, source } = params;
  const { userId } = useUser();
  // 성공 통보용 전역 토스트 — 화면 전환(goBack)을 넘어 살아남는다.
  const { show } = useToast();

  const [detail, setDetail] = useState<GroupDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 위임(+source별 후속)이 진행 중인가 — 재탭·재선택·뒤로가기를 잠근다.
  const [submitting, setSubmitting] = useState(false);
  // 위임 확인 카드(GROMO-1251) — 네이티브 2버튼 Alert에서 이관.
  const [confirmOpen, setConfirmOpen] = useState(false);
  // 위임 확인 카드도 RN Modal이다 — 위 GroupSettingsScreen과 같은 근거로 등록한다.
  useOverlayBlocker('groupOwnerTransfer.confirm', confirmOpen);

  // 마운트 시 1회(재시도 시 재호출) — 멤버 목록만 있으면 되므로 date 없이 부른다(오늘 집중분은 안 쓴다).
  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const requestSessionGeneration = getAuthSessionGeneration();
    try {
      const data = await getGroupDetail(groupId);
      setDetail(data);
    } catch (e) {
      // 진입 조회의 유저 부재(GROMO-1247) — 위임 실패 분기와 **다른 자리**다. 여기서 안 보면
      // 이미 없는 계정으로 들어온 화면이 '다시 시도'만 반복하게 된다(재시도로 안 풀린다).
      if (groupErrorCode(e) === USER_NOT_FOUND) promptSessionExpired(requestSessionGeneration);
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
      // 요청 직전의 인증 세대 — 유저 부재 분기의 로그아웃 판정용(sessionErrors.ts 주석).
      const requestSessionGeneration = getAuthSessionGeneration();
      try {
        await transferOwner(groupId, target.userId);
        // 계측은 위임이 실제로 성공한 뒤에만 발행한다(source는 시작 경로).
        logGroupOwnerTransferred({ group_id: groupId, source });

        if (source === 'withdraw') {
          // 위임 직후 나가기 — 이제 나는 MEMBER라 서버가 나가기를 허용한다.
          // ⚠️ 세대를 **여기서 새로 잡는다**(codex 리뷰). 위 transferOwner 응답을 기다린 만큼
          //    시간이 흘렀고, 그 사이 인증이 전환됐으면 이 요청은 새 세션으로 나간다 —
          //    바깥 세대를 그대로 쓰면 낡은 응답으로 오판해 안내·로그아웃이 둘 다 생략된다.
          const withdrawSessionGeneration = getAuthSessionGeneration();
          try {
            await withdrawGroup(groupId);
            // 그룹 목록 루트(그룹 탭)로 복귀 — 중간의 그룹방·설정 스택을 모두 걷어낸다.
            navigation.popToTop();
          } catch (we) {
            // 유저 부재 — 위임은 끝났지만 **내 계정이 없다**. 나가기 실패로 안내하면 사용자는
            // 그룹방에서 재시도만 반복한다(그 화면도 같은 이유로 실패한다). 재로그인으로 보낸다.
            if (groupErrorCode(we) === USER_NOT_FOUND) {
              promptSessionExpired(withdrawSessionGeneration);
              return;
            }
            // 위임은 이미 끝났다 — 나가기만 실패했음을 따로 알린다(재시도는 그룹방에서).
            showAlert(
              '그룹 나가기 실패',
              '방장은 넘겼지만 나가기에 실패했어요. 그룹에서 직접 나가 주세요.',
            );
            navigation.goBack();
          }
          return;
        }

        // settings·account 공통 — 위임만 하고 이전 화면으로 돌아간다(허브·계정 화면이 재조회).
        // 성공 통보는 읽고 흘려도 되는 한 줄이라 확인 버튼이 필요한 Alert 대신 토스트로 알린다
        // (GROMO-1381). ToastProvider가 NavigationContainer 바깥이라 바로 아래 goBack()으로
        // 화면이 바뀌어도 배너는 살아남는다.
        show({ message: `${target.nickname}님이 새 방장이 되었어요`, tone: 'success' });
        navigation.goBack();
      } catch (e) {
        // HTTP status가 아니라 code로 분기한다(§3-2). NOT_FOUND·MEMBER_ONLY는 방어적으로 나눈다.
        switch (groupErrorCode(e)) {
          // 유저 부재(GROMO-1247) — 그룹이 아니라 **내 계정**이 없다. '그룹을 찾을 수 없어요'로
          // 위장하면 사용자는 멀쩡한 그룹을 의심하며 재시도만 반복한다. 유일한 탈출구인
          // 재로그인으로 보낸다(토스트가 아니라 확인이 필요한 안내 — 세션을 끊는 동작이다).
          case USER_NOT_FOUND:
            // ⚠️ 카드를 **연 채** 띄운다. Alert 는 RN Modal 위에 뜨므로 닫힘이 진행 중이 아니면
            //    경합하지 않는다 — 반대로 닫고 띄우면 dismiss 와 present 가 부딪혀 안내가 사라지고,
            //    이 분기는 그 확인 버튼이 로그아웃까지 쥐고 있어 세션 복구 경로가 통째로 없어진다.
            promptSessionExpired(requestSessionGeneration);
            break;
          // 두 코드 모두 **재시도해도 같은 결과**인 종결 통보다 — 사용자가 할 수 있는 조치가
          // 없으므로 확인 버튼이 필요 없는 tone:'error' 토스트로 알린다
          // (정책 D19 — docs/prd/motion-v2/policy.md, 상위 정본 병합 전까지 여기가 정본).
          // 반면 아래 default('잠시 후 다시 시도')는 재시도가 유효해 Alert로 남긴다.
          // ⚠️ 토스트 경로는 카드를 **닫고** 띄운다. Toast 는 RN Modal 아래에 깔려(Toast.tsx:20-22)
          //    카드가 열려 있으면 사용자가 실패 이유를 아예 못 본다. 토스트는 네이티브 present 가
          //    아니라 RN 뷰라, Alert 와 달리 닫힘과 부딪히지 않는다 — 그래서 이쪽만 먼저 닫는다.
          case 'NOT_FOUND':
            setConfirmOpen(false);
            show({ message: '이미 사라졌거나 나간 그룹이에요', tone: 'error' });
            break;
          case 'MEMBER_ONLY':
            // 화면 제목이 이미 「방장 넘기기」라 목적어를 되풀이하지 않는다.
            setConfirmOpen(false);
            show({ message: '방장이 아니라서 넘길 수 없어요', tone: 'error' });
            break;
          default:
            // 재시도가 유효한 실패라 Alert 유지(D8). 위 USER_NOT_FOUND 와 같은 이유로 카드는 연 채다.
            showAlert('방장을 넘기지 못했어요', '잠시 후 다시 시도해 주세요.');
        }
      } finally {
        setSubmitting(false);
      }
    },
    [groupId, source, submitting, navigation, show, showAlert],
  );

  // '넘기기' 탭 — 확인 카드를 거친 뒤에만 위임한다(되돌릴 수 없는 동작).
  // 확인은 선택지가 있는 2버튼이라 토스트 대상이 아니다(정책 D8) — 표면만 네이티브 Alert에서
  // 앱 컨셉 카드로 바꿨다(GROMO-1251). 문구는 그대로다.
  const onSubmit = useCallback(() => {
    if (submitting || selectedMember === null) return;
    setConfirmOpen(true);
  }, [submitting, selectedMember]);

  // withdraw 경로는 위임 뒤 곧바로 나가므로 그 사실을 확인 문구에 함께 알린다.
  const withdrawNote = source === 'withdraw' ? '\n넘긴 뒤 그룹에서 나가요.' : '';
  // 닫힘 페이드아웃 동안 이름이 사라지지 않게 마지막 대상을 ref로 유지한다(AccountScreen 선례).
  const lastTargetRef = useRef<GroupDetailMemberResponse | null>(null);
  if (selectedMember !== null) lastTargetRef.current = selectedMember;
  const confirmTarget = selectedMember ?? lastTargetRef.current;

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

  // ── 최초 로딩 — 안내 문구 + 멤버 행 자리표시자(GROMO-1381, 옛 중앙 스피너 대체) ──
  // 행 높이가 규격으로 고정된 목록이라 도착 화면과 같은 실루엣을 그릴 수 있다.
  // 펄스는 SkeletonGroup 한 겹에만 건다(무한 루프 1개) — 기존 컨테이너 View를 그대로 교체한 것이라
  // 노드 수·여백은 변하지 않는다. 백버튼이 있는 header는 묶음 밖이라 접근성 트리에 그대로 남는다.
  // 데이터가 오면 이 분기가 사라지며 펄스(무한 루프)도 함께 언마운트된다.
  if (loading) {
    return (
      <SafeAreaView style={s.root} edges={['top']} testID="group.owner.transfer.screen">
        {header}
        <SkeletonGroup style={s.scrollContent} testID="group.owner.transfer.skeleton">
          <View style={s.skeletonGuide}>
            <Skeleton w="70%" h={GUIDE_H} radius={6} />
          </View>
          <View style={s.list}>
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <Skeleton key={i} w="100%" h={ROW_H} radius={14} />
            ))}
          </View>
        </SkeletonGroup>
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
          <Text style={s.errorDesc}>잠시 후 다시 시도해 주세요.</Text>
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
            <Text style={s.guide}>새 방장이 될 멤버를 선택해 주세요.</Text>
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

      {/* 위임 확인 카드 — 문구는 기존 Alert에서 그대로 이식(카피 정본, GROMO-1251).
          ⚠️ 확인 즉시 카드를 **닫고** 위임을 시작한다. 종전 Alert도 버튼 탭 → 알럿 닫힘 →
             onPress 순서였고, 무엇보다 실패 통보 토스트(D19)는 RN Modal이 떠 있으면 그
             **아래**에 깔려 안 보인다(Toast.tsx 주석) — 카드를 띄운 채 요청하면 안 된다. */}
      {confirmTarget !== null && (
        <ConfirmCardModal
          visible={confirmOpen}
          title="방장 넘기기"
          body={`${confirmTarget.nickname}님에게 방장을 넘길까요?${withdrawNote}`}
          primaryLabel="넘기기"
          destructive
          onPrimary={() => {
            // ⚠️ 여기서 카드를 닫지 않는다(codex 리뷰). 실패 경로가 Alert 를 띄우는데, 닫기를
            //    먼저 걸면 iOS 에서 fade dismissal 과 native Alert presentation 이 같은 틱에
            //    경합해 안내가 아예 안 뜬다 — 유저 부재 분기는 그 Alert 의 확인 버튼이
            //    로그아웃까지 쥐고 있어 세션 복구 경로가 통째로 사라진다.
            //    성공 경로는 화면이 전환되므로(goBack·popToTop) 따로 닫을 필요가 없고,
            //    실패 경로는 카드가 남아 사용자가 취소로 빠져나간다.
            doTransfer(confirmTarget);
          }}
          primaryDisabled={submitting}
          // ⚠️ 요청 중에는 **모든 닫기 경로를 막는다**. 취소·스크림·백으로 카드가 닫히면 위임이
          //    취소된 것처럼 보이지만 transferOwner 는 계속되어 실제 방장이 바뀐다 — 되돌릴 수
          //    없는 동작이라 「닫힘 = 취소」가 참이어야 한다. 취소 버튼은 아예 렌더하지 않는다:
          //    가드만 두면 "눌렀는데 아무 일도 없다"가 되어 그것도 거짓 신호다(GroupSettingsScreen 과 같은 처방).
          secondaryLabel={submitting ? undefined : '취소'}
          onSecondary={submitting ? undefined : () => setConfirmOpen(false)}
          onRequestClose={() => {
            if (submitting) return;
            setConfirmOpen(false);
          }}
          testID="group.owner.transfer.confirm"
        />
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
    minHeight: 48,
    paddingVertical: T.space.md,
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
  // 로딩 자리표시자의 안내 문구 자리 — 위 s.guide와 같은 위아래 여백이어야 목록이 밀리지 않는다.
  skeletonGuide: { marginTop: T.space.xs, marginBottom: T.space.lg },

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
    minHeight: 52,
    paddingVertical: T.space.md,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
  },
  submitBtnOff: { opacity: 0.5 },
  submitText: { ...T.text.subtitle, color: T.white },
});
