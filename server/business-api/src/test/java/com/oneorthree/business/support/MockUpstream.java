package com.oneorthree.business.support;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * <b>실제 HTTP 상류</b>를 띄운다 — JDK 내장 {@link HttpServer} 라 추가 의존성이 없다.
 *
 * <p>왜 스텁 빈이 아니라 실제 서버인가: 이 서비스의 계약 대부분이 «HTTP 표면»에 있다 — 어떤 헤더가
 * 실려 나가는가(서비스 토큰 · {@code X-User-Id} · {@code Idempotency-Key}), 재시도에서 그 헤더가
 * 유지되는가, 상태 코드별로 실패가 어떻게 갈라지는가. 클라이언트를 모킹하면 그 전부가 검증 대상에서
 * 빠지고, 「production seam 을 override 한 테스트로 통합 성공을 주장」하는 꼴이 된다.
 */
public final class MockUpstream implements AutoCloseable {

    private final HttpServer server;
    private final Map<String, Handler> handlers = new ConcurrentHashMap<>();
    private final List<RecordedRequest> received = new CopyOnWriteArrayList<>();
    private final Map<String, AtomicInteger> hitCounts = new ConcurrentHashMap<>();
    // ponytail: JVM 수명 동안 커지는 집합 — 테스트 요청 수(수천)만큼이라 비우지 않는다.
    private final Set<String> retiredRequestIds = new HashSet<>();

    private MockUpstream(HttpServer server) {
        this.server = server;
    }

    public static MockUpstream start() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            MockUpstream mock = new MockUpstream(server);
            server.createContext("/", mock::dispatch);
            server.setExecutor(null);
            server.start();
            // 테스트 클래스마다 닫으면 공유 인스턴스가 첫 클래스에서 사라진다 — JVM 이 끝날 때 한 번만 닫는다.
            Runtime.getRuntime().addShutdownHook(new Thread(mock::close));
            return mock;
        } catch (IOException e) {
            throw new IllegalStateException("mock 상류를 띄우지 못했다", e);
        }
    }

    public String baseUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    /** {@code "POST /internal/devices"} 처럼 method 와 path 를 합친 키로 등록한다. */
    public MockUpstream on(String methodAndPath, Handler handler) {
        handlers.put(methodAndPath, handler);
        return this;
    }

    /** 지정한 횟수만큼 실패한 뒤 성공한다 — 재시도가 실제로 도는지 보기 위한 장치. */
    public MockUpstream failThenSucceed(String methodAndPath, int failures, int failStatus, String successBody) {
        AtomicInteger remaining = new AtomicInteger(failures);
        return on(methodAndPath, request -> {
            if (remaining.getAndDecrement() > 0) {
                return new Response(failStatus, "{\"error\":\"boom\"}");
            }
            return new Response(200, successBody);
        });
    }

    public List<RecordedRequest> received() {
        return List.copyOf(received);
    }

    public List<RecordedRequest> receivedFor(String methodAndPath) {
        List<RecordedRequest> matched = new ArrayList<>();
        for (RecordedRequest request : received) {
            if (methodAndPath.equals(request.methodAndPath())) {
                matched.add(request);
            }
        }
        return matched;
    }

    public int hits(String methodAndPath) {
        AtomicInteger counter = hitCounts.get(methodAndPath);
        return counter == null ? 0 : counter.get();
    }

    /**
     * 이전 테스트의 기록을 비운다. 그때까지 본 {@code X-Request-Id} 는 «끝난 요청»으로 은퇴시킨다.
     *
     * <p>화면 조합은 필수 조각 하나가 실패하면 형제 조각을 취소하고 곧장 응답한다. 취소 시점에 형제의
     * 요청 바이트가 이미 소켓에 실려 있으면, 이 mock 은 그것을 «다음 테스트가 reset 한 뒤»에 받아
     * 기록한다(GROMO-1951 — LaunchScreenContractTest 의 「상류 호출 없음」 단언이 앞 테스트 502 요청의
     * 형제 {@code GET .../islands} 로 깨졌다). 같은 요청 ID 의 형제는 실패를 낸 응답을 받기 위해
     * reset 전에 이미 기록돼 있으므로, 그 ID 로 늦게 도착한 요청은 이전 테스트의 잔여물이다.
     */
    public synchronized void reset() {
        for (RecordedRequest request : received) {
            String requestId = request.header("X-Request-Id");
            if (requestId != null) {
                retiredRequestIds.add(requestId);
            }
        }
        received.clear();
        hitCounts.clear();
        handlers.clear();
    }

    /** 끝난 요청의 잔여물이면 기록하지 않는다. 기록 여부 판정과 reset 이 섞이지 않게 같은 락을 쓴다. */
    private synchronized boolean record(RecordedRequest request) {
        String requestId = request.header("X-Request-Id");
        if (requestId != null && retiredRequestIds.contains(requestId)) {
            return false;
        }
        received.add(request);
        hitCounts.computeIfAbsent(request.methodAndPath(), k -> new AtomicInteger()).incrementAndGet();
        return true;
    }

    private void dispatch(HttpExchange exchange) throws IOException {
        String path = exchange.getRequestURI().getPath();
        String key = exchange.getRequestMethod() + " " + path;
        byte[] bodyBytes = readAll(exchange.getRequestBody());

        Map<String, String> headers = new LinkedHashMap<>();
        exchange.getRequestHeaders().forEach((name, values) -> {
            if (!values.isEmpty()) {
                headers.put(name.toLowerCase(java.util.Locale.ROOT), values.get(0));
            }
        });

        RecordedRequest request = new RecordedRequest(
                key, path, exchange.getRequestURI().getQuery(), headers,
                new String(bodyBytes, StandardCharsets.UTF_8));
        if (!record(request)) {
            // 호출자는 이미 취소하고 떠났다 — 핸들러(카운터·실패 주입)를 소모하지 않고 끊는다.
            exchange.close();
            return;
        }

        Handler handler = handlers.get(key);
        Response response = handler == null
                // 등록하지 않은 경로는 404 다 — 「없는 표면을 불렀다」가 조용히 성공하지 않게 한다.
                ? new Response(404, "{\"code\":null,\"message\":\"등록되지 않은 mock 경로\"}")
                : handler.handle(request);

        if (response.status() == 0) {
            // 명령 수신 후 응답만 유실되는 실제 TCP 실패를 재현한다.
            exchange.close();
            return;
        }
        byte[] payload = response.body() == null
                ? new byte[0] : response.body().getBytes(StandardCharsets.UTF_8);
        if (payload.length > 0) {
            exchange.getResponseHeaders().add("Content-Type", "application/json;charset=UTF-8");
        }
        exchange.sendResponseHeaders(response.status(), payload.length == 0 ? -1 : payload.length);
        if (payload.length > 0) {
            exchange.getResponseBody().write(payload);
        }
        exchange.close();
    }

    private byte[] readAll(InputStream in) throws IOException {
        try (InputStream stream = in) {
            return stream.readAllBytes();
        }
    }

    @Override
    public void close() {
        server.stop(0);
    }

    /** 상류가 어떻게 답할지 정하는 함수. */
    public interface Handler {
        Response handle(RecordedRequest request);
    }

    public record Response(int status, String body) {
        public static Response disconnected() {
            return new Response(0, null);
        }
    }

    public record RecordedRequest(
            String methodAndPath,
            String path,
            String query,
            Map<String, String> headers,
            String body) {

        public String header(String name) {
            return headers.get(name.toLowerCase(java.util.Locale.ROOT));
        }
    }
}
