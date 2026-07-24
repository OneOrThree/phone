// ST1 비교 블록(총 집중시간 카드 하단) — 주=리그 랭킹 기반(CompareWeek),
// 일/월=평균 집계 API 기반(ComparePeriod). 축 칩·나 vs 평균 바는 공용.
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { T } from '@/constants/theme';
import type { StatsPeriod } from '@/types/dto/stats';
import { logStatsCompareAxisChanged, type CompareAxisParam } from '@/services/analyticsEvents';
import {
  fetchGlobalAverage,
  fetchCategoryAverage,
  fetchFriendsAverage,
  fetchFocusAverage,
} from '@/services/compareAverages';
import { STORAGE_KEYS } from '@/types/storage';
import { fmtMinutes } from '@/utils/timeFormat';
import { periodKey } from './format';
import { cs } from './cardStyles';

// ST1 비교(주간 실데이터) — 전체/같은 카테고리는 리그 랭킹(주간 아레나 집계) 평균, 친구는 평균
// 집계 API(compareAverages 공용 헬퍼). 리그가 주간 집계라 '주' 탭에서만 유효 —
// 일/월은 평균 집계 API(753) 기반 ComparePeriod가 담당한다(GROMO-833).
export function CompareWeek({ myMinutes }: { myMinutes: number }) {
  const [axis, setAxis] = useState<CompareAxisKey>('ALL');
  const [loaded, setLoaded] = useState(false);
  const [avgs, setAvgs] = useState<{
    global: number | null;
    category: { avg: number | null; label: string | null };
    friends: { avg: number | null; count: number };
  }>({ global: null, category: { avg: null, label: null }, friends: { avg: null, count: 0 } });

  // 화면 재진입마다 재조회 — 리뷰 반영(타임테이블과 동일 패턴)
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const [global, category, friends] = await Promise.all([
          fetchGlobalAverage(),
          fetchCategoryAverage(),
          fetchFriendsAverage('WEEK'),
        ]);
        if (cancelled) return;
        setAvgs({ global, category, friends });
        setLoaded(true);
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const avg =
    axis === 'ALL' ? avgs.global : axis === 'FRIENDS' ? avgs.friends.avg : avgs.category.avg;
  const avgLabel =
    axis === 'ALL'
      ? '전체 평균'
      : axis === 'FRIENDS'
        ? '친구 평균'
        : `${avgs.category.label ?? '같은 카테고리'} 평균`;
  // 축별 빈 상태 안내 — 친구 없음/준비 시험 미설정은 원인을 알려주고, 그 외엔 조회 실패로 안내.
  const emptyNote =
    axis === 'FRIENDS' && avgs.friends.count === 0
      ? '아직 친구가 없어요'
      : axis === 'CATEGORY' && !avgs.category.label
        ? '준비 시험을 설정하면 비교할 수 있어요'
        : '비교 데이터를 불러오지 못했어요';

  return (
    <View style={s.compare}>
      <CompareChips
        active={axis}
        onSelect={(k) => {
          // 같은 칩 재탭은 미계측 — 이 카드는 주 탭 전용이라 period 고정
          if (k !== axis) logStatsCompareAxisChanged({ axis: axisParam(k), period: 'week' });
          setAxis(k);
        }}
      />
      {!loaded ? (
        <View style={cs.compareLoading}>
          <ActivityIndicator color={T.accent} size="small" />
        </View>
      ) : avg == null ? (
        <Text style={cs.emptyText}>{emptyNote}</Text>
      ) : (
        <CompareBars myMinutes={myMinutes} avg={avg} avgLabel={avgLabel} />
      )}
    </View>
  );
}

// ST1 비교(일/월, GROMO-833) — 3축(친구/전체/같은 카테고리) 모두 평균 집계 API(753)로 조회.
// 그룹 값은 합계가 아니라 활동 유저 1인당 평균 — 내 값과 1:1 비교(티켓 833 용어 기준).
// 주 탭(CompareWeek)의 리그 랭킹 기반 방식은 그대로 유지(755에서 범위 외로 결정).
// count 0(집계 대상 없음)·-1(조회 실패)로 빈 문구를 나눈다(679 구분, 집중 결과 카드와 동일).
type CompareAxisKey = 'FRIENDS' | 'ALL' | 'CATEGORY';
type CompareAvg = { avg: number | null; count: number };

const COMPARE_AXES: { key: CompareAxisKey; chip: string; label: string }[] = [
  { key: 'FRIENDS', chip: '친구', label: '친구 평균' },
  { key: 'ALL', chip: '전체', label: '전체 평균' },
  { key: 'CATEGORY', chip: '같은 카테고리', label: '같은 카테고리 평균' },
];

// 계측 파라미터 값 — CompareAxisKey를 이벤트 공용 소문자 값으로 변환(GROMO-782)
const axisParam = (k: CompareAxisKey): CompareAxisParam =>
  k === 'FRIENDS' ? 'friends' : k === 'ALL' ? 'all' : 'category';

export function ComparePeriod({ period, myMinutes }: { period: StatsPeriod; myMinutes: number }) {
  const [axis, setAxis] = useState<CompareAxisKey>('ALL');
  // 축별 도착 상태 — undefined=로딩. 도착한 축부터 채워 축 전환 시 기다림을 줄인다(755 패턴)
  const [avgs, setAvgs] = useState<Partial<Record<CompareAxisKey, CompareAvg>>>({});
  // 준비 시험(카테고리)명 — 서버는 미설정도 sampleSize 0으로 응답해 응답만으론 '표본 없음'과
  // 구분이 안 된다. CompareWeek처럼 로컬 값으로 미설정 문구를 분기한다(PR 254 리뷰 반영)
  const [categoryLabel, setCategoryLabel] = useState<string | null>(null);

  // 화면 재진입마다 재조회 — CompareWeek와 동일 패턴
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const put = (k: CompareAxisKey) => (v: CompareAvg) => {
        if (!cancelled) setAvgs((prev) => ({ ...prev, [k]: v }));
      };
      fetchFriendsAverage(period).then(put('FRIENDS'));
      fetchFocusAverage('TOTAL', period).then(put('ALL'));
      fetchFocusAverage('CATEGORY', period).then(put('CATEGORY'));
      AsyncStorage.getItem(STORAGE_KEYS.focusCategory)
        .then((v) => !cancelled && setCategoryLabel(v))
        .catch(() => {}); // 조회 실패 → 미설정과 동일 취급(설정 유도 문구)
      return () => {
        cancelled = true;
      };
    }, [period]),
  );

  const when = period === 'DAY' ? '오늘' : '이번 달';
  // 축별 빈 상태 안내 — count 0은 집계 대상 없음(원인 안내), 그 외(-1)는 조회 실패.
  // 카테고리 미설정은 기다려도 안 바뀌므로 설정 유도 문구로 분리(CompareWeek와 동일)
  const emptyNote = (k: CompareAxisKey, count: number): string => {
    if (count !== 0) return '비교 데이터를 불러오지 못했어요';
    if (k === 'FRIENDS') return `${when} 집중한 친구가 아직 없어요`;
    if (k === 'CATEGORY')
      return categoryLabel
        ? `${when} 같은 카테고리 기록이 아직 없어요`
        : '준비 시험을 설정하면 비교할 수 있어요';
    return `${when} 집중 기록이 아직 모이지 않았어요`;
  };
  const cur = avgs[axis];
  // 평균 라벨 — 카테고리 축은 주 탭(CompareWeek)처럼 실제 카테고리명으로 표기
  const avgLabel =
    axis === 'CATEGORY'
      ? `${categoryLabel ?? '같은 카테고리'} 평균`
      : (COMPARE_AXES.find((a) => a.key === axis) ?? COMPARE_AXES[1]).label;

  return (
    <View style={s.compare}>
      <CompareChips
        active={axis}
        onSelect={(k) => {
          // 같은 칩 재탭은 미계측
          if (k !== axis)
            logStatsCompareAxisChanged({ axis: axisParam(k), period: periodKey(period) });
          setAxis(k);
        }}
      />
      {cur === undefined ? (
        <View style={cs.compareLoading}>
          <ActivityIndicator color={T.accent} size="small" />
        </View>
      ) : cur.avg == null ? (
        <Text style={cs.emptyText}>{emptyNote(axis, cur.count)}</Text>
      ) : (
        <CompareBars myMinutes={myMinutes} avg={cur.avg} avgLabel={avgLabel} />
      )}
    </View>
  );
}

// 비교축 칩 한 줄(친구/전체/같은 카테고리) — CompareWeek(주)·ComparePeriod(일/월) 공용
function CompareChips({
  active,
  onSelect,
}: {
  active: CompareAxisKey;
  onSelect: (k: CompareAxisKey) => void;
}) {
  return (
    <View style={s.compareChips}>
      {COMPARE_AXES.map((a) => (
        <TouchableOpacity
          key={a.key}
          style={[s.compareChip, active === a.key ? s.compareChipOn : null]}
          onPress={() => onSelect(a.key)}
          activeOpacity={0.8}
        >
          <Text style={[s.compareChipText, active === a.key ? s.compareChipTextOn : null]}>
            {a.chip}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// 나 vs 평균 수평 바 2개 — CompareWeek(주)·ComparePeriod(일/월) 공용
function CompareBars({
  myMinutes,
  avg,
  avgLabel,
}: {
  myMinutes: number;
  avg: number;
  avgLabel: string;
}) {
  const denom = Math.max(myMinutes, avg, 1);
  return (
    <View style={s.teaserPad}>
      <View style={s.teaserRowHead}>
        <Text style={s.teaserLabelMine}>나</Text>
        <Text style={s.teaserValueMine}>{fmtMinutes(myMinutes)}</Text>
      </View>
      <View style={s.teaserTrack}>
        <View
          style={[s.teaserFill, s.teaserFillMine, { width: `${(myMinutes / denom) * 100}%` }]}
        />
      </View>
      <View style={[s.teaserRowHead, s.teaserRowGap]}>
        <Text style={s.teaserLabel}>{avgLabel}</Text>
        <Text style={s.teaserValue}>{fmtMinutes(avg)}</Text>
      </View>
      <View style={s.teaserTrack}>
        <View style={[s.teaserFill, s.teaserFillAvg, { width: `${(avg / denom) * 100}%` }]} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  compare: { marginTop: T.space.lg, gap: T.space.sm },
  // 나 vs 평균 바(CompareBars) 스타일
  teaserPad: { paddingVertical: T.space.xs },
  teaserRowHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: T.space.xs,
  },
  teaserRowGap: { marginTop: T.space.md },
  teaserLabelMine: { ...T.text.caption, fontWeight: '700', color: T.ink },
  teaserValueMine: { ...T.text.caption, fontWeight: '800', color: T.accent },
  teaserLabel: { ...T.text.caption, fontWeight: '600', color: T.inkSub },
  teaserValue: { ...T.text.caption, fontWeight: '700', color: T.inkSub },
  teaserTrack: { height: 10, borderRadius: 5, backgroundColor: T.sandLight, overflow: 'hidden' },
  teaserFill: { height: 10, borderRadius: 5 },
  teaserFillMine: { width: '86%', backgroundColor: T.accent },
  teaserFillAvg: { width: '62%', backgroundColor: T.compare.avg },

  compareChips: { flexDirection: 'row', gap: T.space.sm },
  compareChip: {
    paddingHorizontal: T.space.md,
    paddingVertical: T.space.sm,
    borderRadius: 999,
    backgroundColor: T.sandLight,
  },
  compareChipText: { ...T.text.caption, color: T.inkMuted },
  compareChipOn: { backgroundColor: T.accent },
  compareChipTextOn: { color: T.white, fontWeight: '700' },
});
