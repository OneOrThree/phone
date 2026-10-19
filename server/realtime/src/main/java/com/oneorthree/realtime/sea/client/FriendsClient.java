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
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 친구 id 목록 — {@code GET /internal/users/{id}/friends/ids} (GROMO-2300, 결정 N11). 바다 방 배정의 우선순위에만 쓴다.
 *
 * <p>{@link SeaStateClient} 와 같은 배선이다. 실패는 {@link UpstreamUnavailableException} 으로 올리고, 부르는 쪽이
 * 「친구 없음」으로 접는다 — 우선순위가 틀릴 뿐 입장은 막지 않는다.
 */
@Slf4j
@Component
public class FriendsClient {

    private final RestClient restClient;
    private final String serviceToken;

    public FriendsClient(
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
    public Set<UUID> fetchFriendIds(UUID userId) {
        if (restClient == null || serviceToken.isBlank()) {
            throw new UpstreamUnavailableException();
        }
        try {
            FriendIds body = restClient.get()
                    .uri("/internal/users/{userId}/friends/ids", userId)
                    .header("Authorization", "Bearer " + serviceToken)
                    .header("X-User-Id", userId.toString())
                    .exchange((request, response) -> {
                        if (!response.getStatusCode().is2xxSuccessful()) {
                            log.debug("친구 id 조회 실패 — status={}", response.getStatusCode().value());
                            throw new UpstreamUnavailableException();
                        }
                        return response.bodyTo(FriendIds.class);
                    });
            if (body == null || body.ids() == null) {
                throw new UpstreamUnavailableException();
            }
            return body.ids().stream().filter(Objects::nonNull).collect(Collectors.toUnmodifiableSet());
        } catch (UpstreamUnavailableException e) {
            throw e;
        } catch (RestClientException | UncheckedIOException e) {
            log.warn("친구 id 조회 실패 — reason={}", e.getClass().getSimpleName());
            throw new UpstreamUnavailableException();
        }
    }

    record FriendIds(List<UUID> ids) {
    }
}
