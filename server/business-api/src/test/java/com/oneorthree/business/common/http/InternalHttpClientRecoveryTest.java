package com.oneorthree.business.common.http;

import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamCredentialRejectedException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
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
        // 차단 창 경과를 기다리는 테스트가 아니다. 실제 503으로 열린 뒤 즉시 탐침을 허용한다.
        client = new InternalHttpClient(UpstreamTarget.LINK,
                new UpstreamProperties("http://127.0.0.1:" + server.getAddress().getPort(), "synthetic-token",
                        Duration.ofSeconds(1), Duration.ofSeconds(1), 1, Duration.ZERO), new ObjectMapper());
        assertThatThrownBy(() -> client.execute(call(), Deadline.unbounded()))
                .isInstanceOf(UpstreamUnavailableException.class);
        assertThat(requests.get()).isEqualTo(1);
    }

    @AfterEach
    void stop() {
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
                .isInstanceOf(UpstreamUnavailableException.class).hasMessageContaining("시간 예산 소진");
        assertThat(requests.get()).isEqualTo(1);
        status.set(200);
        assertThatCode(() -> client.execute(call(), Deadline.unbounded())).doesNotThrowAnyException();
        assertThat(requests.get()).isEqualTo(2);
    }

    @Test
    void requestConstructionFailureAlsoReleasesProbe() {
        InternalCall malformed = InternalCall.to(HttpMethod.GET, "/{missing}").build();
        assertThatThrownBy(() -> client.execute(malformed, Deadline.unbounded()))
                .isInstanceOf(IllegalArgumentException.class);
        status.set(200);
        assertThatCode(() -> client.execute(call(), Deadline.unbounded())).doesNotThrowAnyException();
        assertThat(requests.get()).isEqualTo(2);
    }

    private InternalCall call() {
        return InternalCall.to(HttpMethod.POST, "/probe").build();
    }
}
