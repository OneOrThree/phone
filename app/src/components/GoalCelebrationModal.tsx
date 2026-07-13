import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CharacterImage } from '@/components/character/CharacterImage';
import { T, withAlpha } from '@/constants/theme';

// 포커스 목표 달성 축하 모달(GROMO-630) — 오늘 누적 집중이 목표를 처음 채운 순간 결과 화면에서
// 1회 노출. 코인/재화 지급 없음(목표 보상 = 축하 + 스트릭 정책). 표시는 '연속 목표달성'만 —
// '연속 공부'(하루 10분 스트릭)와는 다른 개념이라 이 모달에는 섞지 않는다.
interface Props {
  visible: boolean;
  goalStreakDays: number; // 오늘 포함 연속 목표달성 일수
  onClose: () => void;
}

export function GoalCelebrationModal({ visible, goalStreakDays, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={s.card}>
          <CharacterImage size={104} />
          <Text style={s.title}>오늘 목표 달성! 🎉</Text>
          <Text style={s.sub}>정한 만큼 다 채웠어. 오늘 진짜 멋졌어!</Text>
          <View style={s.streakBox}>
            <Ionicons name="ribbon" size={15} color={T.accentDeep} />
            <Text style={s.streakText}>
              연속 목표달성 <Text style={s.streakDays}>{goalStreakDays}일</Text>
            </Text>
          </View>
          <TouchableOpacity style={s.cta} activeOpacity={0.85} onPress={onClose}>
            <Text style={s.ctaText}>내일도 같이 하자</Text>
          </TouchableOpacity>
        </View>
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
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 20,
    gap: 6,
  },
  title: { ...T.text.subtitle, fontSize: 20, color: T.ink, marginTop: 10 },
  sub: { ...T.text.label, fontWeight: '500', color: T.inkSub, textAlign: 'center' },
  streakBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: T.accentBg,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 10,
  },
  streakText: { ...T.text.label, fontWeight: '600', color: T.accentDeep },
  streakDays: { fontWeight: '800' },
  cta: {
    alignSelf: 'stretch',
    backgroundColor: T.accent,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 14,
  },
  ctaText: { ...T.text.subtitle, color: T.white },
});
