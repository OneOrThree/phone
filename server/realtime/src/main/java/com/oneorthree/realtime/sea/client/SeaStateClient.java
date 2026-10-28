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
    public record SeaState(String remark, Instant remarkChangedAt, Session session, String name, String catColor,
            Appearance appearance) {
        /** 외양을 모르는 호출(테스트·옛 Data 응답 모양). */
        public SeaState(String remark, Instant remarkChangedAt, Session session, String name, String catColor) {
            this(remark, remarkChangedAt, session, name, catColor, null);
        }

        /** 이름·털색을 모르는 호출(테스트·옛 Data 응답 모양). */
        public SeaState(String remark, Instant remarkChangedAt, Session session) {
            this(remark, remarkChangedAt, session, null, null, null);
        }

        /** 방 구성원 표시에 쓰는 머리·목 착용 아이템 — 없으면 null (GROMO-2389). */
        public String head() {
            return appearance == null ? null : appearance.head();
        }

        public String neck() {
            return appearance == null ? null : appearance.neck();
        }

        /** 외양 version — 모르면 0. 입장 뒤 늦게 오는 옛 사건을 거르는 기준이다. */
        public long appearanceVersion() {
            return appearance == null ? 0L : appearance.version();
        }
    }

    /** Data 착용 외양 중 바다 방 표시에 쓰는 머리·목 (GROMO-2389). 나머지 필드는 읽지 않는다. */
    public record Appearance(String head, String neck, long version) {
        /** 버전을 모르는 호출(테스트) — 0 이다. */
        public Appearance(String head, String neck) {
            this(head, neck, 0L);
        }
    }

    public record Session(UUID sessionId, UUID destinationIslandId, Integer sailingMinutes, Long activeSeconds,
            Instant serverNow, Instant startedAt) {

        /** 숫자·시각 필드까지 다 있어야 완전하다 — 하나라도 null 이면 호출부가 NPE 대신 상류 불량으로 접는다. */
        boolean complete() {
            return sessionId != null && destinationIslandId != null && startedAt != null
                    && sailingMinutes != null && activeSeconds != null && serverNow != null;
        }
    }
}
