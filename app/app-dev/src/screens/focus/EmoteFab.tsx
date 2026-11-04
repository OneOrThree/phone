import { C, art } from '@/design-system/patterns';
import { componentTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import { OUTLINE } from '@/screens/focus/FishingIsland';
import { useEffect } from 'react';
import { Image, Pressable, View } from 'react-native';

/** 응원 이모트 부채꼴 + 버튼 — 주민 집중 화면(FocusFlow)에서만 쓴다. 부모가 위치를 잡는다. `disabled` 는 지금 넘기는 곳이 없다(방문자 구경 화면에서 쓰던 모양, DESIGN.md §8.3). */
export function EmoteFab({
  fan,
  setFan,
  emote,
  onSend,
  disabled = false,
  onDisabledPress,
}: {
  fan: boolean;
  setFan: (v: boolean) => void;
  emote: string | null;
  onSend: (id: string) => void;
  /** 보낼 수 없는 상태 — 흐리게 그리고, 누르면 부채꼴 대신 onDisabledPress(안내)만 부른다. */
  disabled?: boolean;
  onDisabledPress?: () => void;
}) {
  const circle = (d: number, bg: string) => ({
    width: d,
    height: d,
    borderRadius: d / 2,
    borderWidth: 2,
    borderColor: OUTLINE,
    backgroundColor: bg,
    boxShadow: `0px 4px 0px ${OUTLINE}`,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  });
  // 비활성이 되는 순간 접는다 — 부채꼴은 숨겨도 fan 이 true 로 남으면 다시 활성이 될 때 저절로 펼쳐진다.
  useEffect(() => {
    if (disabled) setFan(false);
  }, [disabled, setFan]);
  return (
    <>
      {fan && !disabled && (
        <View style={{ position: 'absolute', left: 0, bottom: 64, flexDirection: 'row', gap: 6 }}>
          {['hello', 'cheer', 'sleepy', 'laugh', 'hearts'].map((id) => (
            <Pressable
              key={id}
              testID={`emote-${id}`}
              accessibilityRole="button"
              accessibilityLabel={t(`focusFlow.hud.emote.${id}`)}
              onPress={() => onSend(id)}
              style={circle(46, C.paper)}
            >
              <Image source={art[`emote/${id}`]} style={{ width: 30, height: 30 }} />
            </Pressable>
          ))}
        </View>
      )}
      <Pressable
        testID="emote-fab"
        accessibilityRole="button"
        accessibilityLabel={t('focusFlow.hud.emoteFab')}
        accessibilityHint={disabled ? t('focusFlow.hud.emoteNoOneFocusing') : undefined}
        accessibilityState={{ expanded: fan, disabled }}
        onPress={() => (disabled ? onDisabledPress?.() : setFan(!fan))}
        style={[
          circle(52, C.butter),
          disabled && { opacity: componentTokens.button.disabledOpacity, boxShadow: 'none' },
        ]}
      >
        <Image source={art[`emote/${emote ?? 'hello'}`]} style={{ width: 32, height: 32 }} />
      </Pressable>
    </>
  );
}
