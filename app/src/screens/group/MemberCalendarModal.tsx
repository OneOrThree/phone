import { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '@/constants/theme';
import { api } from '@/services/api';
import type { GroupMember } from '@/types/api';

// 멤버 캘린더 일별 통계
interface DailyStat {
  date: string;
  focusMinutes?: number;
  focusGoalAchieved?: boolean;
  challengeAchieved?: boolean;
}

interface MemberCalendarModalProps {
  visible: boolean;
  member: GroupMember | null;
  groupId: number;
  onClose: () => void;
}

const SCREEN_W = Dimensions.get('window').width;
const H_PAD = 24;
const CELL_GAP = 4;
const CELL_SIZE = Math.floor((SCREEN_W - H_PAD * 2 - CELL_GAP * 6) / 7);

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

export default function MemberCalendarModal({
  visible,
  member,
  groupId,
  onClose,
}: MemberCalendarModalProps) {
  const { bottom: bottomInset } = useSafeAreaInsets();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [stats, setStats] = useState<DailyStat[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !member?.userId || !groupId) return;
    setLoading(true);
    setStats([]);
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
  }, [visible, member, groupId, year, month]);

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

  // 훅 이후에 조기 반환
  if (!visible || !member) return null;

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
  const goalDays = stats.filter((s) => s.focusGoalAchieved).length;
  const challengeDays = stats.filter((s) => s.challengeAchieved).length;

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  const isOwner = member.role === 'OWNER';

  return (
    <Modal visible={visible} transparent={false} animationType="fade" onRequestClose={onClose}>
      <View style={s.container}>
        <TouchableOpacity
          style={StyleSheet.absoluteFillObject}
          activeOpacity={1}
          onPress={onClose}
        />
        <View
          style={[s.sheet, { paddingBottom: Math.max(bottomInset, 16) + 16 }]}
          onStartShouldSetResponder={() => true}
        >
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
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
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
              <Text style={s.summaryVal}>{goalDays}일</Text>
              <Text style={s.summaryLabel}>목표 달성</Text>
            </View>
            <View style={s.summaryDivider} />
            <View style={s.summaryItem}>
              <Text style={s.summaryVal}>{challengeDays}일</Text>
              <Text style={s.summaryLabel}>챌린지</Text>
            </View>
          </View>

          {/* 월 이동 */}
          <View style={s.monthNav}>
            <TouchableOpacity
              onPress={prevMonth}
              hitSlop={{ top: 8, right: 12, bottom: 8, left: 8 }}
            >
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
                style={[s.weekDay, { width: CELL_SIZE }, i === 0 && s.sunTxt, i === 6 && s.satTxt]}
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
                    if (!day) {
                      return <View key={di} style={{ width: CELL_SIZE, height: CELL_SIZE }} />;
                    }
                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const stat = statsMap[dateStr];
                    const hasFocus = (stat?.focusMinutes ?? 0) > 0;
                    const goalMet = !!stat?.focusGoalAchieved;
                    const challengeMet = !!stat?.challengeAchieved;
                    const isToday = isCurrentMonth && now.getDate() === day;

                    return (
                      <View
                        key={di}
                        style={[
                          s.cell,
                          { width: CELL_SIZE, height: CELL_SIZE },
                          isToday && s.cellToday,
                        ]}
                      >
                        <Text
                          style={[
                            s.dayNum,
                            isToday && s.dayNumToday,
                            di === 0 && s.sunTxt,
                            di === 6 && s.satTxt,
                          ]}
                        >
                          {day}
                        </Text>
                        <View style={s.indicators}>
                          {hasFocus && <View style={[s.dot, goalMet ? s.dotGoal : s.dotFocus]} />}
                          {challengeMet && <Text style={s.check}>✓</Text>}
                        </View>
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          )}

          {/* 범례 */}
          <View style={s.legend}>
            <View style={s.legendItem}>
              <View style={[s.dot, s.dotGoal]} />
              <Text style={s.legendTxt}>목표 달성</Text>
            </View>
            <View style={s.legendItem}>
              <View style={[s.dot, s.dotFocus]} />
              <Text style={s.legendTxt}>집중 있음</Text>
            </View>
            <View style={s.legendItem}>
              <Text style={[s.check, { fontSize: 11 }]}>✓</Text>
              <Text style={s.legendTxt}>챌린지</Text>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: T.paper,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: H_PAD,
    paddingTop: 20,
    borderWidth: 1.5,
    borderBottomWidth: 0,
    borderColor: T.ink,
  },

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
  ownerBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: T.ink,
    borderRadius: 4,
  },
  ownerBadgeTxt: { fontSize: 10, fontWeight: '800', color: T.paper },
  closeBtn: { fontSize: 17, color: T.inkMed, fontWeight: '700' },

  summary: {
    flexDirection: 'row',
    backgroundColor: T.paperDark,
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
  cell: { alignItems: 'center', justifyContent: 'center', borderRadius: 6, gap: 1 },
  cellToday: { backgroundColor: T.paperDark },
  dayNum: { fontSize: 13, fontWeight: '600', color: T.ink },
  dayNumToday: { fontWeight: '900' },

  indicators: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 8 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  dotGoal: { backgroundColor: '#16a34a' },
  dotFocus: { backgroundColor: T.paperLine },
  check: { fontSize: 8, fontWeight: '900', color: '#f59e0b' },

  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: T.paperLine,
    backgroundColor: T.paper,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendTxt: { fontSize: 11, fontWeight: '600', color: T.inkMed },
});
