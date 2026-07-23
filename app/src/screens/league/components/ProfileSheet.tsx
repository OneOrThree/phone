import { useEffect, useRef, useState } from 'react';
import { Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import { T, withAlpha } from '@/constants/theme';
import { tierByLevel } from '@/constants/tiers';
import { sendFriendRequest } from '@/services/friendsApi';
import { logFriendRequestSent } from '@/services/analyticsEvents';
import CircularGauge from '@/components/CircularGauge';
import { fmtMinutes, hms } from '../format';
import { MY_USER_ID } from '../mock';
import { MemberAvatar } from './MemberAvatar';
import { TierBadge } from './TierBadge';

// 프로필 오버레이 — 랭킹/친구에서 사람 탭 시 뜨는 바텀시트.
// 배치: [좌 아바타 | 우 이름·스트릭 / 티어·친구] 헤더 → 집중 시간 히어로(풀폭 요일 스파크)
//       → 목표 달성 링 + 개인 기록(최고 순위·주간 최고) 스택 2열 → 친구 추가 CTA.
// 내 프로필 통계는 실데이터(오늘 목표 달성률·오늘 스파크), 타 유저는 mock — TODO: 프로필 API.
export interface ProfileTarget {
  userId: string;
  nickname: string;
  tierLevel: number;
  seconds: number; // 집중 시간(초) — 리그 주간 총합, HH:MM:SS 실초 표기(GROMO-665)
  bestRank: number; // 역대 최고 순위 (기록 카드)
  bestWeekMinutes: number; // 일주일 최대 공부량(분) (기록 카드)
  achievedRate: number; // 목표 달성률 0..1 — 내 것은 오늘 실데이터
  streakDays: number; // 연속 공부 일수 — 하루 10분 스트릭, UserStreak (이름 옆 pill, 0이면 생략)
  friendCount: number;
  isFriend: boolean;
  /** 요일(월~일)별 집중 시간(분) — 없으면 mock 스파크. 정규화는 시트에서 */
  weekSpark?: number[];
}

interface Props {
  target: ProfileTarget | null;
  onClose: () => void;
}

// mock 스파크(분) — 아직 시안 비율 기반 고정 분값. 타 유저 요일별 실데이터는
// getUserStats().heatmap(GROMO-640)으로 확보 가능해져 교체 후보(FriendProfileScreen 배선 참고).
const MOCK_SPARK = [138, 192, 114, 240, 168, 90, 144];
const BAR_AREA_H = 64;
// 스파크 요일 라벨 (월요일 시작)
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
// y축 눈금 컬럼 폭
const AXIS_W = 34;

// y축 눈금 표기 — "4h" / "2.5h" / "30m" / "0"
function fmtAxis(minutes: number): string {
  if (minutes <= 0) return '0';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = minutes / 60;
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
}

// y축 최대 — 데이터 최대치에 맞춰 자동 확장(하루 22시간이면 24h 축).
// 절반 눈금(축/2)도 깔끔하게 떨어지는 단계값으로 올림한다.
const AXIS_STEPS = [30, 60, 120, 240, 360, 480, 720, 960, 1200, 1440]; // 0.5h ~ 24h
function niceAxisMax(maxMinutes: number): number {
  if (maxMinutes <= 0) return 60;
  for (const step of AXIS_STEPS) {
    if (maxMinutes <= step) return step;
  }
  return Math.ceil(maxMinutes / 120) * 120;
}

export function ProfileSheet({ target, onClose }: Props) {
  const insets = useSafeAreaInsets();

  // 친구 신청 상태 — 성공/409는 '요청됨' 유지, 그 외 실패는 롤백 + 안내 (GROMO-940).
  // 수락 전이므로 '친구 ✓'가 아닌 '요청됨' 표기(FriendProfileScreen과 동일 의미 체계).
  const [requested, setRequested] = useState(false);
  const busy = useRef(false); // 연타 방지
  useEffect(() => {
    setRequested(false);
  }, [target]);

  async function requestFriend() {
    if (!target || busy.current) return;
    busy.current = true;
    setRequested(true); // 낙관 전환
    try {
      await sendFriendRequest(target.userId);
      logFriendRequestSent({ request_source: 'profile_sheet' }); // 성공 시에만 — 409(중복)는 미발행
    } catch (e) {
      // 409 = 이미 친구/이미 보낸 요청 — 요청됨 유지
      if (!(axios.isAxiosError(e) && e.response?.status === 409)) {
        setRequested(false); // 롤백
        Alert.alert('친구 신청 실패', '잠시 후 다시 시도해주세요.');
      }
    } finally {
      busy.current = false;
    }
  }

  if (!target) return null;

  const tier = tierByLevel(target.tierLevel);
  const isMe = target.userId === MY_USER_ID;

  // 스파크(분) 정규화 — y축 최대는 데이터에 맞춰 자동 확장(니스 스텝), 전부 0이면 1시간 축
  const raw = target.weekSpark ?? MOCK_SPARK;
  const sparkMax = Math.max(...raw);
  const axisMax = niceAxisMax(sparkMax);
  const ratios = raw.map((v) => v / axisMax);
  const sparkMaxIndex = sparkMax > 0 ? raw.indexOf(sparkMax) : -1;
  const todayIdx = (new Date().getDay() + 6) % 7; // 오늘 요일(월=0) — 라벨 강조

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={s.handle} />
          <TouchableOpacity style={s.closeBtn} onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={15} color={T.link} />
          </TouchableOpacity>

          {/* ── 헤더: 좌 아바타 / 우 이름·스트릭 + 티어·친구 ── */}
          <View style={s.headerRow}>
            <MemberAvatar size={68} />
            <View style={s.headerCol}>
              <View style={s.nameRow}>
                <Text style={s.name} numberOfLines={1}>
                  {target.nickname}
                </Text>
                {target.streakDays > 0 && (
                  <View style={s.streakPill}>
                    <Ionicons name="flame" size={12} color={T.accentAlt} />
                    <Text style={s.streakText} allowFontScaling={false}>
                      {target.streakDays}일 연속
                    </Text>
                  </View>
                )}
              </View>
              <View style={s.metaRow}>
                <TierBadge level={target.tierLevel} size={30} />
                <Text style={s.metaTier}>{tier.name}</Text>
                <Text style={s.metaDot}>·</Text>
                <Text style={s.metaFriend}>
                  친구 <Text style={s.metaFriendNum}>{target.friendCount}</Text>명
                </Text>
              </View>
            </View>
          </View>

          {/* ── 집중 시간 히어로 — 값 + 풀폭 요일 스파크 ── */}
          <View style={s.heroCard}>
            <View style={s.heroTop}>
              <Text style={s.heroLabel}>집중 시간</Text>
              <Text style={s.heroValue} allowFontScaling={false}>
                {hms(target.seconds)}
              </Text>
            </View>
            {/* 차트: y축(시간) + 그리드 + 요일 막대 */}
            <View style={s.chartRow}>
              <View style={s.axisCol}>
                <Text style={s.axisText} allowFontScaling={false}>
                  {fmtAxis(axisMax)}
                </Text>
                <Text style={s.axisText} allowFontScaling={false}>
                  {fmtAxis(axisMax / 2)}
                </Text>
                <Text style={s.axisText} allowFontScaling={false}>
                  0
                </Text>
              </View>
              <View style={s.chartArea}>
                <View style={s.gridWrap} pointerEvents="none">
                  <View style={s.gridLine} />
                  <View style={s.gridLine} />
                  <View style={[s.gridLine, s.gridLineBase]} />
                </View>
                <View style={s.sparkRow}>
                  {ratios.map((v, i) => (
                    <View
                      key={i}
                      style={[
                        s.sparkBar,
                        i === sparkMaxIndex ? s.sparkBarMax : null,
                        { height: Math.max(v * BAR_AREA_H, 3) },
                      ]}
                    />
                  ))}
                </View>
              </View>
            </View>
            <View style={s.dayRow}>
              {WEEKDAYS.map((d, i) => (
                <Text
                  key={d}
                  style={[s.sparkDay, i === todayIdx ? s.sparkDayToday : null]}
                  allowFontScaling={false}
                >
                  {d}
                </Text>
              ))}
            </View>
          </View>

          {/* ── 2열: 목표 달성 링 | 개인 기록(최고 순위·주간 최고) 스택 ── */}
          <View style={s.duoRow}>
            <View style={s.ringCard}>
              <CircularGauge
                size={72}
                progress={target.achievedRate}
                trackColor={T.track}
                progressColor={T.accent}
              >
                <Text style={s.ringValue} allowFontScaling={false}>
                  {Math.round(target.achievedRate * 100)}%
                </Text>
              </CircularGauge>
              <Text style={s.ringLabel}>목표 달성</Text>
            </View>
            <View style={s.recordCard}>
              <View style={s.recordRow}>
                <Text style={s.recordLabel}>최고 순위</Text>
                <Text style={s.recordValue} allowFontScaling={false}>
                  {target.bestRank}위
                </Text>
              </View>
              <View style={s.recordDivider} />
              <View style={s.recordRow}>
                <Text style={s.recordLabel}>주간 최고 기록</Text>
                <Text style={[s.recordValue, s.recordValueAccent]} allowFontScaling={false}>
                  {fmtMinutes(target.bestWeekMinutes)}
                </Text>
              </View>
            </View>
          </View>

          {/* ── 친구 CTA — 내 프로필이면 생략. 이미 친구 '친구 ✓' / 신청 후 '요청됨' / 그 외 신청 버튼 ── */}
          {!isMe &&
            (target.isFriend ? (
              <View style={[s.actionBtn, s.actionBtnFriend]}>
                <Text style={[s.actionText, s.actionTextFriend]}>친구 ✓</Text>
              </View>
            ) : requested ? (
              <View style={[s.actionBtn, s.actionBtnRequested]}>
                <Text style={[s.actionText, s.actionTextRequested]}>요청됨</Text>
              </View>
            ) : (
              <TouchableOpacity style={s.actionBtn} activeOpacity={0.85} onPress={requestFriend}>
                <Text style={s.actionText}>+ 친구 추가</Text>
              </TouchableOpacity>
            ))}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: withAlpha(T.night.bottom, 0.5) },
  sheet: {
    backgroundColor: T.paperLight,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: T.space.xl,
    paddingTop: T.space.md,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: T.border,
    marginBottom: T.space.sm,
  },
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 18,
    zIndex: 1,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: T.track,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // 헤더 — 좌 아바타 / 우 정보
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.md, marginTop: T.space.sm },
  headerCol: { flex: 1, minWidth: 0, gap: T.space.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  name: { ...T.text.stat, color: T.ink, flexShrink: 1 },
  streakPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: T.accentAltBg,
    borderRadius: 999,
    paddingLeft: T.space.sm,
    paddingRight: T.space.sm,
    paddingVertical: 3,
  },
  streakText: { ...T.text.caption, fontWeight: '700', color: T.accentAlt },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  metaTier: { ...T.text.label, fontWeight: '700', color: T.inkSub },
  metaDot: { ...T.text.caption, color: T.inkMuted },
  metaFriend: { ...T.text.caption, color: T.inkSub },
  metaFriendNum: { fontWeight: '800', color: T.successInk },

  // 집중 시간 히어로
  heroCard: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.md,
    marginTop: T.space.lg,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  heroLabel: { ...T.text.caption, color: T.inkSub },
  heroValue: { ...T.text.stat, color: T.accent, fontVariant: ['tabular-nums'] },
  chartRow: { flexDirection: 'row', gap: T.space.sm, marginTop: T.space.md },
  axisCol: { width: AXIS_W, height: BAR_AREA_H, justifyContent: 'space-between' },
  axisText: {
    ...T.text.caption,
    lineHeight: 14,
    textAlign: 'right',
    color: T.inkMuted,
    fontVariant: ['tabular-nums'],
  },
  chartArea: { flex: 1, height: BAR_AREA_H },
  gridWrap: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between' },
  gridLine: { height: 1, backgroundColor: T.divider },
  gridLineBase: { backgroundColor: T.chipBorder },
  sparkRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: T.space.xs,
    paddingHorizontal: 2,
  },
  sparkBar: {
    flex: 1,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    backgroundColor: T.sand,
  },
  dayRow: {
    flexDirection: 'row',
    gap: T.space.xs,
    marginTop: T.space.xs,
    marginLeft: AXIS_W + 6,
    paddingHorizontal: 2,
  },
  sparkDay: { ...T.text.caption, flex: 1, textAlign: 'center', color: T.inkMuted },
  sparkDayToday: { color: T.accentDeep, fontWeight: '800' },
  sparkBarMax: { backgroundColor: T.accent },

  // 2열 — 링 / 순위 스택
  duoRow: { flexDirection: 'row', gap: T.space.md, marginTop: T.space.md },
  ringCard: {
    width: 118,
    alignItems: 'center',
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    paddingVertical: T.space.md,
    gap: T.space.sm,
  },
  ringValue: { ...T.text.label, fontWeight: '800', color: T.ink },
  ringLabel: { ...T.text.caption, color: T.inkSub },
  recordCard: {
    flex: 1,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    paddingHorizontal: T.space.lg,
    justifyContent: 'center',
  },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: T.space.md,
  },
  recordDivider: { height: 1, backgroundColor: T.divider },
  recordLabel: { ...T.text.caption, color: T.inkSub },
  recordValue: {
    ...T.text.subtitle,
    fontWeight: '800',
    color: T.ink,
    fontVariant: ['tabular-nums'],
  },
  recordValueAccent: { color: T.accent },

  actionBtn: {
    alignSelf: 'stretch',
    height: 52,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: T.space.lg,
    shadowColor: T.accent,
    shadowOpacity: 0.5,
    shadowRadius: 11,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  actionBtnFriend: { backgroundColor: T.greenBg, shadowOpacity: 0 },
  actionBtnRequested: { backgroundColor: T.track, shadowOpacity: 0 },
  actionText: { ...T.text.body, fontWeight: '700', color: T.white },
  actionTextFriend: { color: T.successInk },
  actionTextRequested: { color: T.inkSub },
});
