package com.oneorthree.realtime.block.client;

import com.oneorthree.realtime.common.exception.UpstreamUnavailableException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.time.Duration;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Semaphore;

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
 *
 * <h2>총 deadline 과 동시 호출 상한</h2>
 * 이 호출은 아웃바운드 채널 스레드에서 돈다. read timeout 은 «읽기 한 번»의 상한이라 본문을 조금씩 흘리는
 * 상류는 한 호출을 오래 붙들 수 있다 — 그래서 본문 읽기에 호출 단위 deadline 을 따로 건다. 또 캐시 미스가
 * 몰리면(세대가 막 오른 차단자의 모든 세션) 채널 스레드 전부가 Data 를 기다리게 되므로 동시 호출 수를
 * {@code realtime.blocks.max-in-flight} 로 누르고, 넘치면 기다리지 않고 판정 불가로 올린다(프레임 폐기).
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

    private static final int DEFAULT_MAX_IN_FLIGHT = 16;

    private final URI base;
    private final String serviceToken;
    private final int timeoutMs;
    private final long timeoutNanos;
    private final Semaphore capacity;

    /** 테스트·스텁용 — 동시 호출 상한은 기본값. */
    public BlockClient(String baseUrl, String serviceToken, long timeoutMs) {
        this(baseUrl, serviceToken, timeoutMs, DEFAULT_MAX_IN_FLIGHT);
    }

    @Autowired
    public BlockClient(
            @Value("${realtime.focus.data-base-url:}") String baseUrl,
            @Value("${realtime.focus.data-service-token:}") String serviceToken,
            @Value("${realtime.blocks.data-timeout-ms:1500}") long timeoutMs,
            @Value("${realtime.blocks.max-in-flight:16}") int maxInFlight) {
        this.base = baseUrl.isBlank() ? null : URI.create(baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
        this.serviceToken = serviceToken;
        this.timeoutMs = (int) Math.min(Integer.MAX_VALUE, Math.max(1, timeoutMs));
        this.timeoutNanos = Duration.ofMillis(timeoutMs).toNanos();
        this.capacity = new Semaphore(Math.max(1, maxInFlight));
    }

    /**
     * @param userId 차단한 쪽(수신 세션의 주체)
     * @return 그 사람이 차단한 사용자 id 전부. 정상 조회에서 아무도 없으면 빈 집합
     * @throws UpstreamUnavailableException 배선이 없거나, 응답이 계약을 어기거나, 통신이 실패했을 때
     */
    public Set<UUID> fetchBlockedIds(UUID userId) {
        if (base == null || serviceToken.isBlank()) {
            throw new UpstreamUnavailableException();
        }
        if (!capacity.tryAcquire()) {
            log.warn("차단 목록 조회 실패 — 동시 호출 상한");
            throw new UpstreamUnavailableException();
        }
        long deadline = System.nanoTime() + timeoutNanos;
        HttpURLConnection connection = null;
        boolean completed = false;
        try {
            // RestClient 를 쓰지 않는 이유: Spring 의 응답 close 가 커넥션 재사용을 위해 남은 본문을 «끝까지 읽는다».
            // 총 deadline 으로 끊어도 그 drain 이 채널 스레드를 다시 붙든다 — 실패 시 소켓을 바로 닫아야 한다.
            connection = (HttpURLConnection) base.resolve("internal/users/" + userId + "/blocks").toURL()
                    .openConnection();
            connection.setRequestMethod("GET");
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setConnectTimeout(timeoutMs);
            connection.setReadTimeout(timeoutMs);
            connection.setRequestProperty("Authorization", "Bearer " + serviceToken);
            connection.setRequestProperty("X-User-Id", userId.toString());
            connection.setRequestProperty("Accept", MediaType.APPLICATION_JSON_VALUE);
            int status = connection.getResponseCode();
            String contentType = connection.getContentType();
            if (status != 200 || contentType == null || !isJson(contentType)) {
                log.warn("차단 목록 조회 실패 — status={}", status);
                throw new UpstreamUnavailableException();
            }
            Set<UUID> ids;
            try (InputStream body = connection.getInputStream()) {
                ids = parse(readLimited(body, deadline));
            }
            completed = true;
            return ids;
        } catch (UpstreamUnavailableException e) {
            throw e;
        } catch (IOException | RuntimeException e) {
            // 원격 응답·URL·토큰을 포함할 수 있는 cause 를 로그에 붙이지 않는다.
            log.warn("차단 목록 조회 실패 — reason={}", e.getClass().getSimpleName());
            throw new UpstreamUnavailableException();
        } finally {
            if (!completed && connection != null) {
                connection.disconnect();
            }
            capacity.release();
        }
    }

    private static boolean isJson(String contentType) {
        try {
            return MediaType.APPLICATION_JSON.isCompatibleWith(MediaType.parseMediaType(contentType));
        } catch (RuntimeException e) {
            return false;
        }
    }

    /**
     * 상한과 호출 단위 deadline 을 함께 지키며 본문을 읽는다. 읽기 한 번은 read timeout 이 누르므로 최악의 총
     * 대기는 deadline + read timeout 한 번이다.
     */
    private static byte[] readLimited(InputStream body, long deadline) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int read;
        while ((read = body.read(chunk)) != -1) {
            out.write(chunk, 0, read);
            if (out.size() > MAX_RESPONSE_BYTES) {
                log.warn("차단 목록 조회 실패 — 응답이 상한을 넘었다");
                throw new UpstreamUnavailableException();
            }
            if (System.nanoTime() - deadline > 0) {
                log.warn("차단 목록 조회 실패 — 총 deadline 초과");
                throw new UpstreamUnavailableException();
            }
        }
        return out.toByteArray();
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
