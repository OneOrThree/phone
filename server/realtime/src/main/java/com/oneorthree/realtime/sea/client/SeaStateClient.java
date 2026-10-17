package com.oneorthree.realtime.sea.client;

import com.oneorthree.realtime.common.exception.UpstreamUnavailableException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.io.UncheckedIOException;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

/**
 * 「이 사람의 지금 바다 상태」를 Data 정본에 묻는다 — {@code GET /internal/users/{id}/sea-state} (GROMO-2300).
 *
 * <p>{@code IslandFocusSessions} 와 같은 배선이다(RestClient + 서비스 토큰 + {@code X-User-Id}, 설정 키 재사용).
 * 바다 입장 한 번에 한 번만 부른다. 캐시하지 않는다. 답을 못 받으면 입장 자체가 실패한다 — 상태 없이는
 * 방 구성원 표시({@code member})를 만들 수 없다.
 */
@Slf4j
@Component
public class SeaStateClient {

    private final RestClient restClient;
    private final String serviceToken;

    public SeaStateClient(
            @Value("${realtime.focus.data-base-url:}") String baseUrl,
            @Value("${realtime.focus.data-service-token:}") String serviceToken,
            @Value("${realtime.focus.data-timeout-ms:1500}") long timeoutMs) {
        this.serviceToken = serviceToken;
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofMillis(timeoutMs));
        factory.setReadTimeout(Duration.ofMillis(timeoutMs));
        this.restClient = baseUrl.isBlank() ? null
                : RestClient.builder().baseUrl(baseUrl).requestFactory(factory).build();
    }

    /**
     * @throws UpstreamUnavailableException 배선 없음·2xx 아님·본문 계약 위반·통신 실패
     */
    public SeaState fetch(UUID userId) {
        if (restClient == null || serviceToken.isBlank()) {
            log.warn("바다 상태 상류가 배선되지 않았다 — 입장을 거절한다");
            throw new UpstreamUnavailableException();
        }
        try {
            SeaState state = restClient.get()
                    .uri("/internal/users/{userId}/sea-state", userId)
                    .header("Authorization", "Bearer " + serviceToken)
                    .header("X-User-Id", userId.toString())
                    .exchange((request, response) -> {
                        if (!response.getStatusCode().is2xxSuccessful()) {
                            log.debug("바다 상태 조회 실패 — status={}", response.getStatusCode().value());
                            throw new UpstreamUnavailableException();
                        }
                        return response.bodyTo(SeaState.class);
                    });
            if (state == null || (state.session() != null && !state.session().complete())) {
                throw new UpstreamUnavailableException();
            }
            return state;
        } catch (UpstreamUnavailableException e) {
            throw e;
        } catch (RestClientException | UncheckedIOException e) {
            log.warn("바다 상태 조회 실패 — reason={}", e.getClass().getSimpleName());
            throw new UpstreamUnavailableException();
        }
    }

    /** 응답 — 판정·표시에 쓰는 필드만. {@code session} 이 {@code null} 이면 항해 중이 아니다. */
    public record SeaState(String remark, Instant remarkChangedAt, Session session) {
    }

    public record Session(UUID sessionId, UUID destinationIslandId, Integer sailingMinutes, Long activeSeconds,
            Instant serverNow, Instant startedAt) {

        boolean complete() {
            return sessionId != null && destinationIslandId != null && startedAt != null;
        }
    }
}
