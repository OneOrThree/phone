import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View, type GestureResponderHandlers } from 'react-native';
import { T } from '@/constants/theme';
import type { GroupSummaryResponse } from '@/types/dto/group';

interface GroupCardFrontProps {
  group: GroupSummaryResponse;
  emoji?: string;
  emojiLabel?: string;
  position?: number;
  pageCount?: number;
  onFlip: () => void;
  reorderHandlers?: GestureResponderHandlers;
  onMoveStep?: (step: -1 | 1) => void;
  canMovePrevious?: boolean;
  canMoveNext?: boolean;
}

export function GroupCardFront({
  group,
  emoji = '🎯',
  emojiLabel = '과녁',
  position = 1,
  pageCount = 1,
  onFlip,
  reorderHandlers,
  onMoveStep,
  canMovePrevious = false,
  canMoveNext = false,
}: GroupCardFrontProps) {
  const privacyLabel = group.isPrivate ? '비밀방' : '공개방';

  return (
    <View style={s.root} testID={`group.card.front.${group.groupId}`}>
      <View
        style={s.grip}
        testID={`group.card.grip.${group.groupId}`}
        accessibilityRole="adjustable"
        accessibilityLabel={`${group.name} 카드 순서`}
        accessibilityHint="드래그하거나 접근성 동작으로 순서를 바꿉니다"
        accessibilityActions={[
          ...(canMovePrevious ? [{ name: 'decrement' as const, label: '앞으로 이동' }] : []),
          ...(canMoveNext ? [{ name: 'increment' as const, label: '뒤로 이동' }] : []),
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'decrement' && canMovePrevious) onMoveStep?.(-1);
          if (event.nativeEvent.actionName === 'increment' && canMoveNext) onMoveStep?.(1);
        }}
        {...reorderHandlers}
      >
        <MaterialCommunityIcons name="drag-horizontal-variant" size={24} color={T.white} />
      </View>
      <Pressable
        style={s.body}
        onPress={onFlip}
        accessibilityRole="button"
        accessibilityLabel={`${group.name}, 내 카드 아이콘 ${emojiLabel}, ${privacyLabel}, ${group.role === 'OWNER' ? '방장, ' : ''}${group.currentMembers}/${group.maxMembers}명, 현재 ${position}/${pageCount} 페이지`}
        accessibilityHint="두 번 탭하면 이 카드의 방 요약을 봅니다"
        testID={`group.card.${group.groupId}`}
      >
        <View style={s.art}>
          <View style={s.privacyPill}>
            <MaterialCommunityIcons
              name={group.isPrivate ? 'lock' : 'earth'}
              size={12}
              color={T.white}
            />
            <Text style={s.pillText}>{privacyLabel}</Text>
          </View>
          <View style={s.emojiFrame}>
            <Text style={s.emoji} testID={`group.list.emoji.${group.groupId}`}>
              {emoji}
            </Text>
          </View>
        </View>

        <View style={s.info}>
          <View style={s.nameRow}>
            <Text style={s.name} numberOfLines={1} ellipsizeMode="tail">
              {group.name}
            </Text>
            {group.role === 'OWNER' && (
              <View style={s.ownerChip}>
                <Text style={s.ownerText}>방장</Text>
              </View>
            )}
          </View>
          {!!group.description && (
            <Text style={s.desc} numberOfLines={2}>
              {group.description}
            </Text>
          )}
          <View style={s.footer}>
            <Text style={s.count}>
              {group.currentMembers}/{group.maxMembers}
            </Text>
            <View style={s.flipHint}>
              <Text style={s.flipText}>뒤집어 방 보기</Text>
              <MaterialCommunityIcons name="rotate-3d-variant" size={14} color={T.inkSub} />
            </View>
          </View>
        </View>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, minHeight: 300, borderRadius: 22, overflow: 'hidden' },
  body: { flex: 1 },
  grip: {
    position: 'absolute',
    top: T.space.sm,
    right: T.space.md,
    zIndex: 2,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  art: {
    flex: 1,
    minHeight: 170,
    padding: T.space.lg,
    backgroundColor: T.accent,
  },
  privacyPill: {
    alignSelf: 'flex-start',
    height: 24,
    paddingHorizontal: T.space.sm,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.xs,
    backgroundColor: T.accentDeep,
  },
  pillText: { ...T.text.caption, color: T.white },
  emojiFrame: {
    alignSelf: 'center',
    marginVertical: 'auto',
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accentDeep,
  },
  emoji: { fontSize: 44 },
  info: { minHeight: 130, padding: T.space.lg, gap: T.space.xs, backgroundColor: T.white },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  name: { ...T.text.heading, color: T.ink, flexShrink: 1, minWidth: 0 },
  ownerChip: {
    height: 22,
    paddingHorizontal: T.space.sm,
    borderRadius: 11,
    justifyContent: 'center',
    backgroundColor: T.accentBg,
  },
  ownerText: { ...T.text.caption, color: T.accentDeep },
  desc: { ...T.text.caption, color: T.inkSub },
  footer: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  count: { ...T.text.label, color: T.inkSub, fontVariant: ['tabular-nums'] },
  flipHint: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  flipText: { ...T.text.caption, color: T.inkSub },
});
