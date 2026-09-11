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
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 발송 큐가 «흐르는지»와 챌린지 종료가 «한 건으로 접히는지»의 회귀 잠금.
 *
 * <p>둘 다 조용히 깨지는 결함이다. 앞의 것은 보류 행 몇 개가 후보 상한을 채우는 순간 다른 사용자의
 * 알림이 통째로 멈추고(에러도 로그도 없다), 뒤의 것은 종료 챌린지 수만큼 같은 푸시가 더 나간다.
 */
@SpringBootTest
@ActiveProfiles("ci")
@Testcontainers
class DispatchBacklogTest {

    /** {@link DispatchService#candidates()} 의 상한 — 이 수만큼만 보류 행이 있어도 큐가 막혔다. */
    private static final int WINDOW = 25;

    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    static final UUID USER = UUID.fromString("22222222-2222-4222-8222-222222222222");
    static final UUID OTHER = UUID.fromString("33333333-3333-4333-8333-333333333333");
    static final Instant DAY = Instant.parse("2026-09-11T03:00:00Z");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", PG::getJdbcUrl);
        registry.add("spring.datasource.username", PG::getUsername);
        registry.add("spring.datasource.password", PG::getPassword);
    }

    @Autowired Store store;
    @Autowired DeviceService devices;
    @Autowired InboundService inbound;
    @Autowired AckService ack;
    @Autowired DispatchService dispatch;
    @MockitoBean PushTransport transport;
    @MockitoBean DataClient data;
    @MockitoBean Clock clock;

    @BeforeEach
    void resetState() {
        store.update("TRUNCATE delivery_devices,deliveries,inbound_events,commands,device_tokens,session_fences,"
                + "user_fences,settings,projections,result_ack,templates,deeplinks,kinds CASCADE");
        store.update("UPDATE dispatch_control SET enabled=true,ever_opened=true");
        store.update("INSERT INTO kinds(id,quiet_policy,eligibility_required) VALUES('BET_RESULT','DEFER',true)");
        store.update("INSERT INTO templates(id,kind,locale,title,body)"
                + " VALUES('BET_RESULT.ko','BET_RESULT','ko','결과','내기 {count}건')");
        reset(transport, data, clock);
        when(clock.instant()).thenReturn(DAY);
        when(clock.getZone()).thenReturn(ZoneOffset.UTC);
        when(data.eligible(any(), anyString(), any(), any())).thenReturn(true);
        when(transport.send(anyString(), any(), anyBoolean(), anyString())).thenReturn(PushTransport.Result.SENT);
    }

    /**
     * ack 보류 행 25 건이 후보 상한을 통째로 차지해도, 뒤에 선 <b>다른 사용자</b>의 알림과
     * {@code BET_SILENT_FLUSH} 가 보류 해제까지 굶어서는 안 된다.
     *
     * <p>보류는 실패가 아니므로 시도 횟수·사유를 쌓지 않고, «풀릴 수 있는 시각»(= 보류 만료)으로만
     * 이월한다. 이월하지 않으면 같은 정렬(next_attempt_at,id)로 다음 tick 에도 앞자리를 다시 차지한다.
     */
    @Test
    void ackHeldRowsFillingTheCandidateWindowDoNotStarveOtherUsersOrSilentFlush() {
        register(USER, "device", "bootstrap", "register");
        register(OTHER, "other-device", "other-bootstrap", "register-other");
        store.update("INSERT INTO kinds(id,silent,quiet_policy,eligibility_required)"
                + " VALUES('BET_SILENT_FLUSH',true,'BYPASS',true)");
        store.update("INSERT INTO templates(id,kind,locale,title,body)"
                + " VALUES('BET_SILENT_FLUSH.ko','BET_SILENT_FLUSH','ko',NULL,'')");
        for (int index = 0; index < WINDOW; index++) {
            UUID session = UUID.randomUUID();
            ack.command(USER, session, "prepare", "hold-" + index);
            accept("held-" + index, USER, index + 1, session.toString(),
                    Map.of("kind", "BET_RESULT", "count", 1));
        }
        // 보류 행이 후보 정렬의 «앞 25 건»을 통째로 차지하게 만든다.
        store.update("UPDATE deliveries SET next_attempt_at=?", Timestamp.from(DAY.minusSeconds(600)));
        accept("other-user", OTHER, 1, UUID.randomUUID().toString(), Map.of("kind", "BET_RESULT", "count", 1));
        accept("silent", USER, 99, UUID.randomUUID().toString(), Map.of("kind", "BET_SILENT_FLUSH"));

        assertThat(dispatch.candidates()).hasSize(WINDOW)
                .doesNotContain(delivery("other-user"), delivery("silent"));
        flush();
        verifyNoInteractions(transport);

        // 보류 행은 만료 시각으로 이월돼 상한에서 빠진다 — 실패로 세지 않는다.
        Map<String, Object> held = store.one("SELECT status,attempts,last_error,next_attempt_at"
                + " FROM deliveries WHERE event_id='held-0'");
        assertThat(held).containsEntry("status", "PENDING").containsEntry("attempts", 0)
                .containsEntry("last_error", null);
        assertThat(((Timestamp) held.get("next_attempt_at")).toInstant()).isEqualTo(DAY.plusSeconds(30));
        assertThat(dispatch.candidates())
                .containsExactlyInAnyOrder(delivery("other-user"), delivery("silent"));

        flush();
        verify(transport, times(2)).send(anyString(), any(), anyBoolean(), anyString());
        assertThat(status(delivery("other-user"))).isEqualTo("SENT");
        assertThat(status(delivery("silent"))).isEqualTo("SENT");
    }

    /**
     * 아직 닫히지 않은 결과 슬롯도 같은 자리를 점거한다 — 슬롯이 닫히는 시각으로 이월해야
     * 뒤에 선 다른 사용자의 알림이 그 15 분 동안 멈추지 않는다.
     */
    @Test
    void openResultSlotsFillingTheWindowAreCarriedToSlotCloseInsteadOfBlockingTheQueue() {
        register(USER, "device", "bootstrap", "register");
        register(OTHER, "other-device", "other-bootstrap", "register-other");
        UUID group = UUID.randomUUID();
        for (int index = 0; index < WINDOW; index++) {
            accept("slot-" + index, USER, index + 1, UUID.randomUUID().toString(),
                    Map.of("kind", "BET_RESULT", "count", 1, "groupId", group.toString(),
                            "slotAt", DAY.toString()));
        }
        store.update("UPDATE deliveries SET next_attempt_at=?", Timestamp.from(DAY.minusSeconds(600)));
        accept("behind", OTHER, 1, UUID.randomUUID().toString(), Map.of("kind", "BET_RESULT", "count", 1));

        assertThat(dispatch.candidates()).hasSize(WINDOW).doesNotContain(delivery("behind"));
        flush();
        verifyNoInteractions(transport);
        assertThat(((Timestamp) store.one("SELECT next_attempt_at FROM deliveries WHERE event_id='slot-0'")
                .get("next_attempt_at")).toInstant()).isEqualTo(DAY.plusSeconds(900));
        assertThat(dispatch.candidates()).containsExactly(delivery("behind"));

        flush();
        verify(transport, times(1)).send(anyString(), any(), anyBoolean(), anyString());
        assertThat(status(delivery("behind"))).isEqualTo("SENT");
    }

    /**
     * 같은 그룹에서 챌린지 둘이 함께 끝나면 «한 건»이 나가고, 딥링크의 challengeId 는 구 경로와 같은
     * <b>대표</b>(가장 먼저 만들어진 챌린지)여야 한다. 문구에 개수가 없으므로 묶음 템플릿이 아니라
     * 원래 템플릿 그대로 렌더한다.
     *
     * <p>대표는 발송부가 사건마다 명시한 값으로 정한다 — 여기서는 일부러 <b>대표를 나중에 수신</b>시켜
     * 수신 순서 가정이 아님을 못 박는다.
     */
    @Test
    void challengeEndBundlesPerGroupAndKeepsTheRepresentativeChallenge() {
        register(USER, "device", "bootstrap", "register");
        endKind("CHALLENGE_WINDOW_END", "결과를 확인해보세요");
        UUID group = UUID.randomUUID();
        UUID representative = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        List<UUID> batch = List.of(representative, second);
        acceptEnd("end-second", "CHALLENGE_WINDOW_END", 1, group, second, batch);
        acceptEnd("end-first", "CHALLENGE_WINDOW_END", 2, group, representative, batch);

        flush();

        ArgumentCaptor<RenderedPush> rendered = ArgumentCaptor.forClass(RenderedPush.class);
        ArgumentCaptor<String> collapse = ArgumentCaptor.forClass(String.class);
        verify(transport, times(1)).send(anyString(), rendered.capture(), anyBoolean(), collapse.capture());
        assertThat(rendered.getValue().title()).isEqualTo("챌린지가 끝났어요!");
        assertThat(rendered.getValue().body()).isEqualTo("결과를 확인해보세요");
        assertThat(rendered.getValue().data())
                .containsEntry("challengeId", representative.toString())
                .containsEntry("groupId", group.toString())
                .containsEntry("link", "gromo://group?g=" + group + "&challenge=" + representative);
        assertThat(collapse.getValue())
                .isEqualTo("bundle:" + USER + ":" + group + ":CHALLENGE_WINDOW_END:" + DAY);
        // 대변한 챌린지 «전부»에 영수증이 남는다 — 다음 회차가 되살릴 근거다.
        assertThat(status(delivery("end-first"))).isEqualTo("SENT");
        assertThat(status(delivery("end-second"))).isEqualTo("SENT");
        assertThat(store.rows("SELECT * FROM delivery_devices")).hasSize(2);

        flush();
        verify(transport, times(1)).send(anyString(), any(), anyBoolean(), anyString());
    }

    /**
     * <b>수신과 발송이 교차</b>하는 경우 — 한 배치의 첫 사건만 도착한 사이에 flush 가 끼면, 묶음을
     * 켜 두어도 같은 배치가 두 번 나간다(구 경로는 배치당 그룹 한 건이었다).
     *
     * <p>그래서 발송부가 적어 보낸 배치 크기만큼 모이기를 기다리고, 다 온 뒤에 «대표»로 한 건만 낸다.
     */
    @Test
    void aHalfArrivedBatchWaitsSoTheSameBatchIsNotPushedTwice() {
        register(USER, "device", "bootstrap", "register");
        endKind("CHALLENGE_WINDOW_END", "결과를 확인해보세요");
        UUID group = UUID.randomUUID();
        UUID representative = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        List<UUID> batch = List.of(representative, second);
        acceptEnd("end-first", "CHALLENGE_WINDOW_END", 1, group, representative, batch);

        flush();
        // 배치가 다 오지 않았다 — 아직 보내지 않고 뒤로 물려 상한만 비운다.
        verifyNoInteractions(transport);
        Map<String, Object> parked = store.one("SELECT attempts,last_error,next_attempt_at"
                + " FROM deliveries WHERE event_id='end-first'");
        // 기다림은 실패가 아니므로 시도 횟수를 올리지 않고, 재시도 backoff 와 구분되는 표식만 남는다.
        assertThat(parked).containsEntry("attempts", 0).containsEntry("last_error", "BUNDLE_INCOMPLETE");
        assertThat(((Timestamp) parked.get("next_attempt_at")).toInstant()).isEqualTo(DAY.plusSeconds(30));

        acceptEnd("end-second", "CHALLENGE_WINDOW_END", 2, group, second, batch);
        when(clock.instant()).thenReturn(DAY.plusSeconds(10));

        flush();
        ArgumentCaptor<RenderedPush> rendered = ArgumentCaptor.forClass(RenderedPush.class);
        verify(transport, times(1)).send(anyString(), rendered.capture(), anyBoolean(), anyString());
        // 기다리느라 세워 둔 대표가 다시 서서 «대표로» 한 건이 나간다.
        assertThat(rendered.getValue().data()).containsEntry("challengeId", representative.toString());
        assertThat(status(delivery("end-first"))).isEqualTo("SENT");
        assertThat(status(delivery("end-second"))).isEqualTo("SENT");
        // 대기 표식은 되돌리면서 지운다 — 남으면 다음 실패의 사유를 덮어쓴 채 굳는다.
        assertThat(store.one("SELECT last_error FROM deliveries WHERE event_id='end-first'"))
                .containsEntry("last_error", null);
    }

    /**
     * 묶음이 다 온 뒤 전송이 실패하면 그 행은 <b>재시도 backoff</b> 를 갖는다. 같은 축에 사건이 하나 더
     * 도착해 묶음을 다시 「완성」시켜도, 그 backoff 를 앞당겨 매 tick 다시 때려서는 안 된다.
     *
     * <p>대기와 재시도는 둘 다 「PENDING + 미래 시각」이라 겉모습이 같다. 표식 없이 되돌리면
     * 전송 실패·기기 없음의 backoff 가 통째로 취소된다.
     */
    @Test
    void completingTheBundleAgainDoesNotCancelATransportRetryBackoff() {
        register(USER, "device", "bootstrap", "register");
        endKind("CHALLENGE_WINDOW_END", "결과를 확인해보세요");
        UUID group = UUID.randomUUID();
        UUID representative = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        UUID third = UUID.randomUUID();
        List<UUID> batch = List.of(representative, second);
        acceptEnd("end-first", "CHALLENGE_WINDOW_END", 1, group, representative, batch);
        acceptEnd("end-second", "CHALLENGE_WINDOW_END", 2, group, second, batch);
        when(transport.send(anyString(), any(), anyBoolean(), anyString()))
                .thenReturn(PushTransport.Result.RETRY);

        flush();

        verify(transport, times(1)).send(anyString(), any(), anyBoolean(), anyString());
        assertThat(store.one("SELECT attempts,last_error,next_attempt_at FROM deliveries"
                + " WHERE event_id='end-first'"))
                .containsEntry("attempts", 1).containsEntry("last_error", "FCM_RETRY");
        assertThat(((Timestamp) store.one("SELECT next_attempt_at FROM deliveries WHERE event_id='end-first'")
                .get("next_attempt_at")).toInstant()).isEqualTo(DAY.plusSeconds(60));

        // 같은 날 다음 배치가 챌린지 하나를 더해 묶음을 다시 완성시킨다.
        acceptEnd("end-third", "CHALLENGE_WINDOW_END", 3, group, third,
                List.of(representative, second, third));
        when(clock.instant()).thenReturn(DAY.plusSeconds(20));
        when(transport.send(anyString(), any(), anyBoolean(), anyString()))
                .thenReturn(PushTransport.Result.SENT);

        flush();

        // 실패했던 두 행은 원래 backoff 를 그대로 지킨다 — 사유도 시도 횟수도 그대로다.
        for (String eventId : List.of("end-first", "end-second")) {
            Map<String, Object> backedOff = store.one("SELECT status,attempts,last_error,next_attempt_at"
                    + " FROM deliveries WHERE event_id=?", eventId);
            assertThat(backedOff).containsEntry("status", "PENDING").containsEntry("attempts", 1)
                    .containsEntry("last_error", "FCM_RETRY");
            assertThat(((Timestamp) backedOff.get("next_attempt_at")).toInstant())
                    .isEqualTo(DAY.plusSeconds(60));
        }
        assertThat(status(delivery("end-third"))).isEqualTo("SENT");
    }

    /**
     * 늦어진 사건을 <b>시간으로 포기하지 않는다</b>. 「얼마쯤 기다렸으니 온 것만 보낸다」로 닫으면,
     * 뒤늦게 도착한 형제가 그대로 두 번째 푸시가 되어 애초에 막으려던 중복이 그대로 남는다.
     * 유실은 outbox·DLT 가 되돌릴 문제이므로, 그때까지는 보내지 않고 뒤로 물리기만 한다 —
     * 그동안 다른 사용자의 큐는 계속 흐른다.
     */
    @Test
    void aLateBatchEventIsWaitedForIndefinitelyInsteadOfSendingAPartialBundle() {
        register(USER, "device", "bootstrap", "register");
        register(OTHER, "other-device", "other-bootstrap", "register-other");
        endKind("CHALLENGE_WINDOW_END", "결과를 확인해보세요");
        UUID group = UUID.randomUUID();
        UUID representative = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        List<UUID> batch = List.of(representative, second);
        acceptEnd("end-first", "CHALLENGE_WINDOW_END", 1, group, representative, batch);
        accept("other-user", OTHER, 1, UUID.randomUUID().toString(), Map.of("kind", "BET_RESULT", "count", 1));

        flush();
        // 뒤에 선 다른 사용자는 같은 회차에 나갔고, 불완전한 묶음은 나가지 않았다.
        verify(transport, times(1)).send(anyString(), any(), anyBoolean(), anyString());
        assertThat(status(delivery("other-user"))).isEqualTo("SENT");
        assertThat(status(delivery("end-first"))).isEqualTo("PENDING");

        // 한 시간이 지나도 «부분 발송»은 없다.
        when(clock.instant()).thenReturn(DAY.plusSeconds(3600));
        flush();
        verify(transport, times(1)).send(anyString(), any(), anyBoolean(), anyString());
        assertThat(status(delivery("end-first"))).isEqualTo("PENDING");

        // DLT 재처리로 유실분이 돌아오면 그때 «한 건»으로 복구된다.
        acceptEnd("end-second", "CHALLENGE_WINDOW_END", 2, group, second, batch);
        flush();
        ArgumentCaptor<RenderedPush> rendered = ArgumentCaptor.forClass(RenderedPush.class);
        verify(transport, times(2)).send(anyString(), rendered.capture(), anyBoolean(), anyString());
        assertThat(rendered.getValue().data()).containsEntry("challengeId", representative.toString());
        assertThat(status(delivery("end-first"))).isEqualTo("SENT");
        assertThat(status(delivery("end-second"))).isEqualTo("SENT");
    }

    /**
     * 창형과 일 목표형은 문구가 다르다(구 경로의 dedup 축도 pushType 별이었다). 같은 그룹·같은 날이라도
     * 한 묶음으로 섞으면 한쪽 문구가 사라진다.
     */
    @Test
    void windowEndAndDurationEndAreNotMergedIntoOneBundle() {
        register(USER, "device", "bootstrap", "register");
        endKind("CHALLENGE_WINDOW_END", "결과를 확인해보세요");
        endKind("CHALLENGE_ENDED", "어제 목표 달성 결과를 확인해보세요");
        UUID group = UUID.randomUUID();
        UUID windowChallenge = UUID.randomUUID();
        UUID durationChallenge = UUID.randomUUID();
        acceptEnd("window", "CHALLENGE_WINDOW_END", 1, group, windowChallenge, List.of(windowChallenge));
        acceptEnd("duration", "CHALLENGE_ENDED", 2, group, durationChallenge, List.of(durationChallenge));

        flush();

        ArgumentCaptor<RenderedPush> rendered = ArgumentCaptor.forClass(RenderedPush.class);
        ArgumentCaptor<String> collapse = ArgumentCaptor.forClass(String.class);
        verify(transport, times(2)).send(anyString(), rendered.capture(), anyBoolean(), collapse.capture());
        assertThat(rendered.getAllValues()).extracting(RenderedPush::body)
                .containsExactlyInAnyOrder("결과를 확인해보세요", "어제 목표 달성 결과를 확인해보세요");
        assertThat(collapse.getAllValues()).containsExactlyInAnyOrder(
                "bundle:" + USER + ":" + group + ":CHALLENGE_WINDOW_END:" + DAY,
                "bundle:" + USER + ":" + group + ":CHALLENGE_ENDED:" + DAY);
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

    private void endKind(String kind, String body) {
        store.update("INSERT INTO kinds(id,quiet_policy,eligibility_required) VALUES(?,'DROP',true)", kind);
        store.update("INSERT INTO templates(id,kind,locale,title,body) VALUES(?,?,'ko','챌린지가 끝났어요!',?)",
                kind + ".ko", kind, body);
        store.update("INSERT INTO deeplinks(id,url_template,data_template)"
                + " VALUES(?,'gromo://group?g={groupId}&challenge={challengeId}',?::jsonb)",
                kind, "{\"type\":\"" + kind + "\"}");
    }

    private void accept(String eventId, UUID user, long version, String subject, Map<String, Object> params) {
        inbound.accept(NotificationStoreTest.event(eventId, "notification.requested", user, version, subject, params));
    }

    /**
     * 종료 사건 하나를 수신시킨다 — 발송부가 적어 보내는 배치 메타를 그대로 싣는다.
     *
     * @param members 이 배치가 이 (유저 × 그룹)에 적는 대상 전부. 첫 원소가 대표다
     */
    private void acceptEnd(String eventId, String kind, long version, UUID group, UUID challenge,
            List<UUID> members) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("kind", kind);
        params.put("groupId", group.toString());
        params.put("slotAt", DAY.toString());
        params.put("challengeId", challenge.toString());
        params.put("bundleRepresentative", members.get(0).toString());
        params.put("bundleMembers", members.stream().map(UUID::toString).toList());
        accept(eventId, USER, version, challenge.toString(), params);
    }

    private void register(UUID user, String token, String bootstrap, String key) {
        devices.register(user, Map.of("deviceToken", token, "deviceBootstrap", bootstrap,
                "sessionEpoch", 1, "authGeneration", 0), key);
    }

    private UUID delivery(String eventId) {
        return (UUID) store.one("SELECT id FROM deliveries WHERE event_id=?", eventId).get("id");
    }

    private String status(UUID id) {
        return store.one("SELECT status FROM deliveries WHERE id=?", id).get("status").toString();
    }
}
