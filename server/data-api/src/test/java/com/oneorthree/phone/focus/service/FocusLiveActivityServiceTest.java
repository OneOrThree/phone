package com.oneorthree.phone.focus.service;

import com.oneorthree.phone.focus.client.LiveActivityPushClient;
import com.oneorthree.phone.focus.dto.session.LiveActivityRegistration;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.focus.repository.FocusLiveActivityQueryService;
import com.oneorthree.phone.focus.repository.FocusLiveActivityRepository;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.domain.FocusLiveActivity;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.user.repository.UserQueryService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class FocusLiveActivityServiceTest {
    @Mock private FocusLiveActivityRepository activities;
    @Mock private FocusLiveActivityQueryService sessions;
    @Mock private FocusSessionIntervalRepository intervals;
    @Mock private LiveActivityPushClient push;
    @Mock private UserQueryService users;
    private final UUID owner = UUID.randomUUID();
    private final UUID sessionId = UUID.randomUUID();
    private final Instant now = Instant.parse("2026-10-09T01:00:00Z");
    private final LiveActivityRegistration registration =
            new LiveActivityRegistration("activity", "ab".repeat(32), "development", "black");
    private FocusLiveActivityService service;

    @BeforeEach
    void setup() {
        service = new FocusLiveActivityService(activities, sessions, intervals, push,
                Clock.fixed(now, ZoneOffset.UTC), users);
    }

    private FocusSessionDetail detail(FocusSessionLifecycle lifecycle) {
        return FocusSessionDetail.builder().sessionId(sessionId).userId(owner).subject("수학")
                .lastTransitionAt(now.minusSeconds(20)).version(3).lifecycle(lifecycle).build();
    }

    @Test
    void registrationRejectsAnotherUsersSessionBeforeTokenWrite() {
        when(sessions.requireForUpdate(sessionId)).thenReturn(detail(FocusSessionLifecycle.ACTIVE));
        assertThatThrownBy(() -> service.register(UUID.randomUUID(), sessionId, registration))
                .isInstanceOf(FocusException.class);
        verifyNoInteractions(activities, push);
    }

    @Test
    void invalidEnvironmentAndTokenCannotReachApns() {
        assertThatThrownBy(() -> service.register(owner, sessionId,
                new LiveActivityRegistration("a", "../device", "attacker.example", "black")))
                .isInstanceOf(FocusException.class);
        verifyNoInteractions(activities, sessions, push);
    }

    @Test
    void retryDoesNotAdvanceVersionAndACommittedEndRemovesRegistration() {
        var activity = new FocusLiveActivity(sessionId, owner, registration, now.minusSeconds(30));
        when(activities.findBySessionIdForUpdate(sessionId)).thenReturn(Optional.of(activity));
        when(sessions.requireForUpdate(sessionId)).thenReturn(detail(FocusSessionLifecycle.COMPLETED));
        when(intervals.findBySessionIdOrderByOrdinalAsc(sessionId)).thenReturn(List.of());
        when(push.enabled()).thenReturn(true);
        when(push.send(any(), any(), any())).thenReturn(LiveActivityPushClient.Result.RETRY,
                LiveActivityPushClient.Result.SENT);
        service.deliver(sessionId);
        assertThat(activity.getSentVersion()).isEqualTo(-1);
        verify(activities, never()).delete(any());
        activity.attempted(now);
        service.deliver(sessionId);
        verify(activities).delete(activity);
        verify(push, times(2)).send(eq(registration.pushToken()), eq("development"),
                argThat(p -> ((java.util.Map<?, ?>) p.get("aps")).get("event").equals("end")));
    }

    @Test
    void successfulVersionIsNotResentUntilStateChanges() {
        var activity = new FocusLiveActivity(sessionId, owner, registration, now.minusSeconds(30));
        when(activities.findBySessionIdForUpdate(sessionId)).thenReturn(Optional.of(activity));
        when(sessions.requireForUpdate(sessionId)).thenReturn(detail(FocusSessionLifecycle.PAUSED));
        when(intervals.findBySessionIdOrderByOrdinalAsc(sessionId)).thenReturn(List.of());
        when(push.enabled()).thenReturn(true);
        when(push.send(any(), any(), any())).thenReturn(LiveActivityPushClient.Result.SENT);
        service.deliver(sessionId);
        activity.attempted(now);
        service.deliver(sessionId);
        verify(push, times(1)).send(any(), any(), any());
        assertThat(activity.getSentVersion()).isEqualTo(3);
    }

    @Test
    void expiredTokenIsDeletedWithoutPush() {
        var activity = new FocusLiveActivity(sessionId, owner, registration, now.minusSeconds(28801));
        when(activities.findBySessionIdForUpdate(sessionId)).thenReturn(Optional.of(activity));
        when(sessions.requireForUpdate(sessionId)).thenReturn(detail(FocusSessionLifecycle.ACTIVE));
        service.deliver(sessionId);
        verify(activities).delete(activity);
        verifyNoInteractions(push);
    }

    @Test
    void rotationResetsDeliveryButKeepsActivityExpiry() {
        var activity = new FocusLiveActivity(sessionId, owner, registration, now);
        activity.sent(3, now.getEpochSecond());
        activity.register(new LiveActivityRegistration("activity", "cd".repeat(32), "development", "black"),
                now.plusSeconds(60));
        assertThat(activity.getSentVersion()).isEqualTo(-1);
        assertThat(activity.getExpiresAt()).isEqualTo(now.plusSeconds(28800));
        assertThat(activity.getNextAttemptAt()).isEqualTo(now.plusSeconds(60));
    }

    @Test
    void androidRegistrationAcceptsFcmTokenAndUsesServerState() {
        var request = new LiveActivityRegistration("android-activity", "a".repeat(40) + ":_token", "android", "black");
        request.validate();
        var activity = new FocusLiveActivity(sessionId, owner, request, now.minusSeconds(30));
        when(sessions.requireForUpdate(sessionId)).thenReturn(detail(FocusSessionLifecycle.PAUSED));
        when(activities.findBySessionIdForUpdate(sessionId)).thenReturn(Optional.of(activity));
        when(intervals.findBySessionIdOrderByOrdinalAsc(sessionId)).thenReturn(List.of());
        when(push.enabled()).thenReturn(true);
        when(push.send(anyString(), eq("android"), any())).thenReturn(LiveActivityPushClient.Result.SENT);
        service.deliver(sessionId);
        verify(push).send(eq(request.pushToken()), eq("android"), argThat(payload ->
                payload.get("phase").equals("rest") && payload.get("owner").equals(owner.toString())
                        && payload.get("version").equals(3L)
                        && payload.get("anchorMs").equals(now.minusSeconds(20).toEpochMilli())
                        && payload.get("validUntilMs").equals(now.plusSeconds(3580).toEpochMilli())));
        assertThat(activity.getSentVersion()).isEqualTo(3);
    }

    @Test
    void invalidAndroidTokenIsDeletedAfterFcmRejectsIt() {
        var request = new LiveActivityRegistration("android-activity", "a".repeat(40), "android", "black");
        var activity = new FocusLiveActivity(sessionId, owner, request, now.minusSeconds(30));
        when(sessions.requireForUpdate(sessionId)).thenReturn(detail(FocusSessionLifecycle.ACTIVE));
        when(activities.findBySessionIdForUpdate(sessionId)).thenReturn(Optional.of(activity));
        when(intervals.findBySessionIdOrderByOrdinalAsc(sessionId)).thenReturn(List.of());
        when(push.enabled()).thenReturn(true);
        when(push.send(anyString(), eq("android"), any())).thenReturn(LiveActivityPushClient.Result.INVALID_TOKEN);
        service.deliver(sessionId);
        verify(activities).delete(activity);
    }

    @Test
    void androidFocusRemainsRegisteredAndBlockingAfterEightHours() {
        var request = new LiveActivityRegistration("android-activity", "a".repeat(40), "android", "black");
        var activity = new FocusLiveActivity(sessionId, owner, request, now.minusSeconds(36_000));
        assertThat(activity.getExpiresAt()).isNull();
        when(sessions.requireForUpdate(sessionId)).thenReturn(detail(FocusSessionLifecycle.ACTIVE));
        when(activities.findBySessionIdForUpdate(sessionId)).thenReturn(Optional.of(activity));
        when(intervals.findBySessionIdOrderByOrdinalAsc(sessionId)).thenReturn(List.of());
        when(push.enabled()).thenReturn(true);
        when(push.send(any(), any(), any())).thenReturn(LiveActivityPushClient.Result.SENT);
        service.deliver(sessionId);
        verify(push).send(any(), eq("android"), argThat(payload ->
                payload.get("phase").equals("focus") && payload.get("validUntilMs").equals(now.plusSeconds(28 * 86400L).toEpochMilli())));
        verify(activities, never()).delete(any());
    }

    @Test
    void androidSameVersionIsRefreshedDailyButNotOnEveryPoll() {
        var request = new LiveActivityRegistration("android-activity", "a".repeat(40), "android", "black");
        var activity = new FocusLiveActivity(sessionId, owner, request, now.minusSeconds(172800));
        activity.sent(3, now.minusSeconds(86400).getEpochSecond());
        when(sessions.requireForUpdate(sessionId)).thenReturn(detail(FocusSessionLifecycle.ACTIVE));
        when(activities.findBySessionIdForUpdate(sessionId)).thenReturn(Optional.of(activity));
        when(intervals.findBySessionIdOrderByOrdinalAsc(sessionId)).thenReturn(List.of());
        when(push.enabled()).thenReturn(true);
        when(push.send(any(), any(), any())).thenReturn(LiveActivityPushClient.Result.SENT);
        service.deliver(sessionId);
        assertThat(activity.getSentTimestamp()).isEqualTo(now.getEpochSecond());
        activity.attempted(now);
        service.deliver(sessionId);
        verify(push, times(1)).send(any(), eq("android"), argThat(payload ->
                payload.get("validUntilMs").equals(now.plusSeconds(28 * 86400L).toEpochMilli())));
    }

}
