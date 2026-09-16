import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { T } from '@/constants/theme';
import { t } from '@/i18n';
import { GROUP_CARD_EMOJI_OPTIONS, type GroupCardEmoji } from '../groupCardEmojiStore';

interface Props {
  value: GroupCardEmoji;
  onChange: (emoji: GroupCardEmoji) => void;
  testIDPrefix?: string;
  disabled?: boolean;
}

export function GroupCardEmojiPicker({
  value,
  onChange,
  testIDPrefix = 'group.cardEmoji',
  disabled = false,
}: Props) {
  const optionRefs = useRef<Array<{ focus?: () => void } | null>>([]);
  const moveSelection = (from: number, step: -1 | 1) => {
    const next = (from + step + GROUP_CARD_EMOJI_OPTIONS.length) % GROUP_CARD_EMOJI_OPTIONS.length;
    onChange(GROUP_CARD_EMOJI_OPTIONS[next].emoji);
    optionRefs.current[next]?.focus?.();
  };
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('group.groupCardEmojiPicker.title')}
      accessibilityHint={t('group.groupCardEmojiPicker.hint')}
    >
      <View style={s.grid}>
        {GROUP_CARD_EMOJI_OPTIONS.map(({ emoji, labelKey }, index) => {
          const selected = value === emoji;
          return (
            <Pressable
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              key={emoji}
              style={[s.option, selected && s.selected, disabled && s.disabled]}
              onPress={() => onChange(emoji)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityLabel={t('group.groupCardEmojiPicker.optionA11y', {
                label: t(labelKey),
              })}
              accessibilityState={{ selected, checked: selected, disabled }}
              accessibilityActions={[
                { name: 'increment', label: t('group.groupCardEmojiPicker.nextIcon') },
                { name: 'decrement', label: t('group.groupCardEmojiPicker.prevIcon') },
              ]}
              onAccessibilityAction={(event) => {
                if (disabled) return;
                if (event.nativeEvent.actionName === 'increment') moveSelection(index, 1);
                if (event.nativeEvent.actionName === 'decrement') moveSelection(index, -1);
              }}
              {...({
                onKeyDown: (event: { nativeEvent: { key?: string } }) => {
                  if (disabled) return;
                  const key = event.nativeEvent.key;
                  if (key === 'ArrowRight' || key === 'ArrowDown') moveSelection(index, 1);
                  if (key === 'ArrowLeft' || key === 'ArrowUp') moveSelection(index, -1);
                  if (key === 'Enter' || key === ' ') onChange(emoji);
                },
              } as object)}
              testID={`${testIDPrefix}.${emoji}`}
            >
              <Text style={s.emoji}>{emoji}</Text>
              {selected && (
                <Text style={s.check} accessible={false} testID={`${testIDPrefix}.${emoji}.check`}>
                  ✓
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
      <Text style={s.notice}>{t('group.groupCardEmojiPicker.notice')}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: T.space.sm },
  option: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.paperAlt,
    borderWidth: 1,
    borderColor: T.border,
  },
  selected: { borderWidth: 2, borderColor: T.accent, backgroundColor: T.accentBg },
  disabled: { opacity: 0.5 },
  emoji: { fontSize: 26 },
  check: {
    position: 'absolute',
    right: 3,
    bottom: 1,
    color: T.accent,
    fontSize: 14,
    fontWeight: '900',
  },
  notice: { ...T.text.caption, color: T.inkSub, marginTop: T.space.md },
});
