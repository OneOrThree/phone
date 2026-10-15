package com.oneorthree.business.common.http;

import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamCredentialRejectedException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.exception.UpstreamTimeoutException;
import com.oneorthree.business.common.exception.UpstreamUnavailableException;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.ObjectMapper;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.LockSupport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 실제 HTTP 응답 분류와 서킷 탐침의 종료를 함께 검증한다. */
class InternalHttpClientRecoveryTest {
    private HttpServer server;
    private InternalHttpClient client;
    private final AtomicInteger status = new AtomicInteger(503);
    private final AtomicInteger requests = new AtomicInteger();

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/probe", exchange -> {
            requests.incrementAndGet();
            int code = status.get();
            byte[] body = (code == 404 ? "{\"code\":\"SLUG_NOT_FOUND\",\"message\":\"없는 링크\"}" : "{}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(code, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        // 운영 설정의 양수 제약을 유지하며 짧은 차단 창을 실제 503으로 연다.
        client = new InternalHttpClient(UpstreamTarget.LINK,
                new UpstreamProperties("http://127.0.0.1:" + server.getAddress().getPort(), "synthetic-token",
                        Duration.ofSeconds(1), Duration.ofSeconds(1), 1, Duration.ofMillis(1)), new ObjectMapper());
        assertThatThrownBy(() -> client.execute(call(), Deadline.unbounded()))
                .isInstanceOf(UpstreamUnavailableException.class);
        assertThat(requests.get()).isEqualTo(1);
        Thread.sleep(5); // 1ms 차단 창 뒤의 half-open 경로가 검증 대상이다.
    }

    @AfterEach
    void stop() throws Exception {
        if (client != null) {
            client.close();
        }
        if (server != null) {
            server.stop(0);
        }
    }

    @ParameterizedTest
    @CsvSource({"404,domain", "401,credential", "400,contract"})
    void nonRetryableResponseReleasesProbe(int code, String category) {
        status.set(code);
        Class<? extends RuntimeException> expected = switch (category) {
            case "domain" -> UpstreamDomainException.class;
            case "credential" -> UpstreamCredentialRejectedException.class;
            default -> UpstreamContractMismatchException.class;
        };
        assertThatThrownBy(() -> client.execute(call(), Deadline.unbounded())).isInstanceOf(expected);
        assertThat(requests.get()).isEqualTo(2);
        status.set(200);
        assertThatCode(() -> client.execute(call(), Deadline.unbounded())).doesNotThrowAnyException();
        assertThat(requests.get()).isEqualTo(3);
    }

    @Test
    void exhaustedBudgetDoesNotAcquireProbe() {
        assertThatThrownBy(() -> client.execute(call(), Deadline.startingNow(Duration.ZERO)))
                .isInstanceOf(UpstreamTimeoutException.class);
        assertThat(requests.get()).isEqualTo(1);
        status.set(200);
        assertThatCode(() -> client.execute(call(), Deadline.unbounded())).doesNotThrowAnyException();
        assertThat(requests.get()).isEqualTo(2);
    }

    @Test
    void shortBudgetNonIdempotentWriteNeverReachesServerOrConsumesProbe() {
        status.set(200);
        assertThatThrownBy(() -> client.execute(call(), Deadline.startingNow(Duration.ofMillis(100))))
                .isInstanceOf(UpstreamTimeoutException.class);
        // setup의 503 한 건뿐이다. 짧은 예산의 명령은 TCP 서버에 도착하지 않았다.
        assertThat(requests.get()).isEqualTo(1);
        assertThatCode(() -> client.execute(call(), Deadline.startingNow(Duration.ofSeconds(5))))
                .doesNotThrowAnyException();
        assertThat(requests.get()).isEqualTo(2);
    }

    @Test
    void explicitlyIdempotentWriteCanUseShortRemainingBudget() {
        status.set(200);
        InternalCall safe = InternalCall.to(HttpMethod.POST, "/probe").idempotentCommand().build();
        assertThatCode(() -> client.execute(safe, Deadline.startingNow(Duration.ofSeconds(1))))
                .doesNotThrowAnyException();
        assertThat(requests.get()).isEqualTo(2);
    }

    @Test
    void serializationThatConsumesStartBudgetNeverSendsAndReleasesAcquiredProbe() {
        status.set(200);
        Deadline deadline = Deadline.startingNow(Duration.ofSeconds(3));
        BudgetConsumingPayload payload = new BudgetConsumingPayload(deadline);
        InternalCall write = InternalCall.to(HttpMethod.POST, "/probe").body(payload).build();
        assertThatThrownBy(() -> client.execute(write, deadline)).isInstanceOf(UpstreamTimeoutException.class);
        assertThat(payload.visited.get()).isTrue();
        assertThat(requests.get()).isEqualTo(1);
        assertThatCode(() -> client.execute(call(), Deadline.unbounded())).doesNotThrowAnyException();
        assertThat(requests.get()).isEqualTo(2);
    }

    @Test
    void requestSerializationFailureAlsoReleasesProbe() {
        // 새 URI 빌더는 중괄호를 안전하게 인코딩한다. 실제 DTO 직렬화 실패의 탐침 정리를 검증한다.
        InternalCall malformed = InternalCall.to(HttpMethod.POST, "/probe").body(new BrokenPayload()).build();
        assertThatThrownBy(() -> client.execute(malformed, Deadline.unbounded()))
                .isInstanceOf(UpstreamContractMismatchException.class);
        assertThat(requests.get()).isEqualTo(1);
        status.set(200);
        assertThatCode(() -> client.execute(call(), Deadline.unbounded())).doesNotThrowAnyException();
        assertThat(requests.get()).isEqualTo(2);
    }

    private InternalCall call() {
        return InternalCall.to(HttpMethod.POST, "/probe").build();
    }

    public static class BudgetConsumingPayload {
        private final Deadline deadline;
        private final AtomicBoolean visited = new AtomicBoolean();

        BudgetConsumingPayload(Deadline deadline) {
            this.deadline = deadline;
        }

        public String getValue() {
            visited.set(true);
            while (deadline.remaining().compareTo(Duration.ofMillis(1500)) > 0) {
                LockSupport.parkNanos(Duration.ofMillis(5).toNanos());
            }
            return "serialized-after-budget-was-consumed";
        }
    }

    public static class BrokenPayload {
        public String getValue() {
            throw new IllegalStateException("직렬화할 수 없는 테스트 DTO");
        }
    }
}
