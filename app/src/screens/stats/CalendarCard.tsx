// 주/월 캘린더 카드(GROMO-974) — 목표 달성 카드(주 도트·월 그리드)와 공부 잔디 카드를 캘린더 하나로 통합.
// 셀 배경 = 집중시간 강도(인디고 램프 CAL_RAMP), 셀 안에 날짜·집중시간, 그 아래 초록 체크 = 달성한
// 목표 수(집중·폰 사용 각 1개, 최대 2개). ‹ ›로 이전 주/월 넘겨보기 — 과거 기간 heatmap은 카드가
// 직접 조회해 오프셋별로 캐시한다(현재 기간은 useStatsData가 준 cells 재사용).
// 내비게이션 화살표는 기간 라벨 양옆(중앙) 배치 — 카드 오른쪽 위 순서 드래그 핸들(CardOrderEditor)과
// 겹치지 않게 한다.
import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T, withAlpha } from '@/constants/theme';
import type { HeatmapCellResponse, TodayStatsResponse } from '@/types/dto/stats';
import { getFocusPeriodStats, getHeatmap } from '@/services/statsApi';
import { localDateStr, todayStr } from '@/utils/localDate';
import { fmtHm } from '@/utils/timeFormat';
import { calendarPage, grassLevel } from './format';
import { CAL_RAMP, WEEK_DAYS } from './constants';

interface Props {
  period: 'WEEK' | 'MONTH';
  cells: HeatmapCellResponse[]; // 현재 기간(오프셋 0) heatmap — useStatsData 공유
  today: TodayStatsResponse | null; // 오늘 라이브 판정·목표 미설정 판별
  elapsedDays: number | null; // 가입 전 날짜 중립 처리(현재 기간 기준 — 서버가 가입일로 클램프)
  // 현재 기간 총 집중 분(서버 기간 집계 — useStatsData 공유). 일별 내림 합산은 하루 최대 59초씩
  // 잘려 총 집중시간 카드와 어긋날 수 있어 집계값을 우선 쓴다(코드리뷰 반영). null=조회 실패.
  periodTotal: number | null;
}

export function CalendarCard({ period, cells, today, elapsedDays, periodTotal }: Props) {
  const [offset, setOffset] = useState(0); // 0=이번 기간, -1=지난 기간 …
  const [picked, setPicked] = useState<string | null>(null); // 탭한 날짜 — 하단 정보줄
  // 과거 기간 heatmap 캐시(기간 첫 날짜 키). 실패는 캐시하지 않는다 — 빈 데이터로 캐시하면
  // 일시 에러가 '전부 0:00'인 진짜 기록처럼 보이고 재시도도 막힌다(코드리뷰 반영).
  const [pastCells, setPastCells] = useState<Record<string, HeatmapCellResponse[]>>({});
  // 과거 기간 총 집중 분(기간 집계 API — periodTotal과 같은 소스). 실패한 페이지는 키 없음 → 셀 합산 폴백.
  const [pastTotals, setPastTotals] = useState<Record<string, number>>({});
  // 조회 실패한 페이지 — 에러 안내 + 재시도 버튼으로 분기(위 캐시 정책과 세트)
  const [failedKeys, setFailedKeys] = useState<Set<string>>(new Set());
  const [retrySeq, setRetrySeq] = useState(0); // 재시도 버튼이 조회 이펙트를 다시 돌리는 트리거
  const requestedRef = useRef<Set<string>>(new Set()); // 조회 중 재요청 방지
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const todayKey = todayStr();
  const page = calendarPage(period, offset);
  const pageKey = page.days[0];
  const shown = offset === 0 ? cells : pastCells[pageKey];
  const noData = offset < 0 && shown == null; // 로딩·실패 — 셀 값(0:00)·체크를 지어내지 않는다
  const failed = noData && failedKeys.has(pageKey);
  const loading = noData && !failed;

  // 과거 기간 heatmap 조회 — 오프셋을 빠르게 넘겨도 응답은 버리지 않고 캐시에 쌓는다.
  // 기간 총합(집계 API)도 함께 조회하되, 총합 실패는 페이지 실패로 치지 않는다(셀 합산 폴백).
  useEffect(() => {
    if (offset === 0) return;
    const p = calendarPage(period, offset);
    const key = p.days[0];
    if (requestedRef.current.has(key)) return;
    requestedRef.current.add(key);
    const last = p.days[p.days.length - 1];
    const cap = todayStr();
    const anchor = last > cap ? cap : last; // 기간 마지막 날(미래 방지 클램프) — 집계 기준일 겸용
    const totalPromise = getFocusPeriodStats(period, undefined, anchor).catch(() => null);
    getHeatmap(key, anchor)
      .then(async (res) => {
        const stats = await totalPromise;
        if (!mountedRef.current) return;
        setPastCells((prev) => ({ ...prev, [key]: res }));
        if (stats != null) setPastTotals((prev) => ({ ...prev, [key]: stats.totalFocusMinutes }));
        setFailedKeys((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      })
      .catch(() => {
        if (!mountedRef.current) return;
        // 실패는 캐시하지 않고 요청 기록을 지워 재시도가 같은 키를 다시 조회할 수 있게 한다
        requestedRef.current.delete(key);
        setFailedKeys((prev) => new Set(prev).add(key));
      });
  }, [offset, period, retrySeq]);

  // 실패 페이지 재시도 — 실패 표시를 지우고 조회 이펙트를 다시 돌린다
  const retryPage = () => {
    setFailedKeys((prev) => {
      const next = new Set(prev);
      next.delete(pageKey);
      return next;
    });
    setRetrySeq((n) => n + 1);
  };

  const byDate = new Map((shown ?? []).map((c) => [c.date, c]));
  const summedMin = page.days.reduce((sum, d) => sum + (byDate.get(d)?.totalFocusMinutes ?? 0), 0);
  // 헤더 총합 — 서버 기간 집계(초 합산 후 1회 내림) 우선, 미확보 시 셀 합산 폴백(코드리뷰 반영)
  const totalMin = (offset === 0 ? periodTotal : pastTotals[pageKey]) ?? summedMin;

  // 가입 경계 — 서버 elapsedDays는 가입일로 클램프되므로 현재 기간 경과일보다 작으면 가입일을
  // 정확히 역산할 수 있고(joinKey), 같으면 '가입이 현재 기간 시작 이전'이라는 사실만 안다(경계 미상).
  // joinKey를 알면 모든 페이지에서 가입 전 날짜를 중립 처리 — 서버가 요청 범위 전체를 0분 셀로
  // 채워 과거 페이지의 가입 전 날짜가 '0분=달성'으로 보이는 문제 방지(코드리뷰 반영).
  const now = new Date();
  const todayCol = (now.getDay() + 6) % 7; // 0=월..6=일
  const periodElapsed = period === 'WEEK' ? todayCol + 1 : now.getDate();
  const joinKey =
    elapsedDays != null && elapsedDays < periodElapsed
      ? localDateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (elapsedDays - 1)))
      : null;
  // '확실히 가입 이후' 하한 — 경계 미상이면 현재 기간 시작. 이보다 이전 날짜는 멤버십을 알 수
  // 없어 '0분=달성' 폴백을 적용하지 않는다(저장된 확정 플래그만 신뢰).
  const membershipFloor = joinKey ?? calendarPage(period, 0).days[0];
  const isPrejoin = (date: string) => joinKey != null && date < joinKey;

  // 목표 미설정 판별 — 저장된 달성 플래그(true)는 오늘 설정과 무관하게 표시한다(서버가 과거 확정
  // 플래그를 보존 — 목표 해제 시 과거 기록이 사라지면 안 됨, 코드리뷰 반영). 이 게이트는
  // ① 폰 '0분=달성' 폴백 ② 정보줄의 미달 ✗ 표시에만 쓴다. today 조회 실패 시엔 설정된 것으로 간주.
  const focusGoalSet = today == null || today.focus.goalMinutes > 0;
  const phoneGoalSet = today == null || today.screenTime.goalMinutes > 0;

  // 집중 달성 — 오늘은 라이브 판정(달성 즉시 ✓, 미달은 진행 중이라 표시 없음), 과거는 heatmap 플래그.
  const focusOkFor = (date: string, c: HeatmapCellResponse | undefined): boolean =>
    date === todayKey && today != null ? today.focus.goalAchieved : (c?.focusGoalAchieved ?? false);
  // 폰 달성 — 오늘은 다음날 마감까지 미판정(표시 없음). 과거는 저장 플래그, 또는 확실히 가입
  // 이후인 날의 0분(미동기화 날 포함 — 서버 기간 통계 'row 없는 날=0분=달성'과 의미 일치).
  const phoneOkFor = (date: string, c: HeatmapCellResponse | undefined): boolean =>
    date !== todayKey &&
    c != null &&
    (c.screenTimeGoalAchieved ||
      (phoneGoalSet && date >= membershipFloor && c.actualScreenTimeMinutes === 0));

  // 7칸 행으로 슬롯 분할 — 월은 1일 요일 정렬용 앞 빈 칸 + 마지막 행 채움 빈 칸
  const slots: (string | null)[] = [
    ...Array.from({ length: page.leadingBlanks }, () => null),
    ...page.days,
  ];
  while (slots.length % 7 !== 0) slots.push(null);
  const rows: (string | null)[][] = [];
  for (let i = 0; i < slots.length; i += 7) rows.push(slots.slice(i, i + 7));

  const renderCell = (date: string | null, idx: number) => {
    if (date == null) return <View key={`blank-${idx}`} style={s.cell} />;
    const c = byDate.get(date);
    const future = date > todayKey; // 'YYYY-MM-DD' 문자열 비교 = 날짜 비교
    // 로딩·실패(noData) 중엔 전 셀 중립 — 없는 데이터를 '0:00·달성'처럼 지어내지 않는다(코드리뷰 반영)
    const neutral = future || isPrejoin(date) || noData;
    const min = c?.totalFocusMinutes ?? 0;
    const lvl = neutral ? 0 : grassLevel(min);
    const dark = lvl >= 3; // 진한 램프 위 텍스트는 흰색으로
    const checks = (focusOkFor(date, c) ? '✓' : '') + (phoneOkFor(date, c) ? '✓' : '');
    return (
      <Pressable
        key={date}
        onPress={() => {
          if (neutral) return; // 미래·가입 전 무반응(기존 잔디·목표 그리드와 동일)
          setPicked(picked === date ? null : date);
        }}
        style={[
          s.cell,
          { backgroundColor: neutral ? T.track : CAL_RAMP[lvl] },
          date === todayKey || picked === date ? s.cellRing : null,
        ]}
      >
        <Text
          allowFontScaling={false}
          style={[s.cellDate, dark ? s.cellDateOnDark : null, neutral ? s.cellDateNeutral : null]}
        >
          {Number(date.slice(8, 10))}
        </Text>
        {!neutral && (
          <>
            <Text
              allowFontScaling={false}
              style={[s.cellTime, dark ? s.cellTimeOnDark : min <= 0 ? s.cellTimeZero : null]}
            >
              {fmtHm(min)}
            </Text>
            {/* 체크 줄은 빈 날도 고정 높이로 유지 — 셀끼리 날짜·시간 세로 위치를 맞춘다 */}
            <Text allowFontScaling={false} style={s.cellChecks}>
              {checks}
            </Text>
          </>
        )}
      </Pressable>
    );
  };

  // 탭한 날 정보줄 — 날짜·집중(달성 마크)·폰(달성 마크)·세션 수. 오늘 폰 판정은 다음날 확정이라
  // 마크 없음, 오늘 집중 미달도 '진행 중'이라 ✗를 찍지 않는다(캘린더 체크와 동일 판정).
  const pickedInfo = (() => {
    if (picked == null) return null;
    const c = byDate.get(picked);
    const [y, m, d] = picked.split('-').map(Number);
    const dow = WEEK_DAYS[(new Date(y, m - 1, d).getDay() + 6) % 7];
    const isToday = picked === todayKey;
    const min = c?.totalFocusMinutes ?? 0;
    const sessions = c?.sessionCount ?? 0;
    // 서버가 초→분 내림해 0분이어도 세션이 있을 수 있어 '1분 미만'으로 구분(기존 잔디 정보줄 승계)
    const focusText = min > 0 ? fmtHm(min) : sessions > 0 ? '1분 미만' : fmtHm(0);
    const focusOk = focusOkFor(picked, c);
    return {
      head: `${m}월 ${d}일 (${dow}) · 집중 ${focusText}`,
      // 달성(true)은 항상 표시, 미달 ✗는 오늘·목표 미설정이면 숨김(과거 목표 미설정일 ✗ 오표시 방지)
      focusMark: focusOk ? true : isToday || !focusGoalSet ? null : false,
      phone: ` · 폰 ${fmtHm(c?.actualScreenTimeMinutes ?? 0)}`,
      phoneMark: phoneOkFor(picked, c) ? true : isToday || !phoneGoalSet ? null : false,
      tail: ` · 세션 ${sessions}회`,
    };
  })();

  return (
    <View>
      {/* ── 기간 내비게이션: ‹ 라벨 › 중앙 그룹 ── */}
      <View style={s.nav}>
        <TouchableOpacity
          style={s.navBtn}
          onPress={() => {
            setOffset((o) => o - 1);
            setPicked(null);
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={15} color={T.inkSub} />
        </TouchableOpacity>
        <View style={s.navCenter}>
          <Text style={s.navLabel}>{page.label}</Text>
          <Text style={s.navSub} allowFontScaling={false}>
            {page.sublabel}
          </Text>
        </View>
        <TouchableOpacity
          style={s.navBtn}
          disabled={offset === 0}
          onPress={() => {
            setOffset((o) => Math.min(0, o + 1));
            setPicked(null);
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-forward" size={15} color={offset === 0 ? T.inkFaint : T.inkSub} />
        </TouchableOpacity>
      </View>

      <Text style={s.total} allowFontScaling={false}>
        {noData ? '총 집중 —' : `총 집중 ${Math.floor(totalMin / 60)}시간 ${totalMin % 60}분`}
      </Text>

      {/* ── 요일 헤더 ── */}
      <View style={s.dowRow}>
        {WEEK_DAYS.map((d, i) => (
          <Text key={d} allowFontScaling={false} style={[s.dowText, i === 6 ? s.dowSun : null]}>
            {d}
          </Text>
        ))}
      </View>

      {/* ── 캘린더 그리드 — 셀 사이 1px 흰 선(gap) ── */}
      <View>
        <View style={s.grid}>
          {rows.map((row, ri) => (
            <View key={ri} style={s.row}>
              {row.map((date, ci) => renderCell(date, ri * 7 + ci))}
            </View>
          ))}
        </View>
        {loading ? (
          <View style={s.loadingOverlay}>
            <ActivityIndicator color={T.accent} />
          </View>
        ) : null}
        {failed ? (
          <View style={[s.loadingOverlay, s.errorOverlay]}>
            <Text style={s.errorText}>불러오지 못했어요</Text>
            <TouchableOpacity style={s.retryBtn} activeOpacity={0.8} onPress={retryPage}>
              <Text style={s.retryText}>다시 시도</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      {pickedInfo != null && (
        <View style={s.pickbar}>
          <Text allowFontScaling={false} style={s.pickText}>
            {pickedInfo.head}
            {pickedInfo.focusMark != null && (
              <Text style={pickedInfo.focusMark ? s.pickOk : s.pickMiss}>
                {pickedInfo.focusMark ? ' ✓' : ' ✗'}
              </Text>
            )}
            {pickedInfo.phone}
            {pickedInfo.phoneMark != null && (
              <Text style={pickedInfo.phoneMark ? s.pickOk : s.pickMiss}>
                {pickedInfo.phoneMark ? ' ✓' : ' ✗'}
              </Text>
            )}
            {pickedInfo.tail}
          </Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.md,
  },
  navBtn: {
    width: 28,
    height: 28,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navCenter: { alignItems: 'center', minWidth: 96 },
  navLabel: { ...T.text.label, color: T.ink },
  navSub: { ...T.text.caption, fontSize: 11, color: T.inkMuted },
  total: {
    ...T.text.caption,
    fontSize: 12,
    color: T.inkMuted,
    alignSelf: 'center',
    marginTop: T.space.xs,
    marginBottom: T.space.md,
  },
  dowRow: { flexDirection: 'row', gap: 1, marginBottom: T.space.xs },
  dowText: { flex: 1, textAlign: 'center', ...T.text.caption, fontSize: 10, color: T.inkFaint },
  dowSun: { color: T.accentAlt },
  grid: { gap: 1 },
  row: { flexDirection: 'row', gap: 1 },
  // 투명 테두리를 항상 깔아 오늘/선택 링이 켜져도 내용이 밀리지 않게 한다
  cell: {
    flex: 1,
    aspectRatio: 40 / 46,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  cellRing: { borderColor: T.ink },
  cellDate: { fontSize: 12, fontWeight: '700', color: T.ink },
  cellDateOnDark: { color: T.white },
  cellDateNeutral: { color: T.inkFaint },
  cellTime: { fontSize: 9, fontWeight: '600', color: T.inkSub },
  cellTimeOnDark: { color: withAlpha(T.white, 0.92) },
  cellTimeZero: { color: T.inkFaint },
  cellChecks: { fontSize: 9, fontWeight: '900', color: T.greenDeep, height: 11 },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 조회 실패 안내 — 중립 셀 위에 읽히도록 반투명 배경 + 재시도 버튼(친구 목록 에러 패턴 축소판)
  errorOverlay: { backgroundColor: withAlpha(T.white, 0.75) },
  errorText: { ...T.text.caption, fontSize: 12, color: T.inkSub },
  retryBtn: {
    marginTop: T.space.sm,
    backgroundColor: T.accent,
    borderRadius: 999,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.xs,
  },
  retryText: { ...T.text.caption, fontWeight: '700', color: T.white },
  pickbar: {
    marginTop: T.space.sm,
    paddingVertical: T.space.sm,
    paddingHorizontal: T.space.md,
    backgroundColor: T.paperAlt,
    borderRadius: 10,
  },
  pickText: { ...T.text.caption, fontSize: 12, color: T.ink, textAlign: 'center' },
  pickOk: { color: T.greenDeep, fontWeight: '900' },
  pickMiss: { color: T.dangerInk, fontWeight: '900' },
});
