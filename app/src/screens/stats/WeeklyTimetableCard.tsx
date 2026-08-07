// 주 탭 요일별 집중 타임라인(GROMO-778) — 요일(열)×세로 시간축. 세션을 날짜별로 분할해 해당 요일
// 칼럼에 과목 색 블록으로 그린다. 색 매핑(tagId→태그명→과목색)·조회 패턴은 '오늘 타임테이블'(FocusTimetable)과 동일.
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { getAllFocusSessions, getFocusTags } from '@/services/focusApi';
import type { FocusSessionResponse } from '@/types/dto/focus';
import { useSubjects } from '@/store/SubjectContext';
import { localDateStr, todayStr } from '@/utils/localDate';
import {
  kstTodayDate,
  subjectColorForTag,
  weekdayFocusBlocks,
  type WeekFocusBlock,
} from './format';
import { SectionCard } from './SectionCard';
import { WEEK_DAYS } from './constants';
import { cs } from './cardStyles';
import { ShareBrandFooter } from './ShareBrandFooter';
import { useTimetableShareCapture } from './useTimetableShareCapture';

// 주간 타임라인 카드 — '오늘 타임테이블'(FocusTimetableCard)과 동일하게 공유하기(캡처→Share) 버튼 제공(GROMO-778).
export function WeeklyTimetableCard() {
  // 공유 파일명 — 예: 260716_주간타임라인.png (사진 저장 시엔 이름이 남지 않음)
  // 파일명 날짜는 로컬 유지 — 저장하는 기기의 체감 날짜가 정본(GROMO-1236 분류 C)
  const makeFileName = useCallback(
    () => `${todayStr().slice(2).replace(/-/g, '')}_주간타임라인`,
    [],
  );
  // 캡처→공유·로드 게이트 로직은 일/주 공용 훅이 담당(FocusTimetableCard와 동일, GROMO-1070)
  const { shotRef, capturing, captureStyle, disabled, onCharReady, onLoaded, onShare } =
    useTimetableShareCapture({ card: 'weekly_timeline', makeFileName });

  return (
    <SectionCard title="요일별 타임테이블">
      {/* 캡처 범위 — 배경을 칠해 PNG가 투명해지지 않게. 캡처 시엔 사방 소여백(captureStyle) */}
      <View ref={shotRef} collapsable={false} style={[cs.ttShot, captureStyle]}>
        <WeeklyTimetable onLoaded={onLoaded} />
        {/* 공유 브랜드 밴드 — 캡처 순간에만 본문 아래에 렌더되어 캡처 이미지에만 담긴다(GROMO-1070) */}
        <ShareBrandFooter visible={capturing} onCharReady={onCharReady} />
      </View>
      {/* 공유하기 — 카드 하단 오른쪽('오늘 타임테이블'과 동일). 헤더에 두면 상시 드래그 핸들과 겹친다.
          shotRef 밖이라 캡처 이미지에는 안 담긴다 */}
      <TouchableOpacity
        style={cs.shareBtn}
        onPress={onShare}
        hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }}
        activeOpacity={0.7}
        disabled={disabled}
      >
        <Text style={cs.shareBtnText}>공유하기</Text>
        <Ionicons name="share-outline" size={15} color={T.inkSub} />
      </TouchableOpacity>
    </SectionCard>
  );
}

const WTT_BODY_H = 400; // 트랙 세로 픽셀 — 하루 24시간(0~24)을 담아도 세션 막대가 도톰하게 보이도록(GROMO-975)
const WTT_MIN_BLOCK = 3; // 아주 짧은 세션도 보이도록 최소 블록 높이

function WeeklyTimetable({ onLoaded }: { onLoaded?: () => void }) {
  const { subjects } = useSubjects();
  const [blocks, setBlocks] = useState<WeekFocusBlock[] | null>(null);
  // 서버 tagId → 태그명(과목 색 매칭용). 로컬 과목 id는 서버 tagId와 달라 이름으로 잇는다(FocusTimetable과 동일).
  const [tagNames, setTagNames] = useState<Map<string, string>>(new Map());
  // 플롯 실폭 — 칼럼 x좌표·세로 점선 격자 계산용(LineChart의 plotW 패턴)
  const [plotW, setPlotW] = useState(0);

  // 화면 재진입마다 재조회 — 세션 종료 후 돌아와도 방금 세션이 반영(FirstStartChart와 동일 패턴)
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        // 이번 주는 KST 월요일 00:00 '순간'부터 지금까지(GROMO-1236 P2 4라운드) — 같은 화면의
        // 주간 총계·히트맵이 KST 주라, 선별 창이 로컬 주면 비KST 기기에서 서로 다른 주를 담는다.
        // 블록의 요일 칼럼·세로 위치(벽시계)는 세션 타임스탬프 표시 축이라 종전대로 로컬.
        // +09:00 고정 오프셋은 KST가 DST 없는 존이라 안전(FirstStartChart와 동일).
        const now = new Date();
        const kstNow = kstTodayDate();
        const dow = kstNow.getDay(); // 0=일..6=토
        const monday = new Date(kstNow);
        monday.setDate(kstNow.getDate() + (dow === 0 ? -6 : 1 - dow));
        const weekStart = new Date(`${localDateStr(monday)}T00:00:00+09:00`);
        // 전주 일요일에서 자정을 넘어온 세션의 월요일 몫도 담기 위해 하루 전부터 받고
        // (LongestSessionStat과 동일 방식), 주 시작 이전 조각은 헬퍼가 버린다.
        const from = new Date(weekStart.getTime() - 86_400_000);
        const [sessions, tags] = await Promise.all([
          getAllFocusSessions(from.toISOString(), now.toISOString()).catch(
            () => [] as FocusSessionResponse[],
          ),
          getFocusTags().catch(() => []),
        ]);
        if (cancelled) return;
        setTagNames(new Map(tags.map((t) => [t.tagId, t.name])));
        setBlocks(weekdayFocusBlocks(sessions, weekStart.getTime()));
        // 데이터 로드 완료 신호 — 카드가 공유 버튼을 열어준다(GROMO-1070 리뷰 반영)
        onLoaded?.();
      })();
      return () => {
        cancelled = true;
      };
    }, [onLoaded]),
  );

  if (blocks === null) {
    return (
      <View style={cs.compareLoading}>
        <ActivityIndicator color={T.accent} size="small" />
      </View>
    );
  }
  // 기록이 없어도 표(요일 헤더 + 24시간 격자)는 그대로 그린다(GROMO-1082) — 텍스트로 대체하면
  // 이번 주에 아무 기록이 없다는 사실이 표로 보이지 않고, '불러오기 실패'와도 구분되지 않는다.
  // 안내 문구는 표를 가리지 않게 아래에 캡션으로 덧붙인다.

  // 구간의 과목 색 — 공용 헬퍼(subjectColorForTag)로 tagId → 태그명 → 로컬 과목 색 매칭(FocusTimetable과 동일)
  const colorForTag = (tagId: string | null) => subjectColorForTag(tagId, tagNames, subjects);

  // 세로축 — 하루 전체 24시간(0~24시) 고정(GROMO-975). 이전엔 데이터 최소~최대 시각만 축에 담아
  // 하루 중 언제 집중했는지 파악이 어려웠다. 이제 고정된 24h 축 위에 집중 구간을 얹어 시간대를 드러낸다.
  const startH = 0;
  const endH = 24;
  const span = endH - startH; // 24
  const px = WTT_BODY_H / span; // 시간당 픽셀
  const topOf = (hourFloat: number) => (hourFloat - startH) * px;

  // 3시간 간격 눈금(0·3·6…24)
  const ticks: number[] = [];
  for (let h = startH; h <= endH; h += 3) ticks.push(h);

  // 오늘 칼럼(월=0..일=6) + 칼럼 폭
  const nowDow = new Date().getDay();
  const todayCol = nowDow === 0 ? 6 : nowDow - 1;
  const colW = plotW / 7;

  // 범례 — 타임라인에 등장한 과목만, 과목 순서대로(FocusTimetable과 동일)
  const usedNames = new Set(
    blocks
      .map((b) => (b.tagId ? tagNames.get(b.tagId) : undefined))
      .filter((n): n is string => n != null),
  );
  const legendSubjects = subjects.filter((x) => usedNames.has(x.name));

  return (
    <View>
      {/* 요일 헤더 */}
      <View style={s.wttHeadRow}>
        <View style={s.wttGutter} />
        {WEEK_DAYS.map((d, i) => (
          <Text
            key={i}
            style={[
              s.wttDayLabel,
              i === 5 ? s.wttSat : i === 6 ? s.wttSun : null,
              i === todayCol ? s.wttTodayLabel : null,
            ]}
            allowFontScaling={false}
          >
            {d}
          </Text>
        ))}
      </View>
      {/* 시간축 + 플롯(수면 차트식) — 칼럼 배경 트랙 없이 가로 실선(3시간)·칼럼 사이 세로 점선만.
          빈 요일은 문구 없이 빈 공간 그대로 둔다 */}
      <View style={s.wttBodyRow}>
        <View style={[s.wttGutter, { height: WTT_BODY_H }]}>
          {ticks.map((h) => (
            <Text key={h} style={[s.wttTick, { top: topOf(h) - 6 }]} allowFontScaling={false}>
              {h}
            </Text>
          ))}
        </View>
        <View
          style={[s.wttPlot, { height: WTT_BODY_H }]}
          onLayout={(e) => setPlotW(e.nativeEvent.layout.width)}
        >
          {plotW > 0 && (
            <>
              <Svg width={plotW} height={WTT_BODY_H} style={StyleSheet.absoluteFill}>
                {ticks.map((h) => (
                  <Line
                    key={`h${h}`}
                    x1={0}
                    y1={topOf(h)}
                    x2={plotW}
                    y2={topOf(h)}
                    stroke={T.divider}
                    strokeWidth={1}
                  />
                ))}
                {Array.from({ length: 6 }, (_, i) => (
                  <Line
                    key={`v${i}`}
                    x1={colW * (i + 1)}
                    y1={0}
                    x2={colW * (i + 1)}
                    y2={WTT_BODY_H}
                    stroke={T.chipBorder}
                    strokeWidth={1}
                    strokeDasharray="2 4"
                  />
                ))}
              </Svg>
              {/* 세션 블록 — 과목색 각진 사각형(라운드 없음), 휴식 틈은 그대로 빈 공간 */}
              {blocks.map((b, j) => (
                <View
                  key={j}
                  style={[
                    s.wttBlock,
                    {
                      left: b.col * colW + 3,
                      width: colW - 6,
                      top: topOf(b.startMin / 60),
                      height: Math.max(WTT_MIN_BLOCK, ((b.endMin - b.startMin) / 60) * px),
                      backgroundColor: colorForTag(b.tagId),
                    },
                  ]}
                />
              ))}
            </>
          )}
        </View>
      </View>
      {/* 빈 상태 안내 — 표는 띄운 채 캡션만 덧붙인다(GROMO-1082). 기록이 있으면 범례가 대신 뜬다 */}
      {blocks.length === 0 && <Text style={cs.grassHint}>아직 기록이 없어요</Text>}
      {/* 범례 */}
      {legendSubjects.length > 0 && (
        <View style={s.wttLegend}>
          {legendSubjects.map((sub) => (
            <View key={sub.id} style={s.wttLegendItem}>
              <View style={[s.wttLegendDot, { backgroundColor: sub.color }]} />
              <Text style={s.wttLegendText} numberOfLines={1} allowFontScaling={false}>
                {sub.name}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  // 헤더·바디는 gap 없이 거터+균등분할 — 라벨 중심과 플롯 칼럼(plotW/7) x좌표가 일치해야 한다
  wttHeadRow: { flexDirection: 'row', marginTop: T.space.sm, marginBottom: T.space.xs },
  wttBodyRow: { flexDirection: 'row' },
  wttGutter: { width: 18, position: 'relative' }, // 시간축 눈금 칼럼
  wttTick: {
    position: 'absolute',
    right: 3,
    ...T.text.caption,
    fontSize: 9,
    color: T.inkMuted,
  },
  wttDayLabel: {
    flex: 1,
    textAlign: 'center',
    ...T.text.caption,
    fontSize: 12,
    fontWeight: '800',
    color: T.ink,
  },
  wttSat: { color: T.blue },
  wttSun: { color: T.accentAlt },
  wttTodayLabel: { color: T.accent },
  wttPlot: { flex: 1, position: 'relative' },
  wttBlock: { position: 'absolute' }, // 과목색 세션 블록 — 각진 모서리(라운드 금지)
  wttLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: T.space.sm,
    marginTop: T.space.md,
  },
  wttLegendItem: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  wttLegendDot: { width: 8, height: 8, borderRadius: 4 },
  wttLegendText: { ...T.text.caption, fontSize: 11, color: T.ink },
});
