// ST2 과목별 공부량 도넛 — 과목별 비중을 링 구간(strokeDasharray)으로 그리고 가운데에 총합,
// 우측 범례에 과목·비중을 표시(GROMO-761).
// 주·월(CategoryDonut)은 서버 집계 + 팔레트 순서 색(CategoryBars와 동일), 일(SubjectDonut)은
// 드로어와 같은 로컬 오늘 누적 + 과목 고유 색을 쓴다(GROMO-976).
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { T } from '@/constants/theme';
import { fmtHm, hms } from '@/utils/timeFormat';
import { FOCUS_COLOR } from './constants';
import { cs } from './cardStyles';

const DONUT_SIZE = 132;
const DONUT_STROKE = 20;

interface DonutSeg {
  frac: number; // 전체 대비 비중(0~1) — 링 구간 길이·범례 %
  color: string;
  name: string;
  timeLabel: string; // 범례 시간 표기 — 탭별 포맷(주·월 HH:MM, 일 HH:MM:SS)이 달라 문자열로 받음
}

// 공용 렌더러 — 링 + 가운데 총합 + 우측 범례(색 점·이름·시간·%)
function DonutBase({ segs, totalLabel }: { segs: DonutSeg[]; totalLabel: string }) {
  const half = DONUT_SIZE / 2;
  const r = (DONUT_SIZE - DONUT_STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  let acc = 0;
  const placed = segs.map((sg) => {
    const p = { ...sg, offset: acc };
    acc += sg.frac;
    return p;
  });
  return (
    <View style={s.donutRow}>
      <View style={s.donutWrap}>
        <Svg width={DONUT_SIZE} height={DONUT_SIZE}>
          <Circle
            cx={half}
            cy={half}
            r={r}
            stroke={T.track}
            strokeWidth={DONUT_STROKE}
            fill="none"
          />
          {placed.map((sg, i) => (
            <Circle
              key={i}
              cx={half}
              cy={half}
              r={r}
              stroke={sg.color}
              strokeWidth={DONUT_STROKE}
              fill="none"
              strokeDasharray={`${sg.frac * circumference} ${circumference}`}
              strokeDashoffset={-sg.offset * circumference}
              transform={`rotate(-90 ${half} ${half})`}
            />
          ))}
        </Svg>
        {/* 가운데 총합 — 12시 방향부터 시계 방향으로 구간이 채워진다 */}
        <View style={s.donutCenter}>
          <Text style={s.donutCenterValue} allowFontScaling={false}>
            {totalLabel}
          </Text>
          <Text style={s.donutCenterLabel}>총 집중</Text>
        </View>
      </View>
      <View style={s.donutLegend}>
        {placed.map((sg, i) => (
          <View key={i} style={s.donutLegendRow}>
            <View style={[s.donutLegendDot, { backgroundColor: sg.color }]} />
            <Text style={s.donutLegendName} numberOfLines={1}>
              {sg.name}
            </Text>
            <Text style={s.donutLegendTime} allowFontScaling={false}>
              {sg.timeLabel}
            </Text>
            <Text style={s.donutLegendPct} allowFontScaling={false}>
              {Math.round(sg.frac * 100)}%
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// 주·월 탭 — 서버 기간 집계(태그별 분). 색은 팔레트 순서 배정(CategoryBars와 동일)
export function CategoryDonut({
  items,
  total,
}: {
  items: { tagId: string | null; tagName: string | null; totalFocusMinutes: number }[];
  total: number;
}) {
  if (items.length === 0) {
    return <Text style={cs.emptyText}>아직 기록이 없어요</Text>;
  }
  const denom = total || 1;
  const segs = items.map((it, i) => ({
    frac: it.totalFocusMinutes / denom,
    color: T.subjectPalette[i % T.subjectPalette.length],
    name: it.tagName ?? '미분류',
    timeLabel: fmtHm(it.totalFocusMinutes),
  }));
  return <DonutBase segs={segs} totalLabel={fmtHm(total)} />;
}

// 일 탭(GROMO-976) — 집중 세션 메뉴 드로어와 동일한 로컬 오늘 누적(SubjectContext).
// 0초 과목은 범례에서 제외. 범례 시간은 주/월과 같은 HH:MM — HH:MM:SS(8자)는 최소 지원 폭
// 375pt에서 과목명 자리를 다 먹는다(코드리뷰 반영). 중앙 총합만 총계 카드와 같은 HH:MM:SS.
export function SubjectDonut({
  rows,
  totalSeconds,
}: {
  rows: { id: string; name: string; color: string; accumulatedSeconds: number }[];
  totalSeconds: number; // 총계 카드와 동일한 오늘 전체 집중 초(todayFocusSeconds)
}) {
  const subjectSum = rows.reduce((a, x) => a + x.accumulatedSeconds, 0);
  // 재로그인 복원 시 태그 미귀속 세션은 전체 총합에만 있고 과목엔 못 얹힌다(SubjectContext 주석)
  // — 차이를 '미분류' 구간으로 그려 위 총계 카드와 총합이 어긋나지 않게 한다(코드리뷰 반영).
  const unclassified = Math.max(0, totalSeconds - subjectSum);
  const denom = subjectSum + unclassified;
  if (denom <= 0) {
    return <Text style={cs.emptyText}>아직 기록된 집중시간이 없어요</Text>;
  }
  const segs = rows
    .filter((x) => x.accumulatedSeconds > 0)
    .map((x) => ({
      frac: x.accumulatedSeconds / denom,
      color: x.color,
      name: x.name,
      timeLabel: fmtHm(x.accumulatedSeconds / 60),
    }));
  if (unclassified > 0) {
    segs.push({
      frac: unclassified / denom,
      color: T.inkMuted, // 과목 팔레트와 겹치지 않는 중립 회색
      name: '미분류',
      timeLabel: fmtHm(unclassified / 60),
    });
  }
  return <DonutBase segs={segs} totalLabel={hms(denom)} />;
}

const s = StyleSheet.create({
  // 과목별 도넛 — 링 + 가운데 총합 + 우측 범례
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.lg, marginTop: T.space.sm },
  donutWrap: {
    width: DONUT_SIZE,
    height: DONUT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutCenter: { position: 'absolute', alignItems: 'center' },
  // 도넛 중앙 총합 — 카드의 대표 숫자라 캡션급(label)이 아닌 히어로급으로(GROMO-849)
  donutCenterValue: { ...T.text.subtitle, fontWeight: '800', color: FOCUS_COLOR },
  donutCenterLabel: { ...T.text.caption, fontSize: 10, color: T.inkSub, marginTop: 2 },
  donutLegend: { flex: 1, gap: T.space.sm },
  donutLegendRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  donutLegendDot: { width: 10, height: 10, borderRadius: 3 },
  donutLegendName: { ...T.text.caption, color: T.ink, flex: 1 },
  donutLegendTime: { ...T.text.caption, color: T.inkSub, fontVariant: ['tabular-nums'] },
  // %는 자릿수(5%↔100%)에 따라 폭이 흔들려 옆 시간 컬럼까지 밀었다 — 고정폭+우측 정렬로
  // 두 컬럼을 세로 정렬(GROMO-976)
  donutLegendPct: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.inkSub,
    minWidth: 38,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
