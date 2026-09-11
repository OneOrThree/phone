package com.oneorthree.business.common.http;

import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamCredentialRejectedException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.exception.UpstreamUnavailableException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

/**
 * 상류 하나에 대한 «유일한» 호출 창구 — 대상별 서비스 토큰 · 타임아웃 · 서킷 · 재시도 · 실패 분류.
 *
 * <h2>이 클래스가 지키는 계약</h2>
 * <ol>
 *   <li><b>caller 별 토큰을 명시된 대상에만</b>(A22 ㊀ · ㉱): 인스턴스 하나가 {@link UpstreamTarget}
 *       하나와 토큰 하나를 쥐고, 다른 대상에는 그 토큰이 실릴 통로가 없다.</li>
 *   <li><b>외부 {@code X-User-Id} 폐기 후 재설정</b>(A22 ㉸): 인바운드 헤더를 복사하는 경로가 아예
 *       없고, 값은 {@link InternalCall#onBehalfOfUserId()} 즉 검증한 AT subject 뿐이다.</li>
 *   <li><b>타임아웃은 필수</b>: 기본 팩토리는 무제한이라 상류 정지가 진입점 전체의 정지가 된다.</li>
 *   <li><b>재시도는 멱등 GET + 명시적 멱등 명령만</b>(§4), 그리고 <b>같은 {@code Idempotency-Key} 유지</b>
 *       (㉼) — 응답 유실 뒤 재시도가 중복 명령이 되지 않게 하는 유일한 장치다.</li>
 *   <li><b>예산 안에서만 재시도</b>: 남은 {@link Deadline} 이 read timeout 을 못 담으면 시도하지
 *       않는다(구 앱 match 5초 · claim 15초).</li>
 *   <li><b>실패를 「아니오」로 접지 않는다</b>: 응답 없음(503) · 자격 거절(502) · 계약 어긋남(502) ·
 *       도메인 판정(그대로 중계)을 서로 구분한다.</li>
 * </ol>
 *
 * <h2>재시도하지 않는 실패</h2>
 * 도메인 판정(코드가 실린 4xx)은 재시도해도 답이 같고, 자격 거절·계약 불일치는 배포 문제라 두들길수록
 * 나빠진다. 재시도는 <b>연결 실패 · 타임아웃 · 5xx</b> 에만 한다.
 */
@Slf4j
public class InternalHttpClient {

    private static final String HEADER_USER_ID = "X-User-Id";
    private static final String HEADER_IDEMPOTENCY_KEY = "Idempotency-Key";
    private static final int MAX_ATTEMPTS = 2;

    private final UpstreamTarget target;
    private final String serviceToken;
    private final Duration readTimeout;
    private final RestClient restClient;
    private final CircuitBreaker circuitBreaker;
    private final ObjectMapper objectMapper;

    public InternalHttpClient(UpstreamTarget target, UpstreamProperties properties, ObjectMapper objectMapper) {
        // ⚠️ blank 검사만으로는 부족하다 — 환경변수가 «아예 없을» 때 Spring 은 값을 리터럴
        //    "${SVC_TOKEN_...}" 로 남기고 부팅에 성공한다(실측). 그 리터럴이 Bearer 토큰으로 나가면
        //    상류가 전부 401 을 주고 운영에서 「인증 장애」로 오진된다. RequiredConfig 가 둘 다 막는다.
        RequiredConfig.require(properties.baseUrl(), target + " base-url");
        this.serviceToken = RequiredConfig.require(properties.serviceToken(), target + " service-token");
        this.target = target;
        this.readTimeout = properties.readTimeout();
        this.objectMapper = objectMapper;
        this.circuitBreaker = new CircuitBreaker(properties.failureThreshold(), properties.openDuration());
        this.restClient = RestClient.builder()
                .baseUrl(properties.baseUrl())
                .requestFactory(timeoutFactory(properties))
                .build();
    }

    /** 기본 팩토리는 타임아웃이 무제한이다 — 반드시 못박는다. */
    private static ClientHttpRequestFactory timeoutFactory(UpstreamProperties properties) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(properties.connectTimeout());
        factory.setReadTimeout(properties.readTimeout());
        return factory;
    }

    public UpstreamTarget target() {
        return target;
    }

    /** 본문이 없는(또는 무시하는) 호출. */
    public void execute(InternalCall call, Deadline deadline) {
        exchange(call, deadline, null);
    }

    /**
     * 호출하고 본문을 {@code responseType} 으로 읽는다.
     *
     * @return 2xx 본문. {@code responseType} 이 null 이거나 본문이 비면 null
     * @throws UpstreamDomainException            상류가 도메인 코드를 실어 거절했다 — 그대로 중계할 판정
     * @throws UpstreamCredentialRejectedException 우리 서비스 토큰이 거절됐다(배선 사고)
     * @throws UpstreamContractMismatchException  코드 없는 4xx — 우리 요청·배포가 어긋났다
     * @throws UpstreamUnavailableException       응답 없음 · 5xx · 서킷 오픈 — 「모른다」다
     */
    public <T> T exchange(InternalCall call, Deadline deadline, ParameterizedTypeReference<T> responseType) {
        RestClientException lastFailure = null;
        for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            if (!circuitBreaker.allowRequest(System.currentTimeMillis())) {
                throw new UpstreamUnavailableException(target + " 서킷 오픈 — " + call.method() + " " + call.path());
            }
            if (!deadline.hasRoomFor(readTimeout)) {
                // 예산이 read timeout 을 못 담는다. 첫 시도라면 예산 설정 자체가 잘못됐다는 뜻이므로
                // 남은 예산을 로그에 남긴다 — 조용히 짧은 타임아웃으로 대체하지 않는다.
                throw new UpstreamUnavailableException(target + " 시간 예산 소진 — remaining="
                        + deadline.remaining().toMillis() + "ms, readTimeout=" + readTimeout.toMillis() + "ms");
            }
            try {
                T body = send(call, responseType);
                circuitBreaker.recordSuccess();
                return body;
            } catch (UpstreamRetryableFailure e) {
                circuitBreaker.recordFailure(System.currentTimeMillis());
                lastFailure = e.cause();
                if (!call.retryable() || attempt == MAX_ATTEMPTS) {
                    throw new UpstreamUnavailableException(
                            target + " 응답 없음 — " + call.method() + " " + call.path(), e.cause());
                }
                // ⚠️ 같은 call 객체를 그대로 다시 보낸다 — Idempotency-Key 가 유지되는 것이 핵심이다.
                log.warn("{} 재시도 {}/{} — {} {}", target, attempt + 1, MAX_ATTEMPTS, call.method(), call.path());
            }
        }
        throw new UpstreamUnavailableException(target + " 응답 없음 — " + call.method() + " " + call.path(),
                lastFailure);
    }

    private <T> T send(InternalCall call, ParameterizedTypeReference<T> responseType) {
        try {
            RestClient.RequestBodySpec spec = restClient.method(call.method())
                    .uri(builder -> {
                        builder.path(call.path());
                        call.query().forEach(builder::queryParam);
                        return builder.build();
                    })
                    // 대상별 서비스 토큰. 이 인스턴스는 자기 대상의 토큰만 갖고 있어 다른 대상에 실릴 수 없다.
                    .header("Authorization", "Bearer " + serviceToken)
                    .accept(MediaType.APPLICATION_JSON);

            if (call.onBehalfOfUserId() != null) {
                // 검증한 AT subject «하나»만 실린다 — 인바운드 동명 헤더는 필터가 이미 폐기했다(A22 ㉸).
                spec = spec.header(HEADER_USER_ID, call.onBehalfOfUserId().toString());
            }
            if (call.idempotencyKey() != null) {
                spec = spec.header(HEADER_IDEMPOTENCY_KEY, call.idempotencyKey());
            }
            for (Map.Entry<String, String> header : call.declaredHeaders().entrySet()) {
                spec = spec.header(header.getKey(), header.getValue());
            }
            if (call.body() != null) {
                spec = spec.contentType(MediaType.APPLICATION_JSON).body(call.body());
            }

            return spec.exchange((request, response) -> {
                HttpStatusCode status = response.getStatusCode();
                if (status.is2xxSuccessful()) {
                    return responseType == null ? null : readBody(response, responseType);
                }
                throw classify(status, response);
            });
        } catch (RestClientException | UncheckedIOException e) {
            // 연결 불가·타임아웃·본문 변환 실패. 「답을 못 받았다」이지 「아니오」가 아니다.
            throw new UpstreamRetryableFailure(e instanceof RestClientException rce ? rce
                    : new RestClientException("본문 처리 실패", e));
        }
    }

    private <T> T readBody(RestClient.RequestHeadersSpec.ConvertibleClientHttpResponse response,
            ParameterizedTypeReference<T> responseType) {
        return response.bodyTo(responseType);
    }

    /**
     * 상류가 준 비-2xx 를 «네 갈래»로 나눈다.
     *
     * <p>도메인 코드가 실려 있으면 판정이므로 그대로 중계한다. 코드가 없는 401/403 은 우리 자격의
     * 문제이고, 코드 없는 그 밖의 4xx 는 계약 어긋남, 5xx 는 판정 불가다.
     */
    private RuntimeException classify(HttpStatusCode status,
            RestClient.RequestHeadersSpec.ConvertibleClientHttpResponse response) throws IOException {

        String raw = new String(response.getBody().readAllBytes(), StandardCharsets.UTF_8);
        UpstreamError parsed = parseError(raw);

        if (status.is5xxServerError()) {
            return new UpstreamRetryableFailure(new RestClientException(
                    target + " " + status.value() + " — " + summarize(parsed, raw)));
        }
        if (parsed != null && parsed.code() != null && !parsed.code().isBlank()) {
            // 앱이 이 문자열로 분기한다 — 재해석하지 않고 그대로 중계한다.
            return new UpstreamDomainException(status.value(), parsed.code(), parsed.message(),
                    parsed.retryAfterMs());
        }
        int code = status.value();
        if (code == 401 || code == 403) {
            return new UpstreamCredentialRejectedException(
                    target + " 가 서비스 자격을 거절했다 — status=" + code);
        }
        return new UpstreamContractMismatchException(
                target + " " + code + " (도메인 코드 없음) — " + summarize(parsed, raw));
    }

    /** 상류 봉투는 {@code {code, message, retryAfterMs?}} 다. 형태가 다르면 null 로 접는다. */
    private UpstreamError parseError(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readValue(raw, UpstreamError.class);
        } catch (JacksonException e) {
            // 상류가 봉투 모양이 아닌 본문을 줬다(HTML 오류 페이지 등) — 「도메인 코드 없음」으로 접는다.
            return null;
        }
    }

    /** 원문을 통째로 로그에 올리지 않는다 — 상류 응답에 개인정보가 섞일 수 있다. */
    private String summarize(UpstreamError parsed, String raw) {
        if (parsed != null && parsed.code() != null) {
            return parsed.code();
        }
        return "body=" + Math.min(raw == null ? 0 : raw.length(), 4096) + "B";
    }

    /** 상류 에러 봉투. 모르는 필드는 무시한다 — 상류가 필드를 늘려도 우리가 깨지지 않는다(ⓦ). */
    record UpstreamError(String code, String message, Long retryAfterMs) {
    }

    /** 재시도 대상 실패임을 내부에서만 나르는 표식. 밖으로 새지 않는다. */
    private static final class UpstreamRetryableFailure extends RuntimeException {

        private static final long serialVersionUID = 1L;

        private final transient RestClientException cause;

        private UpstreamRetryableFailure(RestClientException cause) {
            super(cause.getMessage(), cause);
            this.cause = cause;
        }

        RestClientException cause() {
            return cause;
        }
    }
}
