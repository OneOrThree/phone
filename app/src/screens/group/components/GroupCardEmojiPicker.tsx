import { Pressable, StyleSheet, Text, View } from 'react-native';
import { T } from '@/constants/theme';
import { GROUP_CARD_EMOJIS, type GroupCardEmoji } from '../groupCardEmojiStore';

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
  return (
    <View accessibilityRole="radiogroup">
      <View style={s.grid}>
        {GROUP_CARD_EMOJIS.map((emoji) => {
          const selected = value === emoji;
          return (
            <Pressable
              key={emoji}
              style={[s.option, selected && s.selected]}
              onPress={() => onChange(emoji)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityLabel={`카드 아이콘 ${emoji}`}
              accessibilityState={{ selected, disabled }}
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
  emoji: { fontSize: 26 },
  notice: { ...T.text.caption, color: T.inkSub, marginTop: T.space.md },
});
