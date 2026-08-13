import { StyleSheet, Text, View } from 'react-native';
import { T } from '@/constants/theme';

// 참가 시트의 잔액 표기 — **N46의 단독 소유 컴포넌트다(GROMO-1424).**
// 형식은 「참가비 30 · 내 잔액 240」까지다 — **차감 후 값(→ 210)은 절대 병기하지 않는다.**
// 참가비와 현재 잔액만 있으면 "낼 수 있나"는 판단되고, 결과값까지 얹으면 한 줄에 숫자가
// 셋이라 정작 중요한 참가비가 묻힌다(policy §7 N46 — 2026-08-09 재영님 결정).
// 잔액 부족 **차단**은 이 컴포넌트의 일이 아니다 — 각 시트가 CTA 잠금으로 유지한다(FR-32).
//
// 다른 시트(join-next 확인·주간 예약 — GROMO-1419·1276)도 잔액을 적을 땐 이 컴포넌트를
// 그대로 재사용한다 — 각 티켓이 자체 표기를 정의하는 것은 금지다(N46 단독 소유).

export interface BetBalanceRowProps {
  // 왼쪽 항목명 — 단건은 '참가비', 주간 합계는 '합계'(둘 다 N46 형식의 '참가비' 자리다).
  label?: string;
  // 이번에 나가는 코인.
  amount: number;
  // 현재 잔액 — 미상(null)이면 숫자를 지어내지 않고 '—'로 적는다(BetSheet 잔액 3상 규칙).
  coins: number | null;
}

export default function BetBalanceRow({ label = '참가비', amount, coins }: BetBalanceRowProps) {
  const balanceText = coins === null ? '—' : String(coins);
  return (
    <View
      style={s.row}
      accessible
      accessibilityLabel={`${label} ${amount}코인, 내 잔액 ${coins === null ? '미확인' : `${coins}코인`}`}
      testID="group.bet.balanceRow"
    >
      <Text style={s.text}>
        {label} {amount} · 내 잔액 {balanceText}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  // 구분선 위 한 줄 — ux 참가 시트 시안(§08)의 CTA 직전 자리 규격.
  row: {
    marginTop: T.space.md,
    paddingTop: T.space.sm,
    borderTopWidth: 1,
    borderTopColor: T.divider,
  },
  text: { ...T.text.caption, fontWeight: '600', color: T.inkSub, fontVariant: ['tabular-nums'] },
});
