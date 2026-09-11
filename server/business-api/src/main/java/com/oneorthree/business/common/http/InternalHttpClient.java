package com.oneorthree.business.common.http;

import com.oneorthree.business.common.exception.CompositionCapacityExceededException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamCredentialRejectedException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.exception.UpstreamTimeoutException;
import com.oneorthree.business.common.exception.UpstreamUnavailableException;
import lombok.extern.slf4j.Slf4j;
import org.apache.hc.client5.http.classic.methods.HttpUriRequestBase;
import org.apache.hc.client5.http.config.ConnectionConfig;
import org.apache.hc.client5.http.config.RequestConfig;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder;
import org.apache.hc.core5.http.ContentType;
import org.apache.hc.core5.http.io.entity.ByteArrayEntity;
import org.apache.hc.core5.util.Timeout;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.web.util.UriComponentsBuilder;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 내부 HTTP의 유일한 창구. 전체 예산에는 큐·연결·본문·재시도가 모두 포함된다.
 * Apache 요청 자체를 취소하여 Future만 끝나고 연결은 남는 경우를 막는다.
 * 대상별 자격·풀을 격리하고 내장 재시도/redirect/cookie는 사용하지 않는다.
 */
@Slf4j
public class InternalHttpClient implements AutoCloseable {

    private static final int MAX_RESPONSE_BYTES = 1024 * 1024;

    private final UpstreamTarget target;
    private final UpstreamProperties properties;
    private final String serviceToken;
    private final CloseableHttpClient http;
    private final ThreadPoolExecutor workers;
    private final CircuitBreaker circuitBreaker;
    private final ObjectMapper objectMapper;

    public InternalHttpClient(UpstreamTarget target, UpstreamProperties properties, ObjectMapper objectMapper) {
        RequiredConfig.require(properties.baseUrl(), target + " base-url");
        this.serviceToken = RequiredConfig.require(properties.serviceToken(), target + " service-token");
        URI base = URI.create(properties.baseUrl());
        if (base.getHost() == null || base.getUserInfo() != null
                || !("http".equals(base.getScheme()) || "https".equals(base.getScheme()))) {
            throw new IllegalArgumentException("상류 base-url이 올바르지 않습니다.");
        }
        this.target = target;
        this.properties = properties;
        this.objectMapper = objectMapper;
        this.circuitBreaker = new CircuitBreaker(properties.failureThreshold(), properties.openDuration());
        this.http = HttpClients.custom().disableAutomaticRetries().disableRedirectHandling().disableCookieManagement()
                .setConnectionManager(PoolingHttpClientConnectionManagerBuilder.create()
                        .setMaxConnTotal(properties.maxConnections()).setMaxConnPerRoute(properties.maxConnections())
                        .setDefaultConnectionConfig(ConnectionConfig.custom()
                                .setConnectTimeout(timeout(properties.connectTimeout()))
                                .setSocketTimeout(timeout(properties.readTimeout())).build()).build()).build();
        this.workers = new ThreadPoolExecutor(properties.maxConnections(), properties.maxConnections(),
                30, TimeUnit.SECONDS, new ArrayBlockingQueue<>(properties.queueCapacity()), runnable -> {
                    Thread thread = new Thread(runnable, "internal-http-" + target.name().toLowerCase());
                    thread.setDaemon(true);
                    return thread;
                }, new ThreadPoolExecutor.AbortPolicy());
        workers.allowCoreThreadTimeOut(true);
    }

    public UpstreamTarget target() {
        return target;
    }

    public void execute(InternalCall call, Deadline deadline) {
        exchange(call, deadline, null);
    }

    public void execute(InternalCall call, UpstreamRequestContext context) {
        exchange(call, context, null);
    }

    public <T> T exchange(InternalCall call, Deadline deadline, ParameterizedTypeReference<T> responseType) {
        return exchange(call, UpstreamRequestContext.capture(call.onBehalfOfUserId(), deadline), responseType);
    }

    public <T> T exchange(InternalCall call, UpstreamRequestContext context,
            ParameterizedTypeReference<T> responseType) {
        context.validate(call);
        for (int attempt = 1; ; attempt++) {
            context.checkActive();
            if (!circuitBreaker.allowRequest(System.currentTimeMillis())) {
                throw new UpstreamUnavailableException(target + " 서킷 오픈");
            }
            try {
                T result = attempt(call, context, responseType);
                context.checkActive();
                circuitBreaker.recordSuccess();
                return result;
            } catch (RetryableFailure | UpstreamTimeoutException failure) {
                // 부모 취소·인터럽트·전체 예산 소진은 새 시도로 바꾸지 않는다.
                if (context.cancelled() || Thread.currentThread().isInterrupted()
                        || context.deadline().remaining().isZero()) {
                    circuitBreaker.recordIgnored();
                    context.checkActive();
                }
                circuitBreaker.recordFailure(System.currentTimeMillis());
                if (!call.retryable() || attempt >= properties.maxAttempts()) {
                    if (failure instanceof UpstreamTimeoutException timeout) {
                        throw timeout;
                    }
                    throw new UpstreamUnavailableException(target + " 일시 응답 실패", failure);
                }
                Duration delay = failure instanceof RetryableFailure retry && retry.retryAfter != null
                        ? retry.retryAfter : properties.retryDelay();
                if (delay.compareTo(context.deadline().remaining()) >= 0) {
                    throw new UpstreamTimeoutException("재시도 대기가 전체 요청 예산을 초과합니다.");
                }
                log.warn("upstream_retry request_id={} target={} attempt={}",
                        context.requestId(), target, attempt + 1);
                pause(delay, context);
            } catch (UpstreamDomainException | UpstreamCredentialRejectedException
                    | UpstreamContractMismatchException terminal) {
                // HTTP 응답이 도착한 종결 판정이다. half-open 탐침도 이 자리에서 닫는다.
                circuitBreaker.recordSuccess();
                throw terminal;
            } catch (RuntimeException terminal) {
                circuitBreaker.recordIgnored();
                throw terminal;
            }
        }
    }

    private <T> T attempt(InternalCall call, UpstreamRequestContext context,
            ParameterizedTypeReference<T> responseType) {
        HttpUriRequestBase request = request(call, context);
        Duration attemptBudget = properties.connectTimeout().plus(properties.readTimeout());
        Duration remaining = context.deadline().remaining();
        long nanos = Math.min(attemptBudget.toNanos(), remaining.toNanos());
        request.setConfig(RequestConfig.custom().setConnectionRequestTimeout(Timeout.ofNanoseconds(nanos))
                .setResponseTimeout(timeout(properties.readTimeout())).build());
        Runnable unregister = context.onCancel(request::cancel);
        AtomicInteger responseStatus = new AtomicInteger();
        Future<T> future = null;
        try {
            context.checkActive();
            future = workers.submit(() -> send(request, call.body(), responseType, context, responseStatus));
            // enqueue 비용도 예산이다. 대기 시작 때 남은 시간을 다시 읽는다.
            nanos = Math.min(nanos, context.deadline().remaining().toNanos());
            T result = future.get(nanos, TimeUnit.NANOSECONDS);
            context.checkActive();
            return result;
        } catch (RejectedExecutionException e) {
            context.checkActive();
            throw new CompositionCapacityExceededException(target + " HTTP 실행 큐 포화", e);
        } catch (TimeoutException | CancellationException e) {
            rejectPartialClientError(responseStatus.get(), context);
            throw new UpstreamTimeoutException(target + " HTTP 시간 제한 또는 취소", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new UpstreamTimeoutException(target + " 호출 취소", e);
        } catch (ExecutionException e) {
            if (e.getCause() instanceof RuntimeException runtime) {
                throw runtime;
            }
            throw new UpstreamContractMismatchException(target + " 예상하지 못한 HTTP 처리 실패");
        } finally {
            unregister.run();
            if (future == null || !future.isDone()) {
                request.cancel();
                if (future != null) {
                    future.cancel(true);
                    workers.remove((Runnable) future);
                }
            }
        }
    }

    private HttpUriRequestBase request(InternalCall call, UpstreamRequestContext context) {
        UriComponentsBuilder builder = UriComponentsBuilder.fromUriString(properties.baseUrl()).path(call.path());
        call.query().forEach(builder::queryParam);
        HttpUriRequestBase request = new HttpUriRequestBase(call.method().name(), builder.build().encode().toUri());
        request.setHeader("Authorization", "Bearer " + serviceToken);
        request.setHeader("X-Request-Id", context.requestId());
        request.setHeader("Accept", "application/json");
        if (call.onBehalfOfUserId() != null) {
            request.setHeader("X-User-Id", context.subject().toString());
        }
        if (call.idempotencyKey() != null) {
            request.setHeader("Idempotency-Key", call.idempotencyKey());
        }
        call.declaredHeaders().forEach(request::setHeader);
        return request;
    }

    private <T> T send(HttpUriRequestBase request, Object body, ParameterizedTypeReference<T> responseType,
            UpstreamRequestContext context, AtomicInteger responseStatus) {
        context.checkActive();
        if (body != null) {
            try {
                request.setEntity(new ByteArrayEntity(
                        objectMapper.writeValueAsBytes(body), ContentType.APPLICATION_JSON));
            } catch (JacksonException e) {
                throw new UpstreamContractMismatchException(target + " 요청 DTO 변환 실패");
            }
        }
        try {
            return http.execute(request, response -> {
                int status = response.getCode();
                responseStatus.set(status);
                byte[] bytes = response.getEntity() == null ? new byte[0]
                        : response.getEntity().getContent().readNBytes(MAX_RESPONSE_BYTES + 1);
                if (bytes.length > MAX_RESPONSE_BYTES) {
                    throw new UpstreamContractMismatchException(target + " 응답 크기 상한 초과");
                }
                context.checkActive();
                if (status >= 200 && status < 300) {
                    if (responseType == null || bytes.length == 0) {
                        return null;
                    }
                    try {
                        return objectMapper.readValue(bytes, objectMapper.constructType(responseType.getType()));
                    } catch (JacksonException | IllegalArgumentException e) {
                        throw new UpstreamContractMismatchException(target + " 응답 DTO 변환 실패");
                    }
                }
                String retryAfter = response.getFirstHeader("Retry-After") == null ? null
                        : response.getFirstHeader("Retry-After").getValue();
                throw classify(status, new String(bytes, StandardCharsets.UTF_8), retryAfter);
            });
        } catch (SocketTimeoutException e) {
            rejectPartialClientError(responseStatus.get(), context);
            throw new UpstreamTimeoutException(target + " 연결 또는 읽기 시간 제한", e);
        } catch (IOException e) {
            rejectPartialClientError(responseStatus.get(), context);
            throw new RetryableFailure(null);
        }
    }

    /** 이미 받은 4xx는 오류 본문 유실로 재시도/선택 null이 될 수 없다. 전체 취소·예산은 우선한다. */
    private void rejectPartialClientError(int status, UpstreamRequestContext context) {
        context.checkActive();
        if (status >= 400 && status < 500) {
            throw new UpstreamContractMismatchException(target + " 상류 오류 본문 수신 실패 status=" + status);
        }
    }

    private RuntimeException classify(int status, String raw, String retryAfter) {
        // 내부 HTTP Authorization은 서비스 자격이다. 본문 코드가 있어도 사용자 401로 노출하지 않는다.
        if (status == 401) {
            return new UpstreamCredentialRejectedException(target + " 서비스 자격 거부 status=401");
        }
        UpstreamError parsed;
        try {
            parsed = objectMapper.readValue(raw, UpstreamError.class);
        } catch (JacksonException e) {
            parsed = null;
        }
        // 429는 도메인 제한을 그대로 반환한다. 전송 계층의 5xx 재시도에 섞지 않는다.
        if (status >= 500 && status <= 599) {
            return new RetryableFailure(parseRetryAfter(retryAfter));
        }
        if (parsed != null && parsed.code() != null && !parsed.code().isBlank()) {
            Duration wait = parseRetryAfter(retryAfter);
            Long waitMillis = parsed.retryAfterMs() != null ? parsed.retryAfterMs()
                    : wait == null ? null : wait.toMillis();
            return new UpstreamDomainException(status, parsed.code(), parsed.message(), waitMillis);
        }
        if (status == 401 || status == 403) {
            return new UpstreamCredentialRejectedException(target + " 서비스 자격 거부 status=" + status);
        }
        return new UpstreamContractMismatchException(target + " 미지원 상류 응답 status=" + status);
    }

    private static Duration parseRetryAfter(String value) {
        if (value == null) {
            return null;
        }
        try {
            long seconds = Long.parseLong(value);
            return seconds < 0 ? null : Duration.ofSeconds(seconds);
        } catch (NumberFormatException e) {
            try {
                Duration duration = Duration.between(Instant.now(),
                        ZonedDateTime.parse(value, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant());
                return duration.isNegative() ? Duration.ZERO : duration;
            } catch (RuntimeException ignored) {
                return null;
            }
        }
    }

    private static void pause(Duration delay, UpstreamRequestContext context) {
        long remaining = delay.toNanos();
        while (remaining > 0) {
            context.checkActive();
            long chunk = Math.min(remaining, TimeUnit.MILLISECONDS.toNanos(20));
            try {
                TimeUnit.NANOSECONDS.sleep(chunk);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new UpstreamTimeoutException("재시도 대기 취소", e);
            }
            remaining -= chunk;
        }
        context.checkActive();
    }

    private static Timeout timeout(Duration duration) {
        return Timeout.ofMilliseconds(Math.max(1, duration.toMillis()));
    }

    @Override
    public void close() throws IOException {
        workers.shutdownNow();
        http.close();
    }

    record UpstreamError(String code, String message, Long retryAfterMs) {
    }

    private static final class RetryableFailure extends RuntimeException {
        private static final long serialVersionUID = 1L;
        private final Duration retryAfter;

        private RetryableFailure(Duration retryAfter) {
            super("상류 연결 또는 서버 일시 실패");
            this.retryAfter = retryAfter;
        }
    }
}
