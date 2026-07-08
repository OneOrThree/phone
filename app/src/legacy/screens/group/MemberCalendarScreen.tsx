import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
  Modal,
  Animated,
  PanResponder,
} from 'react-native';
import type { GestureResponderEvent, PanResponderGestureState } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '@/legacy/constants/legacyTheme';
import { api } from '@/services/api';
import type { RootStackScreenProps } from '@/legacy/types/navigation';

// 멤버 캘린더 일별 통계
interface DailyStat {
  date: string;
  focusMinutes?: number;
  challengeAchieved?: boolean | null;
  achievedChallengeCount?: number;
  totalChallengeCount?: number | null;
}

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
const H_PAD = 24;
const CELL_GAP = 4;
const CELL_W = Math.floor((SCREEN_W - H_PAD * 2 - CELL_GAP * 6) / 7);
const CELL_H = CELL_W; // 정사각형 칸

const DAYS_KR = ['일', '월', '화', '수', '목', '금', '토'];
const MONTHS_KR = [
  '1월',
  '2월',
  '3월',
  '4월',
  '5월',
  '6월',
  '7월',
  '8월',
  '9월',
  '10월',
  '11월',
  '12월',
];

function formatMin(min: number | null | undefined) {
  if (!min) return '0분';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0) return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
  return `${m}분`;
}

function compactMin(min: number | null | undefined) {
  if (!min || min === 0) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h${m}m`;
  if (h > 0) return `${h}h`;
  return `${min}m`;
}

// 달성한 챌린지 수 / 전체 챌린지 수 비율로 초록색 농도 결정
// API가 achievedChallengeCount/totalChallengeCount를 내려주면 그걸 쓰고,
// 없으면 challengeAchieved boolean을 0/1로 fallback
function getChallengeRatio(stat: DailyStat | undefined): { achieved: number; total: number } {
  if (!stat) return { achieved: 0, total: 0 };
  if (stat.totalChallengeCount != null) {
    return { achieved: stat.achievedChallengeCount ?? 0, total: stat.totalChallengeCount };
  }
  if (stat.challengeAchieved != null) {
    return { achieved: stat.challengeAchieved ? 1 : 0, total: 1 };
  }
  return { achieved: 0, total: 0 };
}

function challengeBg(achieved: number, total: number) {
  if (!total || !achieved) return 'transparent';
  const opacity = 0.18 + (achieved / total) * 0.67; // 0.18(연) ~ 0.85(진)
  return `rgba(22, 163, 74, ${opacity.toFixed(2)})`;
}

export default function MemberCalendarScreen({
  navigation,
  route,
}: RootStackScreenProps<'MemberCalendar'>) {
  const { member, groupId } = route.params;
  const { top: topInset } = useSafeAreaInsets();

  // 드래그 바텀시트: 펼침(COLLAPSED) ↔ 전체화면(FULL), 아래로 끝까지 → 닫기
  const COLLAPSED = Math.round(SCREEN_H * 0.28); // 시트 상단이 화면 28% 지점
  const FULL = 0;
  const translateY = useRef(new Animated.Value(SCREEN_H)).current;
  const lastSnap = useRef(COLLAPSED);
  const closing = useRef(false);

  function snapTo(target: number, close: boolean) {
    lastSnap.current = target;
    Animated.spring(translateY, {
      toValue: target,
      useNativeDriver: false,
      bounciness: close ? 0 : 4,
    }).start(({ finished }) => {
      if (close && finished && !closing.current) {
        closing.current = true;
        navigation.goBack();
      }
    });
  }

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: COLLAPSED,
      useNativeDriver: false,
      bounciness: 4,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 전체화면(FULL)일 때만 상태바 안전영역만큼 상단 패딩, 펼침 상태에선 최소
  const contentPaddingTop = translateY.interpolate({
    inputRange: [FULL, COLLAPSED],
    outputRange: [topInset + 8, 8],
    extrapolate: 'clamp',
  });

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e: GestureResponderEvent, g: PanResponderGestureState) => {
        let next = lastSnap.current + g.dy;
        if (next < FULL) next = FULL;
        if (next > SCREEN_H) next = SCREEN_H;
        translateY.setValue(next);
      },
      onPanResponderRelease: (_e: GestureResponderEvent, g: PanResponderGestureState) => {
        const currentY = lastSnap.current + g.dy;
        if (g.vy < -0.5 || currentY < (FULL + COLLAPSED) / 2) {
          snapTo(FULL, false); // 위로 → 전체화면
        } else if (g.vy > 0.8 || currentY > COLLAPSED + (SCREEN_H - COLLAPSED) * 0.4) {
          snapTo(SCREEN_H, true); // 아래로 → 닫기
        } else {
          snapTo(COLLAPSED, false); // 원위치
        }
      },
    }),
  ).current;

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [stats, setStats] = useState<DailyStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    if (!member?.userId || !groupId) return;
    setLoading(true);
    setStats([]);
    setSelectedDate(null);
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    api
      .get<DailyStat[]>(
        `/api/v1/groups/${groupId}/members/${member.userId}/calendar?month=${monthStr}`,
      )
      .then((res) => {
        const data = res.data;
        setStats(Array.isArray(data) ? (data as DailyStat[]) : []);
      })
      .catch(() => setStats([]))
      .finally(() => setLoading(false));
  }, [member, groupId, year, month]);

  function prevMonth() {
    if (month === 0) {
      setYear((y) => y - 1);
      setMonth(11);
    } else setMonth((m) => m - 1);
  }

  function nextMonth() {
    if (year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth())) return;
    if (month === 11) {
      setYear((y) => y + 1);
      setMonth(0);
    } else setMonth((m) => m + 1);
  }

  const statsMap: Record<string, DailyStat> = {};
  stats.forEach((stat) => {
    statsMap[stat.date] = stat;
  });

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  const totalMin = stats.reduce((sum, s) => sum + (s.focusMinutes ?? 0), 0);

  // 이달 내 챌린지 달성 최장 연속 일수
  let challengeStreak = 0;
  let runLen = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const { achieved } = getChallengeRatio(statsMap[ds]);
    if (achieved > 0) {
      runLen += 1;
      if (runLen > challengeStreak) challengeStreak = runLen;
    } else {
      runLen = 0;
    }
  }

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  const isOwner = member.role === 'OWNER';

  function closeSheet() {
    if (closing.current) return;
    snapTo(SCREEN_H, true);
  }

  return (
    <Modal visible transparent animationType="none" onRequestClose={closeSheet}>
      <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={closeSheet} />
      <Animated.View
        style={[s.sheet, { paddingTop: contentPaddingTop, transform: [{ translateY }] }]}
      >
        {/* 드래그 핸들 */}
        <View style={s.handleArea} {...pan.panHandlers}>
          <View style={s.handleBar} />
        </View>

        {/* 헤더 */}
        <View style={s.header}>
          <View style={[s.avatar, isOwner && s.avatarOwner]}>
            <Text style={[s.avatarTxt, isOwner && s.avatarTxtOwner]}>
              {member.nickname?.[0] ?? '?'}
            </Text>
          </View>
          <View style={s.nameRow}>
            <Text style={s.name}>{member.nickname}</Text>
            {isOwner && (
              <View style={s.ownerBadge}>
                <Text style={s.ownerBadgeTxt}>호스트</Text>
              </View>
            )}
          </View>
          <TouchableOpacity onPress={closeSheet} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <Text style={s.closeBtn}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* 월간 요약 */}
        <View style={s.summary}>
          <View style={s.summaryItem}>
            <Text style={s.summaryVal}>{formatMin(totalMin)}</Text>
            <Text style={s.summaryLabel}>이달 집중</Text>
          </View>
          <View style={s.summaryDivider} />
          <View style={s.summaryItem}>
            <Text style={s.summaryVal}>{challengeStreak}일</Text>
            <Text style={s.summaryLabel}>연속 챌린지 달성</Text>
          </View>
        </View>

        {/* 월 이동 */}
        <View style={s.monthNav}>
          <TouchableOpacity onPress={prevMonth} hitSlop={{ top: 8, right: 12, bottom: 8, left: 8 }}>
            <Text style={s.navArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={s.monthTitle}>
            {year}년 {MONTHS_KR[month]}
          </Text>
          <TouchableOpacity
            onPress={nextMonth}
            disabled={isCurrentMonth}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 12 }}
          >
            <Text style={[s.navArrow, isCurrentMonth && s.navDisabled]}>›</Text>
          </TouchableOpacity>
        </View>

        {/* 요일 헤더 */}
        <View style={s.weekRow}>
          {DAYS_KR.map((d, i) => (
            <Text
              key={d}
              style={[s.weekDay, { width: CELL_W }, i === 0 && s.sunTxt, i === 6 && s.satTxt]}
            >
              {d}
            </Text>
          ))}
        </View>

        {/* 달력 그리드 */}
        {loading ? (
          <ActivityIndicator size="small" color={T.inkMed} style={{ marginVertical: 20 }} />
        ) : (
          <View style={{ gap: CELL_GAP }}>
            {rows.map((row, ri) => (
              <View key={ri} style={[s.gridRow, { gap: CELL_GAP }]}>
                {row.map((day, di) => {
                  if (!day) return <View key={di} style={{ width: CELL_W, height: CELL_H }} />;

                  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const stat = statsMap[dateStr];
                  const focusMin = stat?.focusMinutes ?? 0;
                  const isToday = isCurrentMonth && now.getDate() === day;
                  const isSelected = selectedDate === dateStr;
                  const { achieved, total } = getChallengeRatio(stat);
                  const bg = challengeBg(achieved, total);

                  return (
                    <TouchableOpacity
                      key={di}
                      activeOpacity={0.7}
                      onPress={() => setSelectedDate((prev) => (prev === dateStr ? null : dateStr))}
                      style={[
                        s.cell,
                        { width: CELL_W, height: CELL_H, backgroundColor: bg },
                        isToday && s.cellToday,
                        isSelected && s.cellSelected,
                      ]}
                    >
                      <Text
                        style={[
                          s.dayNum,
                          achieved > 0 && s.dayNumAchieved,
                          isToday && s.dayNumToday,
                          di === 0 && s.sunTxt,
                          di === 6 && s.satTxt,
                        ]}
                      >
                        {day}
                      </Text>
                      {focusMin > 0 && (
                        <Text style={[s.cellTime, achieved > 0 && s.cellTimeAchieved]}>
                          {compactMin(focusMin)}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        )}

        {/* 선택한 날짜 집중 시간 */}
        {selectedDate && (
          <View style={s.selectedBox}>
            <Text style={s.selectedDateTxt}>
              {(() => {
                const [, m, d] = selectedDate.split('-');
                return `${Number(m)}월 ${Number(d)}일`;
              })()}
            </Text>
            <Text style={s.selectedTimeTxt}>
              {formatMin(statsMap[selectedDate]?.focusMinutes ?? 0)} 집중
            </Text>
          </View>
        )}

        {/* 범례 */}
        <View style={s.legend}>
          <View style={s.legendItem}>
            <View style={[s.legendBox, { backgroundColor: challengeBg(1, 4) }]} />
            <Text style={s.legendTxt}>일부 달성</Text>
          </View>
          <View style={s.legendItem}>
            <View style={[s.legendBox, { backgroundColor: challengeBg(3, 4) }]} />
            <Text style={s.legendTxt}>대부분 달성</Text>
          </View>
          <View style={s.legendItem}>
            <View style={[s.legendBox, { backgroundColor: challengeBg(1, 1) }]} />
            <Text style={s.legendTxt}>전체 달성</Text>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: SCREEN_H + 400, // 화면보다 크게 — 위로 올려도 바닥이 항상 흰색
    backgroundColor: T.paper,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: H_PAD,
    borderWidth: 1.5,
    borderBottomWidth: 0,
    borderColor: T.ink,
  },
  handleArea: { alignItems: 'center', paddingTop: 6, paddingBottom: 16 },
  handleBar: { width: 44, height: 5, borderRadius: 3, backgroundColor: T.paperLine },

  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 10 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: T.paperDark,
    borderWidth: 1.5,
    borderColor: T.paperLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarOwner: { backgroundColor: T.ink, borderColor: T.ink },
  avatarTxt: { fontSize: 20, fontWeight: '900', color: T.inkMed },
  avatarTxtOwner: { color: T.paper },
  nameRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 17, fontWeight: '900', color: T.ink },
  ownerBadge: { paddingHorizontal: 6, paddingVertical: 2, backgroundColor: T.ink, borderRadius: 4 },
  ownerBadgeTxt: { fontSize: 10, fontWeight: '800', color: T.paper },
  closeBtn: { fontSize: 17, color: T.inkMed, fontWeight: '700' },

  summary: {
    flexDirection: 'row',
    backgroundColor: T.paper,
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 16,
  },
  summaryItem: { flex: 1, alignItems: 'center', gap: 3 },
  summaryVal: { fontSize: 16, fontWeight: '900', color: T.ink },
  summaryLabel: { fontSize: 11, fontWeight: '600', color: T.inkMed },
  summaryDivider: { width: 1, backgroundColor: T.paperLine, marginVertical: 4 },

  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  monthTitle: { fontSize: 15, fontWeight: '800', color: T.ink },
  navArrow: { fontSize: 26, fontWeight: '700', color: T.ink },
  navDisabled: { color: T.inkLight },

  weekRow: { flexDirection: 'row', gap: CELL_GAP, marginBottom: 4 },
  weekDay: { textAlign: 'center', fontSize: 12, fontWeight: '700', color: T.inkMed },
  sunTxt: { color: '#ef4444' },
  satTxt: { color: '#3b82f6' },

  gridRow: { flexDirection: 'row' },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    gap: 2,
    borderWidth: 1,
    borderColor: T.paperLine,
  },
  // 오늘 날짜: 테두리를 강조(배경색과 겹치지 않도록 fill 대신 border만)
  cellToday: { borderWidth: 2, borderColor: T.ink },
  cellSelected: { borderWidth: 2.5, borderColor: '#16a34a' },

  dayNum: { fontSize: 13, fontWeight: '600', color: T.ink },
  dayNumToday: { fontWeight: '900' },
  dayNumAchieved: { fontWeight: '800' },

  cellTime: { fontSize: 9, fontWeight: '600', color: T.inkMed },
  cellTimeAchieved: { color: '#14532d', fontWeight: '700' },

  selectedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: T.paperDark,
    borderWidth: 1.5,
    borderColor: '#16a34a',
  },
  selectedDateTxt: { fontSize: 14, fontWeight: '800', color: T.ink },
  selectedTimeTxt: { fontSize: 14, fontWeight: '800', color: '#16a34a' },

  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
    marginTop: 14,
    paddingTop: 12,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendBox: { width: 12, height: 12, borderRadius: 3, borderWidth: 1, borderColor: T.paperLine },
  legendTxt: { fontSize: 11, fontWeight: '600', color: T.inkMed },
});
