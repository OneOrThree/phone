import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import {
  ConstructionBuildingSprite,
  type ConstructionBuildingId,
  type ConstructionPhase,
} from '@/components/ConstructionBuildingSprite';

const buildings: ReadonlyArray<{ id: ConstructionBuildingId; name: string; minutes: number }> = [
  { id: 'hall', name: '회관', minutes: 1 },
  { id: 'board', name: '게시판', minutes: 15 },
  { id: 'gram', name: '축음기', minutes: 30 },
  { id: 'library', name: '도서관', minutes: 60 },
  { id: 'mail', name: '우편함', minutes: 90 },
  { id: 'tower', name: '시계탑', minutes: 150 },
  { id: 'shop', name: '상점', minutes: 240 },
];

const phases: ReadonlyArray<{ id: ConstructionPhase; label: string; range: string }> = [
  { id: 'foundation', label: '기초 공사', range: '0–15%' },
  { id: 'structure', label: '골조 공사', range: '15–75%' },
  { id: 'finishing', label: '마감 공사', range: '75–100%' },
  { id: 'completion', label: '완공 대기', range: '서버 확인' },
];

export function ConstructionMotionPreview() {
  const { width } = useWindowDimensions();
  const [phase, setPhase] = useState<ConstructionPhase>('foundation');
  const [reduceMotion, setReduceMotion] = useState(false);
  const [night, setNight] = useState(false);
  const columns = width >= 1180 ? 4 : width >= 760 ? 3 : width >= 500 ? 2 : 1;
  const cardWidth = Math.min(270, Math.max(210, (width - 64 - (columns - 1) * 16) / columns));

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <View style={styles.headingRow}>
        <View>
          <Text style={styles.eyebrow}>SPRITE MOTION DEMO</Text>
          <Text style={styles.title}>섬 건물 공사 모션</Text>
          <Text style={styles.subtitle}>
            서버 공사 시간의 진행률에 따라 같은 단계가 건물별로 반복 재생됩니다.
          </Text>
        </View>
        <View style={styles.toggleRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: night }}
            testID="toggle-night"
            onPress={() => setNight((current) => !current)}
            style={[styles.reduceButton, night && styles.selectedButton]}
          >
            <Text style={[styles.reduceButtonText, night && styles.selectedButtonText]}>
              {night ? '밤 · 모션 꺼짐' : '낮'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            testID="toggle-reduce-motion"
            onPress={() => setReduceMotion((current) => !current)}
            style={[styles.reduceButton, reduceMotion && styles.selectedButton]}
          >
            <Text style={[styles.reduceButtonText, reduceMotion && styles.selectedButtonText]}>
              Reduce Motion {reduceMotion ? 'ON' : 'OFF'}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.phaseRow}>
        {phases.map((item) => {
          const selected = phase === item.id;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              testID={`phase-${item.id}`}
              onPress={() => setPhase(item.id)}
              style={[styles.phaseButton, selected && styles.selectedButton]}
            >
              <Text style={[styles.phaseLabel, selected && styles.selectedButtonText]}>
                {item.label}
              </Text>
              <Text style={[styles.phaseRange, selected && styles.selectedButtonText]}>
                {item.range}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.grid}>
        {buildings.map((building) => (
          <View key={building.id} style={[styles.card, { width: cardWidth }]}>
            <View style={[styles.spriteStage, night && styles.spriteStageNight]}>
              <View style={styles.spriteFrame}>
                <ConstructionBuildingSprite
                  building={building.id}
                  phase={phase}
                  night={night}
                  reduceMotion={reduceMotion}
                  testID={`construction-demo-${building.id}`}
                />
              </View>
            </View>
            <View style={styles.cardCopy}>
              <Text style={styles.buildingName}>{building.name}</Text>
              <Text style={styles.buildingMeta}>서버 공사 시간 {building.minutes}분</Text>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#EAF4E1' },
  content: { minHeight: '100%', paddingHorizontal: 32, paddingVertical: 28, gap: 24 },
  headingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 18,
  },
  eyebrow: { color: '#795B49', fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: '#382D27', fontSize: 32, lineHeight: 40, fontWeight: '900', marginTop: 5 },
  subtitle: { color: '#6E6259', fontSize: 14, lineHeight: 21, marginTop: 5 },
  phaseRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  phaseButton: {
    minWidth: 128,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#D9CCBE',
  },
  phaseLabel: { color: '#4C3B31', fontSize: 14, fontWeight: '800' },
  phaseRange: { color: '#8C7768', fontSize: 11, marginTop: 2 },
  toggleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  reduceButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#D9CCBE',
  },
  reduceButtonText: { color: '#4C3B31', fontSize: 13, fontWeight: '800' },
  selectedButton: { backgroundColor: '#7C9A65', borderColor: '#5E7B4A' },
  selectedButtonText: { color: '#FFFFFF' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  card: {
    overflow: 'hidden',
    borderRadius: 22,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#D9CCBE',
  },
  spriteStage: {
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#CDE7C4',
  },
  spriteStageNight: { backgroundColor: '#2E3A4F' },
  spriteFrame: { width: 190, height: 190 },
  cardCopy: { paddingHorizontal: 16, paddingVertical: 14 },
  buildingName: { color: '#382D27', fontSize: 18, fontWeight: '900' },
  buildingMeta: { color: '#806F62', fontSize: 12, marginTop: 3 },
});
