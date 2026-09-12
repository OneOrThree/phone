package com.oneorthree.phone.internal.notification;

import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.friend.repository.domain.FriendshipStatus;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.service.ChallengeResultAckService;
import com.oneorthree.phone.internal.notification.dto.NotificationEligibilityRequest;
import com.oneorthree.phone.internal.notification.dto.NotificationEligibilityResponse;
import com.oneorthree.phone.internal.notification.service.NotificationEligibilityService;
import com.oneorthree.phone.internal.notification.service.NotificationRetentionEligibility;
import com.oneorthree.phone.internal.notification.service.NotificationSnapshotService;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 발송 직전 상태 재확인 — <b>fail-closed</b> 와 <b>일시 오류를 삼키지 않는다</b>가 전부다.
 *
 * <p>구 경로는 발송 직전에 코어를 다시 읽어 거짓 알림을 막았다(삭제된 챌린지의 개설 알림, 이미
 * 처리된 친구 요청, 스캔 이후 참가한 유저의 모집 알림). 그 재조회가 이 엔드포인트로 옮겨 왔으므로,
 * 여기가 느슨해지면 <b>탭해도 아무것도 없는 알림</b>이 그대로 나간다.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class NotificationEligibilityServiceTest {

    private static final UUID USER = UUID.randomUUID();
    private static final UUID SUBJECT = UUID.randomUUID();
    private static final UUID GROUP = UUID.randomUUID();
    private static final Instant NOW = Instant.parse("2026-09-11T03:00:00Z");

    @Mock
    UserQueryService userQueryService;
    @Mock
    GroupQueryService groupQueryService;
    @Mock
    GroupMemberRepository groupMemberRepository;
    @Mock
    GroupChallengeBetParticipantRepository betParticipantRepository;
    @Mock
    FriendshipRepository friendshipRepository;

    /**
     * 서비스는 생성자로 직접 조립한다 — {@code @InjectMocks} 는 «어느 인자에 무엇이 들어갔는가»를
     * 타입 추론에 맡긴다. {@link Clock} 처럼 목이 아닌 의존이 섞이면 그 추론이 조용히 빗나가고,
     * 그때 실패 메시지는 원인을 가리키지 않는다.
     */
    private NotificationEligibilityService service() {
        NotificationRetentionEligibility retention = mock(NotificationRetentionEligibility.class);
        when(retention.evaluate(any(), any(), any())).thenReturn(NotificationEligibilityResponse.allow());
        return new NotificationEligibilityService(userQueryService, groupQueryService,
                groupMemberRepository, betParticipantRepository, friendshipRepository,
                Clock.fixed(NOW, ZoneOffset.UTC), retention);
    }

    private void userIsActive() {
        when(userQueryService.findActive(USER)).thenReturn(Optional.of(User.builder().id(USER).build()));
    }

    private static NotificationEligibilityRequest request(String kind, UUID subjectId) {
        return new NotificationEligibilityRequest(USER, kind, subjectId, Map.of("dedupAt", NOW.toString()));
    }

    @Test
    @DisplayName("모르는 종류는 거절한다 — 「모르면 일단 보낸다」는 새 kind 마다 재확인을 조용히 건너뛴다")
    void unknownKindIsDenied() {
        NotificationEligibilityResponse response = service().evaluate(request("SOMETHING_NEW", SUBJECT));

        assertThat(response.eligible()).isFalse();
        assertThat(response.reason()).isEqualTo("UNKNOWN_KIND");
    }

    @Test
    @DisplayName("폐기된 RANK_OVERTAKE 도 모르는 종류다 — 신 카탈로그에 없으면 보내지 않는다")
    void retiredKindIsAlsoDenied() {
        assertThat(service().evaluate(request("RANK_OVERTAKE", SUBJECT)).reason()).isEqualTo("UNKNOWN_KIND");
    }

    @Test
    @DisplayName("탈퇴자에게는 어떤 종류도 보내지 않는다 — 종류별 분기보다 먼저 걸린다")
    void withdrawnUserIsDeniedBeforeKindBranching() {
        when(userQueryService.findActive(USER)).thenReturn(Optional.empty());

        assertThat(service().evaluate(request("MISSED_FOCUS_TODAY", null)).reason())
                .isEqualTo("USER_INACTIVE");
    }

    @Test
    @DisplayName("대상이 필요한 종류인데 대상이 비면 거절한다 — 통과시키면 어느 회차인지 모른 채 보낸다")
    void missingSubjectIsDenied() {
        userIsActive();

        assertThat(service().evaluate(request("BET_RESULT", null)).reason()).isEqualTo("SUBJECT_REQUIRED");
    }

    @Test
    @DisplayName("시간 제한 종류는 유효기간 안에만 통과하고 친구 수락은 사실 통보로 유지한다")
    void stateIndependentKindsPassOnActiveUser() {
        userIsActive();

        assertThat(service().evaluate(request("LEAGUE_WEEKLY_RESULT", null)).eligible()).isTrue();
        assertThat(service().evaluate(request("STREAK_AT_RISK", null)).eligible()).isTrue();
        // 수락은 «이미 일어난 사실»의 통보라 그 뒤 친구가 끊겨도 문구가 거짓이 되지 않는다.
        assertThat(service().evaluate(request("FRIEND_ACCEPTED", SUBJECT)).eligible()).isTrue();
    }

    @Test
    @DisplayName("삭제·종료된 챌린지의 개설 알림은 거절한다 — 탭해도 아무것도 없는 알림이 된다")
    void deletedChallengeDeniesCreatedNotification() {
        userIsActive();
        when(groupQueryService.findChallenge(SUBJECT))
                .thenReturn(Optional.of(challenge(GroupChallengeStatus.ACTIVE, NOW)));

        assertThat(service().evaluate(request("CHALLENGE_CREATED", SUBJECT)).reason())
                .isEqualTo("CHALLENGE_INACTIVE");
    }

    @Test
    @DisplayName("그룹에서 나간 사람에게는 그 그룹의 챌린지 알림을 보내지 않는다")
    void nonMemberIsDenied() {
        userIsActive();
        when(groupQueryService.findChallenge(SUBJECT))
                .thenReturn(Optional.of(challenge(GroupChallengeStatus.ACTIVE)));
        when(groupMemberRepository.existsByGroupIdAndUserId(GROUP, USER)).thenReturn(false);

        assertThat(service().evaluate(request("CHALLENGE_CREATED", SUBJECT)).reason())
                .isEqualTo("NOT_GROUP_MEMBER");
    }

    @Test
    @DisplayName("종료 알림은 ENDED 여도 통과한다 — 「끝났다」는 통지라 ENDED 가 정상 상태다")
    void endedChallengeStillNotifiesEnd() {
        userIsActive();
        when(groupQueryService.findChallenge(SUBJECT))
                .thenReturn(Optional.of(challenge(GroupChallengeStatus.ENDED)));
        when(groupMemberRepository.existsByGroupIdAndUserId(GROUP, USER)).thenReturn(true);

        assertThat(service().evaluate(request("CHALLENGE_ENDED", SUBJECT)).eligible()).isTrue();
        // 반면 개설 알림은 ENDED 면 거짓말이다.
        assertThat(service().evaluate(request("CHALLENGE_CREATED", SUBJECT)).reason())
                .isEqualTo("CHALLENGE_INACTIVE");
    }

    @Test
    @DisplayName("이미 참가한 사람에게 모집 알림을 보내지 않는다 — 판돈까지 낸 사람에게 「지금 참여할 수 있어요」")
    void alreadyJoinedDeniesSessionOpen() {
        userIsActive();
        when(groupMemberRepository.existsByGroupIdAndUserId(GROUP, USER)).thenReturn(true);
        when(groupQueryService.findBetSession(SUBJECT))
                .thenReturn(Optional.of(session(GroupBetStatus.OPEN, NOW.plusSeconds(3600))));
        when(betParticipantRepository.findBySessionIdAndUserId(SUBJECT, USER))
                .thenReturn(Optional.of(GroupChallengeBetParticipant.builder().build()));

        assertThat(service().evaluate(request("CHALLENGE_SESSION_OPEN", SUBJECT)).reason())
                .isEqualTo("ALREADY_JOINED");
    }

    @Test
    @DisplayName("모집 알림은 발송 시점의 그룹 멤버십을 다시 확인한다")
    void sessionOpenRechecksMembershipAfterLeavingAndRejoining() {
        userIsActive();
        when(groupQueryService.findBetSession(SUBJECT))
                .thenReturn(Optional.of(session(GroupBetStatus.OPEN, NOW.plusSeconds(3600))));
        when(groupMemberRepository.existsByGroupIdAndUserId(GROUP, USER))
                .thenReturn(true, false, true);

        NotificationEligibilityService eligibility = service();
        assertThat(eligibility.evaluate(request("CHALLENGE_SESSION_OPEN", SUBJECT)).eligible()).isTrue();
        assertThat(eligibility.evaluate(request("CHALLENGE_SESSION_OPEN", SUBJECT)).reason())
                .isEqualTo("NOT_GROUP_MEMBER");
        assertThat(eligibility.evaluate(request("CHALLENGE_SESSION_OPEN", SUBJECT)).eligible()).isTrue();
    }

    @Test
    @DisplayName("모집 멤버십은 이벤트 params 대신 실제 회차의 그룹으로 판정한다")
    void sessionOpenUsesAuthoritativeSessionGroup() {
        userIsActive();
        UUID unrelatedGroup = UUID.randomUUID();
        when(groupQueryService.findBetSession(SUBJECT))
                .thenReturn(Optional.of(session(GroupBetStatus.OPEN, NOW.plusSeconds(3600))));
        when(groupMemberRepository.existsByGroupIdAndUserId(unrelatedGroup, USER)).thenReturn(true);
        when(groupMemberRepository.existsByGroupIdAndUserId(GROUP, USER)).thenReturn(false);

        assertThat(service().evaluate(new NotificationEligibilityRequest(USER, "CHALLENGE_SESSION_OPEN",
                SUBJECT, Map.of("groupId", unrelatedGroup.toString()))).reason())
                .isEqualTo("NOT_GROUP_MEMBER");
    }

    @Test
    @DisplayName("모집 멤버십 조회 장애는 재시도를 위해 전파한다")
    void sessionOpenMembershipFailurePropagates() {
        userIsActive();
        when(groupQueryService.findBetSession(SUBJECT))
                .thenReturn(Optional.of(session(GroupBetStatus.OPEN, NOW.plusSeconds(3600))));
        when(groupMemberRepository.existsByGroupIdAndUserId(GROUP, USER))
                .thenThrow(new org.springframework.dao.QueryTimeoutException("멤버십 조회 타임아웃"));

        assertThatThrownBy(() -> service().evaluate(request("CHALLENGE_SESSION_OPEN", SUBJECT)))
                .isInstanceOf(org.springframework.dao.QueryTimeoutException.class);
    }

    @Test
    @DisplayName("참가 마감이 지난 모집은 거절한다 — 그때 도착해봐야 「참여하세요」가 거짓이다")
    void closedJoinWindowDeniesSessionOpen() {
        userIsActive();
        when(groupQueryService.findBetSession(SUBJECT))
                .thenReturn(Optional.of(session(GroupBetStatus.OPEN, NOW.minusSeconds(1))));

        assertThat(service().evaluate(request("CHALLENGE_SESSION_OPEN", SUBJECT)).reason())
                .isEqualTo("JOIN_CLOSED");
    }

    @Test
    @DisplayName("아직 정산되지 않은 회차의 결과 알림은 거절한다")
    void unsettledSessionDeniesResult() {
        userIsActive();
        when(groupQueryService.findBetSession(SUBJECT))
                .thenReturn(Optional.of(session(GroupBetStatus.OPEN, NOW)));

        assertThat(service().evaluate(request("BET_RESULT", SUBJECT)).reason()).isEqualTo("NOT_SETTLED");
    }

    @Test
    @DisplayName("정상 결과의 voidReason=null 본문도 HTTP 적격성 판정을 받는다")
    void nullableResultParamsAreAcceptedOverHttp() throws Exception {
        userIsActive();
        when(groupQueryService.findBetSession(SUBJECT))
                .thenReturn(Optional.of(session(GroupBetStatus.SETTLED, NOW)));
        when(betParticipantRepository.findBySessionIdAndUserId(SUBJECT, USER))
                .thenReturn(Optional.of(GroupChallengeBetParticipant.builder().build()));
        var controller = new InternalNotificationController(mock(NotificationSnapshotService.class),
                service(), mock(ChallengeResultAckService.class));
        var mvc = MockMvcBuilders.standaloneSetup(controller).build();

        mvc.perform(post("/internal/notifications/eligibility")
                        .contentType("application/json")
                        .content("""
                                {"userId":"%s","kind":"BET_RESULT","subjectId":"%s",
                                 "params":{"voidReason":null,"count":1}}
                                """.formatted(USER, SUBJECT)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.eligible").value(true));
    }

    @Test
    @DisplayName("nullable params는 null을 보존하면서 원본 변경과 외부 수정을 막는다")
    void nullableParamsAreAnImmutableSnapshot() {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("voidReason", null);
        NotificationEligibilityRequest request = new NotificationEligibilityRequest(USER, "BET_RESULT", SUBJECT,
                params);
        params.put("voidReason", "CHANGED");

        assertThat(request.params()).containsEntry("voidReason", null);
        assertThatThrownBy(() -> request.params().put("voidReason", "CHANGED"))
                .isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    @DisplayName("친구 요청 판정은 params.requestId 로 한다 — 없으면 거절, 이미 처리됐으면 거절")
    void friendRequestJudgedByRequestId() {
        userIsActive();
        UUID requestId = UUID.randomUUID();

        // requestId 가 없으면 «아직 대기 중인가» 를 물을 수가 없다. 통과시키면 이미 수락된 요청의
        // 알림이 그대로 나간다.
        assertThat(service().evaluate(request("FRIEND_REQUEST", SUBJECT)).reason())
                .isEqualTo("SUBJECT_REQUIRED");

        when(friendshipRepository.findStatusByIdAndDeletedAtIsNull(requestId))
                .thenReturn(Optional.of(FriendshipStatus.ACCEPTED));
        assertThat(service().evaluate(new NotificationEligibilityRequest(USER, "FRIEND_REQUEST", SUBJECT,
                Map.of("requestId", requestId.toString()))).reason()).isEqualTo("REQUEST_RESOLVED");

        when(friendshipRepository.findStatusByIdAndDeletedAtIsNull(requestId))
                .thenReturn(Optional.of(FriendshipStatus.PENDING));
        assertThat(service().evaluate(new NotificationEligibilityRequest(USER, "FRIEND_REQUEST", SUBJECT,
                Map.of("requestId", requestId.toString()))).eligible()).isTrue();
    }

    @Test
    @DisplayName("일시 오류를 eligible=false 로 삼키지 않는다 — 장애가 「정책상 안 보냄」으로 둔갑하면 그 동안의 알림이 사라진다")
    void transientFailurePropagates() {
        when(userQueryService.findActive(USER))
                .thenThrow(new org.springframework.dao.QueryTimeoutException("조회 타임아웃"));

        assertThatThrownBy(() -> service().evaluate(request("BET_RESULT", SUBJECT)))
                .isInstanceOf(org.springframework.dao.QueryTimeoutException.class);
    }

    private static GroupChallenge challenge(GroupChallengeStatus status) {
        return challenge(status, null);
    }

    /**
     * @param status    챌린지 상태
     * @param deletedAt 소프트 딜리트 시각. 살아 있으면 {@code null}
     * @return 판정에 필요한 최소 필드만 채운 챌린지
     */
    private static GroupChallenge challenge(GroupChallengeStatus status, Instant deletedAt) {
        return GroupChallenge.builder()
                .id(SUBJECT)
                .group(Group.builder().id(GROUP).name("그룹").build())
                .status(status)
                .deletedAt(deletedAt)
                .build();
    }

    private static GroupChallengeBetSession session(GroupBetStatus status, Instant joinClosesAt) {
        return GroupChallengeBetSession.builder()
                .id(SUBJECT)
                .group(Group.builder().id(GROUP).build())
                .status(status)
                .joinClosesAt(joinClosesAt)
                .build();
    }
}
