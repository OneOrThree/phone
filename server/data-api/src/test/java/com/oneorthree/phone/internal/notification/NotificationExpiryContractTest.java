package com.oneorthree.phone.internal.notification;

import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.internal.notification.service.NotificationEligibilityService;
import com.oneorthree.phone.internal.notification.service.NotificationSnapshotService;
import com.oneorthree.phone.magazine.repository.MagazineIssueRepository;
import com.oneorthree.phone.magazine.repository.domain.MagazineIssue;
import com.oneorthree.phone.notification.producer.NotificationKind;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.service.UserBlockService;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 재전달로 잡지 만료나 관리자 시험의 제한 시간이 늘어나지 않는다. */
class NotificationExpiryContractTest {
    private static final UUID USER = UUID.randomUUID();
    private static final UUID SUBJECT = UUID.randomUUID();

    private MockMvc httpAt(Instant now, boolean active) {
        UserQueryService users = mock(UserQueryService.class);
        when(users.findActive(USER)).thenReturn(active
                ? Optional.of(User.builder().id(USER).build()) : Optional.empty());
        MagazineIssueRepository issues = mock(MagazineIssueRepository.class);
        when(issues.findById(SUBJECT)).thenReturn(Optional.of(new MagazineIssue(
                LocalDate.of(2026, 9, 13), 7, Instant.parse("2026-09-12T22:00:00Z"), null, 0)));
        NotificationEligibilityService eligibility = new NotificationEligibilityService(users,
                mock(FriendshipRepository.class), Clock.fixed(now, ZoneOffset.UTC),
                mock(UserBlockService.class), issues);
        return MockMvcBuilders.standaloneSetup(new InternalNotificationController(
                mock(NotificationSnapshotService.class), eligibility)).build();
    }

    @ParameterizedTest
    @ValueSource(strings = {"MAIN_ISLAND_TRANSFERRED", "ISLAND_KICKED"})
    void adminTestHasABoundedWindow(String kind) throws Exception {
        Instant requested = Instant.parse("2026-09-13T14:30:00Z");
        String body = "{\"userId\":\"" + USER + "\",\"subjectId\":\"" + SUBJECT
                + "\",\"kind\":\"" + kind + "\",\"adminTestRequestedAt\":\"" + requested + "\",\"params\":{}}";
        httpAt(requested.plusSeconds(899), true).perform(post("/internal/notifications/eligibility")
                .contentType("application/json").content(body)).andExpect(status().isOk())
                .andExpect(jsonPath("$.eligible").value(true));
        httpAt(requested.plusSeconds(900), true).perform(post("/internal/notifications/eligibility")
                .contentType("application/json").content(body)).andExpect(status().isOk())
                .andExpect(jsonPath("$.reason").value("EVENT_EXPIRED"));
        httpAt(requested.minusNanos(1), true).perform(post("/internal/notifications/eligibility")
                .contentType("application/json").content(body)).andExpect(status().isOk())
                .andExpect(jsonPath("$.reason").value("EVENT_TIME_INVALID"));
    }

    @ParameterizedTest
    @EnumSource(NotificationKind.class)
    void inactiveRecipientIsRejectedFirst(NotificationKind kind) throws Exception {
        httpAt(Instant.now(), false).perform(post("/internal/notifications/eligibility")
                .contentType("application/json").content("{\"userId\":\"" + USER
                        + "\",\"kind\":\"" + kind + "\",\"params\":{}}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.reason").value("USER_INACTIVE"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"dedupAt\":null}", "{\"dedupAt\":\"broken\"}",
            "{\"expiresAt\":\"2099-01-01T00:00:00Z\"}"})
    void invalidOriginalTimeCannotBecomeFreshOnReplay(String params) throws Exception {
        httpAt(Instant.parse("2026-09-13T00:00:00Z"), true)
                .perform(post("/internal/notifications/eligibility").contentType("application/json")
                        .content("{\"userId\":\"" + USER + "\",\"subjectId\":\"" + SUBJECT
                                + "\",\"kind\":\"MAGAZINE_PUBLISHED\",\"params\":" + params + "}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.eligible").value(false));
    }
}
