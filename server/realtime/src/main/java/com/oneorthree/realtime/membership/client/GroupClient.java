package com.oneorthree.realtime.membership.client;

import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.common.exception.UpstreamRejectedCredentialException;
import com.oneorthree.realtime.common.exception.UpstreamUnavailableException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.io.UncheckedIOException;
import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * 검증된 요청자의 활성 섬 목록을 Data 내부 API에서 조회한다.
 *
 * <p>AT는 로컬에서 서명·만료·타입을 검증하고, 상류에는 서비스 자격과 확정된 사용자 ID만 보낸다.
 * Data는 현재 사용자와 활성 멤버십을 판정한다. 서비스 인증 오류나 잘못된 응답은 소속 없음으로
 * 캐시하지 않으며, 탈퇴·삭제된 사용자는 자격 거절로 구분한다.
 */
@Slf4j
@Component
public class GroupClient {

    private final RestClient restClient;
    private final Semaphore concurrency;
    private final long timeoutMs;
    private final String serviceToken;
    private final JwtValidator jwtValidator;

    public GroupClient(String baseUrl, long timeoutMs, String serviceToken, JwtValidator jwtValidator) {
        this(baseUrl, timeoutMs, 32, serviceToken, jwtValidator);
    }

    @Autowired
    public GroupClient(@Value("${chat.data-api.base-url}") String baseUrl,
            @Value("${chat.data-api.timeout-ms:2000}") long timeoutMs,
            @Value("${chat.data-api.max-concurrency:32}") int maxConcurrency,
            @Value("${chat.data-api.service-token}") String serviceToken,
            JwtValidator jwtValidator) {
        if (serviceToken == null || serviceToken.isBlank() || serviceToken.contains("${")
                || serviceToken.chars().anyMatch(value -> value <= 32 || value >= 127)) {
            throw new IllegalArgumentException("멤버십 조회용 Data 서비스 자격 설정이 올바르지 않습니다.");
        }
        this.serviceToken = serviceToken;
        this.jwtValidator = java.util.Objects.requireNonNull(jwtValidator);
        this.timeoutMs = timeoutMs;
        this.concurrency = new Semaphore(maxConcurrency);
        this.restClient = RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(timeoutFactory(timeoutMs))
                .build();
    }

    /**
     * 타임아웃을 «반드시» 지정하기 위한 팩토리.
     *
     * <p>기본 팩토리는 타임아웃이 무제한이다. 그 상태로 상류가 멈추면 STOMP 채널 스레드가 그대로
     * 잠기고, 채널 스레드는 풀이라 곧 전부 소진돼 <b>상류 한 곳의 지연이 채팅 전체의 정지</b>가 된다.
     *
     * <p>{@code SimpleClientHttpRequestFactory}(HttpURLConnection)를 쓰는 이유: read 타임아웃이 «소켓 읽기마다»
     * 적용돼 헤더 뒤 본문이 멈춰도 끊긴다. JDK HttpClient 의 요청 타임아웃은 응답 헤더까지만 제한해 본문 정지에
     * 무한 대기가 된다. 연결 재사용은 JDK 기본 keep-alive({@code http.keepAlive})에 맡기고, 동시성은
     * {@link #concurrency} 세마포어로 묶는다.
     */
    private static ClientHttpRequestFactory timeoutFactory(long timeoutMs) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofMillis(timeoutMs));
        factory.setReadTimeout(Duration.ofMillis(timeoutMs));
        return factory;
    }

    /**
     * @param bearerToken 요청자의 Authorization 헤더. 유효한 access 토큰의 사용자만 조회한다
     * @return 활성 섬 ID 집합. 형식이 깨진 성공 응답은 캐시할 수 없는 거절로 돌린다
     * @throws UpstreamRejectedCredentialException AT가 무효이거나 사용자가 탈퇴·삭제됐을 때
     * @throws UpstreamUnavailableException Data 장애 또는 서비스 자격·허용목록 배선 오류일 때
     */
    public Membership fetchMyGroupIds(String bearerToken) {
        String token = bearerToken != null && bearerToken.startsWith("Bearer ") ? bearerToken.substring(7) : null;
        UUID userId = jwtValidator.extractUserId(token).orElseThrow(UpstreamRejectedCredentialException::new);
        boolean acquired;
        try {
            acquired = concurrency.tryAcquire(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new UpstreamUnavailableException();
        }
        if (!acquired) {
            log.warn("그룹 조회 동시 상한 초과 — 대기 {}ms 안에 자리가 나지 않았다", timeoutMs);
            throw new UpstreamUnavailableException();
        }
        try {
            return fetch(userId);
        } finally {
            concurrency.release();
        }
    }

    private Membership fetch(UUID userId) {
        try {
            return restClient.get()
                    .uri("/internal/users/{userId}/islands", userId)
                    .header("Authorization", "Bearer " + serviceToken)
                    .header("X-User-Id", userId.toString())
                    .exchange((request, response) -> {
                        HttpStatusCode status = response.getStatusCode();
                        if (status.value() == 404) {
                            UpstreamError error = response.bodyTo(UpstreamError.class);
                            if (error != null && "USER_NOT_FOUND".equals(error.code())) {
                                throw new UpstreamRejectedCredentialException();
                            }
                        }
                        // 내부 401/403은 사용자 판정이 아니라 서비스 자격·허용목록 배선 오류다.
                        if (!status.is2xxSuccessful()) {
                            throw new UpstreamUnavailableException();
                        }
                        MyIslands islands = response.bodyTo(MyIslands.class);
                        // items=[]만 정상적인 무소속이다. 누락·null·ID 없는 항목은 방문자 자격이 아니다.
                        if (islands == null || islands.items() == null
                                || islands.items().stream().anyMatch(item -> item == null || item.id() == null)) {
                            log.warn("섬 목록 응답 형식 불량 — status={}", status.value());
                            return Membership.rejected();
                        }
                        return Membership.of(islands.items().stream().map(IslandRef::id).collect(Collectors.toSet()));
                    });
        } catch (UpstreamUnavailableException | UpstreamRejectedCredentialException e) {
            throw e;
        } catch (RestClientException | UncheckedIOException e) {
            log.warn("섬 목록 조회 실패 — 상류 응답 없음", e);
            throw new UpstreamUnavailableException();
        }
    }

    /**
     * @param groupIds 활성 섬 ID 집합
     * @param cacheable 조회한 소속으로 캐시해도 되는가. 불완전한 성공 응답은 false다
     */
    public record Membership(Set<UUID> groupIds, boolean cacheable) {

        public static Membership of(Set<UUID> groupIds) {
            return new Membership(groupIds, true);
        }

        public static Membership rejected() {
            return new Membership(Set.of(), false);
        }
    }

    /** Data의 MyIslandsView에서 소속 목록만 읽는다. */
    public record MyIslands(List<IslandRef> items) {
    }

    /** 소속 섬의 식별자. 다른 요약 필드는 소비하지 않는다. */
    public record IslandRef(UUID id) {
    }

    /** 사용자 부재와 내부 경로·자격 오류를 구분하는 Data 오류 코드. */
    public record UpstreamError(String code) {
    }
}
