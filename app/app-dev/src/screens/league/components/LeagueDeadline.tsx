import { Text } from 'react-native';
import { t } from '@/i18n';
import { useLiveFocusClock } from '@/hooks/useLiveFocusClock';
import { FIXED_BOX_FONT_SCALE_MAX } from '@/constants/theme';

// 주간 정산 마감 카운트다운 (GROMO-538) — 1초 틱을 **이 컴포넌트 안에 가둔다**.
//
// ⚠️ 이 틱이 useLeagueMeta(=LeagueScreen 본체)에 있으면 리그 화면 전체가 매초 리렌더된다.
//    랭킹 목록이 봇 190명(티켓 1565) 이후 100행이 되면서 그 매초 리렌더가 곧 100행 재생성과
//    O(N²) 순위 계산으로 이어져 리그 탭이 통째로 굼떠졌다(GROMO-1572). 틱을 소비하는 건
//    이 라벨 하나뿐이므로 여기로 내린다 — 홈 탭(useLeagueMeta로 티어만 읽는다)의
//    매초 리렌더도 같이 사라진다.
//
// 전용 타이머를 만들지 않고 공용 시계(useLiveFocusClock)를 구독한다 — 앱 전체 1초 타이머가
// 하나로 유지된다.
//
// deadlineAt: 절대 마감 시각(epoch ms). '남은 초'를 받지 않는 이유는 useLeagueMeta 주석 참고 —
//   이 라벨은 탭 전환마다 언마운트/재마운트되므로, 감소하는 값을 받으면 재마운트가 카운트다운을
//   되감는다(코덱스 리뷰).
export function LeagueDeadline({
  deadlineAt,
  style,
}: {
  deadlineAt: number | null;
  style?: React.ComponentProps<typeof Text>['style'];
}) {
  const now = useLiveFocusClock(deadlineAt != null);
  const remaining = deadlineAt != null ? Math.max(0, (deadlineAt - now) / 1000) : null;

  return (
    <Text style={style} numberOfLines={1} maxFontSizeMultiplier={FIXED_BOX_FONT_SCALE_MAX}>
      {remaining != null ? fmtDeadline(remaining) : ''}
    </Text>
  );
}

// 초 → "마감 N일 HH:MM"
function fmtDeadline(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  return d > 0
    ? t('league.deadline.withDays', { days: d, time: `${hh}:${mm}` })
    : t('league.deadline.short', { time: `${hh}:${mm}` });
}
