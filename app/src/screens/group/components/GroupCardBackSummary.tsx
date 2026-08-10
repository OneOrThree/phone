import { StyleSheet, Text, TouchableOpacity, View, type LayoutChangeEvent } from 'react-native';
import type { Ref } from 'react';
import { T } from '@/constants/theme';
import type { LeagueMemberResponse } from '@/types/api';
import type { GroupSummaryResponse } from '@/types/dto/group';
import type { GroupCardSummarySnapshot } from '../groupCardSummary';
import { deriveGroupFocusCount } from '../groupFocusStatus';

interface GroupCardBackSummaryProps {
  group: GroupSummaryResponse;
  snapshot: GroupCardSummarySnapshot<LeagueMemberResponse[]> | null;
  onStartFocus: () => void;
  onOpenRoom: () => void;
  onFlipFront: () => void;
  onAccessibilityFlipFront?: () => void;
  titleRef?: Ref<Text>;
  onLayout?: (event: LayoutChangeEvent) => void;
}

function pendingOrFailed(status: 'idle' | 'loading' | 'error', object: string): string {
  return status === 'error' ? `${object} 불러오지 못했어요` : `${object} 불러오는 중`;
}

export function GroupCardBackSummary({
  group,
  snapshot,
  onStartFocus,
  onOpenRoom,
  onFlipFront,
  onAccessibilityFlipFront,
  titleRef,
  onLayout,
}: GroupCardBackSummaryProps) {
  const detail = snapshot?.detail ?? { status: 'idle' as const };
  const announcements = snapshot?.announcements ?? { status: 'idle' as const };
  const challenges = snapshot?.challenges ?? { status: 'idle' as const };
  const focus = snapshot?.focus ?? { status: 'idle' as const };

  const memberSummary =
    detail.status === 'ready'
      ? `${detail.data.members.length}명 참여`
      : pendingOrFailed(detail.status, '멤버 정보를');
  const announcementSummary =
    announcements.status === 'ready'
      ? (announcements.data[0]?.title ?? '새 공지 없음')
      : pendingOrFailed(announcements.status, '공지를');
  const challengeSummary =
    challenges.status === 'ready'
      ? `${challenges.data.filter((challenge) => challenge.status === 'ACTIVE').length}개 진행 중`
      : pendingOrFailed(challenges.status, '그룹 활동을');

  let focusSummary = '집중 현황을 불러오는 중';
  if (focus.status === 'error') focusSummary = '집중 현황을 불러오지 못했어요';
  else if (focus.status === 'coverage-unknown') focusSummary = '집중 인원을 확인할 수 없어요';
  else if (detail.status === 'error')
    focusSummary = '멤버 정보가 없어 집중 인원을 확인할 수 없어요';
  else if (detail.status === 'ready') {
    const count = deriveGroupFocusCount(
      detail.data.members.map((member) => member.userId),
      focus,
    );
    if (count.status === 'ready') focusSummary = `${count.count}명 집중 중`;
    else if (count.status === 'stale') focusSummary = `${count.count}명 집중 중 · 이전 정보`;
  }

  return (
    <View style={s.root} onLayout={onLayout} testID={`group.card.back.${group.groupId}`}>
      <Text ref={titleRef} style={s.title} numberOfLines={1} ellipsizeMode="tail">
        {group.name}
      </Text>
      <View style={s.sections}>
        <Text style={s.section} testID={`group.card.back.members.${group.groupId}`}>
          {memberSummary}
        </Text>
        <Text
          style={s.section}
          numberOfLines={1}
          testID={`group.card.back.notice.${group.groupId}`}
        >
          {announcementSummary}
        </Text>
        <Text style={s.section} testID={`group.card.back.challenge.${group.groupId}`}>
          {challengeSummary}
        </Text>
        <Text style={s.section} testID={`group.card.back.focus.${group.groupId}`}>
          {focusSummary}
        </Text>
      </View>
      <TouchableOpacity
        style={s.primary}
        onPress={onStartFocus}
        accessibilityRole="button"
        testID={`group.card.focus.${group.groupId}`}
      >
        <Text style={s.primaryText}>이 그룹으로 집중</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={s.secondary}
        onPress={onOpenRoom}
        accessibilityRole="button"
        testID={`group.card.room.${group.groupId}`}
      >
        <Text style={s.secondaryText}>방 전체 보기</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onFlipFront}
        accessibilityRole="button"
        accessibilityActions={[{ name: 'activate', label: '카드 앞면 보기' }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'activate') {
            (onAccessibilityFlipFront ?? onFlipFront)();
          }
        }}
        testID={`group.card.frontAction.${group.groupId}`}
      >
        <Text style={s.link}>앞면으로</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    minHeight: 300,
    borderRadius: 22,
    padding: T.space.xl,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    gap: T.space.md,
  },
  title: { ...T.text.heading, color: T.ink },
  sections: { gap: T.space.sm, flex: 1 },
  section: {
    ...T.text.caption,
    color: T.inkSub,
    paddingVertical: T.space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.border,
  },
  primary: {
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
  },
  primaryText: { ...T.text.label, color: T.white },
  secondary: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: T.border,
  },
  secondaryText: { ...T.text.label, color: T.ink },
  link: { ...T.text.caption, color: T.accent, textAlign: 'center' },
});
