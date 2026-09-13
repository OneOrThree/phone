package com.oneorthree.phone.outbox.client;

import com.oneorthree.phone.config.OutboxRelayProperties;
import com.oneorthree.phone.outbox.repository.domain.EventOutboxDelivery;
import com.oneorthree.phone.outbox.repository.domain.OutboxTarget;
import com.oneorthree.phone.outbox.support.OutboxEnvelopeCodec;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.util.UUID;

/**
 * 위성 서비스(링크·알림)로 가는 내부 명령 전달 (계약 §2 · A21).
 *
 * <h2>SSRF 를 구조적으로 막는다</h2>
 * 목적지는 <b>설정의 허용목록에만</b> 있다. 전달 행은 논리 키({@code endpointKey})만 갖고, 그 키가
 * 목록에 없으면 <b>보내지 않는다</b>. payload 나 봉투가 URL·호스트·포트를 고를 수 있는 경로는 하나도
 * 없다 — 경로 자리표시자 {@code {userId}} 조차 <b>봉투의 userId</b> 에서만 채운다.
 *
 * <p>인증은 caller 별 서비스 토큰이다. 위성 수신부는 그 토큰과 명시한 method/path 허용목록으로
 * 호출자를 가른다 — 앱 JWT 로 위성을 인증하지 않는다.
 */
@Slf4j
public class HttpOutboxTransport implements OutboxTransport {

    /** 위성 수신부가 호출자를 가르는 헤더. */
    public static final String SERVICE_TOKEN_HEADER = "Authorization";

    /** 봉투 수신자를 경로에 넣을 때 쓰는 <b>유일한</b> 자리표시자. */
    private static final String USER_ID_PLACEHOLDER = "{userId}";

    private final OutboxTarget target;
    private final RestClient restClient;
    private final OutboxRelayProperties properties;

    /**
     * @param target     이 인스턴스가 맡는 대상(LINK 또는 NOTI)
     * @param restClient 공용 HTTP 클라이언트
     * @param properties 허용목록을 가진 설정
     */
    public HttpOutboxTransport(OutboxTarget target, RestClient restClient, OutboxRelayProperties properties) {
        this.target = target;
        this.restClient = restClient;
        this.properties = properties;
    }

    @Override
    public OutboxTarget target() {
        return target;
    }

    @Override
    public OutboxTransportResult send(EventOutboxDelivery delivery, UUID userId) {
        String key = delivery.getEndpointKey();
        OutboxRelayProperties.Endpoint endpoint = key == null ? null : properties.getEndpoints().get(key);
        if (endpoint == null) {
            // 「모르면 일단 보낸다」로 열면 저장 시점에 잘못 들어간 키가 곧 임의 목적지 호출이 된다.
            return OutboxTransportResult.permanent("허용목록에 없는 엔드포인트 키: " + key);
        }
        if (endpoint.getTarget() != target) {
            return OutboxTransportResult.permanent(
                    "엔드포인트 키의 대상이 다릅니다 — key=" + key + " 설정=" + endpoint.getTarget() + " 행=" + target);
        }

        String url = endpoint.getUrl().replace(USER_ID_PLACEHOLDER, userId.toString());
        String body = OutboxEnvelopeCodec.toJson(delivery.getPayload());
        try {
            HttpStatusCode status = restClient
                    .method(HttpMethod.valueOf(endpoint.getMethod()))
                    .uri(url)
                    .contentType(MediaType.APPLICATION_JSON)
                    .header(SERVICE_TOKEN_HEADER, "Bearer " + endpoint.getToken())
                    .body(body)
                    .retrieve()
                    .onStatus(s -> true, (request, response) -> { })
                    .toBodilessEntity()
                    .getStatusCode();

            if (status.is2xxSuccessful()) {
                return OutboxTransportResult.success();
            }
            if (status.is4xxClientError() && status.value() != 408 && status.value() != 429) {
                // 4xx 는 본문·권한이 틀린 것이라 같은 본문을 다시 보내도 같다. 행은 남긴다(A18 보류).
                return OutboxTransportResult.permanent("HTTP " + status.value());
            }
            return OutboxTransportResult.retry("HTTP " + status.value());
        } catch (RestClientException e) {
            log.warn("위성 명령 전달 실패 — deliveryId={} target={} key={}", delivery.getId(), target, key, e);
            return OutboxTransportResult.retry(e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }
}
