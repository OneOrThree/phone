package com.oneorthree.phone.config;

import com.oneorthree.phone.outbox.repository.domain.OutboxTarget;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.http.HttpMethod;

import java.net.URI;
import java.time.Duration;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * outbox relay 설정 — <b>기본값은 「꺼짐」이다</b> (GROMO-1659/1660 공통 기반).
 *
 * <p>왜 기본이 꺼짐인가: 이 기반이 들어가는 시점에 Kafka 브로커도 링크·알림 서버도 아직 없다. 켜진
 * 채로 들어가면 기존 앱 기동이 매 틱 연결 타임아웃을 물고, 「없는 대상에 못 보냈다」는 오류가 로그를
 * 덮어 진짜 실패를 가린다. 대상이 실제로 뜬 뒤 환경변수로 켠다 —
 * {@code focus.presence.enabled}(GROMO-292)가 같은 이유로 같은 모양이다.
 *
 * <h2>A18 보류를 코드가 대신 정하지 않는다</h2>
 * 최종 재시도 기간·고갈 처리·비요청형 유실 허용은 <b>보류</b>다(A18). 그래서 여기에는 「고갈되면
 * 무엇을 한다」가 없다. {@link Retry#getMaxAttempts()} 는 <b>경고 임계값</b>일 뿐이고, 그 횟수를 넘어도
 * 행은 남고 재시도는 최대 백오프로 계속된다. 폐기·DLQ 이동·HTTP 자동 폴백은 구현하지 않는다.
 *
 * <p>대신 <b>켤 때는 재시도 정책을 반드시 채우게</b> 한다({@link #validateWhenEnabled()}) — 값 없이
 * 켜지면 코드의 임의 기본값이 곧 운영 정책이 되어 버린다.
 */
@Getter
@Setter
@ConfigurationProperties(prefix = "outbox.relay")
public class OutboxRelayProperties {

    /** 꺼짐이 기본이다. 대상이 실제로 뜬 뒤 켠다. */
    private boolean enabled = false;

    /** 워커 식별자 — 리스 소유자 로그에 남는다. 비우면 호스트명을 쓴다. */
    private String workerId;

    /** 한 틱에 대상별로 집을 최대 건수. */
    private Integer batchSize;

    /** 리스 유효 기간 — 이 시간이 지나면 다른 워커가 회수한다. */
    private Duration leaseDuration;

    /** relay 잡 주기. */
    private Duration pollInterval;

    /**
     * 위성 HTTP 연결 수립 상한.
     *
     * <p>기본값을 둔 것은 A18 보류와 무관하다 — 재시도 «정책»이 아니라 「무한정 기다리지 않는다」는
     * 안전장치다. 타임아웃 없는 HTTP 클라이언트가 실제로 사고를 냈다
     * ({@code FriendshipRepository} 의 FCM 주석) — 백그라운드 잡이 멈추면 미전달이 무한히 쌓인다.
     */
    private Duration httpConnectTimeout = Duration.ofSeconds(2);

    /** 위성 HTTP 응답 대기 상한. */
    private Duration httpReadTimeout = Duration.ofSeconds(10);

    private final Retry retry = new Retry();

    private final Kafka kafka = new Kafka();

    /**
     * HTTP 대상의 <b>허용목록</b> — 논리 키 → 목적지. 저장된 payload 는 목적지를 고를 수 없다.
     *
     * <p>이 맵에 없는 키를 가진 전달 행은 <b>보내지 않는다</b>. 「모르면 일단 보낸다」로 열어 두면
     * 저장 시점에 잘못 들어간 키가 곧 임의 목적지 호출이 된다.
     */
    private final Map<String, Endpoint> endpoints = new LinkedHashMap<>();

    /** 재시도 정책 — relay 를 켤 때 <b>전부 필수</b>다. */
    @Getter
    @Setter
    public static class Retry {

        /** 첫 실패 뒤 대기. */
        private Duration initialBackoff;

        /** 백오프 상한 — 지수 증가가 여기서 멈춘다. */
        private Duration maxBackoff;

        /**
         * <b>경고 임계값</b>이다. 이 횟수를 넘으면 로그·메트릭으로 드러내지만 행을 없애거나 재시도를
         * 멈추지 않는다 — 고갈 처리는 A18 보류다.
         */
        private Integer maxAttempts;
    }

    /** Kafka 대상 설정. */
    @Getter
    @Setter
    public static class Kafka {

        /** 정본 토픽. key = userId (A12·A21). */
        private String topic = "notification-events";

        /** 소비 실패의 종착 토픽. 파티션 수는 정본 토픽과 같다(계약 §3). */
        private String dltTopic = "notification-events.DLT";

        /** 두 토픽 공통 파티션 수 — 계약이 3 이다. */
        private int partitions = 3;

        /** 단일 노드라 1 이다(A12). */
        private short replicationFactor = 1;

        /** 발행 한 건을 기다리는 상한 — relay 는 동기 확인 후에만 전달을 표시한다. */
        private Duration sendTimeout = Duration.ofSeconds(10);
    }

    /**
     * HTTP 목적지 하나 — URL·method·caller 토큰이 <b>설정에만</b> 있다.
     *
     * <p>{@code url} 에는 {@code {userId}} 자리표시자만 쓸 수 있다. 그 값은 봉투의 {@code userId} 에서
     * 오며 payload 에서 오지 않는다 — 저장된 본문이 경로를 고를 수 있으면 그게 곧 SSRF 구조다.
     */
    @Getter
    @Setter
    public static class Endpoint {

        /** 이 키가 속한 대상 — 전달 행의 target 과 다르면 보내지 않는다. */
        private OutboxTarget target;

        /** 절대 URL(http/https). */
        private String url;

        /** 허용 method — 계약이 명시한 하나만. */
        private String method = "POST";

        /** caller 별 서비스 토큰. 수신부가 이 값으로 호출자를 가른다(계약 §2). */
        private String token;
    }

    /**
     * 켜진 경우에만 설정을 검증한다 — 꺼져 있으면 아무 값도 요구하지 않는다.
     *
     * <p>여기서 죽는 편이 낫다: 값 없이 켜지면 코드의 임의 기본값이 운영 정책이 되고, 그 사실은
     * 사고가 난 뒤에야 드러난다.
     *
     * @throws IllegalStateException 필수값이 비었거나 엔드포인트가 계약을 어길 때
     */
    public void validateWhenEnabled() {
        if (!enabled) {
            return;
        }
        require(batchSize != null && batchSize > 0, "outbox.relay.batch-size 는 1 이상이어야 합니다.");
        require(isPositive(leaseDuration), "outbox.relay.lease-duration 이 필요합니다.");
        require(isPositive(pollInterval), "outbox.relay.poll-interval 이 필요합니다.");
        require(isPositive(httpConnectTimeout), "outbox.relay.http-connect-timeout 이 필요합니다.");
        require(isPositive(httpReadTimeout), "outbox.relay.http-read-timeout 이 필요합니다.");
        require(isPositive(retry.getInitialBackoff()), "outbox.relay.retry.initial-backoff 가 필요합니다.");
        require(isPositive(retry.getMaxBackoff()), "outbox.relay.retry.max-backoff 가 필요합니다.");
        require(retry.getMaxAttempts() != null && retry.getMaxAttempts() > 0,
                "outbox.relay.retry.max-attempts 가 필요합니다(경고 임계값 — 고갈 처리는 A18 보류).");
        require(retry.getMaxBackoff().compareTo(retry.getInitialBackoff()) >= 0,
                "outbox.relay.retry.max-backoff 는 initial-backoff 이상이어야 합니다.");
        require(kafka.getPartitions() == 3,
                "notification-events 와 .DLT 는 계약상 각 3파티션이다 — 임의로 바꾸지 않는다.");
        endpoints.forEach(OutboxRelayProperties::validateEndpoint);
    }

    private static void validateEndpoint(String key, Endpoint endpoint) {
        require(endpoint.getTarget() != null, "outbox.relay.endpoints." + key + ".target 이 필요합니다.");
        require(endpoint.getTarget() != OutboxTarget.KAFKA,
                "outbox.relay.endpoints." + key + " — Kafka 는 HTTP 목적지를 갖지 않습니다.");
        require(endpoint.getToken() != null && !endpoint.getToken().isBlank()
                        && !endpoint.getToken().contains("${"),
                "outbox.relay.endpoints." + key + ".token 이 필요합니다 — 위성은 caller 별 토큰으로 인증한다.");
        String method = endpoint.getMethod();
        require(method != null && !method.isBlank(),
                "outbox.relay.endpoints." + key + ".method 가 필요합니다.");
        // 「비어 있지 않다」로는 모자란다. Spring 7 의 HttpMethod 는 enum 이 아니라서
        // HttpMethod.valueOf("POSTT") 도 HttpMethod.valueOf("post") 도 «던지지 않고» 그 이름의
        // 인스턴스를 만들어 준다. 그래서 오타가 기동을 통과해 그대로 와이어로 나가고, 위성은 405 로
        // 거절한다 — relay 는 그것을 permanent 로 적으므로 그 축은 설정을 고칠 때까지 멈춘다.
        // HTTP method 는 대소문자를 가리므로 소문자 post 도 같은 결말이다. 표준 이름만 받는다.
        require(Arrays.stream(HttpMethod.values()).anyMatch(known -> known.name().equals(method)),
                "outbox.relay.endpoints." + key + ".method 는 표준 HTTP method 여야 합니다 — " + method);
        String url = endpoint.getUrl();
        require(url != null && !url.isBlank(), "outbox.relay.endpoints." + key + ".url 이 필요합니다.");
        URI uri = URI.create(url.replace("{userId}", "00000000-0000-0000-0000-000000000000"));
        require(uri.isAbsolute() && ("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())),
                "outbox.relay.endpoints." + key + ".url 은 절대 http(s) URL 이어야 합니다.");
        require(uri.getHost() != null, "outbox.relay.endpoints." + key + ".url 에 호스트가 없습니다.");
    }

    private static boolean isPositive(Duration duration) {
        return duration != null && !duration.isZero() && !duration.isNegative();
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new IllegalStateException(message);
        }
    }
}
