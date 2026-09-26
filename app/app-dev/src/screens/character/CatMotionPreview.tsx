import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { CatSprite } from '@/components/CatSprite';
import { Text } from '@/design-system/typography';
import { semanticTokens } from '@/design-system/tokens';
import { colors, colorNames } from '@/services/model';

const motions = [
  ['idle', '자동 대기'],
  ['walking', '걷기'],
  ['blink', '눈 깜박임'],
  ['tilt', '갸웃'],
  ['yawn', '하품'],
  ['stretch', '기지개'],
  ['groom', '그루밍'],
  ['focus', '집중'],
  ['cast', '낚싯대 던지기'],
  ['reading', '독서'],
  ['reel', '낚아올리기'],
] as const;

// 앱과 같은 렌더러를 사용한다. 웹의 ?motion 에서 계정·저장 데이터 없이 확인한다.
export function CatMotionPreview() {
  const [motion, setMotion] = useState<(typeof motions)[number][0]>('idle');
  const [reduce, setReduce] = useState(false);
  const [left, setLeft] = useState(false);
  const [generation, setGeneration] = useState(0);
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>GROMO · 캐릭터 모션</Text>
      <Text accessibilityRole="header" style={styles.title}>
        고양이의 작은 움직임
      </Text>
      <Text style={styles.description}>
        여섯 고양이의 동작을 골라보세요. 자동 대기에서는 눈을 깜박이거나 가볍게 몸을 움직입니다.
      </Text>
      <View style={styles.toolbar}>
        {motions.map(([value, label]) => (
          <Pressable
            key={value}
            testID={`motion-${value}`}
            accessibilityRole="button"
            accessibilityState={{ selected: motion === value }}
            onPress={() => {
              setMotion(value);
              setGeneration((v) => v + 1);
            }}
            style={[styles.button, motion === value && styles.selected]}
          >
            <Text style={styles.buttonText}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.options}>
        <View style={styles.option}>
          <Switch
            testID="motion-reduce"
            accessibilityLabel="모션 줄이기"
            value={reduce}
            onValueChange={setReduce}
          />
          <Text style={styles.optionText}>모션 줄이기</Text>
        </View>
        <View style={styles.option}>
          <Switch
            testID="motion-left"
            accessibilityLabel="왼쪽 보기"
            value={left}
            onValueChange={setLeft}
          />
          <Text style={styles.optionText}>왼쪽 보기</Text>
        </View>
      </View>
      <View style={styles.grid}>
        {colors.map((color, index) => (
          <View key={color} testID={`motion-card-${color}`} style={styles.card}>
            <View style={styles.stage}>
              <View style={styles.ground} />
              <View style={styles.anchor}>
                <CatSprite
                  key={generation}
                  testID={`motion-cat-${color}`}
                  color={color}
                  motion={motion}
                  size={160}
                  reduce={reduce}
                  left={left}
                />
              </View>
            </View>
            <Text style={styles.name}>{colorNames[index]}</Text>
            <Text style={styles.caption}>{motions.find(([v]) => v === motion)?.[1]}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.footer}>
        집중 중에는 집중 동작을 유지합니다. 모션 줄이기를 켜거나 앱이 백그라운드로 전환되면 one-shot
        동작은 즉시 완료됩니다.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: semanticTokens.color.canvas },
  content: {
    width: '100%',
    maxWidth: 1100,
    alignSelf: 'center',
    padding: semanticTokens.spacing.section,
    paddingVertical: 40,
  },
  eyebrow: {
    fontSize: semanticTokens.typography.caption,
    letterSpacing: 2,
    color: semanticTokens.color.textMuted,
    marginBottom: semanticTokens.spacing.control,
  },
  title: {
    fontSize: 30,
    fontWeight: semanticTokens.typography.extraBold,
    color: semanticTokens.color.text,
  },
  description: {
    fontSize: 15,
    lineHeight: 24,
    color: semanticTokens.color.textMuted,
    marginTop: semanticTokens.spacing.control,
    maxWidth: 680,
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: semanticTokens.spacing.section,
  },
  button: {
    minHeight: semanticTokens.size.tapMin,
    justifyContent: 'center',
    paddingHorizontal: semanticTokens.spacing.component,
    borderRadius: semanticTokens.radius.control,
    borderWidth: semanticTokens.stroke.subtle,
    borderColor: semanticTokens.color.divider,
    backgroundColor: semanticTokens.color.surface,
  },
  selected: {
    backgroundColor: semanticTokens.color.selected,
    borderColor: semanticTokens.color.outline,
  },
  buttonText: {
    color: semanticTokens.color.text,
    fontSize: semanticTokens.typography.label,
    fontWeight: semanticTokens.typography.semibold,
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: semanticTokens.spacing.section,
    marginVertical: semanticTokens.spacing.section,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: semanticTokens.size.tapMin,
  },
  optionText: {
    color: semanticTokens.color.textMuted,
    fontSize: semanticTokens.typography.label,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: semanticTokens.spacing.component,
  },
  card: {
    flexGrow: 1,
    flexBasis: 260,
    backgroundColor: semanticTokens.color.surface,
    borderRadius: semanticTokens.radius.card,
    borderWidth: semanticTokens.stroke.subtle,
    borderColor: semanticTokens.color.divider,
    paddingBottom: semanticTokens.spacing.page,
    alignItems: 'center',
  },
  stage: { width: 230, height: 215 },
  anchor: { position: 'absolute', left: 115, top: 190 },
  ground: {
    position: 'absolute',
    left: 65,
    top: 183,
    width: 100,
    height: 12,
    borderRadius: 50,
    backgroundColor: semanticTokens.color.canvas,
  },
  name: {
    color: semanticTokens.color.text,
    fontWeight: semanticTokens.typography.bold,
    fontSize: 17,
  },
  caption: {
    color: semanticTokens.color.textMuted,
    fontSize: semanticTokens.typography.caption,
    marginTop: 5,
  },
  footer: {
    fontSize: semanticTokens.typography.caption,
    lineHeight: 20,
    color: semanticTokens.color.textMuted,
    marginTop: semanticTokens.spacing.section,
  },
});
