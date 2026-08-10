import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { T } from '@/constants/theme';

interface FindMoreCardProps {
  width: number;
  position: number;
  pageCount: number;
  onPress: () => void;
}

/**
 * 캐러셀 끝에만 붙는 탐색 진입점이다.
 * 서버 그룹 배열이나 로컬 순서 배열에 sentinel로 넣지 않는다.
 */
export function FindMoreCard({ width, position, pageCount, onPress }: FindMoreCardProps) {
  return (
    <Pressable
      style={[s.card, { width }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`그룹 찾기, 현재 ${position}/${pageCount} 페이지`}
      testID="group.deck.findMore"
    >
      <View style={s.icon}>
        <Ionicons name="search" size={24} color={T.accent} />
      </View>
      <Text style={s.title}>그룹 찾기</Text>
      <Text style={s.desc}>같이 공부할 그룹을 더 찾아봐요</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    minHeight: 300,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.sm,
    backgroundColor: T.paperAlt,
    borderWidth: 1,
    borderColor: T.border,
    borderStyle: 'dashed',
  },
  icon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accentBg,
  },
  title: { ...T.text.subtitle, color: T.ink },
  desc: { ...T.text.caption, color: T.inkSub },
});
