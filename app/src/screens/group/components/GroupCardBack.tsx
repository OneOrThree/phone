import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { T, withAlpha } from '@/constants/theme';
import { todayStrKst } from '@/utils/localDate';
import type { LeagueMemberResponse } from '@/types/api';
import type { GroupDetailMemberResponse, GroupSummaryResponse } from '@/types/dto/group';
import type { GroupCardSummarySnapshot } from '../groupCardSummary';
import { deriveGroupFocusCount } from '../groupFocusStatus';
import { repeatDayOf } from '../challengeSchedule';
import { categoryLabel, missionLabel } from './challengeLabel';
import { GROUP_CARD_USER_TEXT } from './groupCardLayout';

interface Props {
  group: GroupSummaryResponse;
  userId?: string | null;
  snapshot: GroupCardSummarySnapshot<LeagueMemberResponse[]> | undefined;
  cardRef?: React.RefObject<View | null>;
  onFlipFront: () => void;
  onAccessibilityFlipFront?: () => void;
  onStartFocus: () => void;
  onOpenRoom: () => void;
  onOpenSettings: () => void;
  onInvite: () => void;
  onSummaryScrollActivityChange?: (active: boolean) => void;
  onRetry: (dependency: 'detail' | 'announcements' | 'challenges' | 'focus') => void;
  backFocusRef?: React.RefObject<View | null>;
  roomRef?: React.RefObject<View | null>;
  settingsRef?: React.RefObject<View | null>;
  position?: number;
  pageCount?: number;
}

type RetryDependency = Parameters<Props['onRetry']>[0];

function LoadingLine({ label }: { label: string }) {
  return <Text style={s.muted}>{label} 불러오는 중…</Text>;
}

function RetryAction({
  label,
  dependency,
  onRetry,
}: {
  label: string;
  dependency: RetryDependency;
  onRetry: Props['onRetry'];
}) {
  return (
    <TouchableOpacity
      style={s.retryAction}
      onPress={(event) => {
        event.stopPropagation();
        onRetry(dependency);
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="실패한 정보를 다시 불러옵니다"
      testID={`group.card.retry.${dependency}`}
    >
      <Text style={s.error}>{label}</Text>
    </TouchableOpacity>
  );
}

function memberInitial(nickname: string): string {
  return Array.from(nickname.trim())[0] ?? '·';
}

function MemberAvatars({ members }: { members: readonly GroupDetailMemberResponse[] }) {
  return (
    <View style={s.avatarStack} accessible={false}>
      {members.map((member, index) => (
        <View
          key={member.userId}
          style={[
            s.avatar,
            index > 0 && s.avatarOverlap,
            { backgroundColor: T.avatarPalette[index % T.avatarPalette.length] },
          ]}
          testID={`group.card.memberAvatar.${member.userId}`}
        >
          <Text style={s.avatarText}>{memberInitial(member.nickname)}</Text>
        </View>
      ))}
    </View>
  );
}

export function GroupCardBack({
  group,
  userId = null,
  snapshot,
  cardRef,
  onFlipFront,
  onAccessibilityFlipFront,
  onStartFocus,
  onOpenRoom,
  onOpenSettings,
  onInvite,
  onSummaryScrollActivityChange,
  onRetry,
  backFocusRef,
  roomRef,
  settingsRef,
  position = 1,
  pageCount = 1,
}: Props) {
  const detail = snapshot?.detail ?? { status: 'idle' as const };
  const announcements = snapshot?.announcements ?? { status: 'idle' as const };
  const challenges = snapshot?.challenges ?? { status: 'idle' as const };
  const focus = snapshot?.focus ?? { status: 'idle' as const };
  const memberIds =
    detail.status === 'ready' ? detail.data.members.map((member) => member.userId) : [];
  const memberPreview = (() => {
    if (detail.status !== 'ready') return [];
    const currentIndex = userId
      ? detail.data.members.findIndex((member) => member.userId === userId)
      : -1;
    if (currentIndex <= 0) return detail.data.members.slice(0, 5);
    return [
      detail.data.members[currentIndex],
      ...detail.data.members.slice(0, currentIndex),
      ...detail.data.members.slice(currentIndex + 1),
    ].slice(0, 5);
  })();
  const memberCount = detail.status === 'ready' ? detail.data.members.length : group.currentMembers;
  const maxMembers = detail.status === 'ready' ? detail.data.maxMembers : group.maxMembers;
  const memberOverflow =
    detail.status === 'ready' ? Math.max(0, detail.data.members.length - memberPreview.length) : 0;
  const focusCount = deriveGroupFocusCount(memberIds, focus);
  const activeChallenges =
    challenges.status === 'ready'
      ? challenges.data.filter((challenge) => challenge.status === 'ACTIVE')
      : [];
  const privacyLabel = group.isPrivate ? '비밀방' : '공개방';

  return (
    <View ref={cardRef} style={s.root} testID={`group.card.back.${group.groupId}`}>
      <View style={s.cardFrame}>
        <View style={s.header}>
          <TouchableOpacity
            style={s.headerIconButton}
            onPress={(event) => {
              event.stopPropagation();
              onFlipFront();
            }}
            onAccessibilityTap={() => (onAccessibilityFlipFront ?? onFlipFront)()}
            accessibilityRole="button"
            accessibilityLabel={`${group.name} 카드 앞면 보기`}
            accessibilityHint="카드 앞면으로 돌아갑니다"
            testID={`group.card.backTurn.${group.groupId}`}
          >
            <MaterialCommunityIcons name="rotate-3d-variant" size={23} color={T.white} />
          </TouchableOpacity>

          <Pressable
            style={s.titleAction}
            onPress={(event) => {
              event.stopPropagation();
              onFlipFront();
            }}
            onAccessibilityTap={() => (onAccessibilityFlipFront ?? onFlipFront)()}
            accessibilityRole="button"
            accessibilityLabel={`${group.name}, 카드 뒷면, ${privacyLabel}, ${group.currentMembers}/${group.maxMembers}명, 현재 ${position}/${pageCount} 페이지`}
            accessibilityHint="두 번 탭하면 카드 앞면을 봅니다"
            accessibilityState={{ expanded: true }}
            testID={`group.card.backTitle.${group.groupId}`}
          >
            <Text style={s.title} numberOfLines={1} ellipsizeMode="tail" accessible={false}>
              {group.name}
            </Text>
            <Text style={s.headerMeta} numberOfLines={1} accessible={false}>
              {privacyLabel} · {group.currentMembers}/{group.maxMembers}명
            </Text>
          </Pressable>

          <TouchableOpacity
            ref={settingsRef}
            style={s.headerIconButton}
            onPress={(event) => {
              event.stopPropagation();
              onOpenSettings();
            }}
            accessibilityRole="button"
            accessibilityLabel={`${group.name} 그룹 옵션`}
            testID={`group.card.settings.${group.groupId}`}
          >
            <Ionicons
              name="ellipsis-horizontal"
              size={24}
              color={T.white}
              testID={`group.card.settingsIcon.${group.groupId}`}
            />
          </TouchableOpacity>
        </View>

        <View style={s.bodyPlane}>
          <ScrollView
            style={s.summaryScroll}
            contentContainerStyle={s.summaryContent}
            nestedScrollEnabled
            showsVerticalScrollIndicator
            onTouchStart={() => onSummaryScrollActivityChange?.(true)}
            onTouchEnd={() => onSummaryScrollActivityChange?.(false)}
            onTouchCancel={() => onSummaryScrollActivityChange?.(false)}
            testID="group.card.summaryScroll"
          >
            <View style={s.liveSummary} accessibilityLiveRegion="polite">
              {detail.status === 'idle' || detail.status === 'loading' ? (
                <LoadingLine label="집중 인원" />
              ) : detail.status === 'error' ? (
                <RetryAction
                  label="집중 현황을 불러오지 못했어요 · 다시 시도"
                  dependency="detail"
                  onRetry={onRetry}
                />
              ) : focus.status === 'idle' || focus.status === 'loading' ? (
                <LoadingLine label="집중 인원" />
              ) : focusCount.status === 'unavailable' ? (
                <RetryAction
                  label={
                    focus.status === 'coverage-unknown'
                      ? '집중 현황을 확인할 수 없어요 · 다시 시도'
                      : '집중 현황을 불러오지 못했어요 · 다시 시도'
                  }
                  dependency="focus"
                  onRetry={onRetry}
                />
              ) : (
                <View>
                  <View
                    style={s.livePill}
                    accessible
                    accessibilityLabel={`현재 ${focusCount.count}명 집중 중${focusCount.status === 'stale' ? ', 이전 값' : ''}`}
                    testID="group.card.focusCount"
                  >
                    <View style={s.liveDotHalo}>
                      <View style={s.liveDot} />
                    </View>
                    <Text style={s.liveText}>{focusCount.count}명 집중 중</Text>
                  </View>
                  {focusCount.status === 'stale' && (
                    <RetryAction
                      label="업데이트하지 못했어요 · 다시 시도"
                      dependency="focus"
                      onRetry={onRetry}
                    />
                  )}
                </View>
              )}
            </View>

            <View style={s.divider} />

            <View accessibilityLabel={`챌린지 ${activeChallenges.length}개`}>
              <View style={s.sectionHeader}>
                <Text style={s.sectionLabel}>챌린지</Text>
                {challenges.status === 'ready' && (
                  <Text style={s.sectionCount}>{activeChallenges.length}개</Text>
                )}
              </View>
              {challenges.status === 'ready' ? (
                activeChallenges.length > 0 ? (
                  <View style={s.challengeList}>
                    {activeChallenges.map((challenge) => {
                      const myProgress = challenge.memberProgress?.find(
                        (progress) => progress.userId === userId,
                      );
                      const repeatDays =
                        Array.isArray(challenge.repeatDays) && challenge.repeatDays.length > 0
                          ? challenge.repeatDays
                          : null;
                      const todayRepeatDay = repeatDayOf(todayStrKst());
                      const activeToday =
                        repeatDays === null
                          ? true
                          : (challenge.activeToday ??
                            (todayRepeatDay !== null && repeatDays.includes(todayRepeatDay)));
                      const progressText =
                        challenge.memberProgress === null
                          ? activeToday
                            ? '진행률 없음'
                            : '쉬는 날'
                          : myProgress === undefined
                            ? null
                            : myProgress.progressMinutes === null
                              ? '집계 전'
                              : `${myProgress.progressMinutes}${challenge.durationMinutes ? `/${challenge.durationMinutes}` : ''}분${myProgress.achieved === true ? ' · 달성' : ''}`;
                      const label =
                        missionLabel(challenge, { direction: true }) ?? categoryLabel(challenge);
                      return (
                        <View
                          key={challenge.id}
                          style={s.challengeRow}
                          accessible
                          accessibilityLabel={`${label}${progressText ? `, 내 진행 ${progressText}` : ''}`}
                          testID={`group.card.activity.${challenge.id}`}
                        >
                          <Text style={s.challengeTitle} numberOfLines={1} accessible={false}>
                            {label}
                          </Text>
                          {progressText !== null && (
                            <Text style={s.challengeProgress} numberOfLines={1} accessible={false}>
                              {progressText}
                            </Text>
                          )}
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={s.emptyText}>진행 중인 챌린지가 없어요</Text>
                )
              ) : challenges.status === 'error' ? (
                <RetryAction
                  label="챌린지를 불러오지 못했어요 · 다시 시도"
                  dependency="challenges"
                  onRetry={onRetry}
                />
              ) : (
                <LoadingLine label="챌린지" />
              )}
            </View>

            <View style={s.divider} />

            <View style={s.noticeRow}>
              <Text style={s.noticeTag}>공지</Text>
              {announcements.status === 'ready' ? (
                announcements.data[0] ? (
                  <Text
                    style={s.noticeText}
                    numberOfLines={2}
                    accessibilityLabel={`${announcements.data[0].title}. ${announcements.data[0].content}`}
                    testID="group.card.announcement.content"
                  >
                    {announcements.data[0].content || announcements.data[0].title}
                  </Text>
                ) : (
                  <Text style={s.noticeText}>아직 공지가 없어요</Text>
                )
              ) : announcements.status === 'error' ? (
                <View style={s.noticeContent}>
                  <RetryAction
                    label="공지를 불러오지 못했어요 · 다시 시도"
                    dependency="announcements"
                    onRetry={onRetry}
                  />
                </View>
              ) : (
                <View style={s.noticeContent}>
                  <LoadingLine label="공지" />
                </View>
              )}
            </View>

            <View style={s.divider} />

            <View
              style={s.memberRow}
              accessible={detail.status === 'ready'}
              accessibilityLabel={
                detail.status === 'ready'
                  ? `멤버 ${memberCount}/${maxMembers}명. ${memberPreview.map((member) => member.nickname).join(', ')}${memberOverflow > 0 ? ` 외 ${memberOverflow}명` : ''}`
                  : undefined
              }
              testID="group.card.memberSummary"
            >
              <View style={s.memberCopy}>
                <Text style={s.memberCount}>
                  {memberCount}/{maxMembers}
                </Text>
                <Text style={s.memberCaption}>함께하는 멤버</Text>
              </View>
              {detail.status === 'ready' ? (
                <MemberAvatars members={memberPreview} />
              ) : detail.status === 'error' ? (
                <View style={s.memberState}>
                  <RetryAction
                    label="멤버를 불러오지 못했어요 · 다시 시도"
                    dependency="detail"
                    onRetry={onRetry}
                  />
                </View>
              ) : (
                <View style={s.memberState}>
                  <LoadingLine label="멤버" />
                </View>
              )}
              {memberCount < maxMembers && (
                <TouchableOpacity
                  style={s.inviteAction}
                  onPress={(event) => {
                    event.stopPropagation();
                    onInvite();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${group.name}에 멤버 초대`}
                  testID={`group.card.invite.${group.groupId}`}
                >
                  <Ionicons name="person-add-outline" size={18} color={T.accentDeep} />
                  <Text style={s.inviteText}>초대</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>

          <View style={s.actions}>
            <TouchableOpacity
              ref={backFocusRef}
              style={s.primary}
              onPress={(event) => {
                event.stopPropagation();
                onStartFocus();
              }}
              accessibilityRole="button"
              testID={`group.card.focus.${group.groupId}`}
            >
              <Ionicons name="play" size={17} color={T.white} />
              <Text style={s.primaryText}>이 그룹으로 집중</Text>
            </TouchableOpacity>
            <TouchableOpacity
              ref={roomRef}
              style={s.secondary}
              onPress={(event) => {
                event.stopPropagation();
                onOpenRoom();
              }}
              accessibilityRole="button"
              testID={`group.card.room.${group.groupId}`}
            >
              <Text style={s.secondaryText}>방 전체 보기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 520,
    borderRadius: 28,
    backgroundColor: T.paper,
    shadowColor: T.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  cardFrame: {
    flex: 1,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 28,
    backgroundColor: T.paper,
  },
  header: {
    minHeight: 108,
    paddingHorizontal: T.space.md,
    paddingVertical: T.space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    backgroundColor: T.accentDeep,
  },
  headerIconButton: {
    width: 48,
    height: 48,
    flexShrink: 0,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(T.white, 0.14),
  },
  titleAction: { flex: 1, minWidth: 0 },
  title: {
    ...T.text.heading,
    ...GROUP_CARD_USER_TEXT,
    color: T.white,
  },
  headerMeta: {
    ...T.text.caption,
    marginTop: T.space.xs,
    color: withAlpha(T.white, 0.78),
  },
  bodyPlane: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: T.space.xl,
    paddingTop: T.space.lg,
    paddingBottom: T.space.lg,
    backgroundColor: T.paper,
  },
  summaryScroll: { flex: 1 },
  summaryContent: { paddingBottom: T.space.sm },
  liveSummary: {
    minHeight: 44,
    justifyContent: 'center',
  },
  livePill: {
    minHeight: 44,
    alignSelf: 'flex-start',
    paddingHorizontal: T.space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    borderRadius: 14,
    backgroundColor: T.greenBg,
  },
  liveDotHalo: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: withAlpha(T.greenDeep, 0.12),
  },
  liveDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: T.greenDeep,
  },
  liveText: { ...T.text.label, color: T.greenDeep },
  divider: {
    height: 1,
    marginVertical: T.space.sm,
    backgroundColor: T.border,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: T.space.md,
  },
  sectionLabel: { ...T.text.label, color: T.accentDeep },
  sectionCount: { ...T.text.label, color: T.accentDeep },
  challengeList: { marginTop: T.space.sm, gap: T.space.sm },
  challengeRow: {
    minHeight: 48,
    paddingHorizontal: T.space.md,
    paddingVertical: T.space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 12,
    backgroundColor: T.paperAlt,
  },
  challengeTitle: {
    ...T.text.label,
    ...GROUP_CARD_USER_TEXT,
    flex: 1,
    minWidth: 0,
    color: T.ink,
  },
  challengeProgress: {
    ...T.text.caption,
    maxWidth: '42%',
    flexShrink: 0,
    color: T.accentDeep,
  },
  emptyText: {
    ...T.text.caption,
    marginTop: T.space.sm,
    color: T.inkSub,
  },
  noticeRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: T.space.md,
  },
  noticeTag: {
    ...T.text.label,
    width: 48,
    flexShrink: 0,
    color: T.accentDeep,
  },
  noticeContent: { flex: 1, minWidth: 0 },
  noticeText: {
    ...T.text.label,
    ...GROUP_CARD_USER_TEXT,
    flex: 1,
    minWidth: 0,
    color: T.ink,
  },
  memberRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
  },
  memberCopy: { flexShrink: 0 },
  memberCount: { ...T.text.label, color: T.ink },
  memberCaption: {
    ...T.text.caption,
    marginTop: 2,
    color: T.inkSub,
  },
  avatarStack: {
    flex: 1,
    minWidth: 0,
    paddingLeft: T.space.xs,
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: T.paper,
    borderRadius: 18,
  },
  avatarOverlap: { marginLeft: -7 },
  avatarText: { ...T.text.caption, color: T.white },
  memberState: { flex: 1, minWidth: 0 },
  inviteAction: {
    minWidth: 68,
    minHeight: 48,
    flexShrink: 0,
    paddingHorizontal: T.space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.xs,
    borderRadius: 12,
  },
  inviteText: { ...T.text.caption, color: T.accentDeep },
  muted: { ...T.text.caption, color: T.inkSub },
  retryAction: {
    minHeight: 46,
    justifyContent: 'center',
  },
  error: { ...T.text.caption, color: T.dangerInkStrong },
  actions: {
    paddingTop: T.space.md,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: T.space.sm,
  },
  primary: {
    minHeight: 50,
    flex: 1,
    paddingHorizontal: T.space.md,
    paddingVertical: T.space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.sm,
    borderRadius: 14,
    backgroundColor: T.accentDeep,
  },
  primaryText: { ...T.text.label, color: T.white, textAlign: 'center' },
  secondary: {
    minHeight: 50,
    flexBasis: 116,
    paddingHorizontal: T.space.sm,
    paddingVertical: T.space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: T.paperAlt,
  },
  secondaryText: { ...T.text.label, color: T.inkSub, textAlign: 'center' },
});
