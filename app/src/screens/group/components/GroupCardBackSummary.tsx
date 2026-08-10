import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import type { Ref } from 'react';
import { T } from '@/constants/theme';
import type { LeagueMemberResponse } from '@/types/api';
import type { GroupChallengeResponse, GroupSummaryResponse } from '@/types/dto/group';
import { todayStrKst } from '@/utils/localDate';
import type { GroupCardSummarySnapshot, GroupDependency } from '../groupCardSummary';
import { deriveGroupFocusCount } from '../groupFocusStatus';
import { repeatDayOf } from '../challengeSchedule';
import { categoryLabel, missionLabel } from './challengeLabel';

interface GroupCardBackSummaryProps {
  group: GroupSummaryResponse;
  userId?: string | null;
  snapshot: GroupCardSummarySnapshot<LeagueMemberResponse[]> | null;
  onStartFocus: () => void;
  onOpenRoom: () => void;
  onRetry: (dependency: GroupDependency) => void;
  onFlipFront: () => void;
  onAccessibilityFlipFront?: () => void;
  titleRef?: Ref<Text>;
  onLayout?: (event: LayoutChangeEvent) => void;
}

function challengeProgressLabel(challenge: GroupChallengeResponse, userId?: string | null): string {
  if (challenge.memberProgress === null) {
    const today = todayStrKst();
    const todayRepeatDay = repeatDayOf(today);
    const resting =
      challenge.activeToday === false ||
      (challenge.activeToday === undefined &&
        challenge.repeatDays !== undefined &&
        todayRepeatDay !== null &&
        !challenge.repeatDays.includes(todayRepeatDay));
    return resting ? '오늘은 쉬는 날이에요' : '이 챌린지는 진행률을 표시하지 않아요';
  }

  if (!userId) return '내 진행을 확인할 수 없어요';
  const progress = challenge.memberProgress.find((member) => member.userId === userId);
  if (!progress || progress.progressMinutes === null) return '내 진행 미집계';
  const target = challenge.durationMinutes ? `/${challenge.durationMinutes}` : '';
  return `내 진행 ${progress.progressMinutes}${target}분${progress.achieved ? ' · 달성' : ''}`;
}

function ChallengeSummaryRow({
  challenge,
  userId,
  groupId,
}: {
  challenge: GroupChallengeResponse;
  userId?: string | null;
  groupId: string;
}) {
  const mission =
    missionLabel(challenge, { direction: true, everyday: false }) ?? categoryLabel(challenge);
  return (
    <View style={s.challengeRow} testID={`group.card.back.challenge.${groupId}.${challenge.id}`}>
      <Text style={s.challengeMission} numberOfLines={1} ellipsizeMode="tail">
        {mission}
      </Text>
      <Text style={s.challengeProgress} numberOfLines={1} ellipsizeMode="tail">
        {challengeProgressLabel(challenge, userId)}
      </Text>
    </View>
  );
}

function pendingOrFailed(status: 'idle' | 'loading' | 'error', object: string): string {
  return status === 'error' ? `${object} 불러오지 못했어요` : `${object} 불러오는 중`;
}

function SummarySection({
  text,
  testID,
  retryDependency,
  onRetry,
  numberOfLines,
}: {
  text: string;
  testID: string;
  retryDependency?: GroupDependency;
  onRetry: (dependency: GroupDependency) => void;
  numberOfLines?: number;
}) {
  return (
    <View style={s.sectionRow} testID={testID}>
      <Text style={s.section} numberOfLines={numberOfLines}>
        {text}
      </Text>
      {retryDependency && (
        <TouchableOpacity
          style={s.retry}
          onPress={() => onRetry(retryDependency)}
          accessibilityRole="button"
          accessibilityLabel={`${text}. 다시 시도`}
          testID={`${testID}.retry`}
        >
          <Text style={s.retryText}>다시 시도</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export function GroupCardBackSummary({
  group,
  userId,
  snapshot,
  onStartFocus,
  onOpenRoom,
  onRetry,
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
  const activeChallenges =
    challenges.status === 'ready'
      ? challenges.data.filter((challenge) => challenge.status === 'ACTIVE')
      : [];

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
      <ScrollView
        style={s.sections}
        contentContainerStyle={s.sectionsContent}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        testID={`group.card.back.summaryScroll.${group.groupId}`}
      >
        <SummarySection
          text={memberSummary}
          testID={`group.card.back.members.${group.groupId}`}
          retryDependency={detail.status === 'error' ? 'detail' : undefined}
          onRetry={onRetry}
        />
        <SummarySection
          text={announcementSummary}
          testID={`group.card.back.notice.${group.groupId}`}
          retryDependency={announcements.status === 'error' ? 'announcements' : undefined}
          onRetry={onRetry}
          numberOfLines={1}
        />
        {challenges.status === 'ready' ? (
          activeChallenges.length > 0 ? (
            <View style={s.challengeList} testID={`group.card.back.challenge.${group.groupId}`}>
              {activeChallenges.map((challenge) => (
                <ChallengeSummaryRow
                  key={challenge.id}
                  challenge={challenge}
                  userId={userId}
                  groupId={group.groupId}
                />
              ))}
            </View>
          ) : (
            <SummarySection
              text="진행 중인 활동 없음"
              testID={`group.card.back.challenge.${group.groupId}`}
              onRetry={onRetry}
            />
          )
        ) : (
          <SummarySection
            text={pendingOrFailed(challenges.status, '그룹 활동을')}
            testID={`group.card.back.challenge.${group.groupId}`}
            retryDependency={challenges.status === 'error' ? 'challenges' : undefined}
            onRetry={onRetry}
          />
        )}
        <SummarySection
          text={focusSummary}
          testID={`group.card.back.focus.${group.groupId}`}
          retryDependency={
            focus.status === 'error' || focus.status === 'coverage-unknown' ? 'focus' : undefined
          }
          onRetry={onRetry}
        />
      </ScrollView>
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
    flex: 1,
    height: '100%',
    borderRadius: 22,
    padding: T.space.xl,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    gap: T.space.md,
  },
  title: { ...T.text.heading, color: T.ink },
  sections: { flex: 1 },
  sectionsContent: { gap: T.space.sm, paddingBottom: T.space.xs },
  sectionRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.border,
  },
  section: {
    ...T.text.caption,
    color: T.inkSub,
    flex: 1,
    paddingVertical: T.space.xs,
  },
  challengeList: { gap: T.space.xs },
  challengeRow: {
    minHeight: 48,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.border,
    paddingVertical: T.space.xs,
  },
  challengeMission: { ...T.text.caption, color: T.ink, fontWeight: '700' },
  challengeProgress: { ...T.text.caption, color: T.inkSub, marginTop: 2 },
  retry: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  retryText: { ...T.text.caption, color: T.accent, fontWeight: '700' },
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
