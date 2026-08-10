import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
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
import { BET_NOT_FOUND, getGroupChallengeHistory, groupErrorCode } from '@/services/groupApi';
import type { GroupChallengeHistoryItem } from '@/types/dto/group';
import type { V2RootStackParamList } from '@/navigation/types';
import { WINDOW_FOCUS_TOLERANCE_NOTICE } from './components/progressFormat';
import { fmtMonthDayDow } from './challengeSchedule';
import {
  historyBasis,
  historyDelta,
  historyMissionLabel,
  historyRowA11y,
  historySummary,
  showToleranceNotice,
} from './challengeHistoryView';

// 그룹 챌린지 내역 화면 (root stack 'GroupChallengeHistory') — GROMO-1277 · policy §A9 · N6-1.
//
// **이력의 소유자가 챌린지에서 그룹으로 올라갔다.** 챌린지별 「지난 챌린지」를 대체한다:
// 챌린지가 삭제돼도 돈이 오간 기록은 남아야 하는데, 이력이 챌린지에 매달려 있으면 그룹장
// 클릭 한 번에 전원 404가 됐다(구 A7 갭). 경로를 그룹으로 올려 **구조로** 보장한다.
//   GET /groups/{groupId}/challenge-history?cursor&size&challengeId
//   → { content, size, hasNext, nextCursor }  ((session_date, id) 내림차순, 앱 재정렬 금지)
//
// 진입은 둘이지만 화면은 하나다(IA §1 — 화면을 둘로 나눌 이유가 없다):
//   · 그룹방 「챌린지 내역」 링크        → 필터 없음(그룹 전체)
//   · 지난 결과 시트 「지난 기록 더보기」 → `challengeId` 필터
//
// 한 줄의 표시는 **회차에 박제된 미션 스냅샷**으로 만든다 — 챌린지 행을 조인하지 않으므로
// 삭제된 챌린지의 줄도 온전히 읽힌다(배지로 삭제 사실만 덧붙인다). 문구 조립은 전부
// challengeHistoryView가 쥔다(무효화 사유는 lastSettledView의 공용 매핑에 위임 — 사본 금지).
//
// 페이지네이션 규칙은 구 화면(GROMO-1221)에서 그대로 물려받는다. 하나라도 빠지면 실제로
// 겪었던 사고가 재발한다:
//   · 종료 조건은 **hasNext·nextCursor 둘 다** — 한쪽만 보면 계약이 어긋난 응답에서 같은
//     페이지를 무한 재호출한다.
//   · 다음 페이지 404(BET_NOT_FOUND, 무효 커서)는 받은 페이지를 **유지**하고 꼬리에 인라인으로만
//     알린다. 같은 커서 재시도는 항상 404라 페이지네이션 자체를 접는다.
//   · 일시 실패(코드 없는 500 등)는 **자동 재시도하지 않는다**(#527 P1) — footer 높이 변화가
//     onEndReached를 재발화시켜 요청 무한 루프가 된다. 재개는 수동 탭·새로고침 두 갈래뿐.
//   · 첫 페이지 404(NOT_FOUND)는 전면 에러 — 그룹이 사라진 것이라 볼 게 없다.
//
// ⚠️ 문구에 「회차」를 쓰지 않는다(N28) — 날짜·요일이 그 뜻을 이미 말한다.

// 페이지 크기 — size는 서버 필수 파라미터(범위 밖이면 INVALID_PAGE_REQUEST)라 앱이 상수로 고정한다.
const PAGE_SIZE = 20;

// 다음 페이지 실패 인라인 문구 — 무효 커서(재시도 무의미)와 일시 실패(수동 재시도)를 가른다.
const MORE_DEAD_NOTICE = '지난 기록을 더 불러올 수 없어요';
const MORE_FAILED_NOTICE = '지난 기록을 더 불러오지 못했어요';

type HistoryRoute = RouteProp<V2RootStackParamList, 'GroupChallengeHistory'>;

// 첫 페이지·새로고침 실패 문구 — HTTP status가 아니라 서버 code로 분기한다(§3-2, NoticeScreen 결).
function listErrorMessage(e: unknown): string {
  switch (groupErrorCode(e)) {
    case 'NOT_FOUND':
      return '사라진 그룹이에요.';
    case 'MEMBER_ONLY':
      return '그룹원만 볼 수 있어요.';
    default:
      return '지난 기록을 불러오지 못했어요.';
  }
}

export default function GroupChallengeHistoryScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { groupId, challengeId, challengeLabel } = useRoute<HistoryRoute>().params;

  const [items, setItems] = useState<GroupChallengeHistoryItem[] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // 다음 페이지 커서 상태 — 두 값은 항상 같은 응답에서 함께 온다(따로 갱신되면 종료 판정이 갈린다).
  const [pageEnd, setPageEnd] = useState<{ hasNext: boolean; nextCursor: string | null }>({
    hasNext: false,
    nextCursor: null,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  // 다음 페이지 일시 실패(#527 P1) — onEndReached 경로를 잠근다. 해제는 '다시 시도' 탭과
  // 새로고침(첫 페이지 재조회) 성공 두 갈래뿐이다(자동 재시도는 무한 루프).
  const [moreFailed, setMoreFailed] = useState(false);
  // 무효 커서(BET_NOT_FOUND) — 같은 커서로는 몇 번을 다시 불러도 404라 페이지네이션을 접는다.
  const [historyDead, setHistoryDead] = useState(false);

  // 요청 시퀀스 — 새로고침·'다시 시도'와 진행 중이던 다음 페이지 응답이 겹치면 늦게 도착한
  // 이전 응답이 최신 목록을 덮거나 새 목록에 옛 페이지가 이어붙는다(NoticeScreen 패턴).
  const requestSeqRef = useRef(0);
  // onEndReached 연발 락 — state(loadingMore)는 리렌더 뒤에야 보여 같은 틱 중복 호출을 못 막는다.
  const moreLock = useRef(false);
  // 첫 페이지 조회 진행 중(#527 P2) — 그 동안 loadMore를 통째로 차단한다. seq 캡처만으로는
  // 부족하다: 새로고침 **뒤에** 발화한 onEndReached는 최신 seq를 캡처한 채 옛 커서로 나간다.
  const firstPageInFlight = useRef(false);

  // 첫 페이지 조회 — 진입·새로고침·'다시 시도' 공용. 성공하면 커서 상태까지 통째로 새로 시작한다.
  const fetchFirstPage = useCallback(async (): Promise<void> => {
    const seq = ++requestSeqRef.current;
    firstPageInFlight.current = true;
    setErrorMsg(null);
    try {
      const slice = await getGroupChallengeHistory(groupId, { size: PAGE_SIZE, challengeId });
      if (seq !== requestSeqRef.current) return;
      setItems(slice.content);
      setPageEnd({ hasNext: slice.hasNext, nextCursor: slice.nextCursor });
      // 커서를 새로 받았다 — 다음 페이지 잠금(일시 실패·무효 커서)을 모두 푼다.
      setMoreFailed(false);
      setHistoryDead(false);
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      setErrorMsg(listErrorMessage(e));
    } finally {
      // stale로 끝난 조회는 잠금을 풀지 않는다 — 그 조회의 finally가 자기 몫을 푼다.
      if (seq === requestSeqRef.current) firstPageInFlight.current = false;
    }
  }, [groupId, challengeId]);

  // cleanup에서 시퀀스를 올려 진행 중이던 요청을 무효화한다(언마운트 뒤 setState 방지).
  useEffect(() => {
    fetchFirstPage();
    return () => {
      // 요청 카운터라 cleanup 시점 값을 그대로 올리는 게 맞다(NoticeScreen의 같은 자리 주석).
      // eslint-disable-next-line react-hooks/exhaustive-deps
      requestSeqRef.current++;
    };
  }, [fetchFirstPage]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchFirstPage();
    setRefreshing(false);
  }, [fetchFirstPage]);

  // 다음 페이지 — onEndReached·'다시 시도' 탭 공용. fromRetry는 moreFailed 잠금만 우회하고
  // 나머지 가드(중복·무효 커서·첫 페이지 진행 중)는 그대로 받는다.
  async function loadMore(fromRetry = false) {
    if (items === null || moreLock.current || historyDead) return;
    // 첫 페이지 조회가 도는 동안은 다음 페이지를 잡지 않는다(#527 P2) — 지금 쥔 pageEnd는 곧
    // 교체될 옛 커서라, 나가면 새 첫 페이지 뒤에 옛 페이지가 이어붙는다.
    if (firstPageInFlight.current) return;
    if (moreFailed && !fromRetry) return;
    const { hasNext, nextCursor } = pageEnd;
    if (!hasNext || !nextCursor) return;
    const seq = requestSeqRef.current;
    moreLock.current = true;
    setLoadingMore(true);
    try {
      const slice = await getGroupChallengeHistory(groupId, {
        cursor: nextCursor,
        size: PAGE_SIZE,
        challengeId,
      });
      // 그 사이 새로고침이 목록을 교체했으면 이 페이지는 옛 커서의 꼬리다 — 이어붙이지 않는다.
      if (seq !== requestSeqRef.current) return;
      setItems((prev) => [...(prev ?? []), ...slice.content]);
      setPageEnd({ hasNext: slice.hasNext, nextCursor: slice.nextCursor });
      setMoreFailed(false);
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      if (groupErrorCode(e) === BET_NOT_FOUND) {
        // 무효 커서 — 받은 페이지는 그대로 두고 페이지네이션만 접는다.
        setHistoryDead(true);
      } else {
        // 일시 실패 — 커서는 보존하되 재개는 수동('다시 시도' 탭)뿐이다.
        setMoreFailed(true);
      }
    } finally {
      moreLock.current = false;
      setLoadingMore(false);
    }
  }

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
      <View style={s.headerText}>
        <Text style={s.headerTitle}>챌린지 내역</Text>
        {/* 필터로 들어온 화면임을 밝힌다 — 안 밝히면 그룹 전체 이력으로 읽혀 "왜 다른 챌린지가
            안 보이지"가 된다. 라벨을 못 받은 진입(구 링크)에서는 아무것도 지어내지 않는다. */}
        {challengeId !== undefined && challengeLabel !== undefined && (
          <Text style={s.headerSub} testID="group.challengeHistory.filter">
            {challengeLabel}만 보는 중
          </Text>
        )}
      </View>
    </View>
  );

  // 에러 + 다시 시도 블록 — 최초 조회 실패(전면)와 '빈 목록 + 재조회 실패'가 같이 쓴다.
  function errorState(msg: string) {
    return (
      <View style={s.center}>
        <Text style={s.emptyTitle}>{msg}</Text>
        <Text style={s.emptyDesc}>잠시 후 다시 시도해주세요.</Text>
        <TouchableOpacity style={s.retryBtn} activeOpacity={0.85} onPress={() => fetchFirstPage()}>
          <Text style={s.retryText}>다시 시도</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // 내역 1건 카드 — policy §A9의 한 줄 위계 그대로:
  //   날짜(요일) [삭제됨] / 미션 라벨 / 결과 요약 · 참가비·적립금 · 내 손익
  function renderHistoryCard(item: GroupChallengeHistoryItem) {
    const dateText = fmtMonthDayDow(item.sessionDate);
    const delta = historyDelta(item);
    const basis = historyBasis(item);
    return (
      <View
        style={s.card}
        testID={`group.challengeHistory.item.${item.sessionId}`}
        accessible
        accessibilityLabel={historyRowA11y(item, dateText)}
      >
        <View style={s.cardHead}>
          <Text style={s.cardDate}>{dateText}</Text>
          {/* 삭제된 챌린지의 줄 — 스냅샷 덕분에 내용은 온전하다. 사실만 중립 배지로 덧붙인다
              (없으면 "지금도 도는 챌린지"로 읽힌다). */}
          {item.challengeDeleted && <Text style={s.deletedTag}>삭제됨</Text>}
          <View style={s.spacer} />
          <Text style={[s.delta, s[delta.tone]]}>{delta.text}</Text>
        </View>
        <Text style={s.cardMission} numberOfLines={1}>
          {historyMissionLabel(item)}
        </Text>
        <View style={s.cardFoot}>
          <Text style={s.cardSummary}>{historySummary(item)}</Text>
          {/* 내 판정 근거 — 인별 명단이 없는 목록에서 내 숫자만은 남긴다(미참가·미계측이면 없다). */}
          {basis !== null && <Text style={s.cardBasis}>{basis}</Text>}
        </View>
        <Text style={s.cardStat}>
          참가비 {item.stake} · 적립금 {item.pot}
        </Text>
      </View>
    );
  }

  // ── 최초 로딩 — 중앙 스피너. 새로고침은 RefreshControl이 맡는다. ──
  if (items === null && errorMsg === null) {
    return (
      <SafeAreaView style={s.root} edges={['top']} testID="group.challengeHistory.screen">
        {header}
        <View style={s.center}>
          <ActivityIndicator color={T.accent} />
        </View>
      </SafeAreaView>
    );
  }

  // ── 첫 페이지 에러 + 다시 시도 (전면) ──
  if (items === null && errorMsg !== null) {
    return (
      <SafeAreaView style={s.root} edges={['top']} testID="group.challengeHistory.screen">
        {header}
        {errorState(errorMsg)}
      </SafeAreaView>
    );
  }

  const list = items ?? [];
  // FOCUS 창의 5분 관용치 안내 — 줄마다 실린 스냅샷으로 판단한다(그룹 축이라 여러 챌린지가 섞인다).
  const toleranceNotice = showToleranceNotice(list);
  // 새로고침 실패 인라인(목록이 있을 때만) — 전면 에러 조건에 안 걸리는 무음 실패를 알린다.
  const refreshBanner = errorMsg !== null && list.length > 0 ? errorMsg : null;

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="group.challengeHistory.screen">
      {header}

      <FlatList
        data={list}
        keyExtractor={(item) => item.sessionId}
        testID="group.challengeHistory.list"
        contentContainerStyle={[
          s.listContent,
          { paddingBottom: insets.bottom + T.space.xl },
          list.length === 0 && s.listEmptyContent,
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.accent} />
        }
        // 무한 스크롤 — 끝에서 다음 페이지(keyset). 종료·중복·404 규칙은 loadMore가 쥔다.
        onEndReached={() => loadMore()}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={
          refreshBanner !== null || toleranceNotice ? (
            <View style={s.headerNotices}>
              {refreshBanner !== null && <Text style={s.notice}>{refreshBanner}</Text>}
              {toleranceNotice && (
                <Text style={s.toleranceNotice} testID="group.challengeHistory.toleranceNotice">
                  {WINDOW_FOCUS_TOLERANCE_NOTICE}
                </Text>
              )}
            </View>
          ) : null
        }
        // 빈 목록 + 재조회 실패는 '기록이 없다'가 아니라 '모른다' — 에러+다시 시도로 바꾼다.
        ListEmptyComponent={
          errorMsg !== null ? (
            errorState(errorMsg)
          ) : (
            <View style={s.center}>
              <Text style={s.emptyTitle}>아직 지난 기록이 없어요</Text>
              <Text style={s.emptyDesc}>챌린지 결과가 나오면 여기에 차곡차곡 쌓여요</Text>
            </View>
          )
        }
        // 꼬리: 다음 페이지 로딩 스피너 / 무효 커서 고지 / 일시 실패 + 수동 재시도 버튼(#527 P1).
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator
              color={T.accent}
              style={s.footerLoading}
              testID="group.challengeHistory.more.loading"
            />
          ) : historyDead ? (
            <Text style={s.notice} testID="group.challengeHistory.more.notice">
              {MORE_DEAD_NOTICE}
            </Text>
          ) : moreFailed ? (
            <View style={s.moreFailRow}>
              <Text style={s.notice}>{MORE_FAILED_NOTICE}</Text>
              <TouchableOpacity
                onPress={() => loadMore(true)}
                activeOpacity={0.7}
                hitSlop={8}
                accessibilityRole="button"
                testID="group.challengeHistory.more.retry"
              >
                <Text style={s.moreRetryText}>다시 시도</Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
        renderItem={({ item }) => renderHistoryCard(item)}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  // 화면 골격·헤더·상태 블록은 NoticeScreen과 같은 규격 — 그룹 스택 형제 화면의 위계를 맞춘다.
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
  headerText: { flex: 1 },
  headerTitle: { ...T.text.heading, fontWeight: '800', color: T.ink },
  headerSub: { ...T.text.caption, color: T.inkMuted, marginTop: 2 },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: T.space.xxl,
  },
  emptyTitle: { ...T.text.title, color: T.ink, textAlign: 'center' },
  emptyDesc: {
    ...T.text.body,
    color: T.inkSub,
    marginTop: T.space.sm,
    textAlign: 'center',
  },
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

  // 인라인 배너(새로고침 실패·다음 페이지 실패) — NoticeScreen s.notice와 같은 규격.
  notice: { ...T.text.caption, color: T.dangerInk },
  footerLoading: { marginTop: T.space.md },
  headerNotices: { gap: T.space.xs },
  toleranceNotice: { ...T.text.caption, color: T.inkMuted, textAlign: 'center' },
  moreFailRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  moreRetryText: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.accent,
    textDecorationLine: 'underline',
  },

  listContent: { paddingHorizontal: T.space.xl, paddingTop: T.space.xs, gap: T.space.md },
  listEmptyContent: { flexGrow: 1 },

  // 내역 1건 카드 — 공지 카드와 같은 표면 규격.
  card: {
    backgroundColor: T.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: T.border,
    padding: T.space.lg,
    gap: T.space.xs,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  spacer: { flex: 1 },
  cardDate: { ...T.text.subtitle, color: T.ink },
  // 삭제 배지 — 상태가 아니라 사실 표기라 중립 톤(카드의 '휴면' 칩과 같은 규격).
  deletedTag: {
    ...T.text.caption,
    fontWeight: '600',
    color: T.inkMuted,
    backgroundColor: T.bg,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  cardMission: { ...T.text.caption, fontWeight: '600', color: T.inkSub },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  cardSummary: { ...T.text.caption, fontWeight: '500', color: T.inkSub, flex: 1 },
  cardBasis: {
    ...T.text.caption,
    fontWeight: '500',
    color: T.inkMuted,
    fontVariant: ['tabular-nums'],
  },
  cardStat: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },

  // 내 손익 — 목록에서 가장 먼저 눈이 가는 숫자라 날짜 줄 오른쪽 끝에 둔다.
  delta: {
    ...T.text.label,
    fontWeight: '800',
    color: T.inkSub,
    fontVariant: ['tabular-nums'],
    minWidth: 44,
    textAlign: 'right',
  },
  plus: { color: T.successInk },
  minus: { color: T.dangerInk },
  zero: { color: T.inkSub },
  muted: { color: T.inkFaint, fontWeight: '600' },
});
