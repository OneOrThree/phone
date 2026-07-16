import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CharacterImage } from '@/components/character/CharacterImage';
import { ConfettiBurst, type ConfettiObstacle } from '@/components/ConfettiBurst';
import { T, withAlpha } from '@/constants/theme';

// 포커스 목표 달성 축하 모달(GROMO-630) — 오늘 누적 집중이 목표를 처음 채운 순간 결과 화면에서
// 1회 노출. 코인/재화 지급 없음(목표 보상 = 축하 + 스트릭 정책). 표시는 '연속 목표달성'만 —
// '연속 공부'(하루 10분 스트릭)와는 다른 개념이라 이 모달에는 섞지 않는다.
interface Props {
  visible: boolean;
  goalStreakDays: number; // 오늘 포함 연속 목표달성 일수
  goalMinutes?: number; // 달성한 목표 시간(분) — 제목에 "N시간 집중 목표 달성!" 표기
  onClose: () => void;
}

// 분 → "5시간" / "1시간 30분" / "30분" (축하 제목용 — 00:00:00 표기보다 문장에 자연스러움)
function goalLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}

export function GoalCelebrationModal({ visible, goalStreakDays, goalMinutes, onClose }: Props) {
  const [cardRect, setCardRect] = useState<ConfettiObstacle | null>(null);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose} />
        <View
          style={s.card}
          onLayout={(e) => {
            const { x, y, width } = e.nativeEvent.layout;
            setCardRect((prev) => prev ?? { x, y, width });
          }}
        >
          <View style={s.streakBox}>
            <Ionicons name="ribbon" size={15} color={T.accentDeep} />
            <Text style={s.streakText}>
              연속 목표달성 <Text style={s.streakDays}>{goalStreakDays}일</Text>
            </Text>
          </View>
          <CharacterImage size={104} />
          <Text style={s.title}>
            {goalMinutes ? `${goalLabel(goalMinutes)} 집중 목표 달성!` : '오늘 목표 달성!'}
          </Text>
          <Text style={s.sub}>내일도 힘내서 목표 달성해요!</Text>
          <TouchableOpacity style={s.cta} activeOpacity={0.85} onPress={onClose}>
            <Text style={s.ctaText}>좋아요!</Text>
          </TouchableOpacity>
        </View>
        {cardRect ? <ConfettiBurst obstacle={cardRect} /> : null}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: withAlpha(T.night.bottom, 0.5) },
  card: {
    alignSelf: 'stretch',
    alignItems: 'center',
    backgroundColor: T.white,
    borderRadius: 24,
    paddingHorizontal: T.space.xxl,
    paddingTop: 28,
    paddingBottom: T.space.xl,
    gap: T.space.sm,
  },
  title: { ...T.text.subtitle, fontSize: 20, color: T.ink, marginTop: T.space.md },
  sub: { ...T.text.label, fontWeight: '500', color: T.inkSub, textAlign: 'center' },
  streakBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    backgroundColor: T.accentBg,
    borderRadius: 999,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.sm,
  },
  streakText: { ...T.text.label, fontWeight: '600', color: T.accentDeep },
  streakDays: { fontWeight: '800' },
  cta: {
    alignSelf: 'stretch',
    backgroundColor: T.accent,
    borderRadius: 14,
    paddingVertical: T.space.lg,
    alignItems: 'center',
    marginTop: T.space.lg,
  },
  ctaText: { ...T.text.subtitle, color: T.white },
});
