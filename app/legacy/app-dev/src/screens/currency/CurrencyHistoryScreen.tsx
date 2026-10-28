import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { T } from '@/constants/theme';
import { CURRENCY } from '@/constants/currency';
import { CurrencyIcon } from '@/components/CurrencyIcon';
import { getCurrencyTransactions } from '@/services/currencyApi';
import type { CurrencyTransaction, CurrencyTransactionType } from '@/types/dto/currency';
import { useCoins, useRefreshCoinsOnFocus } from '@/store/CoinContext';
import { logCurrencyHistoryViewed } from '@/services/analyticsEvents';
import type { V2RootStackParamList } from '@/navigation/types';
import { t } from '@/i18n';

// 시간조각(인게임 재화) 거래 내역 화면 — MenuScreen 잔액 행에서 진입.
// GET /api/v1/currency/transactions(최신순)을 그대로 나열한다: 부호 있는 금액 + 사유 한글 라벨 + 날짜.
// ⚠️ 서버 amount는 항상 양수(절대값)라 부호는 type으로 유도한다(dto/currency.ts 주석 참고).

// 거래 사유(enum name) → 번역 키. 서버 CurrencyTransactionType 기준.
const REASON_KEY: Record<string, string> = {
  SESSION_COMPLETE: 'currency.history.reason.sessionComplete',
  STREAK_BONUS: 'currency.history.reason.streakBonus',
  PURCHASE: 'currency.history.reason.purchase',
  BET_STAKE: 'currency.history.reason.betStake',
  BET_PAYOUT: 'currency.history.reason.betPayout',
  BET_REFUND: 'currency.history.reason.betRefund',
  FOCUS_GOAL: 'currency.history.reason.focusGoal',
  SCREEN_TIME_GOAL: 'currency.history.reason.screenTimeGoal',
  LEAGUE_TIER_BONUS: 'currency.history.reason.leagueTierBonus',
};

// 사용(차감) 방향 타입 — 나머지는 적립(+). 미지의 타입은 적립으로 폴백해 오인 음수 표기를 피한다.
const SPEND_TYPES = new Set<CurrencyTransactionType>(['PURCHASE', 'BET_STAKE']);

function reasonLabel(type: CurrencyTransactionType): string {
  return t(REASON_KEY[type] ?? 'currency.history.reason.fallback');
}

// ISO Instant → "M월 D일 HH:mm" (로컬 시간대 기준)
function txDateLabel(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return t('currency.history.dateTime', {
    month: d.getMonth() + 1,
    day: d.getDate(),
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  });
}

type Status = 'loading' | 'error' | 'ready';

// 조회 실패 문구 — 끊긴 연결과 서버 실패를 가른다(GROMO-1073). 응답이 아예 없으면(타임아웃
// ECONNABORTED · 연결 실패 ERR_NETWORK) 서버가 아니라 사용자 쪽 연결이 문제다.
// HTTP status 숫자는 사용자에게 노출하지 않는다(앱 톤) — 원인 추적은 아래 __DEV__ 로그가 맡는다.
// 헬퍼는 화면 안에 둔다(GroupBetHistoryScreen·NoticeScreen의 listErrorMessage 관행).
function listErrorMessage(e: unknown): string {
  if (axios.isAxiosError(e) && !e.response) return t('currency.history.errorOffline');
  return t('common.retryLater');
}

export default function CurrencyHistoryScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<V2RootStackParamList, 'CurrencyHistory'>>();
  const entry = route.params?.entry ?? 'menu_chip';
  const { coins } = useCoins();
  // 잔액을 보여 주는 화면이라 포커스 시 서버 잔액을 다시 불러온다(내기 차감·정산 반영).
  useRefreshCoinsOnFocus();

  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [transactions, setTransactions] = useState<CurrencyTransaction[]>([]);
  // 조회 시퀀스 — 포커스 재조회와 '다시 시도' 탭이 겹칠 수 있어 마지막 호출의 결과만 반영한다
  // (화면을 떠난 뒤 도착한 응답도 여기서 버려진다 — GroupBetHistoryScreen과 같은 결).
  const requestSeqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    setStatus('loading');
    try {
      const list = await getCurrencyTransactions();
      if (seq !== requestSeqRef.current) return;
      setTransactions(list);
      setStatus('ready');
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      if (__DEV__) {
        const httpStatus = axios.isAxiosError(e) ? e.response?.status : undefined;
        const code = axios.isAxiosError(e) ? e.code : undefined;
        console.warn('[currency] 내역 조회 실패', { httpStatus, code, error: e });
      }
      setErrorMsg(listErrorMessage(e));
      setStatus('error');
    }
  }, []);

  // 잔액과 같은 주기로 다시 불러온다(GROMO-1193) — 마운트 1회만 로드하면 화면을 다시 열었을 때
  // '갱신된 잔액 + 낡은 내역'이 나란히 뜬다(잔액은 위 useRefreshCoinsOnFocus가 매번 갱신).
  useFocusEffect(
    useCallback(() => {
      // 화면 진입은 거래 API 성공 여부와 독립된 퍼널 단계다. 조회 성공 여부는 status로
      // 화면에 남기고, 성공한 내역 건수는 화면 진입 이벤트의 필수 조건으로 삼지 않는다.
      logCurrencyHistoryViewed({ entry });
      load();
      return () => {
        // 요청 카운터라 cleanup 시점 값을 그대로 올리는 게 맞다(GroupBetHistoryScreen의 같은 자리).
        requestSeqRef.current++;
      };
    }, [entry, load]),
  );

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* 헤더 — 뒤로가기 + 제목(재화 라벨) */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={T.ink} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>
          {t('currency.history.title', { currency: CURRENCY.label })}
        </Text>
        {/* 오른쪽 스페이서 — 제목 가운데 정렬 유지 */}
        <View style={s.backBtn} />
      </View>

      {/* 현재 잔액 요약 */}
      <View style={s.balanceCard}>
        {/* 중첩 아이콘은 부모 문자열에 합쳐져 글리프로 읽히므로 라벨은 이 <Text>에 단다. */}
        <Text
          style={s.balanceLabel}
          accessibilityLabel={t('currency.history.balanceLabel', { currency: CURRENCY.label })}
        >
          {/* 아이콘 색은 감싸는 라벨(T.inkSub)에 맞춘다 — 다른 자리도 옆 글자 색을 따라간다. */}
          <CurrencyIcon size={14} color={T.inkSub} />{' '}
          {t('currency.history.balanceLabel', { currency: CURRENCY.label })}
        </Text>
        {/* 미로드 시에도 '0'을 보여 준다(GROMO-1073) — 지갑은 가입 시 함께 생겨 신규 유저의
            정답도 0이다. 홈·전체 탭 잔액 표기와 같은 규칙. */}
        <Text style={s.balanceValue}>
          {t('currency.history.balanceValue', { amount: coins.toLocaleString() })}
        </Text>
      </View>

      {status === 'loading' ? (
        <View style={s.center}>
          <ActivityIndicator color={T.accent} />
        </View>
      ) : status === 'error' ? (
        <View style={s.center}>
          <Ionicons name="cloud-offline-outline" size={30} color={T.inkFaint} />
          <Text style={s.stateText}>
            {t('currency.history.loadFailed')}
            {'\n'}
            {errorMsg}
          </Text>
          {/* 같은 화면에 머무는 동안의 유일한 복구 수단 — 포커스 재조회는 화면을 다시 열어야
              돈다(GROMO-1073). 버튼·스타일은 GroupSettingsScreen의 에러 재시도 블록과 동일. */}
          <TouchableOpacity style={s.retryBtn} activeOpacity={0.85} onPress={() => load()}>
            <Text style={s.retryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : transactions.length === 0 ? (
        <View style={s.center}>
          {/* 빈 상태 — 에러 상태(cloud-offline-outline)와 같은 크기·색 계열로 맞춘다 */}
          <CurrencyIcon size={30} color={T.inkFaint} decorative />
          <Text style={s.stateText}>
            {t('currency.history.empty', { currency: CURRENCY.label })}
          </Text>
        </View>
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={(item, index) => `${item.createdAt}-${index}`}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const isSpend = SPEND_TYPES.has(item.type);
            const sign = isSpend ? '−' : '+';
            return (
              <View style={s.row}>
                <View style={s.flex1}>
                  <Text style={s.rowLabel}>{reasonLabel(item.type)}</Text>
                  <Text style={s.rowDate}>{txDateLabel(item.createdAt)}</Text>
                </View>
                <Text
                  style={[s.rowAmount, isSpend ? s.rowAmountSpend : s.rowAmountEarn]}
                  // 부호 기호(−/+)와 중첩 아이콘은 그대로 읽히지 않아 말로 풀어 준다.
                  accessibilityLabel={t(
                    isSpend ? 'currency.history.spentA11y' : 'currency.history.earnedA11y',
                    { amount: item.amount.toLocaleString(), currency: CURRENCY.label },
                  )}
                >
                  {sign}
                  {item.amount.toLocaleString()}{' '}
                  <CurrencyIcon size={16} color={isSpend ? T.dangerInk : T.successInk} />
                </Text>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },

  // 헤더 — StatsScreen과 동일 패턴(백버튼 · 가운데 제목 · 스페이서)
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: T.space.md,
    paddingTop: T.space.xs,
    paddingBottom: T.space.md,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...T.text.subtitle, color: T.ink },

  // 잔액 요약 카드
  balanceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: T.space.xl,
    marginBottom: T.space.md,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.lg,
  },
  balanceLabel: { ...T.text.label, color: T.inkSub, flexShrink: 1 },
  balanceValue: { ...T.text.subtitle, color: T.accentDeep },

  // 상태(로딩·빈·에러) 공통
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: T.space.md },
  stateText: { ...T.text.label, color: T.inkMuted, textAlign: 'center', lineHeight: 20 },
  // 재시도 버튼 — GroupSettingsScreen의 같은 블록 복사. marginTop만 xl→sm으로 줄였다:
  // 이 center는 gap(md)이 이미 있어 원본 그대로 두면 문구와 버튼 사이가 혼자 벌어진다(합 20 유지).
  retryBtn: {
    minHeight: 48,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.xxl,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
    marginTop: T.space.sm,
  },
  retryText: { ...T.text.label, color: T.white },

  // 리스트
  listContent: { paddingHorizontal: T.space.xl, paddingBottom: T.space.xxl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    paddingVertical: T.space.md,
    borderBottomWidth: 1,
    borderBottomColor: T.divider,
  },
  flex1: { flex: 1 },
  rowLabel: { ...T.text.label, color: T.ink },
  rowDate: { ...T.text.caption, color: T.inkMuted, marginTop: 2 },
  rowAmount: { ...T.text.subtitle, fontVariant: ['tabular-nums'] },
  rowAmountEarn: { color: T.successInk },
  rowAmountSpend: { color: T.dangerInk },
});
