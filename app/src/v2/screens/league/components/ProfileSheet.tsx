import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/v2/constants/theme';
import { tierByLevel } from '@/v2/constants/tiers';
import CircularGauge from '@/v2/components/CircularGauge';
import type { FriendRelation } from '@/types/api';
import { fmtMinutes } from '../format';
import { MY_USER_ID, mockProfileExtra } from '../mock';
import { MemberAvatar } from './MemberAvatar';
import { TierBadge } from './TierBadge';

// 프로필 오버레이 — 랭킹 행 탭 시 뜨는 바텀시트 모달.
// 캐릭터/티어/순위 카드/친구 수/목표달성 링/주간 집중 막대/친구추가 버튼.
export interface ProfileTarget {
  userId: string;
  nickname: string;
  tierLevel: number;
  minutes: number; // 주간 집중 분
  seed: number; // mock 확장 정보 생성용 (rank 등)
  relation: FriendRelation;
}

interface Props {
  target: ProfileTarget | null;
  onClose: () => void;
}

const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const BAR_MAX_H = 56;

export function ProfileSheet({ target, onClose }: Props) {
  const insets = useSafeAreaInsets();

  // 친구 신청 버튼 로컬 토글 (NONE → PENDING). TODO: POST /friends/requests 연동
  const [relation, setRelation] = useState<FriendRelation>('NONE');
  useEffect(() => {
    if (target) setRelation(target.relation);
  }, [target]);

  if (!target) return null;

  const tier = tierByLevel(target.tierLevel);
  // TODO: 프로필 상세 엔드포인트가 아직 없어 mock — 백엔드 협의 후 교체
  const extra = mockProfileExtra(target.seed);
  const barMax = Math.max(...extra.weeklyFocusMinutes, 1);
  const isMe = target.userId === MY_USER_ID;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 18 }]}>
          <View style={s.handle} />

          {/* 캐릭터 + 이름 + 티어 pill */}
          <MemberAvatar size={92} />
          <Text style={s.name}>{target.nickname}</Text>
          <View style={s.tierPill}>
            <TierBadge level={target.tierLevel} size={18} />
            <Text style={s.tierPillText}>{tier.name}</Text>
          </View>

          {/* 순위 카드 2개 + 친구 수 */}
          <View style={s.statRow}>
            <View style={s.statCard}>
              <Text style={s.statLabel}>전체 순위</Text>
              <Text style={s.statValue} allowFontScaling={false}>
                {extra.overallRank}위
              </Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statLabel}>리그 순위</Text>
              <Text style={s.statValue} allowFontScaling={false}>
                {extra.leagueRank}위
              </Text>
            </View>
          </View>
          <View style={s.friendPill}>
            <Ionicons name="people" size={13} color={T.inkSub} />
            <Text style={s.friendPillText}>친구 {extra.friendCount}</Text>
          </View>

          {/* 목표달성 링 + 주간 집중 막대 */}
          <View style={s.weekCard}>
            <CircularGauge
              size={92}
              progress={extra.goalRate}
              trackColor="#F1E9DA"
              progressColor={T.accent}
              strokeWidth={12}
            >
              <Text style={s.gaugeValue} allowFontScaling={false}>
                {Math.round(extra.goalRate * 100)}%
              </Text>
              <Text style={s.gaugeLabel}>목표 달성</Text>
            </CircularGauge>
            <View style={s.weekBars}>
              <Text style={s.weekTitle}>
                주간 집중 <Text style={s.weekTotal}>{fmtMinutes(target.minutes)}</Text>
              </Text>
              <View style={s.barsRow}>
                {extra.weeklyFocusMinutes.map((v, i) => (
                  <View key={DAYS[i]} style={s.barCol}>
                    <View style={s.barTrack}>
                      <View style={[s.bar, { height: Math.max((v / barMax) * BAR_MAX_H, 3) }]} />
                    </View>
                    <Text style={s.barDay}>{DAYS[i]}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          {/* 친구 추가/요청됨/친구 — 내 프로필이면 생략 */}
          {!isMe && (
            <TouchableOpacity
              style={[s.actionBtn, relation !== 'NONE' ? s.actionBtnMuted : null]}
              activeOpacity={0.85}
              disabled={relation !== 'NONE'}
              onPress={() => setRelation('PENDING')}
            >
              {relation === 'NONE' && <Ionicons name="person-add" size={16} color={T.white} />}
              {relation === 'FRIEND' && <Ionicons name="checkmark" size={16} color={T.inkSub} />}
              <Text style={[s.actionText, relation !== 'NONE' ? s.actionTextMuted : null]}>
                {relation === 'NONE' ? '친구 추가' : relation === 'PENDING' ? '요청됨' : '친구'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(27,22,19,0.45)' },
  sheet: {
    backgroundColor: T.paperLight,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 20,
    paddingTop: 10,
    alignItems: 'center',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#DDD2BE',
    marginBottom: 14,
  },
  name: { ...T.text.heading, color: T.ink, marginTop: 10 },
  tierPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FBF3E8',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 7,
  },
  tierPillText: { ...T.text.caption, color: T.accentDeep },

  statRow: { flexDirection: 'row', gap: 10, marginTop: 16, alignSelf: 'stretch' },
  statCard: {
    flex: 1,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 14,
    alignItems: 'center',
    paddingVertical: 11,
    gap: 2,
  },
  statLabel: { ...T.text.caption, color: T.inkMuted },
  statValue: { ...T.text.subtitle, color: T.ink },
  friendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 10,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 4,
  },
  friendPillText: { ...T.text.caption, color: T.inkSub },

  weekCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    alignSelf: 'stretch',
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 12,
  },
  gaugeValue: { ...T.text.subtitle, color: T.ink },
  gaugeLabel: { fontSize: 10, fontWeight: '600', color: T.inkMuted },
  weekBars: { flex: 1 },
  weekTitle: { ...T.text.caption, color: T.inkMuted, marginBottom: 8 },
  weekTotal: { color: T.ink, fontWeight: '800' },
  barsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  barCol: { flex: 1, alignItems: 'center', gap: 4 },
  barTrack: { height: BAR_MAX_H, justifyContent: 'flex-end' },
  bar: { width: 9, borderRadius: 4, backgroundColor: T.accent },
  barDay: { fontSize: 10, fontWeight: '600', color: T.inkMuted },

  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'stretch',
    backgroundColor: T.accent,
    borderRadius: 14,
    paddingVertical: 13,
    marginTop: 14,
  },
  actionBtnMuted: { backgroundColor: '#F1E9DA' },
  actionText: { ...T.text.label, fontSize: 16, color: T.white },
  actionTextMuted: { color: T.inkSub },
});
