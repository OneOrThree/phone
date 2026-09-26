import React, { useContext, useEffect, useState, type ReactNode } from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType, type ViewStyle } from 'react-native';
import { MotionContext } from '@/design-system/primitives';
import { Text } from '@/design-system/typography';
import { componentTokens, semanticTokens } from '@/design-system/tokens';

export type ObservatoryRankState = 'normal' | 'rank-updated' | 'rank-changed';
export type ObservatoryDayNight = 'day' | 'night';

const frames: readonly ImageSourcePropType[] = [
  require('@/assets/village-world/motion/observatory/frame-0.png'),
  require('@/assets/village-world/motion/observatory/frame-1.png'),
  require('@/assets/village-world/motion/observatory/frame-2.png'),
  require('@/assets/village-world/motion/observatory/frame-3.png'),
];
const sequence = [0, 1, 2, 3] as const;
const frameDuration = 220;

/** 전망대 망원경의 4프레임 줌/조리개 idle 모션과 랭킹 상태를 표시한다. */
export function VillageObservatoryMotion({
  rankState = 'normal',
  dayNight = 'day',
  generation = 0,
  showFrames = true,
  entryActive = false,
  entryTooltip,
  indicatorScale = 1,
  reduceMotion = false,
  style,
  testID = 'village-observatory-motion',
}: {
  rankState?: ObservatoryRankState;
  dayNight?: ObservatoryDayNight;
  generation?: number;
  showFrames?: boolean;
  entryActive?: boolean;
  entryTooltip?: ReactNode;
  indicatorScale?: number;
  reduceMotion?: boolean;
  style?: ViewStyle;
  testID?: string;
}) {
  const motionDisabled = useContext(MotionContext) || reduceMotion;
  const [frame, setFrame] = useState(0);
  const rankLabel =
    rankState === 'rank-updated'
      ? '주간 순위가 갱신되었습니다'
      : rankState === 'rank-changed'
        ? '주간 순위가 변동되었습니다'
        : undefined;

  useEffect(() => {
    setFrame(0);
    if (motionDisabled || (generation === 0 && rankState === 'normal')) return;
    let sequenceIndex = 0;
    const timer = setInterval(() => {
      sequenceIndex = (sequenceIndex + 1) % sequence.length;
      setFrame(sequence[sequenceIndex]);
      if (sequenceIndex === sequence.length - 1) clearInterval(timer);
    }, frameDuration);
    return () => clearInterval(timer);
  }, [dayNight, generation, motionDisabled, rankState]);

  return (
    <View
      testID={testID}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={[styles.root, style]}
    >
      {showFrames &&
        frames.map((source, index) => (
          <Image
            key={index}
            testID={`village-observatory-frame-${index}`}
            source={source}
            resizeMode="stretch"
            style={[styles.frame, frame === index ? styles.visible : styles.hidden]}
          />
        ))}
      {rankLabel && (
        <View
          testID="village-observatory-rank-indicator"
          style={[
            styles.badge,
            {
              width: componentTokens.villageNotificationBadge.diameter * indicatorScale,
              height: componentTokens.villageNotificationBadge.diameter * indicatorScale,
              borderRadius: componentTokens.villageNotificationBadge.radius * indicatorScale,
              borderWidth: componentTokens.villageNotificationBadge.borderWidth * indicatorScale,
            },
          ]}
        >
          <Text
            style={[
              styles.badgeText,
              { fontSize: 15 * indicatorScale, lineHeight: 18 * indicatorScale },
            ]}
          >
            !
          </Text>
        </View>
      )}
      {entryActive && dayNight === 'night' && (
        <>
          <View
            testID="village-observatory-entry-highlight"
            pointerEvents="none"
            style={styles.entryHighlight}
          />
          <View
            testID="village-observatory-entry-feedback"
            pointerEvents="none"
            style={styles.entryFeedback}
          >
            {entryTooltip}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', height: '100%', position: 'relative' },
  frame: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
  visible: { opacity: 1 },
  hidden: { opacity: 0 },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    paddingHorizontal: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: componentTokens.badge.default.background,
    borderColor: componentTokens.badge.default.border,
  },
  badgeText: {
    color: componentTokens.badge.default.foreground,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 18,
  },
  entryHighlight: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    borderWidth: semanticTokens.stroke.strong,
    borderColor: semanticTokens.color.accent,
    borderRadius: semanticTokens.radius.preview,
  },
  entryFeedback: {
    position: 'absolute',
    alignSelf: 'center',
    top: -30,
    maxWidth: 180,
    paddingHorizontal: semanticTokens.spacing.control,
    paddingVertical: semanticTokens.spacing.control,
    backgroundColor: semanticTokens.color.surface,
    borderColor: semanticTokens.color.outline,
    borderWidth: semanticTokens.stroke.default,
    borderRadius: semanticTokens.radius.control,
  },
});
