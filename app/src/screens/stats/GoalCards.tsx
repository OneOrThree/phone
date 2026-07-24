// ── 목표 달성 카드(ST8 재도입) ──
// 일: 오늘 집중·폰 사용 목표 2개를 스탬프로. 집중=정한 시간 '채우기'(달성 체크),
// 폰 사용=제한 '이내 유지'(초과 시 실패, 이내면 목표까지 남은 사용 시간 표시).
// 주/월: heatmap의 focusGoalAchieved·screenTimeGoalAchieved로 달성한 '날 수'를 집계.
import { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import type { HeatmapCellResponse, TodayStatsResponse } from '@/types/dto/stats';
import { useFocus } from '@/store/FocusContext';
import { localDateStr, todayStr } from '@/utils/localDate';
import { fmtHm } from '@/utils/timeFormat';
import { GRASS, FOCUS_COLOR, PHONE_COLOR, WEEK_DAYS } from './constants';
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

type GoalDotState = 'on' | 'miss' | 'future';

// 주 탭 — 집중·폰 사용 각각 월~일 7칸 도트. 달성=색, 미달=빨강 틴트, 미래·판정 전·가입 전=회색.
// 오늘은 heatmap 플래그 대신 라이브 판정(PR 리뷰 반영) — 폰 사용 플래그는 다음날 마감까지 항상
// false라 그대로 쓰면 아직 목표 이내인 오늘이 하루 종일 '미달'로 칠해진다. 집중=달성 즉시 확정(on),
// 폰=초과만 확정(miss), 그 외는 진행 중(중립). 가입 전 요일은 서버가 가입일로 클램프한
// elapsedDays(스크린타임 기간 통계)로 역산해 중립 처리(신규 유저가 미달로 보이지 않게).
export function GoalWeekDots({
  cells,
  today,
  elapsedDays,
}: {
  cells: HeatmapCellResponse[];
  today: TodayStatsResponse | null;
  elapsedDays: number | null;
}) {
  const now = new Date();
  const dow = now.getDay(); // 0=일..6=토
  const monday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + (dow === 0 ? -6 : 1 - dow),
  );
  const todayKey = todayStr();
  const byDate = new Map(cells.map((c) => [c.date, c]));
  const todayCol = dow === 0 ? 6 : dow - 1;
  // 이번 주 앞쪽에서 가입 전인 요일 수 — 지난 요일 수(todayCol+1)가 경과일보다 크면 그 차이만큼
  const preJoinCols = elapsedDays != null ? Math.max(0, todayCol + 1 - elapsedDays) : 0;

  // 오늘 라이브 판정 — today 조회 실패 시 집중은 heatmap 플래그(달성 즉시 반영), 폰은 중립.
  const todayFocus: GoalDotState | null = today
    ? today.focus.goalAchieved
      ? 'on'
      : 'future'
    : null;
  const todayPhone: GoalDotState =
    today &&
    today.screenTime.goalMinutes > 0 &&
    today.screenTime.todayMinutes > today.screenTime.goalMinutes
      ? 'miss'
      : 'future';

  // 목표 미설정(goalMinutes 0) — 플래그가 항상 false라 매일 '미달'로 보인다(PR 리뷰 반영).
  // 해당 지표 줄은 중립 도트 + '목표 미설정' 라벨. today 조회 실패 시엔 설정된 것으로 간주(기존 동작).
  const focusGoalSet = today == null || today.focus.goalMinutes > 0;
  const phoneGoalSet = today == null || today.screenTime.goalMinutes > 0;

  const stateFor = (
    offset: number,
    achieved: (c: HeatmapCellResponse | undefined) => boolean,
    todayState: GoalDotState | null, // null = heatmap 판정 그대로 사용
  ): GoalDotState => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + offset);
    const key = localDateStr(d);
    if (key > todayKey) return 'future'; // 'YYYY-MM-DD' 문자열 비교 = 날짜 비교
    if (offset < preJoinCols) return 'future'; // 가입 전 — 판정 없음
    if (key === todayKey && todayState != null) return todayState;
    return achieved(byDate.get(key)) ? 'on' : 'miss';
  };
  // 집중: 플래그 그대로(기록 없는 날 = 0분 = 미달). 폰: 플래그 또는 0분이면 달성 — 서버 기간
  // 통계의 'row 없는 날 = 0분 = 달성'과 의미 일치(PR 리뷰 반영). heatmap은 빈 날을 false
  // 플래그·0분 셀로 채우므로 플래그만 보면 미동기화 날이 전부 미달로 보인다.
  const focusStates = WEEK_DAYS.map((_, i) =>
    focusGoalSet
      ? stateFor(i, (c) => c?.focusGoalAchieved ?? false, todayFocus)
      : ('future' as GoalDotState),
  );
  const phoneStates = WEEK_DAYS.map((_, i) =>
    phoneGoalSet
      ? stateFor(
          i,
          (c) => c != null && (c.screenTimeGoalAchieved || c.actualScreenTimeMinutes === 0),
          todayPhone,
        )
      : ('future' as GoalDotState),
  );
  return (
    <View style={s.goalWeekWrap}>
      <GoalDotRow label="집중" color={FOCUS_COLOR} states={focusStates} unset={!focusGoalSet} />
      <GoalDotRow label="폰 사용" color={PHONE_COLOR} states={phoneStates} unset={!phoneGoalSet} />
    </View>
  );
}

function GoalDotRow({
  label,
  color,
  states,
  unset,
}: {
  label: string;
  color: string;
  states: GoalDotState[];
  unset?: boolean; // 목표 미설정 — 도트는 전부 중립으로 오고, 카운트 자리에 안내만
}) {
  const count = states.filter((x) => x === 'on').length;
  return (
    <View>
      <View style={s.goalDotHead}>
        <Text style={[s.goalDotLabel, { color }]}>{label}</Text>
        <Text style={[s.goalDotCount, { color: unset ? T.inkMuted : color }]}>
          {unset ? '목표 미설정' : `7일 중 ${count}일 달성`}
        </Text>
      </View>
      <View style={s.goalDotRow}>
        {WEEK_DAYS.map((d, i) => {
          const st = states[i];
          const bg = st === 'on' ? color : st === 'miss' ? T.dangerBg : T.track;
          const fg = st === 'on' ? T.white : st === 'miss' ? T.dangerInk : T.inkFaint;
          return (
            <View key={d} style={[s.goalDot, { backgroundColor: bg }]}>
              <Text style={[s.goalDotDay, { color: fg }]} allowFontScaling={false}>
                {d}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// 월 탭 — 해당 월 달력. 하루에 둘 다 달성=진한 초록, 하나만=연초록, 못함=빈칸, 미래·판정 전·가입 전=회색.
// 오늘·가입 전 처리는 GoalWeekDots와 동일한 이유(PR 리뷰 반영) — 오늘은 라이브 판정(집중 달성만
// 확정 연초록, 폰은 다음날 마감 전이라 미판정), 가입 전 날짜는 elapsedDays 역산으로 중립 처리.
export function GoalMonthGrid({
  cells,
  today,
  elapsedDays,
}: {
  cells: HeatmapCellResponse[];
  today: TodayStatsResponse | null;
  elapsedDays: number | null;
}) {
  // 탭한 날의 목표별 달성 내역 정보줄(GROMO-849) — 미래·가입 전 무반응, 같은 칸 재탭이면 닫힘
  const [picked, setPicked] = useState<string | null>(null);
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const todayKey = todayStr();
  const byDate = new Map(cells.map((c) => [c.date, c]));
  const dayOf = (date: string) => Number(date.slice(8, 10));
  // 이달 앞쪽에서 가입 전인 날 수 — 오늘 일자가 경과일보다 크면 그 차이만큼
  const preJoinDays = elapsedDays != null ? Math.max(0, now.getDate() - elapsedDays) : 0;
  // 목표 미설정·폰 0분 달성 판정은 GoalWeekDots와 동일한 이유(PR 리뷰 반영).
  const focusGoalSet = today == null || today.focus.goalMinutes > 0;
  const phoneGoalSet = today == null || today.screenTime.goalMinutes > 0;
  const todayFocusOn = focusGoalSet && (today?.focus.goalAchieved ?? false);
  // 폰 과거일 달성 — 플래그 또는 0분(미동기화 날 포함): 서버 'row 없는 날 = 0분 = 달성'과 일치
  const phoneAchieved = (c: HeatmapCellResponse | undefined) =>
    c != null && (c.screenTimeGoalAchieved || c.actualScreenTimeMinutes === 0);

  let focusDays = todayFocusOn ? 1 : 0; // 오늘 몫은 라이브 판정으로만 계상(폰·둘 다는 다음날 확정)
  let phoneDays = 0;
  let bothDays = 0;
  for (const c of cells) {
    if (c.date >= todayKey) continue; // 오늘은 위에서 라이브로, 미래는 제외
    if (dayOf(c.date) <= preJoinDays) continue; // 가입 전 — 판정 없음
    const f = focusGoalSet && c.focusGoalAchieved;
    const p = phoneGoalSet && phoneAchieved(c);
    if (f) focusDays += 1;
    if (p) phoneDays += 1;
    if (f && p) bothDays += 1;
  }
  const days = Array.from({ length: lastDay }, (_, i) =>
    localDateStr(new Date(now.getFullYear(), now.getMonth(), i + 1)),
  );
  const rows: string[][] = [];
  for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
  const colorFor = (date: string): string => {
    if (date > todayKey) return T.track;
    if (dayOf(date) <= preJoinDays) return T.track; // 가입 전 — 판정 없음
    if (date === todayKey) return todayFocusOn ? GRASS[2] : T.track; // 오늘 — 집중 달성만 확정
    const c = byDate.get(date);
    const n =
      (focusGoalSet && c?.focusGoalAchieved ? 1 : 0) + (phoneGoalSet && phoneAchieved(c) ? 1 : 0);
    return n === 2 ? GRASS[4] : n === 1 ? GRASS[2] : GRASS[0];
  };
  // 탭한 날 정보줄 — 달성한 목표만 나열(색 구분 없음). 오늘 폰 사용은 다음날 확정이라 미포함,
  // 과거는 플래그·폰 0분 달성 규칙 그대로(달력 색칠과 동일 판정).
  const pickedInfo = (() => {
    if (picked == null) return null;
    const [y, m, d] = picked.split('-').map(Number);
    const day = WEEK_DAYS[(new Date(y, m - 1, d).getDay() + 6) % 7];
    const isToday = picked === todayKey;
    const c = byDate.get(picked);
    const done = [
      isToday ? todayFocusOn : focusGoalSet && (c?.focusGoalAchieved ?? false),
      !isToday && phoneGoalSet && phoneAchieved(c),
    ];
    const names = ['집중', '폰 사용'].filter((_, i) => done[i]);
    return `${m}월 ${d}일 (${day}) · ${names.length > 0 ? `${names.join('·')} 달성` : '달성한 목표 없음'}`;
  })();
  return (
    <View>
      <View style={s.goalMonthHead}>
        {/* 달성일/말일 분모 표기 — 주 탭 '7일 중 n일'과 같은 취지, 3개 나열이라 컴팩트(n/말일) */}
        <Text style={[s.goalMonthStat, { color: FOCUS_COLOR }]}>
          집중 {focusGoalSet ? `${focusDays}/${lastDay}일` : '미설정'}
        </Text>
        <Text style={[s.goalMonthStat, { color: PHONE_COLOR }]}>
          폰 사용 {phoneGoalSet ? `${phoneDays}/${lastDay}일` : '미설정'}
        </Text>
        {/* 한쪽이라도 미설정이면 '둘 다'는 성립 불가 — 숨김 */}
        {focusGoalSet && phoneGoalSet && (
          <Text style={[s.goalMonthStat, { color: T.successInk }]}>
            둘 다 {bothDays}/{lastDay}일
          </Text>
        )}
      </View>
      <View style={cs.monthGrass}>
        {rows.map((row, ri) => (
          <View key={ri} style={cs.monthGrassRow}>
            {row.map((date) => (
              <Pressable
                key={date}
                onPress={() => {
                  // 미래·가입 전 날짜는 완전 무반응(코덱스 리뷰 반영)
                  if (date > todayKey || dayOf(date) <= preJoinDays) return;
                  setPicked(picked === date ? null : date);
                }}
                style={[
                  cs.monthGrassCell,
                  { backgroundColor: colorFor(date) },
                  picked === date ? cs.grassCellOn : null,
                ]}
              />
            ))}
          </View>
        ))}
      </View>
      {pickedInfo != null && (
        <Text style={cs.grassPickInfo} allowFontScaling={false}>
          {pickedInfo}
        </Text>
      )}
      <View style={s.goalLegend}>
        <GoalLegendDot color={GRASS[4]} label="둘 다" />
        <GoalLegendDot color={GRASS[2]} label="하나" />
        <GoalLegendDot color={GRASS[0]} label="못함" />
      </View>
    </View>
  );
}

function GoalLegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={s.goalLegendItem}>
      <View style={[s.goalLegendSwatch, { backgroundColor: color }]} />
      <Text style={s.goalLegendText}>{label}</Text>
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

  // 목표 달성 — 주 도트(집중·폰 사용 각 7칸)
  goalWeekWrap: { gap: T.space.lg },
  goalDotHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: T.space.sm,
  },
  goalDotLabel: { ...T.text.label, fontWeight: '800' },
  goalDotCount: { ...T.text.label, fontWeight: '800' },
  goalDotRow: { flexDirection: 'row', gap: T.space.sm },
  goalDot: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalDotDay: { ...T.text.caption, fontSize: 10, fontWeight: '800' },

  // 목표 달성 — 월 달력
  // 분모 표기로 길어질 수 있어 좁은 화면에선 줄바꿈 허용
  goalMonthHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: T.space.lg,
    marginBottom: T.space.md,
  },
  goalMonthStat: { ...T.text.label, fontWeight: '800' },
  goalLegend: { flexDirection: 'row', gap: T.space.lg, marginTop: T.space.md, alignSelf: 'center' },
  goalLegendItem: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  goalLegendSwatch: { width: 12, height: 12, borderRadius: 4 },
  goalLegendText: { ...T.text.caption, color: T.inkSub },
});
