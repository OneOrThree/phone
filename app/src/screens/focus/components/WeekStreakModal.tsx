import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CharacterImage } from '@/components/character/CharacterImage';
import { T, withAlpha } from '@/constants/theme';

// 주간 스트릭 완성 축하 모달(GROMO-667) — 월~일 7일을 모두 채운 주, 일요일 결과 화면의
// ✓ 팝 → 종이폭죽 연출 뒤에 노출(주 1회). 코인/재화 지급 없음(축하+스트릭 정책).
interface Props {
  visible: boolean;
  onClose: () => void;
}

export function WeekStreakModal({ visible, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={s.card}>
          <CharacterImage size={104} />
          <Text style={s.title}>이번 주 스트릭 완성! 🎉</Text>
          <Text style={s.sub}>월요일부터 일요일까지 하루도 빠짐없이 채웠어요</Text>
          <View style={s.weekBox}>
            <Ionicons name="flame" size={15} color={T.accentDeep} />
            <Text style={s.weekText}>7일 연속 집중 완주</Text>
          </View>
          <TouchableOpacity style={s.cta} activeOpacity={0.85} onPress={onClose}>
            <Text style={s.ctaText}>다음 주도 함께해요!</Text>
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
  weekBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: T.accentBg,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 10,
  },
  weekText: { ...T.text.label, fontWeight: '600', color: T.accentDeep },
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
