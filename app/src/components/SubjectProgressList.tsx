import { View, Text, StyleSheet } from 'react-native';
import { T } from '@/constants/theme';
import { hms } from '@/utils/timeFormat';

// 과목별 집중 현황 — 색 점+이름+시간(HH:MM:SS) 행 목록과 전체 대비 과목 비율 바.
// 집중 세션 메뉴 드로어와 통계 일 탭 '과목별 공부량'이 공유
// (FocusMenuDrawer에서 승격 — 2개 feature 이상 사용 시 전역 이동 규칙, GROMO-762).
export function SubjectProgressList({
  rows,
}: {
  rows: { id: string; name: string; color: string; accumulatedSeconds: number }[];
}) {
  const totalSeconds = rows.reduce((a, x) => a + x.accumulatedSeconds, 0);
  return (
    <View>
      <View style={s.progressList}>
        {rows.map((p) => (
          <View key={p.id} style={s.subjectRow}>
            <View style={[s.subjectDot, { backgroundColor: p.color }]} />
            <Text style={s.progressName} numberOfLines={1}>
              {p.name}
            </Text>
            <Text style={s.progressTime}>{hms(p.accumulatedSeconds)}</Text>
          </View>
        ))}
      </View>
      {/* 전체 집중시간 대비 과목별 비율 바 — flex로 세그먼트 분할 */}
      <View style={s.ratioTrack}>
        {rows
          .filter((p) => p.accumulatedSeconds > 0)
          .map((p) => (
            <View key={p.id} style={{ flex: p.accumulatedSeconds, backgroundColor: p.color }} />
          ))}
      </View>
      {totalSeconds <= 0 && <Text style={s.ratioEmpty}>아직 기록된 집중시간이 없어요</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  progressList: { gap: T.space.md },
  subjectRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  subjectDot: { width: 8, height: 8, borderRadius: 4 },
  progressName: { flex: 1, ...T.text.caption, color: T.ink },
  progressTime: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.inkSub,
    fontVariant: ['tabular-nums'],
  },
  ratioTrack: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    backgroundColor: T.caramel,
    overflow: 'hidden',
    marginTop: T.space.md,
  },
  ratioEmpty: { ...T.text.caption, fontWeight: '500', color: T.inkMuted, marginTop: T.space.sm },
});
