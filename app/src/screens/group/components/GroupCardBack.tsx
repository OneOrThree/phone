import { useEffect, useRef, type ComponentRef } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ReactNative from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import type { LeagueMemberResponse } from '@/types/api';
import type { GroupSummaryResponse } from '@/types/dto/group';
import type { GroupCardSummarySnapshot } from '../groupCardSummary';
import { deriveGroupFocusCount } from '../groupFocusStatus';
import { GROUP_CARD_HEIGHT } from './groupCardLayout';

interface Props {
  group: GroupSummaryResponse;
  snapshot: GroupCardSummarySnapshot<LeagueMemberResponse[]>;
  onFlipBack: () => void;
  onOpenSettings: () => void;
  onStartFocus: () => void;
  onOpenRoom: () => void;
  focusRoomOnMount?: boolean;
  onRoomFocusRestored?: () => void;
  suppressInitialFocus?: boolean;
  focusPrimaryOnMount?: boolean;
  onPrimaryFocusRestored?: () => void;
  onRetry: (section: 'detail' | 'announcements' | 'challenges' | 'focus') => void;
  minHeight?: number;
}

function SectionError({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <View style={s.errorRow}>
      <Text style={s.errorText}>{label}</Text>
      <TouchableOpacity onPress={onRetry} accessibilityRole="button">
        <Text style={s.retryText}>다시 시도</Text>
      </TouchableOpacity>
    </View>
  );
}

export function GroupCardBack({
  group,
  snapshot,
  onFlipBack,
  onOpenSettings,
  onStartFocus,
  onOpenRoom,
  focusRoomOnMount = false,
  onRoomFocusRestored,
  suppressInitialFocus = false,
  focusPrimaryOnMount = false,
  onPrimaryFocusRestored,
  onRetry,
  minHeight = GROUP_CARD_HEIGHT,
}: Props) {
  const disclosureId = `group-card-summary-${group.groupId}`;
  const frontActionRef = useRef<ComponentRef<typeof Pressable>>(null);
  const primaryActionRef = useRef<ComponentRef<typeof TouchableOpacity>>(null);
  const roomActionRef = useRef<ComponentRef<typeof TouchableOpacity>>(null);
  const focusHandledRef = useRef(false);
  const roomRestoreHandledRef = useRef(false);
  const onRoomFocusRestoredRef = useRef(onRoomFocusRestored);
  onRoomFocusRestoredRef.current = onRoomFocusRestored;
  const onPrimaryFocusRestoredRef = useRef(onPrimaryFocusRestored);
  onPrimaryFocusRestoredRef.current = onPrimaryFocusRestored;
  useEffect(() => {
    // 방 복귀는 네트워크 후속 렌더에서 prop이 false로 바뀌어도 기본 mount 포커스로 되돌리지 않는다.
    if (roomRestoreHandledRef.current) return;
    if (focusRoomOnMount) roomRestoreHandledRef.current = true;
    else if (suppressInitialFocus || focusHandledRef.current) return;
    else focusHandledRef.current = true;
    const frame = requestAnimationFrame(() => {
      const node = ReactNative.findNodeHandle(
        focusRoomOnMount
          ? roomActionRef.current
          : focusPrimaryOnMount
            ? primaryActionRef.current
            : frontActionRef.current,
      );
      if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
      if (focusRoomOnMount) onRoomFocusRestoredRef.current?.();
      else if (focusPrimaryOnMount) onPrimaryFocusRestoredRef.current?.();
      else AccessibilityInfo.announceForAccessibility(`${group.name} 방 요약이 열렸습니다`);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusPrimaryOnMount, focusRoomOnMount, group.name, suppressInitialFocus]);
  const detail = snapshot.detail.status === 'ready' ? snapshot.detail.data : null;
  const focus = deriveGroupFocusCount(
    detail?.members.map((member) => member.userId) ?? [],
    snapshot.focus,
  );
  const notice =
    snapshot.announcements.status === 'ready' ? snapshot.announcements.data[0] : undefined;
  const challengeCount =
    snapshot.challenges.status === 'ready'
      ? snapshot.challenges.data.filter((challenge) => challenge.status === 'ACTIVE').length
      : null;

  return (
    <View
      nativeID={disclosureId}
      style={[s.root, { minHeight }]}
      onAccessibilityEscape={onFlipBack}
      testID={`group.card.back.${group.groupId}`}
    >
      <View style={s.header}>
        <Pressable
          ref={frontActionRef}
          style={s.headerButton}
          onPress={onFlipBack}
          accessibilityRole="button"
          accessibilityState={{ expanded: true }}
          aria-controls={disclosureId}
          accessibilityLabel="앞면 보기"
          testID={`group.card.frontAction.${group.groupId}`}
          hitSlop={6}
        >
          <Ionicons name="chevron-back" size={18} color={T.inkSub} />
        </Pressable>
        <Text
          style={s.title}
          numberOfLines={1}
          ellipsizeMode="tail"
          accessibilityLabel={group.name}
        >
          {group.name}
        </Text>
        <TouchableOpacity
          style={s.headerButton}
          onPress={onOpenSettings}
          accessibilityRole="button"
          accessibilityLabel={`${group.name} 그룹 옵션`}
          testID={`group.card.settings.${group.groupId}`}
          hitSlop={6}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={T.inkSub} />
        </TouchableOpacity>
      </View>

      <ScrollView style={s.body} contentContainerStyle={s.bodyContent}>
        {snapshot.focus.status === 'error' ? (
          <SectionError label="집중 현황을 불러오지 못했어요" onRetry={() => onRetry('focus')} />
        ) : snapshot.focus.status === 'coverage-unknown' ? (
          <Text style={s.muted}>집중 현황을 확인할 수 없어요</Text>
        ) : focus.status === 'unavailable' || !detail ? (
          <Text style={s.muted}>집중 현황을 확인하는 중…</Text>
        ) : focus.status === 'stale' ? (
          <View style={s.errorRow}>
            <Text style={s.focus} testID={`group.card.focusCount.${group.groupId}`}>
              마지막 확인 {focus.count}명 집중 중
            </Text>
            <TouchableOpacity onPress={() => onRetry('focus')} accessibilityRole="button">
              <Text style={s.retryText}>새로고침</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={s.focus} testID={`group.card.focusCount.${group.groupId}`}>
            현재 {focus.count}명 집중 중
          </Text>
        )}

        <View style={s.section}>
          <Text style={s.sectionTitle}>챌린지</Text>
          {snapshot.challenges.status === 'error' ? (
            <SectionError
              label="챌린지를 불러오지 못했어요"
              onRetry={() => onRetry('challenges')}
            />
          ) : challengeCount === null ? (
            <Text style={s.muted}>불러오는 중…</Text>
          ) : (
            <Text style={s.summary}>
              {challengeCount > 0 ? `진행 중 ${challengeCount}개` : '진행 중인 챌린지가 없어요'}
            </Text>
          )}
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>최신 공지</Text>
          {snapshot.announcements.status === 'error' ? (
            <SectionError
              label="공지를 불러오지 못했어요"
              onRetry={() => onRetry('announcements')}
            />
          ) : snapshot.announcements.status !== 'ready' ? (
            <Text style={s.muted}>불러오는 중…</Text>
          ) : notice ? (
            <Text style={s.summary} numberOfLines={2}>
              {notice.title}
            </Text>
          ) : (
            <Text style={s.muted}>아직 공지가 없어요</Text>
          )}
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>멤버</Text>
          {snapshot.detail.status === 'error' ? (
            <SectionError label="멤버를 불러오지 못했어요" onRetry={() => onRetry('detail')} />
          ) : detail ? (
            <Text style={s.summary}>
              {detail.members
                .slice(0, 5)
                .map((member) => member.nickname)
                .join(' · ') || '멤버가 없어요'}
            </Text>
          ) : (
            <Text style={s.muted}>불러오는 중…</Text>
          )}
        </View>
      </ScrollView>

      <View style={s.actions}>
        <TouchableOpacity
          ref={primaryActionRef}
          style={s.primary}
          onPress={onStartFocus}
          accessibilityRole="button"
          testID={`group.card.focus.${group.groupId}`}
        >
          <Text style={s.primaryText}>이 그룹으로 집중</Text>
        </TouchableOpacity>
        <TouchableOpacity
          ref={roomActionRef}
          style={s.secondary}
          onPress={onOpenRoom}
          accessibilityRole="button"
          testID={`group.card.room.${group.groupId}`}
        >
          <Text style={s.secondaryText}>방 전체 보기</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    padding: T.space.md,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
  },
  headerButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { ...T.text.label, flex: 1, minWidth: 0, textAlign: 'center', color: T.ink },
  body: { flex: 1 },
  bodyContent: { padding: T.space.lg, gap: T.space.md },
  focus: { ...T.text.subtitle, color: T.accentDeep },
  section: { gap: T.space.xs },
  sectionTitle: { ...T.text.caption, color: T.inkMuted },
  summary: { ...T.text.caption, color: T.ink },
  muted: { ...T.text.caption, color: T.inkMuted },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  errorText: { ...T.text.caption, flex: 1, color: T.dangerInk },
  retryText: { ...T.text.caption, color: T.accent },
  actions: { padding: T.space.lg, paddingTop: 0, gap: T.space.sm },
  primary: {
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
  },
  primaryText: { ...T.text.label, color: T.white },
  secondary: {
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: T.border,
  },
  secondaryText: { ...T.text.label, color: T.ink },
});
