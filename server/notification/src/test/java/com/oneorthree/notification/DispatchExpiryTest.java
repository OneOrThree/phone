package com.oneorthree.notification;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 시한부 알림의 만료가 게이트·브로커 지연 뒤 발송·재시도·묶음 수집에서 지켜지는지 (GROMO-893 ⑧).
 *
 * <p>{@code LEAGUE_FINAL_DEADLINE}·{@code STREAK_AT_RISK} 는 카탈로그에서 {@code eligibility_required=false} 다. 늦게
 * 소비돼도 «마감 2시간 전!»이 마감 뒤에 나가면 안 되고, 같은 사용자의 아직 유효한 결과·환불 묶음은 함께 버려지면 안 된다.
 */
@SpringBootTest
@ActiveProfiles("ci")
@Testcontainers
class DispatchExpiryTest {

    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final UUID USER = UUID.randomUUID();
    private static final UUID GROUP = UUID.randomUUID();
    /** 13:00 KST — 기본 조용한 시간(23–07) 밖. */
    private static final Instant NOW = Instant.parse("2026-09-11T04:00:00Z");
    private static final Instant SLOT = Instant.parse("2026-09-11T03:00:00Z");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", PG::getJdbcUrl);
        registry.add("spring.datasource.username", PG::getUsername);
        registry.add("spring.datasource.password", PG::getPassword);
    }

    @Autowired Store store;
    @Autowired InboundService inbound;
    @Autowired DeviceService devices;
    @Autowired DispatchService dispatch;
    @MockitoBean PushTransport transport;
    @MockitoBean DataClient data;
    @MockitoBean Clock clock;

    @BeforeEach
    void setup() {
        store.update("TRUNCATE result_bundle_manifests,delivery_devices,deliveries,inbound_events,commands,"
                + "device_tokens,session_fences,user_fences,settings,result_ack CASCADE");
        store.update("UPDATE dispatch_control SET enabled=true,ever_opened=true");
        store.update("UPDATE kinds SET quiet_policy='DROP' WHERE id='LEAGUE_FINAL_DEADLINE'");
        reset(clock, data, transport);
        when(clock.instant()).thenReturn(NOW);
        when(data.eligible(any(), anyString(), any(), any())).thenReturn(true);
        when(transport.send(anyString(), any(), anyBoolean(), anyString())).thenReturn(PushTransport.Result.SENT);
        devices.register(USER, Map.of("deviceToken", "device", "deviceBootstrap", "bootstrap",
                "sessionEpoch", 1, "authGeneration", 0), "register");
    }

    @Test
    @DisplayName("게이트가 닫힌 사이 시한이 지난 알림은 게이트가 열려도 적격성 조회·발송 없이 만료로 끝난다")
    void aTimedNotificationThatExpiredWhileTheGateWasClosedIsTerminated() {
        store.update("UPDATE dispatch_control SET enabled=false");
        timed("deadline", "LEAGUE_FINAL_DEADLINE", NOW.plusSeconds(60));
        dispatch.dispatch(delivery("deadline"));
        assertThat(status("deadline")).containsEntry("status", "PENDING");

        when(clock.instant()).thenReturn(NOW.plusSeconds(61));
        store.update("UPDATE dispatch_control SET enabled=true");
        dispatch.dispatch(delivery("deadline"));

        verifyNoInteractions(data, transport);
        assertThat(status("deadline")).containsEntry("status", "SUPPRESSED").containsEntry("last_error", "EXPIRED");
    }

    @Test
    @DisplayName("적격성 조회를 기다리는 사이 시한이 지나면 보내지 않고 만료로 끝난다")
    void expiryReachedWhileEligibilityIsBeingCheckedDoesNotSend() {
        timed("streak", "STREAK_AT_RISK", NOW.plusSeconds(30));
        when(data.eligible(any(), anyString(), any(), any())).thenAnswer(invocation -> {
            when(clock.instant()).thenReturn(NOW.plusSeconds(31));
            return true;
        });

        dispatch.dispatch(delivery("streak"));

        verify(transport, never()).send(anyString(), any(), anyBoolean(), anyString());
        assertThat(status("streak")).containsEntry("status", "SUPPRESSED").containsEntry("last_error", "EXPIRED");
    }

    @Test
    @DisplayName("전송 실패로 재시도를 기다리는 사이 시한이 지나면 다시 보내지 않는다")
    void aRetryAfterExpiryIsNotSent() {
        timed("deadline", "LEAGUE_FINAL_DEADLINE", NOW.plusSeconds(90));
        when(transport.send(anyString(), any(), anyBoolean(), anyString())).thenReturn(PushTransport.Result.RETRY);
        dispatch.dispatch(delivery("deadline"));
        verify(transport, times(1)).send(anyString(), any(), anyBoolean(), anyString());
        assertThat(status("deadline")).containsEntry("status", "PENDING").containsEntry("last_error", "FCM_RETRY");

        when(clock.instant()).thenReturn(NOW.plusSeconds(120));
        dispatch.dispatch(delivery("deadline"));

        verify(transport, times(1)).send(anyString(), any(), anyBoolean(), anyString());
        assertThat(status("deadline")).containsEntry("status", "SUPPRESSED").containsEntry("last_error", "EXPIRED");
    }

    @Test
    @DisplayName("시한이 지난 알림을 끝내도 같은 사용자의 아직 유효한 결과·환불 묶음은 버리지 않고 한 번 보낸다")
    void stillValidResultsAndRefundsAreNotDiscardedWithExpiredTimedNotifications() {
        timed("streak", "STREAK_AT_RISK", NOW.minusSeconds(1));
        timed("deadline", "LEAGUE_FINAL_DEADLINE", NOW.minusSeconds(1));
        result("result", "BET_RESULT");
        result("refund", "BET_VOID_REFUND");
        inbound.accept(event("seal", "notification.resultBundle.closed", GROUP.toString(),
                Map.of("groupId", GROUP.toString(), "slotAt", SLOT.toString(), "eventIds", List.of("refund", "result"))));

        for (UUID candidate : dispatch.candidates()) {
            dispatch.dispatch(candidate);
        }

        verify(transport, times(1)).send(anyString(), any(), anyBoolean(), anyString());
        assertThat(status("streak")).containsEntry("status", "SUPPRESSED").containsEntry("last_error", "EXPIRED");
        assertThat(status("deadline")).containsEntry("status", "SUPPRESSED").containsEntry("last_error", "EXPIRED");
        assertThat(status("result")).containsEntry("status", "SENT");
        assertThat(status("refund")).containsEntry("status", "SENT");
    }

    @Test
    @DisplayName("조용한 시간이 끝나기 전에 시한이 지나는 이월 알림은 정책 억제가 아니라 만료로 끝난다")
    void aDeferredTimedNotificationWhoseQuietHoursOutliveItsExpiryIsExpired() {
        deferLeagueFinalDeadlineInQuietHoursUntilOneHourLater();
        timed("deadline", "LEAGUE_FINAL_DEADLINE", NOW.plusSeconds(1800));

        dispatch.dispatch(delivery("deadline"));

        verifyNoInteractions(data, transport);
        assertThat(status("deadline")).containsEntry("status", "SUPPRESSED").containsEntry("last_error", "EXPIRED");
    }

    @Test
    @DisplayName("조용한 시간이 끝난 뒤에도 유효한 이월 알림은 만료로 끝내지 않고 조용한 시간 끝으로 이월한다")
    void aDeferredTimedNotificationStillValidAfterQuietHoursIsCarriedOver() {
        deferLeagueFinalDeadlineInQuietHoursUntilOneHourLater();
        timed("deadline", "LEAGUE_FINAL_DEADLINE", NOW.plusSeconds(7200));

        dispatch.dispatch(delivery("deadline"));

        verifyNoInteractions(data, transport);
        assertThat(status("deadline")).containsEntry("status", "DEFERRED");
        assertThat(status("deadline").get("last_error")).isNull();
    }

    /** 콘솔 등록부가 이 시한부 종류를 «이월»로 바꾼 상태 + 사용자 조용한 시간 12:00–14:00 KST(지금 13:00 → 1시간 뒤 끝). */
    private void deferLeagueFinalDeadlineInQuietHoursUntilOneHourLater() {
        store.update("UPDATE kinds SET quiet_policy='DEFER' WHERE id='LEAGUE_FINAL_DEADLINE'");
        store.update("INSERT INTO settings(user_id,night_mode_enabled,night_start_time,night_end_time)"
                + " VALUES(?,true,'12:00','14:00')", USER);
    }

    private void timed(String id, String kind, Instant expiresAt) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("kind", kind);
        params.put("rank", 3);
        params.put("streakCount", 4);
        params.put("dedupAt", expiresAt.minusSeconds(7200).toString());
        params.put("expiresAt", expiresAt.toString());
        inbound.accept(event(id, "notification.requested", null, params));
    }

    private void result(String id, String kind) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("kind", kind);
        params.put("groupId", GROUP.toString());
        params.put("slotAt", SLOT.toString());
        params.put("challengeId", UUID.randomUUID().toString());
        params.put("betStatus", "SETTLED");
        params.put("achieved", true);
        params.put("stake", 100);
        params.put("payout", 200);
        params.put("voidReason", "CHALLENGE_DELETED");
        inbound.accept(event(id, "notification.requested", UUID.randomUUID().toString(), params));
    }

    private Map<String, Object> event(String id, String type, String subject, Map<String, Object> params) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("eventId", id);
        body.put("schemaVersion", 1);
        body.put("type", type);
        body.put("userId", USER.toString());
        body.put("version", 1);
        body.put("subjectId", subject);
        body.put("locale", "ko");
        body.put("occurredAt", NOW.toString());
        // 수신 시각이 아니라 이 테스트의 시계로 후보에 선다 — DB now() 는 실제 시각이다.
        body.put("scheduledAt", NOW.toString());
        body.put("params", params);
        return body;
    }

    private UUID delivery(String event) {
        return (UUID) store.one("SELECT id FROM deliveries WHERE event_id=?", event).get("id");
    }

    private Map<String, Object> status(String event) {
        return store.one("SELECT status,last_error FROM deliveries WHERE event_id=?", event);
    }
}
