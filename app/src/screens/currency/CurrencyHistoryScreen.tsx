import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { CURRENCY } from '@/constants/currency';
import { CurrencyIcon } from '@/components/CurrencyIcon';
import { getCurrencyTransactions } from '@/services/currencyApi';
import type { CurrencyTransaction, CurrencyTransactionType } from '@/types/dto/currency';
import { useCoins, useRefreshCoinsOnFocus } from '@/store/CoinContext';

// 시간조각(인게임 재화) 거래 내역 화면 — MenuScreen 잔액 행에서 진입.
// GET /api/v1/currency/transactions(최신순)을 그대로 나열한다: 부호 있는 금액 + 사유 한글 라벨 + 날짜.
// ⚠️ 서버 amount는 항상 양수(절대값)라 부호는 type으로 유도한다(dto/currency.ts 주석 참고).

// 거래 사유(enum name) → 한글 라벨. 서버 CurrencyTransactionType 기준.
// 미발행 확장 타입(FOCUS_GOAL 등)은 백엔드가 아직 내리지 않지만, 도착 시 라벨이 비지 않게 미리 매핑해 둔다.
const REASON_LABEL: Record<string, string> = {
  SESSION_COMPLETE: '집중 완료',
  STREAK_BONUS: '연속 공부 보너스',
  PURCHASE: '상점 구매',
  BET_STAKE: '내기 판돈',
  BET_PAYOUT: '내기 정산',
  BET_REFUND: '내기 환불',
  // 서버 확장 대비(현재 미발행)
  FOCUS_GOAL: '집중 목표 달성',
  SCREEN_TIME_GOAL: '스크린타임 목표 달성',
  LEAGUE_TIER_BONUS: '리그 승급 보상',
};

// 사용(차감) 방향 타입 — 나머지는 적립(+). 미지의 타입은 적립으로 폴백해 오인 음수 표기를 피한다.
const SPEND_TYPES = new Set<CurrencyTransactionType>(['PURCHASE', 'BET_STAKE']);

function reasonLabel(type: CurrencyTransactionType): string {
  return REASON_LABEL[type] ?? '재화 변동';
}

// ISO Instant → "M월 D일 HH:mm" (로컬 시간대 기준)
function txDateLabel(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Status = 'loading' | 'error' | 'ready';

export default function CurrencyHistoryScreen() {
  const navigation = useNavigation();
  const { coins, coinsLoaded } = useCoins();
  // 잔액을 보여 주는 화면이라 포커스 시 서버 잔액을 다시 불러온다(내기 차감·정산 반영).
  useRefreshCoinsOnFocus();

  const [status, setStatus] = useState<Status>('loading');
  const [transactions, setTransactions] = useState<CurrencyTransaction[]>([]);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    getCurrencyTransactions()
      .then((list) => {
        if (cancelled) return;
        setTransactions(list);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* 헤더 — 뒤로가기 + 제목(재화 라벨) */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={T.ink} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{CURRENCY.label} 내역</Text>
        {/* 오른쪽 스페이서 — 제목 가운데 정렬 유지 */}
        <View style={s.backBtn} />
      </View>

      {/* 현재 잔액 요약 */}
      <View style={s.balanceCard}>
        {/* 중첩 아이콘은 부모 문자열에 합쳐져 글리프로 읽히므로 라벨은 이 <Text>에 단다. */}
        <Text style={s.balanceLabel} accessibilityLabel={`지금 가진 ${CURRENCY.label}`}>
          {/* 아이콘 색은 감싸는 라벨(T.inkSub)에 맞춘다 — 다른 자리도 옆 글자 색을 따라간다. */}
          <CurrencyIcon size={14} color={T.inkSub} /> 지금 가진 {CURRENCY.label}
        </Text>
        <Text style={s.balanceValue}>{coinsLoaded ? `${coins.toLocaleString()}개` : '–'}</Text>
      </View>

      {status === 'loading' ? (
        <View style={s.center}>
          <ActivityIndicator color={T.accent} />
        </View>
      ) : status === 'error' ? (
        <View style={s.center}>
          <Ionicons name="cloud-offline-outline" size={30} color={T.inkFaint} />
          <Text style={s.stateText}>내역을 불러오지 못했어요.{'\n'}잠시 후 다시 시도해주세요.</Text>
        </View>
      ) : transactions.length === 0 ? (
        <View style={s.center}>
          {/* 빈 상태 — 에러 상태(cloud-offline-outline)와 같은 크기·색 계열로 맞춘다 */}
          <CurrencyIcon size={30} color={T.inkFaint} decorative />
          <Text style={s.stateText}>아직 {CURRENCY.label} 내역이 없어요.</Text>
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
                  accessibilityLabel={`${isSpend ? '사용' : '적립'} ${item.amount.toLocaleString()} ${CURRENCY.label}`}
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
