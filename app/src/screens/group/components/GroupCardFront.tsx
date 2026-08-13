import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, type Ref, type RefObject } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderHandlers,
} from 'react-native';
import Animated, { useAnimatedProps, useSharedValue } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { M } from '@/constants/motion';
import { T, withAlpha } from '@/constants/theme';
import { useMotion } from '@/hooks/useMotion';
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
  reorderState?: 'idle' | 'holding' | 'active';
  reorderHoldMs?: number;
  onMoveStep?: (step: -1 | 1) => void;
  canMovePrevious?: boolean;
  canMoveNext?: boolean;
  cardRef?: RefObject<View | null>;
  bodyRef?: RefObject<View | null>;
  gripRef?: Ref<View>;
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
  reorderState = 'idle',
  reorderHoldMs = 300,
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
        <View style={s.grip} testID={`group.card.gripDrag.${group.groupId}`}>
          <View
            ref={gripRef}
            style={s.gripButton}
            testID={`group.card.grip.${group.groupId}`}
            {...reorderHandlers}
            accessible
            accessibilityRole="adjustable"
            focusable={active}
            accessibilityState={{ disabled: !active }}
            accessibilityLabel={`${group.name} 카드 순서`}
            accessibilityValue={{ text: `${position}/${reorderCount}` }}
            accessibilityHint="0.3초 누른 상태에서 좌우로 드래그하거나 접근성 동작으로 순서를 바꿉니다"
            accessibilityActions={[
              ...(canMovePrevious ? [{ name: 'decrement' as const, label: '앞으로 이동' }] : []),
              ...(canMoveNext ? [{ name: 'increment' as const, label: '뒤로 이동' }] : []),
            ]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'decrement' && canMovePrevious) onMoveStep?.(-1);
              if (event.nativeEvent.actionName === 'increment' && canMoveNext) onMoveStep?.(1);
            }}
          >
            <ReorderGripVisual
              state={reorderState}
              groupId={group.groupId}
              holdMs={reorderHoldMs}
            />
          </View>
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
              </View>
            </ScrollView>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const GRIP_TOUCH_SIZE = 52;
const GRIP_RING_SIZE = 50;
const GRIP_RING_STROKE = 3;
const GRIP_RING_RADIUS = (GRIP_RING_SIZE - GRIP_RING_STROKE) / 2;
const GRIP_RING_CIRCUMFERENCE = 2 * Math.PI * GRIP_RING_RADIUS;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function ReorderGripVisual({
  state,
  groupId,
  holdMs,
}: {
  state: 'idle' | 'holding' | 'active';
  groupId: string;
  holdMs: number;
}) {
  const motion = useMotion();
  const progress = useSharedValue(state === 'active' ? 1 : 0);

  useEffect(() => {
    if (state === 'holding') {
      // 진행 링은 장식이 아니라 hold의 남은 시간을 알려 준다. 동작 줄이기에서는 움직임을
      // 생략하고, 실제 대기가 끝나 active가 됐을 때만 꽉 찬 링으로 바꾼다.
      progress.value = motion.reduce
        ? 0
        : motion.timing(1, { duration: holdMs, easing: M.curve.linear.fn });
      return;
    }
    // idle에서는 링 자체가 숨겨지므로 되감기 애니메이션을 만들 필요가 없다. 여기서
    // CubicBezierEasing 객체를 넘기면 일부 네이티브 Worklets 런타임이 값을 복사하지 못해
    // 렌더 오류를 내므로 즉시 초기화한다.
    progress.value = state === 'active' ? 1 : 0;
  }, [holdMs, motion, progress, state]);

  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: GRIP_RING_CIRCUMFERENCE * (1 - progress.value),
  }));

  return (
    <View
      style={[s.gripVisual, state === 'active' && s.gripVisualActive]}
      testID={`group.card.gripVisual.${groupId}`}
    >
      <Svg
        width={GRIP_RING_SIZE}
        height={GRIP_RING_SIZE}
        style={[s.gripRing, state === 'idle' && s.gripRingIdle]}
        testID={`group.card.gripProgress.${groupId}`}
      >
        <Circle
          cx={GRIP_RING_SIZE / 2}
          cy={GRIP_RING_SIZE / 2}
          r={GRIP_RING_RADIUS}
          stroke={withAlpha(T.white, 0.24)}
          strokeWidth={GRIP_RING_STROKE}
          fill="none"
        />
        <AnimatedCircle
          cx={GRIP_RING_SIZE / 2}
          cy={GRIP_RING_SIZE / 2}
          r={GRIP_RING_RADIUS}
          stroke={T.white}
          strokeWidth={GRIP_RING_STROKE}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${GRIP_RING_CIRCUMFERENCE} ${GRIP_RING_CIRCUMFERENCE}`}
          animatedProps={ringProps}
          transform={`rotate(-90 ${GRIP_RING_SIZE / 2} ${GRIP_RING_SIZE / 2})`}
        />
      </Svg>
      <MaterialCommunityIcons name="drag-vertical" size={28} color={T.white} />
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
    width: GRIP_TOUCH_SIZE,
    height: GRIP_TOUCH_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gripButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  gripVisual: {
    width: GRIP_TOUCH_SIZE,
    height: GRIP_TOUCH_SIZE,
    borderRadius: GRIP_TOUCH_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gripVisualActive: { backgroundColor: withAlpha(T.white, 0.18) },
  gripRing: { position: 'absolute' },
  gripRingIdle: { opacity: 0 },
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
});
