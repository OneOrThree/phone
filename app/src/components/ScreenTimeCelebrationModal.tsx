import { Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CelebrationModal, CelebrationPill } from '@/components/CelebrationModal';
import { T } from '@/constants/theme';
import { CurrencyIcon } from '@/components/CurrencyIcon';
import { CURRENCY } from '@/constants/currency';

// 스크린타임 목표 달성 축하 모달(GROMO-629) — 어제 사용 시간이 목표 이내였으면 그날 첫 홈 진입에
// 1회 노출. 목표 보상으로 지급된 시간조각을 rewardCoins로 받아 +N 한 줄로 표시한다(>0일 때만) —
// 값은 호출자가 넘긴다. 모양은 포커스 목표 축하(GoalCelebrationModal)와 동일, 문구만 스크린타임용.
// '연속 목표달성'만 표시한다.
//
// 연출·타이밍·게이트는 전부 CelebrationModal(공통 껍데기)에 있다 — 여기는 문구와 pill만 정한다.
interface Props {
  visible: boolean;
  streakDays: number; // 어제 포함 연속 목표달성 일수
  goalMinutes?: number; // 어제 목표 사용 시간(분) — "N시간 이내로 사용하기 성공" 문구용
  rewardCoins?: number; // 목표 보상 시간조각 — >0일 때만 +N ⏳ 표기
  onClose: () => void;
}

// 분 → "3시간" / "3시간 30분" / "30분" (목표 시간 문장 표기용)
function goalLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}

export function ScreenTimeCelebrationModal({
  visible,
  streakDays,
  goalMinutes,
  rewardCoins,
  onClose,
}: Props) {
  const goalLine = goalMinutes
    ? `${goalLabel(goalMinutes)} 이내로 사용하기 성공했어요.`
    : '목표 이내로 사용하기 성공했어요.';
  return (
    <CelebrationModal
      visible={visible}
      onClose={onClose}
      testIDPrefix="screenTimeCelebration"
      badge={
        <CelebrationPill>
          <Ionicons name="flame" size={15} color={T.accentDeep} />
          <Text style={s.streakText}>
            연속 목표달성 <Text style={s.streakDays}>{streakDays}일</Text>
          </Text>
        </CelebrationPill>
      }
      title="어제 핸드폰 사용 시간 목표를 달성했군요!"
      sub={`${goalLine}\n오늘도 화이팅!`}
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
