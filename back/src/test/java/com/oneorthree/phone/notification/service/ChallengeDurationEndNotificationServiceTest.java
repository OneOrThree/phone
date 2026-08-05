package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.notification.domain.NotificationSentLog;
import com.oneorthree.phone.notification.dto.PushDispatchSummaryResponse;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 일 목표형(DURATION) 챌린지 하루 마감 푸시의 <b>회차 경계</b>와 dedup 단위 테스트.
 *
 * <p>{@link ChallengeEndPushDispatcher} 는 실물을 쓴다 — 발송 단위(그룹당 1건)와 dedup 이 이 서비스의
 * 동작 계약이라 목으로 걷어내면 검증할 것이 남지 않는다.
 */
@ExtendWith(MockitoExtension.class)
class ChallengeDurationEndNotificationServiceTest {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final UUID GROUP_ID = UUID.randomUUID();
    /** 챌린지 생성 시각 — 마감된 회차(어제)보다 앞선다. */
    private static final Instant CREATED_AT = kst(2026, 7, 1, 10, 0);

    @Mock
    private GroupChallengeRepository groupChallengeRepository;
    @Mock
    private GroupChallengeDurationRepository groupChallengeDurationRepository;
    @Mock
    private GroupMemberRepository groupMemberRepository;
    @Mock
    private UserNotificationSettingsRepository userNotificationSettingsRepository;
    @Mock
    private NotificationSentLogRepository notificationSentLogRepository;
    @Mock
    private PushNotificationService pushNotificationService;

    private ChallengeDurationEndNotificationService service() {
        return new ChallengeDurationEndNotificationService(
                groupChallengeRepository,
                groupChallengeDurationRepository,
                new ChallengeEndPushDispatcher(
                        groupMemberRepository,
                        userNotificationSettingsRepository,
                        notificationSentLogRepository,
                        pushNotificationService));
    }

    private static Instant kst(int year, int month, int day, int hour, int minute) {
        return LocalDate.of(year, month, day).atTime(hour, minute).atZone(KST).toInstant();
    }

    private static Group group() {
        return Group.builder().id(GROUP_ID).name("그룹").build();
    }

    private static GroupChallenge challenge(MissionCategory category, Instant createdAt) {
        return GroupChallenge.builder()
                .id(UUID.randomUUID())
                .group(group())
                .category(category)
                .type(MissionType.DURATION)
                .status(GroupChallengeStatus.ACTIVE)
                .createdAt(createdAt)
                .build();
    }

    private static GroupChallenge challenge() {
        return challenge(MissionCategory.FOCUS, CREATED_AT);
    }

    private void givenChallenges(GroupChallenge... challenges) {
        given(groupChallengeRepository.findActiveByType(
                GroupChallengeStatus.ACTIVE, MissionType.DURATION))
                .willReturn(List.of(challenges));
        given(groupChallengeDurationRepository.findByChallengeIdIn(anyCollection()))
                .willReturn(Arrays.stream(challenges)
                        .map(challenge -> GroupChallengeDuration.builder()
                                .challengeId(challenge.getId())
                                .challenge(challenge)
                                .durationMinutes(60)
                                .build())
                        .toList());
    }

    private void givenMembers(User... users) {
        given(groupMemberRepository.findByGroupIdIn(anyCollection())).willReturn(
                Arrays.stream(users)
                        .map(user -> GroupMember.builder().id(UUID.randomUUID())
                                .group(group()).user(user).build())
                        .toList());
    }

    private static User user() {
        UUID id = UUID.randomUUID();
        return User.builder().id(id).nickname("유저").deviceToken("token-" + id).build();
    }

    private void givenNoSentLogs() {
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(
                eq(NotificationSentLog.TYPE_CHALLENGE_ENDED), anyList(), any()))
                .willReturn(List.of());
    }

    private void givenNoSettings() {
        given(userNotificationSettingsRepository.findAllById(anyCollection()))
                .willReturn(List.<UserNotificationSettings>of());
    }

    @Test
    @DisplayName("어제 회차가 끝난 일 목표형 챌린지의 그룹원 전원에게 발송한다")
    void sendsToAllGroupMembers() {
        givenChallenges(challenge());
        givenMembers(user(), user());
        givenNoSentLogs();
        givenNoSettings();
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).willReturn(true);

        PushDispatchSummaryResponse summary =
                service().sendDurationEndNotifications(kst(2026, 8, 2, 9, 0));

        assertThat(summary.targetCount()).isEqualTo(2);
        assertThat(summary.sentCount()).isEqualTo(2);
    }

    @Test
    @DisplayName("스크린타임 일 목표형도 대상이다 — 감지는 카테고리를 가리지 않는다")
    void sendsForScreenTimeDurationChallenge() {
        givenChallenges(challenge(MissionCategory.SCREEN_TIME, CREATED_AT));
        givenMembers(user());
        givenNoSentLogs();
        givenNoSettings();
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).willReturn(true);

        PushDispatchSummaryResponse summary =
                service().sendDurationEndNotifications(kst(2026, 8, 2, 9, 0));

        assertThat(summary.sentCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("마감된 회차가 끝난 뒤(오늘) 만들어진 챌린지는 알릴 결과가 없다")
    void skipsChallengeCreatedAfterCycleEnd() {
        givenChallenges(challenge(MissionCategory.FOCUS, kst(2026, 8, 2, 8, 0)));

        PushDispatchSummaryResponse summary =
                service().sendDurationEndNotifications(kst(2026, 8, 2, 9, 0));

        assertThat(summary.targetCount()).isZero();
        verify(groupMemberRepository, never()).findByGroupIdIn(anyCollection());
    }

    @Test
    @DisplayName("일 목표 상세가 없는 챌린지는 결과 자체가 없어 발송하지 않는다")
    void skipsChallengeWithoutGoal() {
        given(groupChallengeRepository.findActiveByType(
                GroupChallengeStatus.ACTIVE, MissionType.DURATION))
                .willReturn(List.of(challenge()));
        given(groupChallengeDurationRepository.findByChallengeIdIn(anyCollection()))
                .willReturn(List.of());

        PushDispatchSummaryResponse summary =
                service().sendDurationEndNotifications(kst(2026, 8, 2, 9, 0));

        assertThat(summary.targetCount()).isZero();
    }

    @Test
    @DisplayName("같은 회차에 이미 보낸 유저는 dedup — 수동 재트리거에도 재발송하지 않는다")
    void dedupsWithinSameCycle() {
        GroupChallenge challenge = challenge();
        givenChallenges(challenge);
        User member = user();
        givenMembers(member);
        given(notificationSentLogRepository.findByTypeAndUserIdInSince(
                eq(NotificationSentLog.TYPE_CHALLENGE_ENDED), anyList(), any()))
                .willReturn(List.of(NotificationSentLog.builder()
                        .userId(member.getId())
                        .type(NotificationSentLog.TYPE_CHALLENGE_ENDED)
                        .targetUserId(challenge.getId())
                        .sentAt(kst(2026, 8, 2, 9, 0))
                        .build()));

        PushDispatchSummaryResponse summary =
                service().sendDurationEndNotifications(kst(2026, 8, 2, 9, 5));

        assertThat(summary.dedupedCount()).isEqualTo(1);
        assertThat(summary.sentCount()).isZero();
        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("이력 조회는 어제 회차가 끝난 시각(오늘 00:00 KST) 이후만 본다 — 어제 발송분에 막히지 않는다")
    void dedupWindowStartsAtCycleEnd() {
        givenChallenges(challenge());
        givenMembers(user());
        givenNoSentLogs();
        givenNoSettings();
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).willReturn(true);

        service().sendDurationEndNotifications(kst(2026, 8, 2, 9, 0));

        ArgumentCaptor<Instant> since = ArgumentCaptor.forClass(Instant.class);
        verify(notificationSentLogRepository).findByTypeAndUserIdInSince(
                eq(NotificationSentLog.TYPE_CHALLENGE_ENDED), anyList(), since.capture());
        assertThat(since.getValue()).isEqualTo(LocalDate.of(2026, 8, 2).atStartOfDay(KST).toInstant());
    }

    @Test
    @DisplayName("알림을 끈 유저는 발송·이력 모두 없다 — 다음 회차에 다시 시도된다")
    void skipsNotificationDisabledUser() {
        givenChallenges(challenge());
        User member = user();
        givenMembers(member);
        givenNoSentLogs();
        given(userNotificationSettingsRepository.findAllById(anyCollection()))
                .willReturn(List.of(UserNotificationSettings.builder()
                        .userId(member.getId()).notificationEnabled(false).build()));
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).willReturn(false);

        PushDispatchSummaryResponse summary =
                service().sendDurationEndNotifications(kst(2026, 8, 2, 9, 0));

        assertThat(summary.sentCount()).isZero();
        assertThat(summary.skippedCount()).isEqualTo(1);
        verify(notificationSentLogRepository).saveAll(List.of());
    }

    @Test
    @DisplayName("문구는 승패를 담지 않고, 딥링크·type·challengeId 가 실린다")
    void composesResultCheckMessage() {
        GroupChallenge challenge = challenge();
        givenChallenges(challenge);
        givenMembers(user());
        givenNoSentLogs();
        givenNoSettings();
        given(pushNotificationService.sendIfAllowed(any(), any(), any(), any())).willReturn(true);

        service().sendDurationEndNotifications(kst(2026, 8, 2, 9, 0));

        ArgumentCaptor<PushMessage> captor = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService).sendIfAllowed(any(), any(), captor.capture(), any());
        PushMessage message = captor.getValue();
        assertThat(message.title()).isEqualTo("챌린지가 끝났어요!");
        assertThat(message.body()).isEqualTo("어제 목표 달성 결과를 확인해보세요");
        assertThat(message.link())
                .isEqualTo("gromo://group?g=" + GROUP_ID + "&challenge=" + challenge.getId());
        assertThat(message.data()).containsEntry("type", "CHALLENGE_ENDED")
                .containsEntry("groupId", GROUP_ID.toString())
                .containsEntry("challengeId", challenge.getId().toString());
    }

    @Test
    @DisplayName("활성 일 목표형 챌린지가 없으면 상세 조회조차 하지 않는다")
    void returnsEmptyWhenNoActiveChallenges() {
        given(groupChallengeRepository.findActiveByType(
                GroupChallengeStatus.ACTIVE, MissionType.DURATION))
                .willReturn(List.of());

        PushDispatchSummaryResponse summary =
                service().sendDurationEndNotifications(kst(2026, 8, 2, 9, 0));

        assertThat(summary.targetCount()).isZero();
        verify(groupChallengeDurationRepository, never()).findByChallengeIdIn(anyCollection());
    }
}
