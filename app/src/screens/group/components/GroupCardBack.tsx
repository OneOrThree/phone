import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { T } from '@/constants/theme';
import type { LeagueMemberResponse } from '@/types/api';
import type { GroupSummaryResponse } from '@/types/dto/group';
import type { GroupCardSummarySnapshot } from '../groupCardSummary';
import { deriveGroupFocusCount } from '../groupFocusStatus';

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
  onRetry: (dependency: 'detail' | 'announcements' | 'challenges' | 'focus') => void;
  backFocusRef?: React.RefObject<View | null>;
  roomRef?: React.RefObject<View | null>;
  settingsRef?: React.RefObject<View | null>;
  position?: number;
  pageCount?: number;
}

function LoadingLine({ label }: { label: string }) {
  return <Text style={s.muted}>{label} 불러오는 중…</Text>;
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
  const focusCount = deriveGroupFocusCount(memberIds, focus);
  const activeChallengeCount =
    challenges.status === 'ready'
      ? challenges.data.filter((challenge) => challenge.status === 'ACTIVE').length
      : 0;

  return (
    <View ref={cardRef} style={s.root} testID={`group.card.back.${group.groupId}`}>
      <View style={s.header}>
        <Text
          style={s.title}
          numberOfLines={1}
          ellipsizeMode="tail"
          accessible
          accessibilityRole="header"
          accessibilityLabel={`${group.name}, 현재 ${position}/${pageCount} 페이지`}
        >
          {group.name}
        </Text>
        <TouchableOpacity
          ref={settingsRef}
          onPress={onOpenSettings}
          accessibilityRole="button"
          accessibilityLabel={`${group.name} 그룹 옵션`}
          testID={`group.card.settings.${group.groupId}`}
        >
          <Text style={s.link}>⋯ 설정</Text>
        </TouchableOpacity>
      </View>

      <View style={s.section}>
        <Text style={s.sectionTitle}>지금 방</Text>
        {detail.status === 'idle' || detail.status === 'loading' ? (
          <LoadingLine label="멤버" />
        ) : detail.status === 'error' ? (
          <TouchableOpacity onPress={() => onRetry('detail')}>
            <Text style={s.error}>멤버 정보를 확인하지 못했어요 · 다시 시도</Text>
          </TouchableOpacity>
        ) : (
          <>
            <Text style={s.body}>{memberPreview.map((member) => member.nickname).join(' · ')}</Text>
            {focus.status === 'idle' || focus.status === 'loading' ? (
              <LoadingLine label="집중 인원" />
            ) : (
              <Text style={s.muted}>
                {focusCount.status === 'unavailable'
                  ? '현재 집중 인원 확인 불가'
                  : `현재 집중 ${focusCount.count}명${focusCount.status === 'stale' ? ' · 이전 값' : ''}`}
              </Text>
            )}
          </>
        )}
        {(focus.status === 'error' || focus.status === 'coverage-unknown') && (
          <TouchableOpacity onPress={() => onRetry('focus')}>
            <Text style={s.error}>집중 상태 다시 시도</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={s.section}>
        <Text style={s.sectionTitle}>공지</Text>
        {announcements.status === 'ready' ? (
          <Text style={s.body} numberOfLines={1}>
            {announcements.data[0]?.title ?? '새 공지가 없어요'}
          </Text>
        ) : announcements.status === 'error' ? (
          <TouchableOpacity onPress={() => onRetry('announcements')}>
            <Text style={s.error}>공지를 불러오지 못했어요 · 다시 시도</Text>
          </TouchableOpacity>
        ) : (
          <LoadingLine label="공지" />
        )}
      </View>

      <View style={s.section}>
        <Text style={s.sectionTitle}>그룹 활동</Text>
        {challenges.status === 'ready' ? (
          <Text style={s.body}>진행 중인 활동 {activeChallengeCount}개</Text>
        ) : challenges.status === 'error' ? (
          <TouchableOpacity onPress={() => onRetry('challenges')}>
            <Text style={s.error}>활동을 불러오지 못했어요 · 다시 시도</Text>
          </TouchableOpacity>
        ) : (
          <LoadingLine label="활동" />
        )}
      </View>

      <View style={s.actions}>
        <TouchableOpacity
          ref={backFocusRef}
          style={s.primary}
          onPress={onStartFocus}
          testID={`group.card.focus.${group.groupId}`}
        >
          <Text style={s.primaryText}>이 그룹으로 집중</Text>
        </TouchableOpacity>
        <TouchableOpacity
          ref={roomRef}
          style={s.secondary}
          onPress={onOpenRoom}
          testID={`group.card.room.${group.groupId}`}
        >
          <Text style={s.secondaryText}>방 전체 보기</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onFlipFront}
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
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 520,
    borderRadius: 28,
    padding: T.space.lg,
    backgroundColor: T.white,
    gap: T.space.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: T.space.sm,
  },
  title: { ...T.text.heading, color: T.ink, flex: 1 },
  section: { padding: T.space.sm, borderRadius: 12, backgroundColor: T.paperAlt, gap: 2 },
  sectionTitle: { ...T.text.label, color: T.ink },
  body: { ...T.text.caption, color: T.ink },
  muted: { ...T.text.caption, color: T.inkSub },
  error: { ...T.text.caption, color: T.dangerInk },
  actions: { marginTop: 'auto', gap: T.space.xs },
  primary: {
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
  },
  primaryText: { ...T.text.label, color: T.white },
  secondary: {
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: T.border,
  },
  secondaryText: { ...T.text.label, color: T.ink },
  link: { ...T.text.caption, color: T.accent, textAlign: 'center' },
});
