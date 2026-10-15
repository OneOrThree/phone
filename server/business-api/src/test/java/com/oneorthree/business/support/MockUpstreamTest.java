package com.oneorthree.business.support;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import static org.assertj.core.api.Assertions.assertThat;

/** GROMO-1951 — 이전 테스트에서 취소된 형제 조각이 reset 뒤에 도착해도 다음 테스트 기록에 섞이지 않는다. */
class MockUpstreamTest {

    private final MockUpstream mock = MockUpstream.start();
    private final HttpClient http = HttpClient.newHttpClient();

    @AfterEach
    void close() {
        mock.close();
    }

    @Test
    void lateArrivalOfAFinishedRequestIsNotRecordedAfterReset() throws Exception {
        mock.on("GET /me", request -> new MockUpstream.Response(200, "{}"));
        send("/me", "finished");
        mock.reset();

        send("/islands", "finished"); // 앞 요청의 형제가 늦게 도착
        assertThat(mock.received()).isEmpty();
        assertThat(mock.hits("GET /islands")).isZero();

        send("/islands", "fresh");
        assertThat(mock.received()).extracting(MockUpstream.RecordedRequest::methodAndPath)
                .containsExactly("GET /islands");
    }

    private void send(String path, String requestId) throws InterruptedException {
        HttpRequest request = HttpRequest.newBuilder(URI.create(mock.baseUrl() + path))
                .header("X-Request-Id", requestId).GET().build();
        try {
            http.send(request, HttpResponse.BodyHandlers.discarding());
        } catch (IOException ignored) {
            // 잔여물은 응답 없이 끊긴다 — 실제 호출자는 이미 취소하고 떠났다.
        }
    }
}
