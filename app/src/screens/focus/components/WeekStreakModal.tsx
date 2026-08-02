import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CharacterImage } from '@/components/character/CharacterImage';
import { useCharacter } from '@/store/CharacterContext';
import { T, withAlpha } from '@/constants/theme';
import { ConfettiBurst, type ConfettiObstacle } from '@/components/ConfettiBurst';

// 주간 스트릭 완성 축하 모달(GROMO-667) — 월~일 7일을 모두 채운 주, 일요일 결과 화면의
// ✓ 팝 뒤에 노출(주 1회). 종이폭죽은 모달과 동시에 오버레이 안에서 터진다(오스카 결정).
// 코인/재화 지급 없음(축하+스트릭 정책).
interface Props {
  visible: boolean;
  onClose: () => void;
}

export function WeekStreakModal({ visible, onClose }: Props) {
  // 카드 위치·폭(오버레이 좌표) — 컨페티가 카드를 장애물로 취급할 때 사용. 최초 1회만 기록.
  const [cardRect, setCardRect] = useState<ConfettiObstacle | null>(null);
  // 장착 캐릭터 — custom 선택 + 누끼 있으면 그 URI, 아니면 null(기본 정적 에셋).
  const { activeSource } = useCharacter();
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
          <CharacterImage size={104} sourceUri={activeSource ?? undefined} />
          <Text style={s.title}>이번 주 스트릭 완성! 🎉</Text>
          <Text style={s.sub}>월요일부터 일요일까지 하루도 빠짐없이 채웠어요</Text>
          <View style={s.weekBox}>
            <Ionicons name="flame" size={15} color={T.flame} />
            <Text style={s.weekText}>7일 연속 집중 완주</Text>
          </View>
          <TouchableOpacity style={s.cta} activeOpacity={0.85} onPress={onClose}>
            <Text style={s.ctaText}>다음 주도 함께해요!</Text>
          </TouchableOpacity>
        </View>
        {/* 종이폭죽 — 모달 등장 직후, 카드 위 레이어에서 낙하(카드에 쌓이거나 옆으로 흘러내림) */}
        {cardRect ? <ConfettiBurst obstacle={cardRect} /> : null}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: withAlpha(T.night.bottom, 0.5) },
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
  weekBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    backgroundColor: T.accentBg,
    borderRadius: 999,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.sm,
    marginTop: T.space.md,
  },
  weekText: { ...T.text.label, fontWeight: '600', color: T.accentDeep },
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
