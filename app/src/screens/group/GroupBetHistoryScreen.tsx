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
import { BET_NOT_FOUND, getBetHistory, groupErrorCode } from '@/services/groupApi';
import type { GroupBetHistoryItem, LastSettledBetResult } from '@/types/dto/group';
import type { V2RootStackParamList } from '@/navigation/types';
import {
  basisText,
  deltaText,
  monthDay,
  rowA11y,
  statusBanner,
  verdictText,
} from './components/LastBetResultSheet';

// 내기 히스토리 화면 (root stack 'GroupBetHistory') — GROMO-1221.
// 진입점은 지난 내기 결과 시트(LastBetResultSheet)의 '지난 기록 더보기' — 시트는 챌린지 목록
// 응답의 최신 정산 1건(lastSettledBet)만 아는 한계가 있어, 전체 이력은 이 화면이 전용
// 엔드포인트로 따로 받는다. 와이어는 #510 서버 계약 그대로:
//   GET /groups/{groupId}/challenges/{challengeId}/bets?cursor&size
//   → { content, size, hasNext, nextCursor } (bet_date 내림차순, 앱 재정렬 금지)
//
// 뼈대는 NoticeScreen(3상 로딩/에러/빈 + RefreshControl + 인라인 배너)이고, 여기에 앱 최초의
// FlatList 무한 스크롤(onEndReached keyset 커서)이 얹힌다. 페이지 규칙:
//   · 종료 조건은 **hasNext·nextCursor 둘 다** — 한쪽만 보면 계약이 어긋난 응답(hasNext=true에
//     cursor null 등)에서 같은 페이지를 무한 재호출한다(DTO 주석과 짝).
//   · 다음 페이지 404(BET_NOT_FOUND, 무효 커서)는 이미 받은 페이지를 **유지**하고 꼬리에
//     인라인으로만 알린다 — 화면 전체를 에러로 뒤집으면 잘 읽던 이력이 통째로 사라진다.
//     같은 커서 재시도는 항상 404라 페이지네이션 자체를 접는다(계약 §2-1221).
//   · 첫 페이지 404(NOT_FOUND)는 전면 에러 — 그룹·챌린지가 사라진 것이라 볼 게 없다.
// 표기(판정·손익·근거·음성)는 LastBetResultSheet의 조각을 그대로 import 한다 — 같은 데이터를
// 두 자리에서 그리므로 규칙이 갈라지면 안 된다.

// 페이지 크기 — size는 서버 필수 파라미터(1~100, 누락 시 프레임워크 400)라 앱이 상수로
// 고정한다(계약 §2-1221 '앱 상수 고정, 예: 20').
const PAGE_SIZE = 20;

// 다음 페이지 실패 인라인 문구 — 무효 커서(재시도 무의미)와 일시 실패(재시도 가능)를 가른다.
const MORE_DEAD_NOTICE = '지난 기록을 더 불러올 수 없어요';
const MORE_RETRY_NOTICE = '지난 기록을 더 불러오지 못했어요. 스크롤하면 다시 시도해요';

type HistoryRoute = RouteProp<V2RootStackParamList, 'GroupBetHistory'>;

// 첫 페이지·새로고침 실패 문구 — HTTP status가 아니라 서버 code로 분기한다(§3-2, NoticeScreen 결).
function listErrorMessage(e: unknown): string {
  switch (groupErrorCode(e)) {
    case 'NOT_FOUND':
      return '사라진 챌린지예요.';
    case 'MEMBER_ONLY':
      return '그룹원만 볼 수 있어요.';
    default:
      return '지난 내기 기록을 불러오지 못했어요.';
  }
}

export default function GroupBetHistoryScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { groupId, challengeId } = useRoute<HistoryRoute>().params;

  const [items, setItems] = useState<GroupBetHistoryItem[] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // 다음 페이지 커서 상태 — 두 값은 항상 같은 응답에서 함께 온다(따로 갱신되면 종료 판정이 갈린다).
  const [pageEnd, setPageEnd] = useState<{ hasNext: boolean; nextCursor: string | null }>({
    hasNext: false,
    nextCursor: null,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  // 다음 페이지 실패 인라인(꼬리 배너) — 받은 이력은 그대로 두고 사실만 알린다.
  const [moreNotice, setMoreNotice] = useState<string | null>(null);
  // 무효 커서(BET_NOT_FOUND) — 같은 커서로는 몇 번을 다시 불러도 404라 페이지네이션을 접는다.
  // 당겨서 새로고침(첫 페이지 재조회)이 커서를 새로 받으면 다시 풀린다.
  const [historyDead, setHistoryDead] = useState(false);

  // 요청 시퀀스 — 새로고침·'다시 시도'와 진행 중이던 다음 페이지 응답이 겹치면 늦게 도착한
  // 이전 응답이 최신 목록을 덮거나(교체 뒤 stale append) 새 목록에 옛 페이지가 이어붙는다.
  // 최신 요청의 결과만 반영한다(NoticeScreen의 requestSeqRef 패턴).
  const requestSeqRef = useRef(0);
  // onEndReached 연발 락 — state(loadingMore)는 리렌더 뒤에야 보여 같은 틱 중복 호출을 못
  // 막는다(ChallengeCard.leaveLock과 같은 이유).
  const moreLock = useRef(false);

  // 첫 페이지 조회 — 진입·새로고침·'다시 시도' 공용. 성공하면 커서 상태까지 통째로 새로 시작한다.
  const fetchFirstPage = useCallback(async (): Promise<void> => {
    const seq = ++requestSeqRef.current;
    setErrorMsg(null);
    try {
      const slice = await getBetHistory(groupId, challengeId, { size: PAGE_SIZE });
      if (seq !== requestSeqRef.current) return;
      setItems(slice.content);
      setPageEnd({ hasNext: slice.hasNext, nextCursor: slice.nextCursor });
      setMoreNotice(null);
      setHistoryDead(false);
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      setErrorMsg(listErrorMessage(e));
    }
  }, [groupId, challengeId]);

  // cleanup에서 시퀀스를 올려 진행 중이던 요청을 무효화한다(언마운트 뒤 setState 방지 — NoticeScreen 결).
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

  // 다음 페이지 — onEndReached 전용. 종료 조건(hasNext·nextCursor 둘 다)은 파일 머리 주석.
  async function loadMore() {
    if (items === null || moreLock.current || historyDead) return;
    const { hasNext, nextCursor } = pageEnd;
    if (!hasNext || !nextCursor) return;
    const seq = requestSeqRef.current;
    moreLock.current = true;
    setLoadingMore(true);
    try {
      const slice = await getBetHistory(groupId, challengeId, {
        cursor: nextCursor,
        size: PAGE_SIZE,
      });
      // 그 사이 새로고침이 목록을 교체했으면 이 페이지는 옛 커서의 꼬리다 — 이어붙이지 않는다.
      if (seq !== requestSeqRef.current) return;
      setItems((prev) => [...(prev ?? []), ...slice.content]);
      setPageEnd({ hasNext: slice.hasNext, nextCursor: slice.nextCursor });
      setMoreNotice(null);
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      if (groupErrorCode(e) === BET_NOT_FOUND) {
        // 무효 커서(그 내기가 삭제되는 등) — 받은 페이지는 그대로 두고 페이지네이션만 접는다.
        setHistoryDead(true);
        setMoreNotice(MORE_DEAD_NOTICE);
      } else {
        // 일시 실패(네트워크 등) — 커서를 보존해 다음 onEndReached가 같은 페이지를 재시도한다.
        setMoreNotice(MORE_RETRY_NOTICE);
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
      <Text style={s.headerTitle}>지난 내기 기록</Text>
    </View>
  );

  // 에러 + 다시 시도 블록 — 최초 조회 실패(전면)와 '빈 목록 + 재조회 실패'가 같이 쓴다(NoticeScreen 결).
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

  // 정산 1건 카드 — 시트(LastBetResultSheet)와 같은 정보 위계(날짜·배너·참가비/적립금·인별 행).
  // 표기 함수는 전부 시트에서 import — 손익 환산·3상(미판정)·근거(기록 분) 규칙이 갈라지지 않게.
  function renderBetCard(item: GroupBetHistoryItem) {
    const banner = statusBanner(item.status);
    // 분모(목표 분) — undefined(구서버)와 null(과거 정산분)은 표기상 같은 '분모 생략'(시트와 동일).
    const goalMinutes = item.goalMinutes ?? null;
    // achieved 3상 — null(미판정)은 달성으로도 미달성으로도 세지 않는다(카드 캡션과 같은 집계).
    const achieved = item.results.filter((r) => r.achieved === true).length;
    return (
      <View style={s.card} testID={`group.betHistory.item.${item.betId}`}>
        <View style={s.cardHead}>
          <Text style={s.cardDate}>{monthDay(item.betDate)}</Text>
          <Text style={s.cardSummary}>
            {item.results.length}명 중 {achieved}명 달성
          </Text>
        </View>
        {banner !== null && <Text style={s.cardBanner}>{banner}</Text>}
        <Text style={s.cardStat}>
          참가비 {item.stake} · 적립금 {item.pot}
        </Text>
        <View style={s.rows}>
          {item.results.map((r: LastSettledBetResult) => {
            const pending = r.payout === null || r.achieved === null;
            const delta = pending ? 0 : (r.payout as number) - item.stake;
            return (
              <View
                key={r.userId}
                style={s.row}
                accessible
                accessibilityLabel={rowA11y(r, item.stake, goalMinutes)}
              >
                <Text style={s.nickname} numberOfLines={1}>
                  {r.nickname}
                </Text>
                {/* 판정 근거(기록/목표 분) — undefined는 필드를 모르는 구서버라 아예 그리지
                    않는다(시트와 같은 3상 규칙). */}
                {r.progressMinutes !== undefined && (
                  <Text style={s.basis}>{basisText(r.progressMinutes, goalMinutes)}</Text>
                )}
                <Text
                  style={[
                    s.verdict,
                    !pending && r.achieved === true && s.verdictDone,
                    pending && s.verdictPending,
                  ]}
                >
                  {verdictText(r)}
                </Text>
                <Text
                  style={[
                    s.delta,
                    pending && s.deltaPending,
                    !pending && delta > 0 && s.deltaPlus,
                    !pending && delta < 0 && s.deltaMinus,
                  ]}
                >
                  {deltaText(r, item.stake)}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    );
  }

  // ── 최초 로딩 — 중앙 스피너. 새로고침은 RefreshControl이 맡는다(NoticeScreen 결). ──
  if (items === null && errorMsg === null) {
    return (
      <SafeAreaView style={s.root} edges={['top']} testID="group.betHistory.screen">
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
      <SafeAreaView style={s.root} edges={['top']} testID="group.betHistory.screen">
        {header}
        {errorState(errorMsg)}
      </SafeAreaView>
    );
  }

  const list = items ?? [];

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="group.betHistory.screen">
      {header}

      <FlatList
        data={list}
        keyExtractor={(item) => item.betId}
        testID="group.betHistory.list"
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
        // 목록이 이미 있는 상태의 새로고침 실패는 전면 에러 조건에 걸리지 않아 무음이 된다 —
        // 리스트 상단 인라인 배너로 알린다(NoticeScreen과 같은 규격·같은 이유).
        ListHeaderComponent={
          errorMsg !== null && list.length > 0 ? <Text style={s.notice}>{errorMsg}</Text> : null
        }
        // 빈 목록 + 재조회 실패는 '기록이 없다'가 아니라 '모른다' — 에러+다시 시도로 바꾼다.
        ListEmptyComponent={
          errorMsg !== null ? (
            errorState(errorMsg)
          ) : (
            <View style={s.center}>
              <Text style={s.emptyTitle}>아직 정산된 내기가 없어요</Text>
              <Text style={s.emptyDesc}>내기가 정산되면 여기에 차곡차곡 쌓여요</Text>
            </View>
          )
        }
        // 꼬리: 다음 페이지 로딩 스피너 / 실패 인라인 — 받은 이력 위에 얹지 않고 끝에만 붙인다.
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator
              color={T.accent}
              style={s.footerLoading}
              testID="group.betHistory.more.loading"
            />
          ) : moreNotice !== null ? (
            <Text style={s.notice} testID="group.betHistory.more.notice">
              {moreNotice}
            </Text>
          ) : null
        }
        renderItem={({ item }) => renderBetCard(item)}
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
  headerTitle: { ...T.text.heading, fontWeight: '800', color: T.ink },

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

  listContent: { paddingHorizontal: T.space.xl, paddingTop: T.space.xs, gap: T.space.md },
  listEmptyContent: { flexGrow: 1 },

  // 정산 1건 카드 — 공지 카드와 같은 표면 규격(NoticeScreen s.card).
  card: {
    backgroundColor: T.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: T.border,
    padding: T.space.lg,
    gap: T.space.xs,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardDate: { ...T.text.subtitle, color: T.ink },
  cardSummary: { ...T.text.caption, fontWeight: '600', color: T.inkSub },
  // 승자 0명의 결말(환불/소멸) — 돈의 결말이 갈리는 문장이라 danger가 아닌 보조 톤으로 사실만 적는다.
  cardBanner: { ...T.text.caption, fontWeight: '600', color: T.inkSub },
  cardStat: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },

  // 인별 행 — 시트(LastBetResultSheet)의 행 규격을 따른다(같은 데이터·같은 위계).
  rows: {
    marginTop: T.space.xs,
    paddingTop: T.space.sm,
    borderTopWidth: 1,
    borderTopColor: T.divider,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    paddingVertical: T.space.sm,
  },
  nickname: { ...T.text.caption, fontWeight: '600', color: T.inkSub, flex: 1 },
  basis: { ...T.text.caption, fontWeight: '500', color: T.inkMuted, fontVariant: ['tabular-nums'] },
  verdict: { ...T.text.caption, fontWeight: '600', color: T.inkSub },
  verdictDone: { color: T.successInk },
  verdictPending: { color: T.inkFaint, fontWeight: '500' },
  delta: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.inkSub,
    fontVariant: ['tabular-nums'],
    minWidth: 44,
    textAlign: 'right',
  },
  deltaPlus: { color: T.successInk },
  deltaMinus: { color: T.dangerInk },
  deltaPending: { color: T.inkFaint, fontWeight: '500' },
});
