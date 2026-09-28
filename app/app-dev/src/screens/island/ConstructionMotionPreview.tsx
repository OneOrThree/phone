import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import {
  ConstructionBuildingSprite,
  type ConstructionBuildingId,
  type ConstructionPhase,
} from '@/components/ConstructionBuildingSprite';
import { Seg, Toggle } from '@/design-system/patterns';
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
  const { page, component } = semanticTokens.spacing;
  const cardWidth = Math.min(
    270,
    Math.max(210, (width - page * 2 - (columns - 1) * component) / columns),
  );
  const current = phases.find((item) => item.id === phase)!;

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
          <Seg
            inset
            items={['낮', '밤']}
            value={night ? '밤' : '낮'}
            onChange={(value: string) => setNight(value === '밤')}
            style={styles.dayNight}
          />
          <View style={styles.reduceRow}>
            <Text style={styles.reduceLabel}>Reduce Motion</Text>
            <Toggle label="Reduce Motion" value={reduceMotion} onChange={setReduceMotion} />
          </View>
        </View>
      </View>

      <View style={styles.phaseRow}>
        <Seg
          inset
          items={phases.map((item) => item.label)}
          value={current.label}
          onChange={(label: string) =>
            setPhase(phases.find((item) => item.label === label)?.id ?? 'foundation')
          }
        />
        <Text style={styles.phaseRange}>
          진행률 {current.range}
          {night ? ' · 밤에는 공사 모션을 재생하지 않습니다' : ''}
        </Text>
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
  toggleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: semanticTokens.spacing.component,
  },
  dayNight: { width: 160 },
  reduceRow: {
    minHeight: semanticTokens.size.tapMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: semanticTokens.spacing.control,
  },
  reduceLabel: {
    color: color.text,
    fontSize: semanticTokens.typography.label,
    fontWeight: semanticTokens.typography.bold,
  },
  phaseRow: { gap: semanticTokens.spacing.control },
  phaseRange: { color: color.textMuted, fontSize: semanticTokens.typography.caption },
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
