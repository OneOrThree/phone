import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentRef, Ref, RefObject } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderHandlers,
} from 'react-native';
import { T, withAlpha } from '@/constants/theme';
import type { GroupSummaryResponse } from '@/types/dto/group';
import { groupCardEmojiLabel } from '../groupCardEmojiStore';
import { GROUP_CARD_USER_TEXT } from './groupCardLayout';

interface GroupCardFrontProps {
  group: GroupSummaryResponse;
  emoji?: string;
  position?: number;
  pageCount?: number;
  reorderCount?: number;
  onFlip: () => void;
  onAccessibilityFlip?: () => void;
  reorderHandlers?: GestureResponderHandlers;
  onOpenReorderMenu?: () => void;
  onMoveStep?: (step: -1 | 1) => void;
  canMovePrevious?: boolean;
  canMoveNext?: boolean;
  cardRef?: RefObject<View | null>;
  bodyRef?: RefObject<View | null>;
  gripRef?: Ref<ComponentRef<typeof Pressable>>;
  active?: boolean;
}

export function GroupCardFront({
  group,
  emoji = '🎯',
  position = 1,
  pageCount = 1,
  reorderCount = pageCount,
  onFlip,
  onAccessibilityFlip,
  reorderHandlers,
  onOpenReorderMenu,
  onMoveStep,
  canMovePrevious = false,
  canMoveNext = false,
  cardRef,
  bodyRef,
  gripRef,
  active = true,
}: GroupCardFrontProps) {
  const privacyLabel = group.isPrivate ? '비밀방' : '공개방';
  const disclosureId = `group-card-summary-${group.groupId}`;

  return (
    <View ref={cardRef} style={s.shadowShell} testID={`group.card.front.${group.groupId}`}>
      <View style={s.root}>
        <View style={s.grip} testID={`group.card.gripDrag.${group.groupId}`} {...reorderHandlers}>
          <Pressable
            ref={gripRef}
            style={s.gripButton}
            testID={`group.card.grip.${group.groupId}`}
            accessibilityRole="adjustable"
            focusable={active}
            disabled={!active}
            onPress={onOpenReorderMenu}
            accessibilityLabel={`${group.name} 카드 순서`}
            accessibilityValue={{ text: `${position}/${reorderCount}` }}
            accessibilityHint="드래그하거나 접근성 동작으로 순서를 바꿉니다"
            accessibilityActions={[
              ...(canMovePrevious ? [{ name: 'decrement' as const, label: '앞으로 이동' }] : []),
              ...(canMoveNext ? [{ name: 'increment' as const, label: '뒤로 이동' }] : []),
            ]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'decrement' && canMovePrevious) onMoveStep?.(-1);
              if (event.nativeEvent.actionName === 'increment' && canMoveNext) onMoveStep?.(1);
            }}
          >
            <MaterialCommunityIcons name="drag-vertical-variant" size={28} color={T.inkSub} />
          </Pressable>
        </View>
        <Pressable
          ref={bodyRef}
          style={s.body}
          focusable={active}
          onPress={onFlip}
          accessibilityActions={[{ name: 'activate', label: '방 요약 보기' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'activate') (onAccessibilityFlip ?? onFlip)();
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded: false }}
          aria-controls={disclosureId}
          accessibilityLabel={`${group.name}${group.description ? `, ${group.description}` : ''}, 내 카드 아이콘 ${groupCardEmojiLabel(emoji)}, ${privacyLabel}, ${group.role === 'OWNER' ? '방장, ' : ''}${group.currentMembers}/${group.maxMembers}명, 현재 ${position}/${pageCount} 페이지`}
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
            <ScrollView
              style={s.infoScroll}
              contentContainerStyle={s.infoInner}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              testID={`group.card.frontInfo.${group.groupId}`}
            >
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
            </ScrollView>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  shadowShell: {
    flex: 1,
    minHeight: 520,
    borderRadius: 28,
    backgroundColor: T.white,
    shadowColor: T.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  root: {
    flex: 1,
    minHeight: 520,
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
  gripButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
    flexGrow: 1,
    width: '76%',
    alignSelf: 'center',
    paddingHorizontal: T.space.sm,
    paddingBottom: 56,
    gap: T.space.sm,
  },
  infoScroll: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  name: {
    ...T.text.heading,
    ...GROUP_CARD_USER_TEXT,
    color: T.ink,
    flexShrink: 1,
    minWidth: 0,
  },
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
  desc: { ...T.text.body, ...GROUP_CARD_USER_TEXT, color: T.inkSub },
  footer: {
    marginTop: 'auto',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    rowGap: T.space.sm,
    columnGap: T.space.md,
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
