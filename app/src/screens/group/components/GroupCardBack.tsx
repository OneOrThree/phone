import type { RefObject } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { T } from '@/constants/theme';
import type { GroupSummaryResponse } from '@/types/dto/group';
import type { LeagueMemberResponse } from '@/types/api';
import type { GroupCardSummarySnapshot } from '../groupCardSummary';
import { deriveGroupFocusCount } from '../groupFocusStatus';
import type { GroupCardFlipTrigger } from '@/services/analyticsEvents';
import { categoryLabel, missionLabel } from './challengeLabel';

interface Props {
  group: GroupSummaryResponse;
  snapshot: GroupCardSummarySnapshot<LeagueMemberResponse[]> | null;
  cardRef?: RefObject<View | null>;
  backFocusRef?: RefObject<View | null>;
  roomFocusRef?: RefObject<View | null>;
  settingsFocusRef?: RefObject<View | null>;
  onRoom: () => void;
  onFocus: () => void;
  onSettings: () => void;
  onFront: (trigger: GroupCardFlipTrigger) => void;
  onRetry: (dependency: 'detail' | 'announcements' | 'challenges' | 'focus') => void;
}

export function GroupCardBack({
  group,
  snapshot,
  cardRef,
  backFocusRef,
  roomFocusRef,
  settingsFocusRef,
  onRoom,
  onFocus,
  onSettings,
  onFront,
  onRetry,
}: Props) {
  const focus =
    snapshot?.detail.status === 'ready'
      ? deriveGroupFocusCount(
          snapshot.detail.data.members.map((member) => member.userId),
          snapshot.focus,
        )
      : null;
  const loading =
    snapshot === null || snapshot.detail.status === 'idle' || snapshot.detail.status === 'loading';
  const latestAnnouncement =
    snapshot?.announcements.status === 'ready' ? snapshot.announcements.data[0] : undefined;
  const latestChallenge =
    snapshot?.challenges.status === 'ready' ? snapshot.challenges.data[0] : undefined;

  return (
    <View ref={cardRef} style={s.root} testID={`group.card.back.${group.groupId}`}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator
        nestedScrollEnabled
        testID={`group.card.back.scroll.${group.groupId}`}
      >
        <Text style={s.title} numberOfLines={1} ellipsizeMode="tail">
          {group.name}
        </Text>
        {loading ? (
          <Text style={s.body}>방 요약을 불러오는 중이에요.</Text>
        ) : snapshot.detail.status === 'ready' ? (
          <Text style={s.body}>멤버 {snapshot.detail.data.members.length}명</Text>
        ) : (
          <RetryRow label="멤버 정보를 불러오지 못했어요." onPress={() => onRetry('detail')} />
        )}
        {focus?.status === 'stale' ? (
          <Text style={s.body} accessibilityLabel={`현재 집중 ${focus.count}명, 업데이트 실패`}>
            현재 집중 {focus.count}명 · 업데이트 실패
          </Text>
        ) : focus?.status === 'ready' ? (
          <Text style={s.body}>현재 집중 {focus.count}명</Text>
        ) : snapshot?.focus.status === 'error' ? (
          <RetryRow label="집중 상태를 확인하지 못했어요." onPress={() => onRetry('focus')} />
        ) : snapshot?.focus.status === 'coverage-unknown' ? (
          <Text style={s.body}>현재 집중 인원은 확인할 수 없어요.</Text>
        ) : snapshot?.detail.status === 'error' ? (
          <Text style={s.body}>집중 인원은 멤버 정보를 다시 불러온 뒤 확인할 수 있어요.</Text>
        ) : (
          <Text style={s.body}>집중 상태를 불러오는 중이에요.</Text>
        )}
        {snapshot?.announcements.status === 'ready' ? (
          latestAnnouncement ? (
            <Text
              style={s.body}
              numberOfLines={1}
              accessibilityLabel={`최신 공지, ${latestAnnouncement.title}, ${latestAnnouncement.content}`}
            >
              최신 공지 · {latestAnnouncement.title} — {latestAnnouncement.content}
            </Text>
          ) : (
            <Text style={s.body}>새 공지가 없어요.</Text>
          )
        ) : snapshot?.announcements.status === 'error' ? (
          <RetryRow label="공지를 불러오지 못했어요." onPress={() => onRetry('announcements')} />
        ) : (
          <Text style={s.body}>공지를 불러오는 중이에요.</Text>
        )}
        {snapshot?.challenges.status === 'ready' ? (
          latestChallenge ? (
            <Text style={s.body} numberOfLines={1}>
              그룹 활동 · {missionLabel(latestChallenge) ?? categoryLabel(latestChallenge)}
            </Text>
          ) : (
            <Text style={s.body}>진행 중인 그룹 활동이 없어요.</Text>
          )
        ) : snapshot?.challenges.status === 'error' ? (
          <RetryRow label="그룹 활동을 불러오지 못했어요." onPress={() => onRetry('challenges')} />
        ) : (
          <Text style={s.body}>그룹 활동을 불러오는 중이에요.</Text>
        )}
        <TouchableOpacity
          ref={backFocusRef}
          style={s.primary}
          onPress={onFocus}
          testID={`group.card.focus.${group.groupId}`}
        >
          <Text style={s.primaryText}>이 그룹으로 집중</Text>
        </TouchableOpacity>
        <TouchableOpacity
          ref={roomFocusRef}
          onPress={onRoom}
          testID={`group.card.room.${group.groupId}`}
        >
          <Text style={s.link}>방 전체 보기</Text>
        </TouchableOpacity>
        <TouchableOpacity
          ref={settingsFocusRef}
          onPress={onSettings}
          testID={`group.card.settings.${group.groupId}`}
        >
          <Text style={s.link}>⋯ 그룹 설정</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onFront('card_tap')}
          accessibilityActions={[{ name: 'activate', label: '앞면으로' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'activate') onFront('accessibility_action');
          }}
          testID={`group.card.frontAction.${group.groupId}`}
        >
          <Text style={s.link}>앞면으로</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function RetryRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <View style={s.retryRow}>
      <Text style={s.body}>{label}</Text>
      <TouchableOpacity onPress={onPress} accessibilityRole="button">
        <Text style={s.retry}>다시 시도</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    height: 300,
    borderRadius: 22,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    overflow: 'hidden',
  },
  scroll: { flex: 1 },
  content: {
    flexGrow: 1,
    padding: T.space.xl,
    justifyContent: 'center',
    gap: T.space.sm,
  },
  title: { ...T.text.heading, color: T.ink, marginBottom: T.space.sm },
  body: { ...T.text.body, color: T.inkSub, flexShrink: 1 },
  retryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  retry: { ...T.text.caption, color: T.accent },
  primary: {
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
    marginTop: T.space.sm,
  },
  primaryText: { ...T.text.label, color: T.white },
  link: { ...T.text.caption, color: T.accent, textAlign: 'center' },
});
