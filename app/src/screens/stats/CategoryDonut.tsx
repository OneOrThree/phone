// ST2 과목별 공부량 도넛 — 과목별 비중을 링 구간(strokeDasharray)으로 그리고 가운데에 총합,
// 우측 범례에 과목·비중을 표시(GROMO-761).
// 주·월(CategoryDonut)은 서버 집계 + 팔레트 순서 색(CategoryBars와 동일), 일(SubjectDonut)은
// 드로어와 같은 로컬 오늘 누적 + 과목 고유 색을 쓴다(GROMO-976).
import { View, Text, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { enterUp, fadeIn } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';
import { Enter } from '@/components/Enter';
import { T } from '@/constants/theme';
import { fmtHm, hms } from '@/utils/timeFormat';
import { DONUT_BLOCK_H, DONUT_SIZE, FOCUS_COLOR } from './constants';
import { CardBodyEmpty } from './CardBodySlot';

const DONUT_STROKE = 20;

interface DonutSeg {
  frac: number; // 전체 대비 비중(0~1) — 링 구간 길이·범례 %
  color: string;
  name: string;
  /**
   * 범례 행의 신원. React key 로 쓴다.
   *
   * ⚠️ **인덱스를 키로 쓰면 안 된다.** 서버 items 는 집중분 내림차순이라 새 과목이 목록
   *    앞이나 중간에 끼어든다. 인덱스 키면 기존 행이 다른 과목으로 재사용되고 마지막
   *    노드만 새로 마운트돼, 정작 새 과목은 즉시 나타나고 기존 마지막 과목이 enterUp 을
   *    재생한다(codex 리뷰). 타임테이블 블록과 같은 부류의 문제다.
   */
  key: string;
  timeLabel: string; // 범례 시간 표기 — 탭별 포맷(주·월 HH:MM, 일 HH:MM:SS)이 달라 문자열로 받음
}

// 공용 렌더러 — 링 + 가운데 총합 + 우측 범례(색 점·이름·시간·%)
//
// ⚠️ 진입 연출에 growUp을 쓰지 않는다 — 도넛은 막대가 아니다. scaleY 0→1은 원을 납작한
//    타원으로 눌렀다 펴는 모양이 되고, 오버슛 구간에서는 세로로 늘어난 타원까지 보인다.
//    '값이 바닥부터 자란다'는 뜻도 없다(링은 12시부터 도는 비중 표현이다).
//    링은 fadeIn, 범례는 리스트 관용구인 enterUp(i) 시차로 나눠 준다.
function DonutBase({ segs, totalLabel }: { segs: DonutSeg[]; totalLabel: string }) {
  const m = useMotion();
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
      <Animated.View style={[s.donutWrap, m.enter(fadeIn())]}>
        <Svg width={DONUT_SIZE} height={DONUT_SIZE}>
          <Circle
            cx={half}
            cy={half}
            r={r}
            stroke={T.track}
            strokeWidth={DONUT_STROKE}
            fill="none"
          />
          {placed.map((sg) => (
            <Circle
              key={sg.key}
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
      </Animated.View>
      <View style={s.donutLegend}>
        {/* ⚠️ 행마다 Enter — 재조회·세션 반영으로 과목이 추가되면 그 행은 **나중에** 마운트되는데,
            부모의 useMotion 결정에 묶이면 그 사이 '동작 줄이기'를 켠 사용자에게도 페이드된다
            (codex 리뷰). 뷰를 새로 끼운 게 아니라 원래 있던 Animated.View를 대신한다. */}
        {placed.map((sg, i) => (
          <Enter key={sg.key} preset={enterUp(i)} style={s.donutLegendRow}>
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
          </Enter>
        ))}
      </View>
    </View>
  );
}

// 주·월 탭 — 서버 기간 집계(태그별 분). 색은 팔레트 순서 배정(CategoryBars와 동일)
export function CategoryDonut({
  items,
  total,
  reservedHeight,
}: {
  items: { tagId: string | null; tagName: string | null; totalFocusMinutes: number }[];
  total: number;
  /**
   * 스켈레톤이 이 카드에 예약했던 본문 높이. 조회가 실패해 `items`가 비면 여기까지 줄어드는
   * 대신 이 높이를 유지한다.
   *
   * ⚠️ 없으면 과목을 많이 쓴 사용자에게 **로딩이 끝나는 순간 카드가 수축한다.** 스켈레톤은
   *    오늘 사용 과목 수로 범례 높이를 예약하는데(예: 10개 → 약 240px), 실패 응답은 빈
   *    배열로 내려와 최소 높이(140px)만 남기므로 아래 카드가 100px 위로 튄다(codex 리뷰).
   */
  reservedHeight?: number;
}) {
  if (items.length === 0) {
    return (
      <CardBodyEmpty height={Math.max(DONUT_BLOCK_H, reservedHeight ?? 0)}>
        아직 기록이 없어요
      </CardBodyEmpty>
    );
  }
  const denom = total || 1;
  const segs = items.map((it, i) => ({
    frac: it.totalFocusMinutes / denom,
    color: T.subjectPalette[i % T.subjectPalette.length],
    name: it.tagName ?? '미분류',
    // tagId 가 신원이다. 없는 응답(미분류)은 이름으로 잇는다 — 한 목록에 미분류는 하나뿐이다.
    key: it.tagId ?? `name:${it.tagName ?? '미분류'}`,
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
    return <CardBodyEmpty height={DONUT_BLOCK_H}>아직 기록된 집중시간이 없어요</CardBodyEmpty>;
  }
  const segs = rows
    .filter((x) => x.accumulatedSeconds > 0)
    .map((x) => ({
      frac: x.accumulatedSeconds / denom,
      color: x.color,
      name: x.name,
      key: x.id, // 로컬 과목 id 가 신원이다
      // 초→분은 버림 — fmtHm의 반올림에 맡기면 30초가 00:01로 과대 표기돼
      // 중앙 HH:MM:SS와 모순된다(코드리뷰 반영)
      timeLabel: fmtHm(Math.floor(x.accumulatedSeconds / 60)),
    }));
  if (unclassified > 0) {
    segs.push({
      frac: unclassified / denom,
      color: T.inkMuted, // 과목 팔레트와 겹치지 않는 중립 회색
      name: '미분류',
      // 과목 id 와 부딪히지 않는 고정 키 — 미분류 행은 목록에 하나뿐이다.
      key: 'unclassified',
      timeLabel: fmtHm(Math.floor(unclassified / 60)),
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
