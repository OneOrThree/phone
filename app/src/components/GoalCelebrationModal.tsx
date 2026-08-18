import { Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CelebrationModal, CelebrationPill } from '@/components/CelebrationModal';
import { T } from '@/constants/theme';
import { CurrencyIcon } from '@/components/CurrencyIcon';
import { CURRENCY } from '@/constants/currency';

// 포커스 목표 달성 축하 모달(GROMO-630) — 오늘 누적 집중이 목표를 처음 채운 순간 결과 화면에서
// 1회 노출. 목표 보상으로 지급된 시간조각을 rewardCoins로 받아 +N 한 줄로 표시한다(>0일 때만).
// 값은 호출자가 넘긴다 — 지급이 없거나 아직 안 정해졌으면 줄을 숨겨 축하 + 스트릭만 남는다.
// '연속 목표달성' 표기는 '연속 공부'(하루 10분 스트릭)와 다른 개념이라 이 모달에는 섞지 않는다.
//
// 연출·타이밍·게이트는 전부 CelebrationModal(공통 껍데기)에 있다 — 여기는 문구와 pill만 정한다.
interface Props {
  visible: boolean;
  goalStreakDays: number; // 오늘 포함 연속 목표달성 일수
  goalMinutes?: number; // 달성한 목표 시간(분) — 제목에 "N시간 집중 목표 달성!" 표기
  rewardCoins?: number; // 목표 보상 시간조각 — >0일 때만 +N ⏳ 표기
  onClose: () => void;
}

// 분 → "5시간" / "1시간 30분" / "30분" (축하 제목용 — 00:00:00 표기보다 문장에 자연스러움)
function goalLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}

export function GoalCelebrationModal({
  visible,
  goalStreakDays,
  goalMinutes,
  rewardCoins,
  onClose,
}: Props) {
  return (
    <CelebrationModal
      visible={visible}
      onClose={onClose}
      testIDPrefix="goalCelebration"
      badge={
        <CelebrationPill>
          <Ionicons name="flame" size={15} color={T.accentDeep} />
          <Text style={s.streakText}>
            연속 목표달성 <Text style={s.streakDays}>{goalStreakDays}일</Text>
          </Text>
        </CelebrationPill>
      }
      title={goalMinutes ? `${goalLabel(goalMinutes)} 집중 목표 달성!` : '오늘 목표 달성!'}
      sub="내일도 힘내서 목표 달성해요!"
      /* 목표 보상 시간조각 — 호출자가 넘긴 rewardCoins>0일 때만 */
      footer={
        (rewardCoins ?? 0) > 0 ? (
          <CelebrationPill style={s.coinBox}>
            {/* 중첩 아이콘은 부모 문자열에 합쳐져 글리프로 읽히므로 라벨은 이 <Text>에 단다. */}
            <Text
              style={s.coinText}
              accessibilityLabel={`${CURRENCY.label} ${rewardCoins?.toLocaleString()} 획득!`}
            >
              +{rewardCoins?.toLocaleString()} <CurrencyIcon size={14} /> 획득!
            </Text>
          </CelebrationPill>
        ) : null
      }
      ctaLabel="좋아요!"
    />
  );
}

const s = StyleSheet.create({
  streakText: { ...T.text.label, fontWeight: '600', color: T.accentDeep },
  streakDays: { fontWeight: '800' },
  // 목표 보상 시간조각 pill(+N ⏳)
  coinBox: { marginTop: T.space.xs },
  coinText: { ...T.text.label, fontWeight: '800', color: T.accentDeep },
});
