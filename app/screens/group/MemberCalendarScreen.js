import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '../../components/theme';
import { apiFetch } from '../../utils/api';

const SCREEN_W = Dimensions.get('window').width;
const H_PAD = 24;
const CELL_GAP = 4;
const CELL_W = Math.floor((SCREEN_W - H_PAD * 2 - CELL_GAP * 6) / 7);
const CELL_H = CELL_W + 10;

const DAYS_KR = ['일', '월', '화', '수', '목', '금', '토'];
const MONTHS_KR = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

function formatMin(min) {
  if (!min) return '0분';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0) return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
  return `${m}분`;
}

function compactMin(min) {
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
function getChallengeRatio(stat) {
  if (!stat) return { achieved: 0, total: 0 };
  if (stat.totalChallengeCount != null) {
    return { achieved: stat.achievedChallengeCount ?? 0, total: stat.totalChallengeCount };
  }
  if (stat.challengeAchieved != null) {
    return { achieved: stat.challengeAchieved ? 1 : 0, total: 1 };
  }
  return { achieved: 0, total: 0 };
}

function challengeBg(achieved, total) {
  if (!total || !achieved) return 'transparent';
  const opacity = 0.18 + (achieved / total) * 0.67; // 0.18(연) ~ 0.85(진)
  return `rgba(22, 163, 74, ${opacity.toFixed(2)})`;
}

export default function MemberCalendarScreen({ navigation, route }) {
  const { member, groupId } = route.params;
  const { bottom: bottomInset } = useSafeAreaInsets();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [stats, setStats] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!member?.userId || !groupId) return;
    setLoading(true);
    setStats([]);
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    apiFetch(`/api/v1/groups/${groupId}/members/${member.userId}/calendar?month=${monthStr}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setStats(Array.isArray(data) ? data : []))
      .catch(() => setStats([]))
      .finally(() => setLoading(false));
  }, [member, groupId, year, month]);

  function prevMonth() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  }

  function nextMonth() {
    if (year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth())) return;
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  }

  const statsMap = {};
  stats.forEach((stat) => { statsMap[stat.date] = stat; });

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
  const challengeDays = stats.filter((s) => {
    const { achieved } = getChallengeRatio(s);
    return achieved > 0;
  }).length;

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  const isOwner = member.role === 'OWNER';

  return (
    <View style={s.overlay}>
      <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => navigation.goBack()} />
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
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
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
          <TouchableOpacity onPress={prevMonth} hitSlop={{ top: 8, right: 12, bottom: 8, left: 8 }}>
            <Text style={s.navArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={s.monthTitle}>{year}년 {MONTHS_KR[month]}</Text>
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
            <Text key={d} style={[s.weekDay, { width: CELL_W }, i === 0 && s.sunTxt, i === 6 && s.satTxt]}>
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
                  const { achieved, total } = getChallengeRatio(stat);
                  const bg = challengeBg(achieved, total);

                  return (
                    <View
                      key={di}
                      style={[
                        s.cell,
                        { width: CELL_W, height: CELL_H, backgroundColor: bg },
                        isToday && s.cellToday,
                      ]}
                    >
                      <Text style={[
                        s.dayNum,
                        achieved > 0 && s.dayNumAchieved,
                        isToday && s.dayNumToday,
                        di === 0 && s.sunTxt,
                        di === 6 && s.satTxt,
                      ]}>
                        {day}
                      </Text>
                      {focusMin > 0 && (
                        <Text style={[s.cellTime, achieved > 0 && s.cellTimeAchieved]}>
                          {compactMin(focusMin)}
                        </Text>
                      )}
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
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: {
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
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: T.paperDark, borderWidth: 1.5, borderColor: T.paperLine,
    alignItems: 'center', justifyContent: 'center',
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
    flexDirection: 'row', backgroundColor: T.paper,
    borderRadius: 12, paddingVertical: 12, marginBottom: 16,
  },
  summaryItem: { flex: 1, alignItems: 'center', gap: 3 },
  summaryVal: { fontSize: 16, fontWeight: '900', color: T.ink },
  summaryLabel: { fontSize: 11, fontWeight: '600', color: T.inkMed },
  summaryDivider: { width: 1, backgroundColor: T.paperLine, marginVertical: 4 },

  monthNav: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 10,
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

  dayNum: { fontSize: 13, fontWeight: '600', color: T.ink },
  dayNumToday: { fontWeight: '900' },
  dayNumAchieved: { fontWeight: '800' },

  cellTime: { fontSize: 9, fontWeight: '600', color: T.inkMed },
  cellTimeAchieved: { color: '#14532d', fontWeight: '700' },

  legend: {
    flexDirection: 'row', justifyContent: 'center', gap: 14,
    marginTop: 14, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: T.paperLine,
    backgroundColor: T.paper,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendBox: { width: 12, height: 12, borderRadius: 3, borderWidth: 1, borderColor: T.paperLine },
  legendTxt: { fontSize: 11, fontWeight: '600', color: T.inkMed },
});
