import { Pressable, StyleSheet, Text, View } from 'react-native';
import { T } from '@/constants/theme';
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
  const moveSelection = (from: number, step: -1 | 1) => {
    const next = (from + step + GROUP_CARD_EMOJI_OPTIONS.length) % GROUP_CARD_EMOJI_OPTIONS.length;
    onChange(GROUP_CARD_EMOJI_OPTIONS[next].emoji);
  };
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="내 카드 아이콘"
      accessibilityHint="이 기기에서 나에게만 보여요. 방향키로 선택을 이동할 수 있어요."
    >
      <View style={s.grid}>
        {GROUP_CARD_EMOJI_OPTIONS.map(({ emoji, label }, index) => {
          const selected = value === emoji;
          return (
            <Pressable
              key={emoji}
              style={[s.option, selected && s.selected, disabled && s.disabled]}
              onPress={() => onChange(emoji)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityLabel={`카드 아이콘 ${label}`}
              accessibilityState={{ selected, checked: selected, disabled }}
              accessibilityActions={[
                { name: 'increment', label: '다음 아이콘' },
                { name: 'decrement', label: '이전 아이콘' },
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
            </Pressable>
          );
        })}
      </View>
      <Text style={s.notice}>이 기기에서 나에게만 보여요</Text>
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
  notice: { ...T.text.caption, color: T.inkSub, marginTop: T.space.md },
});
