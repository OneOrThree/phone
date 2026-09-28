import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import {
  ConstructionBuildingSprite,
  type ConstructionBuildingId,
  type ConstructionPhase,
} from '@/components/ConstructionBuildingSprite';
import { semanticTokens } from '@/design-system/tokens';

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
            style={[styles.toggleButton, night && styles.selectedButton]}
          >
            <Text style={[styles.toggleButtonText, night && styles.selectedButtonText]}>
              {night ? '밤 · 모션 꺼짐' : '낮'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: reduceMotion }}
            testID="toggle-reduce-motion"
            onPress={() => setReduceMotion((current) => !current)}
            style={[styles.toggleButton, reduceMotion && styles.selectedButton]}
          >
            <Text style={[styles.toggleButtonText, reduceMotion && styles.selectedButtonText]}>
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
              accessibilityState={{ selected }}
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

const color = semanticTokens.color;

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.canvas },
  content: {
    minHeight: '100%',
    paddingHorizontal: semanticTokens.spacing.page,
    paddingVertical: semanticTokens.spacing.section,
    gap: semanticTokens.spacing.section,
  },
  headingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: semanticTokens.spacing.component,
  },
  eyebrow: {
    color: color.textMuted,
    fontSize: semanticTokens.typography.caption,
    fontWeight: semanticTokens.typography.extraBold,
    letterSpacing: 1.2,
  },
  title: {
    color: color.text,
    fontSize: semanticTokens.typography.display,
    fontWeight: semanticTokens.typography.extraBold,
    marginTop: 4,
  },
  subtitle: { color: color.textMuted, fontSize: semanticTokens.typography.label, marginTop: 4 },
  toggleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: semanticTokens.spacing.control },
  phaseRow: { flexDirection: 'row', flexWrap: 'wrap', gap: semanticTokens.spacing.control },
  phaseButton: {
    minWidth: 128,
    minHeight: semanticTokens.size.tapMin,
    justifyContent: 'center',
    paddingHorizontal: semanticTokens.spacing.component,
    paddingVertical: 10,
    borderRadius: semanticTokens.radius.control,
    backgroundColor: color.surface,
    borderWidth: semanticTokens.stroke.default,
    borderColor: color.outline,
  },
  phaseLabel: {
    color: color.text,
    fontSize: semanticTokens.typography.label,
    fontWeight: semanticTokens.typography.extraBold,
  },
  phaseRange: { color: color.textMuted, fontSize: semanticTokens.typography.caption, marginTop: 2 },
  toggleButton: {
    minHeight: semanticTokens.size.tapMin,
    justifyContent: 'center',
    paddingHorizontal: semanticTokens.spacing.component,
    borderRadius: semanticTokens.radius.control,
    backgroundColor: color.surface,
    borderWidth: semanticTokens.stroke.default,
    borderColor: color.outline,
  },
  toggleButtonText: {
    color: color.text,
    fontSize: semanticTokens.typography.label,
    fontWeight: semanticTokens.typography.extraBold,
  },
  selectedButton: { backgroundColor: color.primary },
  selectedButtonText: { color: color.onPrimary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: semanticTokens.spacing.component },
  card: {
    overflow: 'hidden',
    borderRadius: semanticTokens.radius.card,
    backgroundColor: color.surface,
    borderWidth: semanticTokens.stroke.default,
    borderColor: color.outline,
  },
  spriteStage: {
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.secondary,
  },
  spriteStageNight: { backgroundColor: semanticTokens.nightColor.canvas },
  spriteFrame: { width: 190, height: 190 },
  cardCopy: {
    paddingHorizontal: semanticTokens.spacing.component,
    paddingVertical: semanticTokens.spacing.control,
  },
  buildingName: {
    color: color.text,
    fontSize: semanticTokens.typography.title,
    fontWeight: semanticTokens.typography.extraBold,
  },
  buildingMeta: {
    color: color.textMuted,
    fontSize: semanticTokens.typography.caption,
    marginTop: 2,
  },
});
