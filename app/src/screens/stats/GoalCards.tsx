// ── 목표 달성 카드(ST8) — 일 탭 전용 ──
// 오늘 집중·폰 사용 목표 2개를 스탬프로. 집중=정한 시간 '채우기'(달성 체크),
// 폰 사용=제한 '이내 유지'(초과 시 실패, 이내면 목표까지 남은 사용 시간 표시).
// 주/월 달성 표시(구 도트·달력 그리드)는 GROMO-974에서 CalendarCard(캘린더)로 대체됐다.
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import type { TodayStatsResponse } from '@/types/dto/stats';
import { useFocus } from '@/store/FocusContext';
import { fmtHm } from '@/utils/timeFormat';
import { FOCUS_COLOR } from './constants';
import { cs } from './cardStyles';

// 일 탭 — 오늘 2목표 스탬프. 집중 현재값은 홈·타임테이블과 같은 로컬 오늘 누적(서버 today.focus는
// 업로드 지연이 있어 총계 카드와 어긋난다) + 목표는 서버값. 폰 사용은 서버 today.screenTime.
export function GoalDayStamps({ today }: { today: TodayStatsResponse | null }) {
  const { todayFocusSeconds } = useFocus();
  if (today === null) {
    return <Text style={cs.emptyText}>목표 정보를 불러오지 못했어요</Text>;
  }
  return (
    <View style={s.stampRow}>
      {/* floor — 반올림하면 59분 31초가 60분이 돼 목표 도달 전에 '달성'이 뜬다(PR 리뷰 반영) */}
      <FocusStamp cur={Math.floor(todayFocusSeconds / 60)} goal={today.focus.goalMinutes} />
      <PhoneStamp cur={today.screenTime.todayMinutes} goal={today.screenTime.goalMinutes} />
    </View>
  );
}

function StampIcon({
  bg,
  name,
  color,
}: {
  bg: string;
  name: keyof typeof Ionicons.glyphMap;
  color: string;
}) {
  return (
    <View style={[s.stampIc, { backgroundColor: bg }]}>
      <Ionicons name={name} size={22} color={color} />
    </View>
  );
}

// 집중 목표 — 정한 시간을 채우면 달성. 미설정(0)·진행 중·달성 3상태.
function FocusStamp({ cur, goal }: { cur: number; goal: number }) {
  if (goal <= 0) {
    return (
      <View style={s.stamp}>
        <StampIcon bg={T.track} name="book-outline" color={T.inkMuted} />
        <Text style={[s.stampTitle, { color: T.inkMuted }]}>목표 미설정</Text>
        <Text style={s.stampSub}>설정에서 집중 목표를 정해요</Text>
      </View>
    );
  }
  if (cur >= goal) {
    return (
      <View style={[s.stamp, s.stampOn]}>
        <StampIcon bg={T.green} name="checkmark" color={T.white} />
        <Text style={[s.stampTitle, { color: FOCUS_COLOR }]}>집중 달성</Text>
        <Text style={[s.stampSub, { color: T.successInk }]}>
          {cur}분 · 목표 {goal}분
        </Text>
      </View>
    );
  }
  return (
    <View style={s.stamp}>
      <StampIcon bg={T.greenBg} name="book-outline" color={FOCUS_COLOR} />
      <Text style={[s.stampTitle, { color: FOCUS_COLOR }]}>
        집중 {cur}/{goal}분
      </Text>
      <Text style={s.stampSub}>목표까지 {goal - cur}분</Text>
    </View>
  );
}

// 폰 사용 목표 — 제한 이내로 유지가 목표. 미설정(0)·초과(실패)·이내(남은 시간) 3상태.
function PhoneStamp({ cur, goal }: { cur: number; goal: number }) {
  if (goal <= 0) {
    return (
      <View style={s.stamp}>
        <StampIcon bg={T.track} name="phone-portrait-outline" color={T.inkMuted} />
        <Text style={[s.stampTitle, { color: T.inkMuted }]}>목표 미설정</Text>
        <Text style={s.stampSub}>설정에서 폰 사용 목표를 정해요</Text>
      </View>
    );
  }
  if (cur > goal) {
    return (
      <View style={[s.stamp, s.stampFail]}>
        <StampIcon bg={T.accentAlt} name="close" color={T.white} />
        <Text style={[s.stampTitle, { color: T.dangerInk }]}>목표 달성 실패!</Text>
        <Text style={s.stampSub}>
          폰 사용 {fmtHm(cur)} · 목표 {fmtHm(goal)}
        </Text>
      </View>
    );
  }
  return (
    <View style={[s.stamp, s.stampProgress]}>
      <StampIcon bg={T.white} name="time-outline" color={T.accentDeep} />
      <Text style={[s.stampTitle, { color: T.accentDeep }]}>{fmtHm(goal - cur)} 남음</Text>
      <Text style={s.stampSub}>
        폰 사용 {fmtHm(cur)} · 목표 {fmtHm(goal)}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  // 목표 달성 — 일 스탬프
  stampRow: { flexDirection: 'row', gap: T.space.md },
  stamp: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: T.border,
    paddingVertical: T.space.lg,
    paddingHorizontal: T.space.sm,
  },
  stampOn: { borderColor: T.successBorder, backgroundColor: T.successBg },
  stampFail: { borderColor: T.dangerBorder, backgroundColor: T.dangerBg },
  stampProgress: { borderColor: T.noteBorder, backgroundColor: T.noteBg },
  stampIc: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: T.space.sm,
  },
  stampTitle: { ...T.text.label, fontWeight: '800', textAlign: 'center' },
  stampSub: { ...T.text.caption, color: T.inkSub, textAlign: 'center', marginTop: 2 },
});
