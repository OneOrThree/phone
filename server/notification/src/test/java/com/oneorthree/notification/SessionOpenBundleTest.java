package com.oneorthree.notification;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 회차 <b>모집</b> 알림이 «한 스캔당 (유저 × 그룹 × 슬롯) 한 건»으로 접히는지의 회귀 잠금.
 *
 * <p>종료 알림과 달리 모집 묶음은 슬롯이 닫히기를 기다리지 않는다. 그래서 첫 사건 수신과 둘째 사건
 * 수신 사이에 flush 가 끼면 — outbox relay 는 유저별 사건을 다른 틱에 전달하므로 실제로 가능한
 * 순서다 — 같은 스캔의 모집 알림이 회차 수만큼 나간다. 발송부가 사건마다 실어 보내는
 * {@code bundleMembers} 가 그 구멍을 막는 유일한 근거다.
 */
@SpringBootTest
@ActiveProfiles("ci")
@Testcontainers
class SessionOpenBundleTest {

    private static final String KIND = "CHALLENGE_SESSION_OPEN";

    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    static final UUID USER = UUID.fromString("44444444-4444-4444-8444-444444444444");
    static final Instant DAY = Instant.parse("2026-09-11T03:00:00Z");
    /** 조용한 시간 기본값(23–07 KST) 안의 시각과 그 창의 끝 — 유저 설정이 없을 때의 정책 경로다. */
    static final Instant QUIET = Instant.parse("2026-09-11T14:30:00Z");
    static final Instant QUIET_END = Instant.parse("2026-09-11T22:00:00Z");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", PG::getJdbcUrl);
        registry.add("spring.datasource.username", PG::getUsername);
        registry.add("spring.datasource.password", PG::getPassword);
    }

    @Autowired Store store;
    @Autowired DeviceService devices;
    @Autowired InboundService inbound;
    @Autowired DispatchService dispatch;
    @MockitoBean PushTransport transport;
    @MockitoBean DataClient data;
    @MockitoBean Clock clock;

    @BeforeEach
    void resetState() {
        store.update("TRUNCATE delivery_devices,deliveries,inbound_events,commands,device_tokens,session_fences,"
                + "user_fences,settings,projections,result_ack,templates,deeplinks,kinds CASCADE");
        store.update("UPDATE dispatch_control SET enabled=true,ever_opened=true");
        store.update("INSERT INTO kinds(id,silent,quiet_policy,eligibility_required)"
                + " VALUES(?,false,'DEFER',true)", KIND);
        store.update("INSERT INTO templates(id,kind,locale,title,body) VALUES(?,?,'ko',?,?)",
                KIND + ".ko", KIND, "오늘 참여할 챌린지가 있어요", "참가비 {stake}코인 — 지금 참여할 수 있어요");
        store.update("INSERT INTO deeplinks(id,url_template,data_template) VALUES(?,NULL,?::jsonb)",
                KIND, "{\"type\":\"" + KIND + "\"}");
        store.update("INSERT INTO kinds(id,silent,quiet_policy,eligibility_required)"
                + " VALUES(?,false,'DEFER',false)", KIND + "_BUNDLE");
        store.update("INSERT INTO templates(id,kind,locale,title,body) VALUES(?,?,'ko',?,?)",
                KIND + "_BUNDLE.ko", KIND + "_BUNDLE", "오늘 참여할 챌린지가 있어요",
                "참여 가능한 챌린지 {count}개가 열려 있어요");
        store.update("INSERT INTO deeplinks(id,url_template,data_template) VALUES(?,NULL,?::jsonb)",
                KIND + "_BUNDLE", "{\"type\":\"" + KIND + "\"}");
        reset(transport, data, clock);
        when(clock.instant()).thenReturn(DAY);
        when(clock.getZone()).thenReturn(ZoneOffset.UTC);
        when(data.eligible(any(), anyString(), any(), any())).thenReturn(true);
        when(transport.send(anyString(), any(), anyBoolean(), anyString())).thenReturn(PushTransport.Result.SENT);
        devices.register(USER, Map.of("deviceToken", "device", "deviceBootstrap", "bootstrap",
                "sessionEpoch", 1, "authGeneration", 0), "register");
    }

    /**
     * <b>수신과 발송이 교차</b>하는 경우 — 첫 회차 사건만 도착한 사이에 flush 가 끼어도 모집 알림이
     * 두 번 나가서는 안 된다. 구 경로의 {@code sendBundles()} 는 한 스캔의 (유저 × 그룹 × 슬롯) 을
     * 통째로 모아 한 건만 보냈다.
     */
    @Test
    void aHalfArrivedOpenBatchWaitsSoTheSameSlotIsNotPushedTwice() {
        UUID group = UUID.randomUUID();
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        List<UUID> batch = List.of(first, second);
        acceptOpen("open-first", 1, group, first, batch);

        flush();

        verifyNoInteractions(transport);
        Map<String, Object> parked = store.one("SELECT attempts,last_error,next_attempt_at"
                + " FROM deliveries WHERE event_id='open-first'");
        // 기다림은 실패가 아니다 — 시도 횟수를 올리지 않고 재시도 backoff 와 구분되는 표식만 남긴다.
        assertThat(parked).containsEntry("attempts", 0).containsEntry("last_error", "BUNDLE_INCOMPLETE");

        acceptOpen("open-second", 2, group, second, batch);
        when(clock.instant()).thenReturn(DAY.plusSeconds(10));

        flush();

        ArgumentCaptor<RenderedPush> rendered = ArgumentCaptor.forClass(RenderedPush.class);
        verify(transport, times(1)).send(anyString(), rendered.capture(), anyBoolean(), anyString());
        // 묶음 문구는 개수형이다 — 회차 하나가 먼저 나가 버렸다면 여기가 단건 문구로 갈린다.
        assertThat(rendered.getValue().body()).isEqualTo("참여 가능한 챌린지 2개가 열려 있어요");
        assertThat(status("open-first")).isEqualTo("SENT");
        assertThat(status("open-second")).isEqualTo("SENT");
        assertThat(store.one("SELECT last_error FROM deliveries WHERE event_id='open-first'"))
                .containsEntry("last_error", null);
    }

    /**
     * 앞 스캔에서 <b>이미 나갔거나 걸러진</b> 회차도 «도착은 했다». 상태로 거르면, 다음 스캔이 그 회차를
     * 구성원으로 다시 선언하는 순간 뒤 배치가 영원히 미달로 남아 모집 알림이 통째로 멈춘다.
     */
    @Test
    void siblingsAlreadySentOrSuppressedCountAsArrived() {
        UUID group = UUID.randomUUID();
        UUID sent = UUID.randomUUID();
        UUID suppressed = UUID.randomUUID();
        UUID late = UUID.randomUUID();
        // 앞 스캔: 슬롯에 도달한 회차가 둘뿐이고 하나는 자격 판정에서 걸러진다.
        when(data.eligible(any(), anyString(), eq(suppressed.toString()), any())).thenReturn(false);
        acceptOpen("open-sent", 1, group, sent, List.of(sent, suppressed));
        acceptOpen("open-suppressed", 2, group, suppressed, List.of(sent, suppressed));

        flush();

        assertThat(status("open-sent")).isEqualTo("SENT");
        assertThat(status("open-suppressed")).isEqualTo("SUPPRESSED");

        // 뒤 스캔: 같은 슬롯에 회차가 하나 더 붙어 구성원 합집합이 셋이 된다. 앞 둘은 다시 오지 않는다.
        when(clock.instant()).thenReturn(DAY.plusSeconds(900));
        acceptOpen("open-late", 3, group, late, List.of(sent, suppressed, late));

        flush();

        ArgumentCaptor<RenderedPush> rendered = ArgumentCaptor.forClass(RenderedPush.class);
        verify(transport, times(2)).send(anyString(), rendered.capture(), anyBoolean(), anyString());
        assertThat(status("open-late")).isEqualTo("SENT");
        assertThat(rendered.getValue().data()).containsEntry("challengeId", late.toString());
    }

    /**
     * 묶음이 다시 «완성»돼도 앞서 세워 둔 전송 실패의 재시도 backoff 를 앞당겨서는 안 된다. 대기와
     * 재시도는 둘 다 「PENDING + 미래 시각」이라 겉모습이 같아, 표식 없이 되돌리면 통째로 취소된다.
     */
    @Test
    void reCompletingTheBundleDoesNotCancelATransportRetryBackoff() {
        UUID group = UUID.randomUUID();
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        UUID third = UUID.randomUUID();
        when(transport.send(anyString(), any(), anyBoolean(), anyString()))
                .thenReturn(PushTransport.Result.RETRY);
        acceptOpen("open-first", 1, group, first, List.of(first, second));
        acceptOpen("open-second", 2, group, second, List.of(first, second));

        flush();

        assertThat(retryAt("open-first")).isEqualTo(DAY.plusSeconds(60));

        // 같은 슬롯의 다음 스캔이 회차 하나를 더해 묶음을 다시 완성시킨다.
        when(clock.instant()).thenReturn(DAY.plusSeconds(20));
        when(transport.send(anyString(), any(), anyBoolean(), anyString())).thenReturn(PushTransport.Result.SENT);
        acceptOpen("open-third", 3, group, third, List.of(first, second, third));

        flush();

        for (String eventId : List.of("open-first", "open-second")) {
            assertThat(status(eventId)).isEqualTo("PENDING");
            assertThat(retryAt(eventId)).isEqualTo(DAY.plusSeconds(60));
            assertThat(store.one("SELECT attempts,last_error FROM deliveries WHERE event_id=?", eventId))
                    .containsEntry("attempts", 1).containsEntry("last_error", "FCM_RETRY");
        }
        assertThat(status("open-third")).isEqualTo("SENT");
    }

    /**
     * 조용한 시간 이월도 「아직 기다려야 할 시간」이다 — 묶음이 다시 완성돼도 앞당기지 않고, 창이
     * 끝난 뒤에 <b>한 건으로</b> 다시 모인다.
     */
    @Test
    void quietHoursDeferralSurvivesReCompletionAndRegroupsIntoOnePush() {
        UUID group = UUID.randomUUID();
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        UUID third = UUID.randomUUID();
        when(clock.instant()).thenReturn(QUIET);
        acceptOpen("open-first", 1, group, first, List.of(first, second));
        acceptOpen("open-second", 2, group, second, List.of(first, second));

        flush();

        assertThat(status("open-first")).isEqualTo("DEFERRED");
        assertThat(retryAt("open-first")).isEqualTo(QUIET_END);

        when(clock.instant()).thenReturn(QUIET.plusSeconds(10));
        acceptOpen("open-third", 3, group, third, List.of(first, second, third));

        flush();

        verifyNoInteractions(transport);
        for (String eventId : List.of("open-first", "open-second", "open-third")) {
            assertThat(status(eventId)).isEqualTo("DEFERRED");
            assertThat(retryAt(eventId)).isEqualTo(QUIET_END);
        }

        when(clock.instant()).thenReturn(QUIET_END);

        flush();

        ArgumentCaptor<RenderedPush> rendered = ArgumentCaptor.forClass(RenderedPush.class);
        verify(transport, times(1)).send(anyString(), rendered.capture(), anyBoolean(), anyString());
        assertThat(rendered.getValue().body()).isEqualTo("참여 가능한 챌린지 3개가 열려 있어요");
    }

    /** {@link JobRegistry} 의 flush 와 같은 격리 — 한 건의 실패가 나머지 후보를 끊지 않는다. */
    private void flush() {
        for (UUID id : dispatch.candidates()) {
            try {
                dispatch.dispatch(id);
            } catch (RuntimeException failure) {
                dispatch.backOff(id, failure.getClass().getSimpleName());
            }
        }
    }

    /**
     * 모집 사건 하나를 수신시킨다 — 발송부가 적어 보내는 묶음 구성원을 그대로 싣는다.
     *
     * @param members 이 스캔이 이 (유저 × 그룹 × 슬롯) 에 적는 회차 전부
     */
    private void acceptOpen(String eventId, long version, UUID group, UUID session, List<UUID> members) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("kind", KIND);
        params.put("quietPolicy", "DEFER");
        params.put("groupId", group.toString());
        params.put("slotAt", DAY.toString());
        params.put("challengeId", session.toString());
        params.put("stake", 300);
        params.put("deferExpiresAt", DAY.plusSeconds(86400).toString());
        params.put("bundleMembers", members.stream().map(UUID::toString).toList());
        inbound.accept(NotificationStoreTest.event(eventId, "notification.requested", USER, version,
                session.toString(), params));
    }

    private String status(String eventId) {
        return store.one("SELECT status FROM deliveries WHERE event_id=?", eventId).get("status").toString();
    }

    private Instant retryAt(String eventId) {
        return ((Timestamp) store.one("SELECT next_attempt_at FROM deliveries WHERE event_id=?", eventId)
                .get("next_attempt_at")).toInstant();
    }
}
