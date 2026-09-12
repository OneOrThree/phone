package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.group.event.GroupChallengeCreatedEvent;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.repository.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import com.oneorthree.phone.notification.producer.NotificationDispatchOutcome;
import com.oneorthree.phone.notification.producer.NotificationDispatcher;
import com.oneorthree.phone.notification.producer.NotificationRequest;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.times;

/**
 * fan-out 의 <b>수신자 잠금 순서</b>.
 *
 * <p>{@code OUTBOX} 모드의 {@code enqueueOnly} 는 수신자마다 {@code aggregate_versions(USER, userId)}
 * 를 배타 잠금하고, 그 잠금은 원 트랜잭션이 끝날 때까지 유지된다. {@code findByGroup} 에는
 * {@code ORDER BY} 가 없으므로 공통 멤버가 여럿인 두 그룹에서 챌린지가 <b>동시에</b> 개설되면 한쪽이
 * A→B, 다른 쪽이 B→A 로 잠금을 잡아 PostgreSQL 이 한쪽을 deadlock 으로 중단한다 — 알림 하나가
 * 아니라 <b>챌린지 개설 트랜잭션 전체</b>가 롤백된다.
 *
 * <p>순서를 전역으로 같은 기준(userId)으로 고정하면 두 트랜잭션이 같은 순서로 잠그므로 순환이
 * 생기지 않는다.
 */
@ExtendWith(MockitoExtension.class)
@DisplayName("챌린지 개설 fan-out 의 수신자 순서")
class ChallengeCreatedFanOutOrderTest {

    private static final UUID CHALLENGE_ID = UUID.fromString("aaaaaaaa-0000-4000-8000-000000000001");
    private static final UUID CREATOR = UUID.fromString("ffffffff-0000-4000-8000-00000000000f");
    // 일부러 역순으로 둔다 — 정렬이 없으면 조회가 준 순서 그대로 나간다.
    private static final UUID LATER = UUID.fromString("cccccccc-0000-4000-8000-000000000003");
    private static final UUID EARLIER = UUID.fromString("bbbbbbbb-0000-4000-8000-000000000002");

    @Mock
    private GroupQueryService groupQueryService;
    @Mock
    private GroupChallengeDurationRepository groupChallengeDurationRepository;
    @Mock
    private GroupChallengeWindowRepository groupChallengeWindowRepository;
    @Mock
    private GroupMemberRepository groupMemberRepository;
    @Mock
    private UserQueryService userQueryService;
    @Mock
    private NotificationSentLogRepository notificationSentLogRepository;
    @Mock
    private PushNotificationService pushNotificationService;
    @Mock
    private NotificationDispatcher notificationDispatcher;

    private ChallengeCreatedNotificationService service;

    @BeforeEach
    void assembleService() {
        service = new ChallengeCreatedNotificationService(
                groupQueryService, groupChallengeDurationRepository, groupChallengeWindowRepository,
                groupMemberRepository, userQueryService, notificationSentLogRepository,
                pushNotificationService, notificationDispatcher);
    }

    @Test
    @DisplayName("수신자는 userId 순으로 적재된다 — 조회 순서를 그대로 따르면 두 그룹이 서로를 교착시킨다")
    void recipientsAreEnqueuedInAGloballyConsistentOrder() {
        Group group = Group.builder().id(UUID.randomUUID()).name("열공모임").build();
        GroupChallenge challenge = GroupChallenge.builder()
                .id(CHALLENGE_ID).group(group)
                .category(MissionCategory.FOCUS).type(MissionType.DURATION)
                .status(GroupChallengeStatus.ACTIVE).createdAt(Instant.parse("2026-09-11T00:00:00Z"))
                .build();
        given(groupQueryService.findChallenge(CHALLENGE_ID)).willReturn(Optional.of(challenge));
        given(groupChallengeDurationRepository.findByChallengeIdIn(any()))
                .willReturn(List.of(GroupChallengeDuration.builder()
                        .challengeId(CHALLENGE_ID).durationMinutes(30).build()));
        // 조회가 «역순»으로 준다. 정렬이 없으면 이 순서 그대로 잠금을 잡는다.
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(
                member(group, LATER), member(group, EARLIER)));
        given(notificationDispatcher.enqueueOnly(any())).willReturn(NotificationDispatchOutcome.QUEUED);

        service.enqueueCreatedNotifications(new GroupChallengeCreatedEvent(CHALLENGE_ID, group.getId(), CREATOR));

        ArgumentCaptor<NotificationRequest> requests = ArgumentCaptor.forClass(NotificationRequest.class);
        verify(notificationDispatcher, times(2)).enqueueOnly(requests.capture());
        List<UUID> order = requests.getAllValues().stream().map(NotificationRequest::userId).toList();
        assertThat(order)
                .as("전역으로 같은 기준이라야 두 트랜잭션이 같은 순서로 잠근다")
                .containsExactly(EARLIER, LATER)
                .isSortedAccordingTo(Comparator.naturalOrder());
    }

    private static GroupMember member(Group group, UUID userId) {
        return GroupMember.builder().id(UUID.randomUUID()).group(group)
                .user(User.builder().id(userId).nickname("유저").build()).build();
    }
}
