import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Ref } from 'react';
import { T } from '@/constants/theme';
import type { GroupSummaryResponse } from '@/types/dto/group';

interface GroupCardFrontProps {
  group: GroupSummaryResponse;
  emoji?: string;
  pageIndex: number;
  pageCount: number;
  onFlip: () => void;
  actionRef?: Ref<View>;
}

export function GroupCardFront({
  group,
  emoji = '🎯',
  pageIndex,
  pageCount,
  onFlip,
  actionRef,
}: GroupCardFrontProps) {
  const privacyLabel = group.isPrivate ? '비밀방' : '공개방';
  const descriptionLabel = group.description ? `, ${group.description}` : '';

  return (
    <View style={s.root} testID={`group.card.front.${group.groupId}`}>
      <View
        style={s.grip}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        testID={`group.card.grip.${group.groupId}`}
      >
        <MaterialCommunityIcons name="drag-horizontal-variant" size={24} color={T.white} />
      </View>
      <Pressable
        ref={actionRef}
        style={s.body}
        onPress={onFlip}
        accessibilityRole="button"
        accessibilityLabel={`${group.name}${descriptionLabel}, ${privacyLabel}, ${group.role === 'OWNER' ? '방장, ' : ''}${group.currentMembers}/${group.maxMembers}명, ${pageIndex + 1} / ${pageCount}`}
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
            <Text style={s.emoji}>{emoji}</Text>
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
  grip: { position: 'absolute', top: T.space.md, right: T.space.lg, zIndex: 2 },
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
