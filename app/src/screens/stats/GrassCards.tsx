// ST9 공부 잔디 카드 본문 — 주=월~일 7칸 한 줄(WeekGrassRow), 월=해당 월 전체 날짜
// 7칸씩 그리드(MonthGrassGrid). 공부량이 많을수록 진해진다(GROMO-761).
import { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { T } from '@/constants/theme';
import type { HeatmapCellResponse } from '@/types/dto/stats';
import { localDateStr, todayStr } from '@/utils/localDate';
import { fmtHm } from '@/utils/timeFormat';
import { grassLevel } from './format';
import { GRASS, WEEK_DAYS } from './constants';
import { cs } from './cardStyles';

// 탭한 잔디 칸 정보줄 문구 — 날짜·요일·집중시간. 서버가 초를 분으로 내림해 0분이어도 세션이
// 있을 수 있어(sessionCount>0) '1분 미만'과 '기록 없음'을 구분한다(코덱스 리뷰 반영)
function grassPickLabel(date: string, minutes: number, hasRecord: boolean): string {
  const [y, m, d] = date.split('-').map(Number);
  const day = WEEK_DAYS[(new Date(y, m - 1, d).getDay() + 6) % 7];
  const time = minutes > 0 ? `집중 ${fmtHm(minutes)}` : hasRecord ? '집중 1분 미만' : '기록 없음';
  return `${m}월 ${d}일 (${day}) · ${time}`;
}

// 주 탭 — 월~일 7칸 정사각형 고정. 아직 안 온 요일은 빈 칸(레벨 0)으로 자리만 유지.
export function WeekGrassRow({ cells }: { cells: HeatmapCellResponse[] }) {
  // 탭한 칸의 날짜·집중시간 정보줄(GROMO-849) — 미래 요일 무반응, 같은 칸 재탭이면 닫힘
  const [picked, setPicked] = useState<number | null>(null);
  const minutesByDay = [0, 0, 0, 0, 0, 0, 0];
  const recordedByDay = [false, false, false, false, false, false, false]; // 세션 존재(0분 구분용)
  for (const c of cells) {
    const [y, m, d] = c.date.split('-').map(Number);
    const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // 0=월..6=일
    minutesByDay[dow] = c.totalFocusMinutes;
    recordedByDay[dow] = c.sessionCount > 0;
  }
  // 이번 주 월요일 — 칸별 날짜 계산(정보줄 표기·미래 판정용)
  const now = new Date();
  const dow0 = now.getDay(); // 0=일..6=토
  const monday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + (dow0 === 0 ? -6 : 1 - dow0),
  );
  const dateFor = (i: number) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return localDateStr(d);
  };
  const todayKey = todayStr();
  return (
    <View>
      <View style={s.weekGrassRow}>
        {WEEK_DAYS.map((d, i) => (
          <View key={d} style={s.weekGrassCol}>
            <Pressable
              onPress={() => {
                // 미래 요일은 완전 무반응(코덱스 리뷰 반영)
                if (dateFor(i) > todayKey) return;
                setPicked(picked === i ? null : i);
              }}
              style={[
                s.weekGrassCell,
                { backgroundColor: GRASS[grassLevel(minutesByDay[i])] },
                picked === i ? cs.grassCellOn : null,
              ]}
            />
            <Text style={s.weekGrassLabel} allowFontScaling={false}>
              {d}
            </Text>
          </View>
        ))}
      </View>
      {picked != null && (
        <Text style={cs.grassPickInfo} allowFontScaling={false}>
          {grassPickLabel(dateFor(picked), minutesByDay[picked], recordedByDay[picked])}
        </Text>
      )}
    </View>
  );
}

// ST9(월) 공부 잔디 — 해당 월 전체 날짜(말일까지)를 한 줄 7칸씩 정사각형으로 미리 그림(GROMO-761).
// 아직 안 온 날짜는 빈 칸(레벨 0)으로 자리만 유지.
export function MonthGrassGrid({ cells }: { cells: HeatmapCellResponse[] }) {
  // 탭한 칸의 날짜·집중시간 정보줄(GROMO-849) — 미래 날짜 무반응, 같은 칸 재탭이면 닫힘
  const [picked, setPicked] = useState<string | null>(null);
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const cellByDate = new Map(cells.map((c) => [c.date, c])); // 분·세션 수 함께 참조(0분 구분용)
  const days = Array.from({ length: lastDay }, (_, i) =>
    localDateStr(new Date(now.getFullYear(), now.getMonth(), i + 1)),
  );
  const rows: string[][] = [];
  for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
  const todayKey = todayStr();
  return (
    <View>
      <View style={cs.monthGrass}>
        {rows.map((row, ri) => (
          <View key={ri} style={cs.monthGrassRow}>
            {row.map((date) => (
              <Pressable
                key={date}
                onPress={() => {
                  // 미래 날짜는 완전 무반응(코덱스 리뷰 반영)
                  if (date > todayKey) return;
                  setPicked(picked === date ? null : date);
                }}
                style={[
                  cs.monthGrassCell,
                  {
                    backgroundColor:
                      GRASS[grassLevel(cellByDate.get(date)?.totalFocusMinutes ?? 0)],
                  },
                  picked === date ? cs.grassCellOn : null,
                ]}
              />
            ))}
          </View>
        ))}
      </View>
      {picked != null && (
        <Text style={cs.grassPickInfo} allowFontScaling={false}>
          {grassPickLabel(
            picked,
            cellByDate.get(picked)?.totalFocusMinutes ?? 0,
            (cellByDate.get(picked)?.sessionCount ?? 0) > 0,
          )}
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  // 주 탭 잔디 한 줄 — 월 탭과 같은 24px 정사각형 + 요일 라벨, 블록 가운데 정렬
  weekGrassRow: {
    flexDirection: 'row',
    gap: T.space.sm,
    marginTop: T.space.xs,
    alignSelf: 'center',
  },
  weekGrassCol: { alignItems: 'center', gap: T.space.xs },
  weekGrassCell: { width: 24, height: 24, borderRadius: 6 },
  weekGrassLabel: { ...T.text.caption, fontSize: 10, color: T.inkMuted },
});
