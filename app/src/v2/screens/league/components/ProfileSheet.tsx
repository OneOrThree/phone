import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/v2/constants/theme';
import { tierByLevel } from '@/v2/constants/tiers';
import CircularGauge from '@/v2/components/CircularGauge';
import { fmtMinutes } from '../format';
import { MY_USER_ID } from '../mock';
import { MemberAvatar } from './MemberAvatar';

// 프로필 오버레이 — 랭킹 행 탭 시 뜨는 바텀시트 모달 (시안 "리그 메인 · 프로필").
// 캐릭터 / 그라디언트 티어 pill / 전체·{시험} 리그 순위 / 친구 pill / 목표달성 링 + 주간 집중 / 친구 버튼.
export interface ProfileTarget {
  userId: string;
  nickname: string;
  tierLevel: number;
  minutes: number; // 주간 집중 분
  globalRank: number; // 전체 순위
  examName: string; // 준비 시험 (리그 순위 카드 라벨)
  examRank: number; // 시험 리그 내 순위
  achievedRate: number; // 목표 달성률 0..1
  friendCount: number;
  isFriend: boolean;
}

interface Props {
  target: ProfileTarget | null;
  onClose: () => void;
}

// 주간 집중 막대 — 시안 고정 스파크 (최대치만 브라운, 나머지 모래색)
const SPARK = [0.46, 0.64, 0.38, 0.8, 0.56, 0.3, 0.48];
const SPARK_MAX_INDEX = SPARK.indexOf(Math.max(...SPARK));
const BAR_AREA_H = 44;

export function ProfileSheet({ target, onClose }: Props) {
  const insets = useSafeAreaInsets();

  // 친구 버튼 로컬 토글 — 시안은 즉시 '친구 ✓' 전환.
  // TODO: 실제로는 POST /friends/requests 신청/수락 플로우 — API 연동 시 교체
  const [isFriend, setIsFriend] = useState(false);
  useEffect(() => {
    if (target) setIsFriend(target.isFriend);
  }, [target]);

  if (!target) return null;

  const tier = tierByLevel(target.tierLevel);
  const isMe = target.userId === MY_USER_ID;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={s.handle} />
          <TouchableOpacity style={s.closeBtn} onPress={onClose} hitSlop={6}>
            <Ionicons name="close" size={15} color={T.link} />
          </TouchableOpacity>

          {/* 캐릭터 + 이름 + 티어 pill */}
          <MemberAvatar size={92} />
          <Text style={s.name}>{target.nickname}</Text>
          <LinearGradient
            colors={tier.gradient}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={s.tierPill}
          >
            <Ionicons name="star" size={13} color={tier.starColor} />
            <Text style={[s.tierPillText, { color: tier.starColor }]}>{tier.name}</Text>
          </LinearGradient>

          {/* 순위 카드 2개 + 친구 수 */}
          <View style={s.statRow}>
            <View style={s.statCard}>
              <Text style={s.statLabel}>전체</Text>
              <Text style={s.statValue} allowFontScaling={false}>
                {target.globalRank}위
              </Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statLabel}>{target.examName} 리그</Text>
              <Text style={[s.statValue, s.statValueAccent]} allowFontScaling={false}>
                {target.examRank}위
              </Text>
            </View>
          </View>
          <View style={s.friendPill}>
            <Ionicons name="people" size={14} color="#5B7A48" />
            <Text style={s.friendPillText}>
              친구 <Text style={s.friendPillCount}>{target.friendCount}</Text>명
            </Text>
          </View>

          {/* 공개 프로필 — 목표달성 링 + 주간 집중 */}
          <Text style={s.sectionLabel}>공개 프로필 · 이번 주</Text>
          <View style={s.weekRow}>
            <View style={s.ringCard}>
              <CircularGauge
                size={84}
                progress={target.achievedRate}
                trackColor="#EFE7D8"
                progressColor={T.accent}
              >
                <Text style={s.ringValue} allowFontScaling={false}>
                  {Math.round(target.achievedRate * 100)}%
                </Text>
              </CircularGauge>
              <Text style={s.ringLabel}>목표 달성</Text>
            </View>
            <View style={s.sparkCard}>
              <Text style={s.sparkLabel}>이번 주 집중</Text>
              <Text style={s.sparkValue} allowFontScaling={false}>
                {fmtMinutes(target.minutes)}
              </Text>
              <View style={s.sparkRow}>
                {SPARK.map((v, i) => (
                  <View
                    key={i}
                    style={[
                      s.sparkBar,
                      i === SPARK_MAX_INDEX ? s.sparkBarMax : null,
                      { height: v * BAR_AREA_H },
                    ]}
                  />
                ))}
              </View>
            </View>
          </View>

          {/* 친구 추가/친구 ✓ 토글 — 내 프로필이면 생략 */}
          {!isMe && (
            <TouchableOpacity
              style={[s.actionBtn, isFriend ? s.actionBtnFriend : null]}
              activeOpacity={0.85}
              onPress={() => setIsFriend((f) => !f)}
            >
              <Text style={[s.actionText, isFriend ? s.actionTextFriend : null]}>
                {isFriend ? '친구 ✓' : '+ 친구 추가'}
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
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(20,14,9,0.5)' },
  sheet: {
    backgroundColor: T.paperLight,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 10,
    alignItems: 'center',
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#D8CFBE',
    marginBottom: 8,
  },
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 18,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#EFE7D8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: 22, fontWeight: '800', color: T.ink, marginTop: 4 },
  tierPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingLeft: 10,
    paddingRight: 13,
    paddingVertical: 5,
    marginTop: 9,
  },
  tierPillText: { fontSize: 13, fontWeight: '700' },

  statRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  statCard: {
    alignItems: 'center',
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 12,
    paddingHorizontal: 15,
    paddingVertical: 7,
    gap: 1,
  },
  statLabel: { fontSize: 11, fontWeight: '500', color: T.inkSub },
  statValue: { fontSize: 17, fontWeight: '800', color: T.ink },
  statValueAccent: { color: T.accent },
  friendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 10,
    backgroundColor: '#EEF2EA',
    borderWidth: 1,
    borderColor: '#D8E4CC',
    borderRadius: 999,
    paddingLeft: 9,
    paddingRight: 14,
    paddingVertical: 6,
  },
  friendPillText: { fontSize: 13, fontWeight: '600', color: '#4A6B3A' },
  friendPillCount: { fontWeight: '800' },

  sectionLabel: {
    alignSelf: 'flex-start',
    fontSize: 12,
    fontWeight: '600',
    color: T.inkSub,
    marginTop: 18,
    marginBottom: 9,
  },
  weekRow: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  ringCard: {
    width: 120,
    alignItems: 'center',
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  ringValue: { fontSize: 19, fontWeight: '800', color: T.ink },
  ringLabel: { fontSize: 11, fontWeight: '600', color: T.inkSub },
  sparkCard: {
    flex: 1,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    padding: 14,
  },
  sparkLabel: { fontSize: 11, fontWeight: '500', color: T.inkSub },
  sparkValue: { fontSize: 21, fontWeight: '800', color: T.accent, marginTop: 2, marginBottom: 12 },
  sparkRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, height: BAR_AREA_H },
  sparkBar: {
    flex: 1,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    backgroundColor: '#E6D3B4',
  },
  sparkBarMax: { backgroundColor: T.accent },

  actionBtn: {
    alignSelf: 'stretch',
    height: 52,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    shadowColor: '#C8893F',
    shadowOpacity: 0.5,
    shadowRadius: 11,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  actionBtnFriend: { backgroundColor: '#EEF4E9', shadowOpacity: 0 },
  actionText: { fontSize: 16, fontWeight: '700', color: T.white },
  actionTextFriend: { color: '#5B7A48' },
});
