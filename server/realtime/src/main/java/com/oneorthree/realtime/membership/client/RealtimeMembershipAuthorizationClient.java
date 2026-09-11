package com.oneorthree.realtime.membership.client;

import com.oneorthree.realtime.auth.VerifiedAccessIdentity;
import com.oneorthree.realtime.common.exception.UpstreamUnavailableException;
import com.oneorthree.realtime.config.RealtimeAuthorizationProperties;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/** Data753 단일 멤버십 판정 전용. 서비스 오류는 사용자401이나 부정 판정으로 바꾸지 않는다. */
@Slf4j
public class RealtimeMembershipAuthorizationClient {
    private static final int MAX_RESPONSE_BYTES = 1024;
    private static final JsonMapper JSON = JsonMapper.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();
    private final HttpClient http;
    private final URI endpoint;
    private final String serviceToken;
    private final Duration requestTimeout;
    private final Semaphore capacity;

    public RealtimeMembershipAuthorizationClient(RealtimeAuthorizationProperties properties) {
        properties.validate();
        if (!properties.isEnabled()) {
            throw new IllegalArgumentException("현재 멤버십 HTTP client는 활성 설정에서만 생성합니다.");
        }
        endpoint = URI.create(properties.getBaseUrl()).resolve("/internal/realtime/membership-authorization");
        serviceToken = properties.getServiceToken();
        requestTimeout = properties.getRequestTimeout();
        capacity = new Semaphore(properties.getMaxInFlight());
        http = HttpClient.newBuilder().connectTimeout(properties.getConnectTimeout())
                .followRedirects(HttpClient.Redirect.NEVER).build();
    }

    /** 헤더부터 마지막 body byte까지 한 예산. 응답이나 요청을 재시도/캐시하지 않는다. */
    public boolean isAllowed(VerifiedAccessIdentity identity, UUID islandId) {
        long started = System.nanoTime();
        if (!capacity.tryAcquire()) {
            log.warn("현재 멤버십 조회 실패 — outcome=capacity status=0 durationMs=0");
            throw new UpstreamUnavailableException();
        }
        var outcome = new AtomicReference<>("transport");
        var status = new AtomicInteger();
        var subscriber = new AtomicReference<LimitedBodySubscriber>();
        var stopped = new AtomicBoolean();
        CompletableFuture<HttpResponse<byte[]>> response = null;
        boolean completed = false;
        try {
            long deadline = started + requestTimeout.toNanos();
            String body = "{\"sessionId\":\"" + identity.sessionId() + "\",\"authGeneration\":"
                    + identity.authGeneration() + ",\"islandId\":\"" + islandId + "\"}";
            long remaining = deadline - System.nanoTime();
            if (remaining <= 0) {
                throw new TimeoutException();
            }
            HttpRequest request = HttpRequest.newBuilder(endpoint).timeout(Duration.ofNanos(remaining))
                    .header("Authorization", "Bearer " + serviceToken)
                    .header("X-User-Id", identity.userId().toString())
                    .header("X-Request-Id", UUID.randomUUID().toString())
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .header("Cache-Control", "no-store")
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8)).build();
            response = http.sendAsync(request, info -> {
                status.set(info.statusCode());
                var reader = new LimitedBodySubscriber(outcome);
                subscriber.set(reader);
                if (stopped.get()) {
                    reader.cancel();
                } else if (info.statusCode() != 200) {
                    outcome.set("status");
                    reader.cancel();
                } else if (!isJson(info)) {
                    outcome.set("content_type");
                    reader.cancel();
                }
                return reader;
            });
            remaining = deadline - System.nanoTime();
            if (remaining <= 0) {
                throw new TimeoutException();
            }
            byte[] bytes = response.get(remaining, TimeUnit.NANOSECONDS).body();
            outcome.set("contract");
            JsonNode result = JSON.readTree(bytes);
            if (result == null || !result.isObject() || result.size() != 1 || !result.has("allowed")
                    || !result.get("allowed").isBoolean()) {
                throw new UpstreamUnavailableException();
            }
            boolean allowed = result.get("allowed").booleanValue();
            if (deadline - System.nanoTime() <= 0) {
                throw new TimeoutException();
            }
            outcome.set(allowed ? "allowed" : "denied");
            completed = true;
            return allowed;
        } catch (InterruptedException e) {
            outcome.set("interrupted");
            Thread.currentThread().interrupt();
            throw new UpstreamUnavailableException();
        } catch (TimeoutException e) {
            outcome.set("deadline");
            throw new UpstreamUnavailableException();
        } catch (ExecutionException e) {
            if (e.getCause() instanceof HttpTimeoutException) {
                outcome.set("deadline");
            }
            throw new UpstreamUnavailableException();
        } catch (RuntimeException e) {
            // 원격 응답·URL·토큰을 포함할 수 있는 cause를 외부 예외나 로그에 붙이지 않는다.
            throw new UpstreamUnavailableException();
        } finally {
            stopped.set(true);
            LimitedBodySubscriber reader = subscriber.get();
            if (!completed) {
                if (reader != null) {
                    reader.cancel();
                }
                if (response != null) {
                    response.cancel(true);
                }
                log.warn("현재 멤버십 조회 실패 — outcome={} status={} durationMs={}",
                        outcome.get(), status.get(), TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started));
            } else {
                log.debug("현재 멤버십 조회 — outcome={} status=200 durationMs={}", outcome.get(),
                        TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started));
            }
            capacity.release();
        }
    }

    private static boolean isJson(HttpResponse.ResponseInfo info) {
        List<String> values = info.headers().allValues("Content-Type");
        if (values.size() != 1) {
            return false;
        }
        try {
            MediaType type = MediaType.parseMediaType(values.get(0));
            return "application".equalsIgnoreCase(type.getType()) && "json".equalsIgnoreCase(type.getSubtype());
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    /** ofByteArray 이후 크기를 재는 대신 각 chunk를 복사하기 전에 한도를 검사한다. */
    private static final class LimitedBodySubscriber implements HttpResponse.BodySubscriber<byte[]> {
        private final CompletableFuture<byte[]> body = new CompletableFuture<>();
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        private final AtomicBoolean cancelled = new AtomicBoolean();
        private final AtomicReference<String> outcome;
        private volatile Flow.Subscription subscription;

        private LimitedBodySubscriber(AtomicReference<String> outcome) {
            this.outcome = outcome;
        }

        @Override
        public CompletionStage<byte[]> getBody() {
            return body;
        }

        @Override
        public void onSubscribe(Flow.Subscription value) {
            subscription = value;
            if (cancelled.get()) {
                value.cancel();
            } else {
                value.request(Long.MAX_VALUE);
            }
        }

        @Override
        public void onNext(List<ByteBuffer> chunks) {
            if (cancelled.get()) {
                return;
            }
            for (ByteBuffer chunk : chunks) {
                int size = chunk.remaining();
                if (size > MAX_RESPONSE_BYTES - bytes.size()) {
                    outcome.set("body_limit");
                    cancel();
                    return;
                }
                byte[] copy = new byte[size];
                chunk.get(copy);
                bytes.writeBytes(copy);
            }
        }

        @Override
        public void onError(Throwable failure) {
            body.completeExceptionally(new UpstreamUnavailableException());
        }

        @Override
        public void onComplete() {
            if (!cancelled.get()) {
                body.complete(bytes.toByteArray());
            }
        }

        private void cancel() {
            cancelled.set(true);
            Flow.Subscription current = subscription;
            if (current != null) {
                current.cancel();
            }
            body.completeExceptionally(new UpstreamUnavailableException());
        }
    }
}
