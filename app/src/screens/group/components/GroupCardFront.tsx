import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Ref } from 'react';
import { T, withAlpha } from '@/constants/theme';
import type { GroupSummaryResponse } from '@/types/dto/group';

interface GroupCardFrontProps {
  group: GroupSummaryResponse;
  emoji?: string;
  pageIndex: number;
  pageCount: number;
  onFlip: () => void;
  actionRef?: Ref<View>;
  minHeight?: number;
  onHeightChange?: (height: number) => void;
}

export function GroupCardFront({
  group,
  emoji = '🎯',
  pageIndex,
  pageCount,
  onFlip,
  actionRef,
  minHeight = 520,
  onHeightChange,
}: GroupCardFrontProps) {
  const privacyLabel = group.isPrivate ? '비밀방' : '공개방';
  const descriptionLabel = group.description ? `, ${group.description}` : '';

  return (
    <View
      style={[s.root, { minHeight }]}
      onLayout={(event) => onHeightChange?.(event.nativeEvent.layout.height)}
      testID={`group.card.front.${group.groupId}`}
    >
      <View
        style={s.grip}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        testID={`group.card.grip.${group.groupId}`}
      >
        <MaterialCommunityIcons name="drag-vertical-variant" size={28} color={T.inkSub} />
      </View>
      <Pressable
        ref={actionRef}
        style={s.body}
        onPress={onFlip}
        accessibilityRole="button"
        accessibilityState={{ expanded: false }}
        nativeID={`group.card.disclosure.${group.groupId}`}
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
          <View style={s.emojiOrbit}>
            <View style={s.emojiOrbitDash}>
              <View style={s.emojiFrame}>
                <Text style={s.emoji}>{emoji}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={s.info}>
          <View style={s.infoInner}>
            <View style={s.nameRow}>
              <Text style={s.name} numberOfLines={1} ellipsizeMode="tail">
                {group.name}
              </Text>
              {group.role === 'OWNER' && (
                <View style={s.ownerChip}>
                  <MaterialCommunityIcons name="crown-outline" size={14} color={T.accentDeep} />
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
              <View style={s.countBadge}>
                <MaterialCommunityIcons
                  name="account-multiple-outline"
                  size={18}
                  color={T.accentDeep}
                />
                <Text style={s.count}>
                  {group.currentMembers}/{group.maxMembers}
                </Text>
              </View>
              <View style={s.flipHint}>
                <MaterialCommunityIcons name="rotate-3d-variant" size={18} color={T.inkSub} />
                <Text style={s.flipText}>뒤집어 방 보기</Text>
              </View>
            </View>
          </View>
        </View>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
  },
  body: { flex: 1 },
  grip: {
    position: 'absolute',
    top: T.space.lg,
    right: T.space.lg,
    zIndex: 2,
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(T.white, 0.92),
  },
  art: {
    flex: 1,
    minHeight: 310,
    padding: T.space.xl,
    backgroundColor: T.accent,
  },
  privacyPill: {
    alignSelf: 'flex-start',
    minHeight: 32,
    paddingHorizontal: T.space.md,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.xs,
    backgroundColor: withAlpha(T.accentDeep, 0.76),
  },
  pillText: { ...T.text.label, color: T.white },
  emojiOrbit: {
    alignSelf: 'center',
    marginVertical: 'auto',
    width: 154,
    height: 154,
    borderRadius: 77,
    padding: 17,
    borderWidth: 2,
    borderColor: withAlpha(T.white, 0.34),
  },
  emojiOrbitDash: {
    flex: 1,
    borderRadius: 60,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: withAlpha(T.white, 0.34),
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiFrame: {
    width: 76,
    height: 76,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(T.white, 0.16),
  },
  emoji: { fontSize: 46 },
  info: {
    width: '132%',
    alignSelf: 'center',
    minHeight: 245,
    marginTop: -64,
    paddingTop: 94,
    borderTopLeftRadius: 240,
    borderTopRightRadius: 240,
    backgroundColor: T.white,
  },
  infoInner: {
    flex: 1,
    width: '76%',
    alignSelf: 'center',
    paddingHorizontal: T.space.sm,
    paddingBottom: T.space.xl,
    gap: T.space.sm,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  name: { ...T.text.heading, color: T.ink, flexShrink: 1, minWidth: 0 },
  ownerChip: {
    minHeight: 30,
    paddingHorizontal: T.space.sm,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.xs,
    justifyContent: 'center',
    backgroundColor: T.accentBg,
  },
  ownerText: { ...T.text.caption, color: T.accentDeep },
  desc: { ...T.text.body, color: T.inkSub },
  footer: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  countBadge: {
    minHeight: 36,
    paddingHorizontal: T.space.md,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    backgroundColor: T.accentBg,
  },
  count: { ...T.text.label, color: T.accentDeep, fontVariant: ['tabular-nums'] },
  flipHint: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  flipText: { ...T.text.label, color: T.inkSub },
});
