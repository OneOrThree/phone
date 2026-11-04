package com.oneorthree.phone.group.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.oneorthree.phone.config.MetaCapiProperties;
import com.oneorthree.phone.group.repository.FirstIslandArrivalRepository;
import com.oneorthree.phone.group.repository.domain.FirstIslandArrival;
import com.oneorthree.phone.outbox.support.OutboxEnvelopeCodec;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 첫 섬 도착 사건을 Meta Conversions API 로 보낸다 (GROMO-2741).
 *
 * <p>상태: PENDING → SENT(200 + events_received≥1) | FAILED(4xx) | EXPIRED(7일−1시간 초과). 5xx·타임아웃은
 * PENDING 으로 두고 attempts 를 올려 지수 백오프로 다시 시도한다. 종료 상태가 되면 매칭 값을 지운다.
 * 행마다 요청을 하나씩 보낸다 — 7일을 넘긴 이벤트가 하나라도 섞이면 Meta 가 요청 전체를 거부한다.
 * 토큰·anon_id·IP 는 로그에 남기지 않는다.
 */
@Slf4j
@Component
@EnableConfigurationProperties(MetaCapiProperties.class)
@ConditionalOnExpression("${meta.capi.enabled:false} and !'${meta.capi.dataset-id:}'.isEmpty() "
        + "and !'${meta.capi.access-token:}'.isEmpty()")
public class FirstIslandArrivalCapiSender {

    private static final int BATCH_SIZE = 50;
    /** Meta 는 7일 넘은 이벤트를 거부한다 — 1시간 여유를 둔다. */
    private static final Duration MAX_AGE = Duration.ofDays(7).minusHours(1);
    private static final List<Duration> BACKOFF = List.of(Duration.ofMinutes(1), Duration.ofMinutes(5),
            Duration.ofMinutes(30), Duration.ofHours(2), Duration.ofHours(6));

    private final FirstIslandArrivalRepository repository;
    private final MetaCapiProperties properties;
    private final Clock clock;
    private final TransactionTemplate tx;
    private final RestClient restClient;

    public FirstIslandArrivalCapiSender(FirstIslandArrivalRepository repository, MetaCapiProperties properties,
            Clock clock, TransactionTemplate tx) {
        this.repository = repository;
        this.properties = properties;
        this.clock = clock;
        this.tx = tx;
        // 소셜 IdP 클라이언트와 같은 연결 5초 + 읽기 5초 타임아웃.
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(5));
        factory.setReadTimeout(Duration.ofSeconds(5));
        this.restClient = RestClient.builder().requestFactory(factory).build();
    }

    @Scheduled(fixedDelay = 30_000, initialDelay = 30_000)
    @SchedulerLock(name = "meta-capi-first-island-arrival", lockAtMostFor = "PT5M")
    public void sendDue() {
        for (FirstIslandArrival row : repository.findDue(clock.instant(), PageRequest.of(0, BATCH_SIZE))) {
            try {
                sendOne(row);
            } catch (RuntimeException e) {
                // 한 행의 예외가 나머지를 막지 않는다. 값은 남기지 않는다.
                log.warn("첫 섬 도착 CAPI 처리 실패 eventId={} error={}", row.getEventId(), e.getClass().getSimpleName());
            }
        }
    }

    private void sendOne(FirstIslandArrival row) {
        Instant now = clock.instant();
        if (row.getOccurredAt().plus(MAX_AGE).isBefore(now)) {
            saveResult(row.getUserId(), "EXPIRED", row.getAttempts(), null, null, "EXPIRED");
            return;
        }
        int status;
        String body;
        try {
            var response = restClient.post()
                    .uri(properties.getBaseUrl() + "/" + properties.getApiVersion() + "/" + properties.getDatasetId()
                            + "/events")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(payload(row))
                    .exchange((req, res) -> new String[] {String.valueOf(res.getStatusCode().value()),
                            new String(res.getBody().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)});
            status = Integer.parseInt(response[0]);
            body = response[1];
        } catch (RestClientException e) {
            retry(row, now, e.getClass().getSimpleName());
            return;
        }
        if (status == 200 && receivedAtLeastOne(body)) {
            saveResult(row.getUserId(), "SENT", row.getAttempts(), null, now, null);
        } else if (status == 429 || status >= 500) {
            retry(row, now, "HTTP " + status);
        } else {
            saveResult(row.getUserId(), "FAILED", row.getAttempts(), null, null, error(status, body));
        }
    }

    private void retry(FirstIslandArrival row, Instant now, String error) {
        int attempts = row.getAttempts() + 1;
        Duration delay = BACKOFF.get(Math.min(attempts, BACKOFF.size()) - 1);
        saveResult(row.getUserId(), "PENDING", attempts, now.plus(delay), null, error);
    }

    /** 요청 본문 — 토큰은 본문 access_token 으로 보낸다(URL·접근 로그에 남기지 않는다). */
    private String payload(FirstIslandArrival row) {
        Map<String, Object> userData = new LinkedHashMap<>();
        userData.put("anon_id", row.getAnonId());
        if (row.getClientIp() != null) {
            userData.put("client_ip_address", row.getClientIp());
        }
        Map<String, Object> appData = new LinkedHashMap<>();
        appData.put("advertiser_tracking_enabled", Boolean.TRUE.equals(row.getAdvertiserTrackingEnabled()) ? 1 : 0);
        appData.put("application_tracking_enabled", 1);
        appData.put("extinfo", row.getExtinfo());
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("event_name", "first_island_arrival");
        event.put("event_time", row.getOccurredAt().getEpochSecond());
        event.put("event_id", row.getEventId().toString());
        event.put("action_source", "app");
        event.put("user_data", userData);
        event.put("app_data", appData);
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("data", List.of(event));
        root.put("access_token", properties.getAccessToken());
        if (!properties.getTestEventCode().isEmpty()) {
            root.put("test_event_code", properties.getTestEventCode());
        }
        return OutboxEnvelopeCodec.toJson(root);
    }

    private static boolean receivedAtLeastOne(String body) {
        try {
            JsonNode node = OutboxEnvelopeCodec.fromJson(body, JsonNode.class);
            return node.path("events_received").asInt(0) >= 1;
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            return false;
        }
    }

    /** 오류 코드와 fbtrace_id 만 남긴다 — 사용자 값은 금지. */
    private static String error(int status, String body) {
        String code = "";
        try {
            JsonNode err = OutboxEnvelopeCodec.fromJson(body, JsonNode.class).path("error");
            code = " code=" + err.path("code").asText("") + " fbtrace_id=" + err.path("fbtrace_id").asText("");
        } catch (com.fasterxml.jackson.core.JsonProcessingException ignored) {
            // 본문이 JSON 이 아니면 상태 코드만 남긴다.
        }
        String text = "HTTP " + status + code;
        return text.length() > 200 ? text.substring(0, 200) : text;
    }

    /** 결과 기록은 짧은 트랜잭션 하나다 — HTTP 호출은 트랜잭션 밖에서 한다. */
    private void saveResult(java.util.UUID userId, String status, int attempts, Instant next, Instant sentAt,
            String error) {
        tx.executeWithoutResult(t -> repository.recordResult(userId, status, attempts, next, sentAt, error));
    }
}
