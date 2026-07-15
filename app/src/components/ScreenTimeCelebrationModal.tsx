import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CharacterImage } from '@/components/character/CharacterImage';
import { T, withAlpha } from '@/constants/theme';

// 스크린타임 목표 달성 축하 모달(GROMO-629) — 어제 사용 시간이 목표 이내였으면 그날 첫 홈 진입에
// 1회 노출. 코인/재화 지급 없음(축하 + 스트릭 정책). 모양은 포커스 목표 축하(GoalCelebrationModal)
// 와 동일 — 문구만 스크린타임용. '연속 목표달성'만 표시한다.
interface Props {
  visible: boolean;
  streakDays: number; // 어제 포함 연속 목표달성 일수
  goalMinutes?: number; // 어제 목표 사용 시간(분) — "N시간 이내로 사용하기 성공" 문구용
  onClose: () => void;
}

// 분 → "3시간" / "3시간 30분" / "30분" (목표 시간 문장 표기용)
function goalLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}

export function ScreenTimeCelebrationModal({ visible, streakDays, goalMinutes, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={s.card}>
          <CharacterImage size={104} />
          <Text style={s.title}>어제 핸드폰 사용 시간 목표를 달성했어요! 🎉</Text>
          <Text style={s.sub}>
            {goalMinutes
              ? `${goalLabel(goalMinutes)} 이내로 사용하기 성공했어요.`
              : '목표 이내로 사용하기 성공했어요.'}
            {'\n'}오늘도 화이팅!
          </Text>
          <View style={s.streakBox}>
            <Ionicons name="ribbon" size={15} color={T.accentDeep} />
            <Text style={s.streakText}>
              연속 목표달성 <Text style={s.streakDays}>{streakDays}일</Text>
            </Text>
          </View>
          <TouchableOpacity style={s.cta} activeOpacity={0.85} onPress={onClose}>
            <Text style={s.ctaText}>좋아요!</Text>
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
