package com.oneorthree.realtime.focus;

import com.oneorthree.realtime.common.exception.UpstreamUnavailableException;
import com.oneorthree.realtime.message.exception.ChatErrorCode;
import com.oneorthree.realtime.message.exception.ChatException;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 응원 인가의 술어 — <b>누가 통과하고 누가 거절되는가</b> (GROMO-1765).
 *
 * <p>{@code GroupClientTest} 와 같은 이유로 실제 HTTP(JDK 내장 서버)로 받는다: 여기서 갈리는 것은
 * 「어느 실패를 거절로 접고 어느 실패를 판정 불가로 올리는가」이고, 그건 RestClient 가 <b>언제 본문을
 * 읽는지</b>에 달려 있어 목으로는 한 글자도 검증되지 않는다.
 *
 * <p>가장 중요한 케이스는 <b>{@code paused}</b> 다. 2026-09-20 결정으로 휴식 중에도 응원을 보내므로,
 * 이 술어가 {@code active} 만 보던 시절로 되돌아가면 「쉬면 응원이 안 나간다」가 조용히 부활한다 —
 * 통합 테스트는 이 클라이언트를 목으로 두므로 그 회귀를 여기서만 잡을 수 있다.
 */
class IslandFocusSessionsTest {

    private static final UUID ISLAND = UUID.fromString("019f16a0-0000-7000-8000-000000000001");
    private static final UUID USER = UUID.fromString("019f16a0-0000-7000-8000-000000000002");
    private static final UUID SESSION = UUID.fromString("019f16a0-0000-7000-8000-000000000003");
    private static final String TOKEN = "svc-realtime-to-data";

    private HttpServer server;
    private IslandFocusSessions focusSessions;
    private final AtomicReference<String> body = new AtomicReference<>();
    private final AtomicInteger status = new AtomicInteger(200);
    private final AtomicReference<String> lastAuthorization = new AtomicReference<>();
    private final AtomicReference<String> lastSubject = new AtomicReference<>();
    private final AtomicReference<String> lastPath = new AtomicReference<>();

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/internal/islands", exchange -> {
            lastAuthorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            lastSubject.set(exchange.getRequestHeaders().getFirst("X-User-Id"));
            lastPath.set(exchange.getRequestURI().getPath());
            byte[] bytes = body.get().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status.get(), bytes.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(bytes);
            }
        });
        server.start();
        focusSessions = new IslandFocusSessions("http://127.0.0.1:" + server.getAddress().getPort(), TOKEN, 1000);
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    @ParameterizedTest
    @ValueSource(strings = {"active", "paused"})
    @DisplayName("진행 중이면 통과한다 — 휴식(paused)도 포함이다(2026-09-20 결정)")
    void progressingStatusesPass(String status) {
        respondWith(member(USER, SESSION, status));

        assertThatCode(() -> focusSessions.requireActiveSession(ISLAND, USER, SESSION)).doesNotThrowAnyException();
        assertThatCode(() -> focusSessions.requireActiveSession(ISLAND, USER, null)).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("목록에 없거나 남의 세션·남의 행이면 NOT_FOCUSING 이다 — 바뀐 건 paused 하나뿐이다")
    void otherRowsAndSessionsAreStillRejected() {
        UUID other = UUID.randomUUID();

        respondWith("");
        assertNotFocusing(SESSION);

        // 완료·포기는 애초에 focus-members 에 실리지 않는다. 그래도 status 를 집합으로 «확인»하므로
        // Data 가 나중에 다른 상태를 같은 목록에 실어도 조용히 허용되지 않는다.
        respondWith(member(USER, SESSION, "completed"));
        assertNotFocusing(SESSION);

        // 남의 세션 — 그 섬에서 집중 중이긴 해도 본인이 주장한 세션이 아니다.
        respondWith(member(USER, SESSION, "paused"));
        assertNotFocusing(UUID.randomUUID());

        // 남의 행만 있다 — 다른 사람이 집중 중이라고 내가 보낼 수 있는 것은 아니다.
        respondWith(member(other, SESSION, "active"));
        assertNotFocusing(SESSION);
    }

    @Test
    @DisplayName("서비스 토큰과 주체를 실어 그 섬의 경로로 묻는다")
    void sendsServiceCredentialAndSubject() {
        respondWith(member(USER, SESSION, "active"));

        focusSessions.requireActiveSession(ISLAND, USER, SESSION);

        assertThat(lastAuthorization.get()).isEqualTo("Bearer " + TOKEN);
        assertThat(lastSubject.get()).isEqualTo(USER.toString());
        assertThat(lastPath.get()).isEqualTo("/internal/islands/" + ISLAND + "/focus-members");
    }

    @Test
    @DisplayName("상류가 답하지 않으면 «거절» 이 아니라 «판정 불가» 다 — fail-closed 지만 코드가 다르다")
    void upstreamFailureIsNotADenial() {
        status.set(503);
        respondWith("{\"code\":\"UNKNOWN\"}");

        assertThatThrownBy(() -> focusSessions.requireActiveSession(ISLAND, USER, SESSION))
                .isInstanceOf(UpstreamUnavailableException.class);
    }

    @Test
    @DisplayName("base-url·토큰이 비면 전량 거절한다 — 배선되지 않은 배포에서 응원만 조용히 열리지 않게")
    void unwiredDeploymentRejectsEverything() {
        assertThatThrownBy(() -> new IslandFocusSessions("", TOKEN, 1000)
                .requireActiveSession(ISLAND, USER, SESSION)).isInstanceOf(UpstreamUnavailableException.class);
        assertThatThrownBy(() -> new IslandFocusSessions("http://127.0.0.1:1", "", 1000)
                .requireActiveSession(ISLAND, USER, SESSION)).isInstanceOf(UpstreamUnavailableException.class);
    }

    private void assertNotFocusing(UUID sessionId) {
        assertThatThrownBy(() -> focusSessions.requireActiveSession(ISLAND, USER, sessionId))
                .isInstanceOf(ChatException.class)
                .extracting(e -> ((ChatException) e).getErrorCode())
                .isEqualTo(ChatErrorCode.NOT_FOCUSING);
    }

    /** 상류의 실제 응답 모양({@code IslandFocusMembersView}) — 판정에 안 쓰는 필드도 그대로 싣는다. */
    private static String member(UUID userId, UUID sessionId, String status) {
        return "{\"userId\":\"" + userId + "\",\"name\":\"수아\",\"sessionId\":\"" + sessionId + "\","
                + "\"subject\":\"영어 단어\",\"activeSeconds\":1320,\"status\":\"" + status + "\"}";
    }

    private void respondWith(String item) {
        body.set("{\"items\":[" + item + "],\"serverNow\":\"2026-09-20T00:00:00Z\",\"watermarks\":[]}");
    }
}
