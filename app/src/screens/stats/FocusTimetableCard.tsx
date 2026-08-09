// ST4(일) 시간대별 집중 타임테이블 — 스터디 플래너식 격자. 한 줄 = 1시간(칸 6개 × 10분),
// 첫 줄 오전 6시 → 다음날 새벽 5시까지 24줄. 격자는 항상 그려지고, 오늘 세션(GET /focus-session)이
// 겹친 슬롯만 칠해진다(칠 농도 = 슬롯 내 집중 비율). 서버 집계 없이 세션 구간만으로 계산(GROMO-761).
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { fetchTodayFocusSessions } from '@/screens/focus/focusRestore';
import { getFocusTags } from '@/services/focusApi';
import { useSubjects } from '@/store/SubjectContext';
import { todayStr } from '@/utils/localDate';
import { subjectColorForTag, tenMinuteFocusSlots, type FocusSlotSegment } from './format';
import { SectionCard } from './SectionCard';
import { FOCUS_COLOR, TT_CELL_H, TT_ROW_GAP, TT_ROWS } from './constants';
import { cs } from './cardStyles';
import { ShareDayFrame } from './ShareDayFrame';
import { useTimetableShareCapture } from './useTimetableShareCapture';

// 격자 치수(TT_*)는 constants.ts에 있다 — 로딩 스켈레톤이 같은 값으로 카드 높이를 잡는다(GROMO-1381).
const TIMETABLE_HOURS = Array.from({ length: TT_ROWS }, (_, i) => (i + 6) % 24);

// 타임테이블 카드(일) — 헤더에 공유 버튼. 카드 내용(범례+격자)을 이미지로 캡처해
// iOS 공유 시트로 내보낸다(react-native-view-shot, GROMO-762).
export function FocusTimetableCard() {
  // 공유 파일명 — 예: 260711_타임테이블.png (사진 저장 시엔 이름이 남지 않음)
  // 파일명 날짜는 로컬 유지 — 저장하는 기기의 체감 날짜가 정본(GROMO-1236 분류 C)
  const makeFileName = useCallback(() => `${todayStr().slice(2).replace(/-/g, '')}_타임테이블`, []);
  // 캡처→공유·로드 게이트 로직은 일/주 공용 훅이 담당(GROMO-1070)
  const { shotRef, capturing, captureStyle, disabled, onCharReady, onLoaded, onShare } =
    useTimetableShareCapture({ card: 'timetable', makeFileName });

  return (
    <SectionCard title="오늘 타임테이블">
      {/* 캡처 범위 — 배경을 칠해 PNG가 투명해지지 않게. 캡처 시엔 사방 소여백(captureStyle) */}
      <View ref={shotRef} collapsable={false} style={[cs.ttShot, captureStyle]}>
        {/* 일 카드 캡처 레이아웃 — 평소엔 격자만, 캡처 땐 상단 헤더(날짜·gromo) + 왼쪽 하단 마스코트(GROMO-1070) */}
        <ShareDayFrame capturing={capturing} onCharReady={onCharReady}>
          <FocusTimetable onLoaded={onLoaded} />
        </ShareDayFrame>
      </View>
      {/* 공유하기 — 카드 하단 오른쪽. 헤더(우측 상단)에 두면 순서 편집 드래그 핸들과 겹친다.
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

function FocusTimetable({ onLoaded }: { onLoaded?: () => void }) {
  const { subjects } = useSubjects();
  const [slots, setSlots] = useState<FocusSlotSegment[][] | null>(null);
  // 서버 tagId → 태그명 (과목 색 매칭용). 로컬 과목 id는 서버 tagId와 다를 수 있어 이름으로 잇는다.
  const [tagNames, setTagNames] = useState<Map<string, string>>(new Map());

  // 화면 재진입마다 재조회 — 세션 종료 후 돌아와도 방금 세션이 타임테이블에 반영(리뷰 반영)
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const [sessions, tags] = await Promise.all([
          fetchTodayFocusSessions().catch(() => []),
          getFocusTags().catch(() => []),
        ]);
        if (cancelled) return;
        setTagNames(new Map(tags.map((t) => [t.tagId, t.name])));
        setSlots(tenMinuteFocusSlots(sessions));
        // 데이터 로드 완료 신호 — 카드가 공유 버튼을 열어준다(GROMO-1070 리뷰 반영)
        onLoaded?.();
      })();
      return () => {
        cancelled = true;
      };
    }, [onLoaded]),
  );

  if (slots === null) {
    return (
      <View style={cs.compareLoading}>
        <ActivityIndicator color={T.accent} size="small" />
      </View>
    );
  }

  // 구간의 과목 색 — 공용 헬퍼(subjectColorForTag)로 tagId → 태그명 → 로컬 과목 색 매칭
  const colorForTag = (tagId: string | null) => subjectColorForTag(tagId, tagNames, subjects);

  // 왼쪽 범례 — 오늘 타임테이블에 등장한 과목만, 과목 순서대로. 텍스트를 형광펜처럼 과목 색으로 칠한다.
  const usedNames = new Set(
    slots
      .flat()
      .map((seg) => (seg.tagId ? tagNames.get(seg.tagId) : undefined))
      .filter((name): name is string => name != null),
  );
  const legendSubjects = subjects.filter((x) => usedNames.has(x.name));

  return (
    <View style={s.ttLayout}>
      {/* 범례 칼럼은 비어도 자리를 유지 — 격자 크기가 범례 유무와 무관하게 고정되도록 */}
      <View style={s.ttLegendCol}>
        {legendSubjects.map((sub) => (
          <View key={sub.id} style={s.ttLegendRow}>
            <View style={[s.ttLegendDot, { backgroundColor: sub.color }]} />
            <Text style={s.ttLegendText} numberOfLines={1} allowFontScaling={false}>
              {sub.name}
            </Text>
          </View>
        ))}
      </View>
      <View style={s.ttGrid}>
        {TIMETABLE_HOURS.map((hour) => (
          <View key={hour} style={s.ttRow}>
            <Text style={s.ttHourLabel} allowFontScaling={false}>
              {hour}
            </Text>
            {Array.from({ length: 6 }, (_, i) => {
              const segments = slots[hour * 6 + i];
              return (
                <View key={i} style={s.ttCell}>
                  {/* 슬롯 내 실제 집중 위치 그대로 칠함 — 3:35~3:45 집중이면 3:30 칸 오른쪽 절반 */}
                  {segments.map((seg, j) => (
                    <View
                      key={j}
                      style={[
                        s.ttCellFill,
                        {
                          backgroundColor: colorForTag(seg.tagId),
                          left: `${seg.start * 100}%`,
                          width: `${(seg.end - seg.start) * 100}%`,
                        },
                      ]}
                    />
                  ))}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // 시간대별 타임테이블 — 왼쪽 과목 범례(형광펜 하이라이트) + 격자(한 줄 1시간 = 10분×6칸)
  ttLayout: { flexDirection: 'row', gap: T.space.md, marginTop: T.space.lg },
  ttLegendCol: { width: 76, gap: T.space.sm, paddingTop: 2, alignItems: 'flex-start' },
  // 범례 — 글자 배경칠 대신 왼쪽 원형 점으로 과목 색 표시
  ttLegendRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs, maxWidth: '100%' },
  ttLegendDot: { width: 8, height: 8, borderRadius: 4 },
  ttLegendText: { ...T.text.caption, fontSize: 11, color: T.ink, flexShrink: 1 },
  ttGrid: { flex: 1, gap: TT_ROW_GAP },
  // 한 시간 안의 10분 칸은 간격 없이 붙임(GROMO-849) — 시간 라벨과의 간격은 라벨 마진이 담당
  ttRow: { flexDirection: 'row', alignItems: 'center' },
  ttHourLabel: {
    ...T.text.caption,
    fontSize: 9,
    color: T.inkMuted,
    width: 18,
    textAlign: 'right',
    marginRight: 3,
  },
  ttCell: {
    flex: 1,
    height: TT_CELL_H,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: T.paperAlt,
    backgroundColor: T.white,
    overflow: 'hidden',
  },
  ttCellFill: { position: 'absolute', top: 0, bottom: 0, backgroundColor: FOCUS_COLOR },
});
