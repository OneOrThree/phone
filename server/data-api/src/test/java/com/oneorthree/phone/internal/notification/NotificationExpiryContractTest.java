package com.oneorthree.phone.internal.notification;

import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.internal.notification.service.NotificationEligibilityService;
import com.oneorthree.phone.internal.notification.service.NotificationRetentionEligibility;
import com.oneorthree.phone.internal.notification.service.NotificationSnapshotService;
import com.oneorthree.phone.group.service.ChallengeResultAckService;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;
import com.oneorthree.phone.notification.producer.NotificationKind;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.Mockito.mock;
import static org.mockito.ArgumentMatchers.any;
import com.oneorthree.phone.internal.notification.dto.NotificationEligibilityResponse;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** relay/DLT가 언제 복구되든 수신 시각으로 과거 사건의 유효기간을 늘리지 않는다. */
class NotificationExpiryContractTest {
    private static final UUID USER = UUID.randomUUID();

    private MockMvc httpAt(Instant now) {
        UserQueryService users = mock(UserQueryService.class);
        when(users.findActive(USER)).thenReturn(Optional.of(User.builder().id(USER).build()));
        NotificationRetentionEligibility retention = mock(NotificationRetentionEligibility.class);
        when(retention.evaluate(any(), any(), any())).thenReturn(NotificationEligibilityResponse.allow());
        NotificationEligibilityService eligibility = new NotificationEligibilityService(users,
                mock(GroupQueryService.class), mock(GroupMemberRepository.class),
                mock(GroupChallengeBetParticipantRepository.class), mock(FriendshipRepository.class),
                Clock.fixed(now, ZoneOffset.UTC), retention);
        return MockMvcBuilders.standaloneSetup(new InternalNotificationController(
                mock(NotificationSnapshotService.class), eligibility, mock(ChallengeResultAckService.class))).build();
    }

    @ParameterizedTest
    @ValueSource(strings = {"LEAGUE_DEADLINE", "LEAGUE_DEADLINE_D1", "MISSED_FOCUS_TODAY", "INACTIVE_RETURN",
            "STREAK_AT_RISK", "LEAGUE_WEEKLY_RESULT"})
    void anAuthenticatedTemplateTestHasABoundedWindowEvenAfterTheDomainDayEnds(String kind) throws Exception {
        Instant requested = Instant.parse("2026-09-13T14:30:00Z"); // KST 23:30
        String body = "{\"userId\":\"" + USER + "\",\"kind\":\"" + kind
                + "\",\"adminTestRequestedAt\":\"" + requested + "\",\"params\":{}}";
        httpAt(requested).perform(post("/internal/notifications/eligibility").contentType("application/json")
                .content(body)).andExpect(status().isOk()).andExpect(jsonPath("$.eligible").value(true));
        httpAt(requested.plusSeconds(899)).perform(post("/internal/notifications/eligibility")
                .contentType("application/json").content(body)).andExpect(status().isOk())
                .andExpect(jsonPath("$.eligible").value(true));
        httpAt(requested.plusSeconds(900)).perform(post("/internal/notifications/eligibility")
                .contentType("application/json").content(body)).andExpect(status().isOk())
                .andExpect(jsonPath("$.eligible").value(false))
                .andExpect(jsonPath("$.reason").value("EVENT_EXPIRED"));
        httpAt(requested.minusNanos(1)).perform(post("/internal/notifications/eligibility")
                .contentType("application/json").content(body)).andExpect(status().isOk())
                .andExpect(jsonPath("$.eligible").value(false));
    }

    @ParameterizedTest
    @ValueSource(strings = {"STREAK_AT_RISK", "MISSED_FOCUS_TODAY"})
    void eventParamsCannotClaimTheTrustedAdminTestContext(String kind) throws Exception {
        String params = "{\"adminTest\":true,\"adminActor\":\"admin\","
                + "\"adminTestRequestedAt\":\"2026-09-13T14:30:00Z\","
                + "\"dedupAt\":\"2026-09-11T12:00:00Z\"}";
        httpAt(Instant.parse("2026-09-13T14:30:00Z"))
                .perform(post("/internal/notifications/eligibility").contentType("application/json")
                        .content("{\"userId\":\"" + USER + "\",\"kind\":\"" + kind + "\",\"params\":"
                                + params + "}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.eligible").value(false))
                .andExpect(jsonPath("$.reason").value("EVENT_EXPIRED"));
    }

    @ParameterizedTest
    @EnumSource(NotificationKind.class)
    void everyKindRejectsAnInactiveRecipientBeforeAnyOtherPolicy(NotificationKind kind) throws Exception {
        UserQueryService users = mock(UserQueryService.class);
        when(users.findActive(USER)).thenReturn(Optional.empty());
        NotificationRetentionEligibility retention = mock(NotificationRetentionEligibility.class);
        when(retention.evaluate(any(), any(), any())).thenReturn(NotificationEligibilityResponse.allow());
        NotificationEligibilityService eligibility = new NotificationEligibilityService(users,
                mock(GroupQueryService.class), mock(GroupMemberRepository.class),
                mock(GroupChallengeBetParticipantRepository.class), mock(FriendshipRepository.class),
                Clock.systemUTC(), retention);
        MockMvc http = MockMvcBuilders.standaloneSetup(new InternalNotificationController(
                mock(NotificationSnapshotService.class), eligibility, mock(ChallengeResultAckService.class))).build();
        http.perform(post("/internal/notifications/eligibility").contentType("application/json")
                .content("{\"userId\":\"" + USER + "\",\"kind\":\"" + kind + "\",\"params\":{}}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.eligible").value(false))
                .andExpect(jsonPath("$.reason").value("USER_INACTIVE"));
    }

    @ParameterizedTest
    @CsvSource({
            "LEAGUE_WEEKLY_RESULT,2026-09-07T22:00:00Z,2026-09-14T22:00:00Z",
            "LEAGUE_DEADLINE,2026-09-13T11:00:00Z,2026-09-13T15:00:00Z",
            "LEAGUE_DEADLINE_D1,2026-09-13T00:00:00Z,2026-09-13T15:00:00Z",
            "LEAGUE_RELEGATION_WARNING,2026-09-13T00:00:00Z,2026-09-13T15:00:00Z",
            "LEAGUE_RELEGATION_WARNING_EVENING,2026-09-13T09:00:00Z,2026-09-13T15:00:00Z",
            "LEAGUE_FINAL_DEADLINE,2026-09-13T13:00:00Z,2026-09-13T15:00:00Z",
            "INACTIVE_RETURN,2026-09-13T01:00:00Z,2026-09-13T14:00:00Z",
            "MISSED_FOCUS_TODAY,2026-09-11T12:00:00Z,2026-09-11T14:00:00Z",
            "STREAK_AT_RISK,2026-09-13T12:00:00Z,2026-09-13T14:00:00Z",
            "STREAK_AT_RISK,2026-09-11T13:00:00Z,2026-09-11T15:00:00Z",
            "LEAGUE_DEADLINE,2026-09-13T11:03:00Z,2026-09-13T15:00:00Z"
    })
    void delayedOriginalEventExpiresAtItsBoundary(String kind, String occurred, String expires) throws Exception {
        String body = "{\"userId\":\"" + USER + "\",\"kind\":\"" + kind
                + "\",\"params\":{\"dedupAt\":\"" + occurred + "\"}}";
        httpAt(Instant.parse(expires).minusNanos(1)).perform(post("/internal/notifications/eligibility")
                .contentType("application/json").content(body))
                .andExpect(status().isOk()).andExpect(jsonPath("$.eligible").value(true));
        httpAt(Instant.parse(expires)).perform(post("/internal/notifications/eligibility")
                .contentType("application/json").content(body))
                .andExpect(status().isOk()).andExpect(jsonPath("$.eligible").value(false))
                .andExpect(jsonPath("$.reason").value("EVENT_EXPIRED"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"dedupAt\":null}", "{\"dedupAt\":\"broken\"}",
            "{\"expiresAt\":\"2099-01-01T00:00:00Z\"}"})
    void missingOrInvalidOriginalTimeCannotBecomeFreshOnReplay(String params) throws Exception {
        httpAt(Instant.parse("2026-09-14T00:00:00Z"))
                .perform(post("/internal/notifications/eligibility").contentType("application/json")
                        .content("{\"userId\":\"" + USER + "\",\"kind\":\"STREAK_AT_RISK\",\"params\":"
                                + params + "}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.eligible").value(false));
    }
}
