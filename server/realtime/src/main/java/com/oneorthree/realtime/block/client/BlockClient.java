package com.oneorthree.realtime.block.client;

import com.oneorthree.realtime.common.exception.UpstreamUnavailableException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.net.HttpURLConnection;
import java.time.Duration;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import java.util.UUID;

/**
 * 「이 사람이 누구를 차단했는가」를 Data 정본에 묻는 창구 (GROMO-2182).
 *
 * <p>새 표면을 만들지 않는다 — Data 에 이미 있는 {@code GET /internal/users/{userId}/blocks}
 * (GROMO-1975, Business 의 공개 {@code /blocks} 위임용)를 {@code realtime} caller 로도 연다. 판정용
 * 전용 엔드포인트를 따로 파면 같은 술어가 두 벌이 된다.
 *
 * <p>대상·자격은 응원 인가({@code IslandFocusSessions})와 <b>같은 값</b>을 쓴다 — 같은 Data 내부 표면·같은
 * caller 라 두 벌로 관리하면 한쪽만 바뀌어 조용히 어긋난다.
 *
 * <h2>응답을 엄격하게 읽는다</h2>
 * 현재 멤버십 client 와 같은 규칙이다 — 200 + {@code application/json} 이 아니거나, 본문이 상한을 넘거나,
 * 중복 키·뒤따르는 토큰이 있거나, 원소가 정확히 {@code {id, name}} 이 아니면(모르는 필드 포함) <b>판정 불가</b>
 * 로 올린다. 오류를 «빈 집합(아무도 차단 안 함)»으로 접지 않는다 — 그러면 장애가 곧 차단 해제가 된다.
 * redirect 는 따르지 않는다(3xx 도 판정 불가).
 */
@Slf4j
@Component
public class BlockClient {

    /**
     * 응답 상한. 원소 하나가 UUID + 닉네임이라 약 100바이트 — 수천 명의 차단까지 담는다. 넘으면 판정 불가다.
     */
    static final int MAX_RESPONSE_BYTES = 256 * 1024;

    private static final JsonMapper JSON = JsonMapper.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();

    private static final Set<String> ALLOWED_FIELDS = Set.of("id", "name");

    private final RestClient restClient;
    private final String serviceToken;

    public BlockClient(
            @Value("${realtime.focus.data-base-url:}") String baseUrl,
            @Value("${realtime.focus.data-service-token:}") String serviceToken,
            @Value("${realtime.blocks.data-timeout-ms:1500}") long timeoutMs) {
        this.serviceToken = serviceToken;
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory() {
            @Override
            protected void prepareConnection(HttpURLConnection connection, String httpMethod) throws IOException {
                super.prepareConnection(connection, httpMethod);
                connection.setInstanceFollowRedirects(false);
            }
        };
        // 무제한 타임아웃이면 상류 정지가 아웃바운드 채널 스레드를 잠가 실시간 전체가 멈춘다.
        factory.setConnectTimeout(Duration.ofMillis(timeoutMs));
        factory.setReadTimeout(Duration.ofMillis(timeoutMs));
        this.restClient = baseUrl.isBlank() ? null
                : RestClient.builder().baseUrl(baseUrl).requestFactory(factory).build();
    }

    /**
     * @param userId 차단한 쪽(수신 세션의 주체)
     * @return 그 사람이 차단한 사용자 id 전부. 정상 조회에서 아무도 없으면 빈 집합
     * @throws UpstreamUnavailableException 배선이 없거나, 응답이 계약을 어기거나, 통신이 실패했을 때
     */
    public Set<UUID> fetchBlockedIds(UUID userId) {
        if (restClient == null || serviceToken.isBlank()) {
            throw new UpstreamUnavailableException();
        }
        try {
            return restClient.get()
                    .uri("/internal/users/{userId}/blocks", userId)
                    .header("Authorization", "Bearer " + serviceToken)
                    .header("X-User-Id", userId.toString())
                    .header("Accept", MediaType.APPLICATION_JSON_VALUE)
                    .exchange((request, response) -> {
                        HttpStatusCode status = response.getStatusCode();
                        MediaType type = response.getHeaders().getContentType();
                        if (status.value() != 200 || type == null
                                || !MediaType.APPLICATION_JSON.isCompatibleWith(type)) {
                            log.warn("차단 목록 조회 실패 — status={}", status.value());
                            throw new UpstreamUnavailableException();
                        }
                        return parse(readLimited(response.getBody()));
                    });
        } catch (UpstreamUnavailableException e) {
            throw e;
        } catch (RestClientException | UncheckedIOException e) {
            // 원격 응답·URL·토큰을 포함할 수 있는 cause 를 로그에 붙이지 않는다.
            log.warn("차단 목록 조회 실패 — reason={}", e.getClass().getSimpleName());
            throw new UpstreamUnavailableException();
        }
    }

    private static byte[] readLimited(InputStream body) throws IOException {
        byte[] bytes = body.readNBytes(MAX_RESPONSE_BYTES + 1);
        if (bytes.length > MAX_RESPONSE_BYTES) {
            log.warn("차단 목록 조회 실패 — 응답이 상한을 넘었다");
            throw new UpstreamUnavailableException();
        }
        return bytes;
    }

    /** 계약 {@code [{"id": UUID, "name": string|null}, …]} 만 받는다. 그 밖은 전부 판정 불가다. */
    static Set<UUID> parse(byte[] bytes) {
        JsonNode root;
        try {
            root = JSON.readTree(bytes);
        } catch (RuntimeException e) {
            log.warn("차단 목록 조회 실패 — 형식 오류");
            throw new UpstreamUnavailableException();
        }
        if (root == null || !root.isArray()) {
            throw contractViolation();
        }
        Set<UUID> ids = new HashSet<>();
        for (JsonNode item : root) {
            if (!item.isObject() || !item.has("id")) {
                throw contractViolation();
            }
            Iterator<String> names = item.propertyNames().iterator();
            while (names.hasNext()) {
                if (!ALLOWED_FIELDS.contains(names.next())) {
                    throw contractViolation();
                }
            }
            JsonNode id = item.get("id");
            JsonNode name = item.get("name");
            if (!id.isString() || (name != null && !name.isNull() && !name.isString())) {
                throw contractViolation();
            }
            ids.add(canonicalUuid(id.stringValue()));
        }
        return Set.copyOf(ids);
    }

    /** {@code UUID.fromString} 은 {@code "1-1-1-1-1"} 같은 비정규 표기도 받는다 — 정규 표기만 인정한다. */
    private static UUID canonicalUuid(String raw) {
        try {
            UUID uuid = UUID.fromString(raw);
            if (uuid.toString().equals(raw)) {
                return uuid;
            }
        } catch (IllegalArgumentException e) {
            // 아래에서 계약 위반으로 올린다.
        }
        throw contractViolation();
    }

    private static UpstreamUnavailableException contractViolation() {
        log.warn("차단 목록 조회 실패 — 응답 계약 위반");
        return new UpstreamUnavailableException();
    }
}
