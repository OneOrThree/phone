package com.oneorthree.phone.outbox.support;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 위성 서비스(링크·알림) 자리에 세우는 <b>진짜 HTTP 서버</b>.
 *
 * <p>목 대신 실제 소켓을 쓰는 이유: 검증 대상이 「relay 가 무엇을 보내는가」가 아니라 <b>상태 코드에
 * 따라 무엇을 표시하는가</b>이기 때문이다. 목으로 세우면 HTTP 배선(헤더·본문·타임아웃)이 통째로
 * 테스트 밖으로 빠져, 계약 §8 이 금지한 「목이 생산 경로를 대신 세우는」 상태가 된다.
 */
public final class StubSatelliteServer {

    private final HttpServer server;
    private final AtomicInteger status = new AtomicInteger(200);
    private final List<Received> received = new CopyOnWriteArrayList<>();

    private StubSatelliteServer(HttpServer server) {
        this.server = server;
    }

    /**
     * 임의 포트로 띄운다.
     *
     * @param path 받을 경로
     * @return 기동한 서버
     */
    public static StubSatelliteServer start(String path) {
        try {
            HttpServer http = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            StubSatelliteServer stub = new StubSatelliteServer(http);
            http.createContext(path, stub::handle);
            http.start();
            return stub;
        } catch (IOException e) {
            throw new IllegalStateException("위성 스텁 기동 실패", e);
        }
    }

    private void handle(HttpExchange exchange) throws IOException {
        String body;
        try (InputStream in = exchange.getRequestBody()) {
            body = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
        received.add(new Received(
                exchange.getRequestMethod(),
                exchange.getRequestURI().getPath(),
                exchange.getRequestHeaders().getFirst("Authorization"),
                body));
        int code = status.get();
        exchange.sendResponseHeaders(code, -1);
        exchange.close();
    }

    /** @return {@code http://127.0.0.1:<port>} */
    public String baseUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    /**
     * 다음 응답 상태를 바꾼다 — 장애·복구를 재현한다.
     *
     * @param code HTTP 상태
     */
    public void respondWith(int code) {
        status.set(code);
    }

    /** @return 지금까지 받은 요청들 */
    public List<Received> received() {
        return List.copyOf(received);
    }

    /** 받은 기록을 비운다. */
    public void clear() {
        received.clear();
    }

    /** 서버를 내린다. */
    public void stop() {
        server.stop(0);
    }

    /**
     * 받은 요청 한 건.
     *
     * @param method       HTTP method
     * @param path         경로 — {@code {userId}} 가 실제 값으로 채워졌는지 본다
     * @param serviceToken caller 별 서비스 토큰
     * @param body         본문
     */
    public record Received(String method, String path, String serviceToken, String body) {
    }
}
