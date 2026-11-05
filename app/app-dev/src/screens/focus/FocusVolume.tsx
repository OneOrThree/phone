import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import { useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';

export function FocusVolume({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const [width, setWidth] = useState(1);
  const latest = useRef({ value, onChange, width });
  latest.current = { value, onChange, width };
  const setFromTouch = (locationX: number) =>
    latest.current.onChange(Math.max(0, Math.min(1, locationX / latest.current.width)));
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => setFromTouch(event.nativeEvent.locationX),
      onPanResponderMove: (event) => setFromTouch(event.nativeEvent.locationX),
    }),
  ).current;
  const thumbSize = semanticTokens.spacing.section;
  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={t('focusFlow.music.deviceVolume')}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) =>
        onChange(
          Math.max(
            0,
            Math.min(1, value + (event.nativeEvent.actionName === 'increment' ? 0.1 : -0.1)),
          ),
        )
      }
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      {...pan.panHandlers}
      style={{ height: semanticTokens.size.tapMin, justifyContent: 'center' }}
    >
      <View
        style={{
          height: componentTokens.progress.height,
          borderRadius: semanticTokens.radius.full,
          backgroundColor: componentTokens.progress.track,
        }}
      >
        <View
          style={{
            height: componentTokens.progress.height,
            width: `${value * 100}%`,
            borderRadius: semanticTokens.radius.full,
            backgroundColor: componentTokens.progress.fill,
          }}
        />
      </View>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: width * value - thumbSize / 2,
          top: (semanticTokens.size.tapMin - thumbSize) / 2,
          width: thumbSize,
          height: thumbSize,
          borderRadius: semanticTokens.radius.full,
          borderWidth: semanticTokens.stroke.strong,
          borderColor: semanticTokens.color.outline,
          backgroundColor: semanticTokens.color.surface,
        }}
      />
    </View>
  );
}
