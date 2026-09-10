package com.oneorthree.chat.membership;

import com.oneorthree.chat.common.redis.RedisKeys;
import com.oneorthree.chat.membership.client.GroupClient;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * 「이 사람이 이 섬의 멤버인가」 — 채팅의 첫 번째 규칙을 판정한다.
 *
 * <p>정본은 Data API 고({@link GroupClient}) 여기는 그 답을 {@code cache:chat:member:{userId}} 에
 * 잠깐 얹어 두는 층이다. 캐시가 필요한 이유는 <b>발신 한 건마다 이 판정이 돌기 때문</b>이다 —
 * 캐시가 없으면 메시지 1건이 서버 간 HTTP 왕복 1회가 되어, 대화가 활발할수록 상류가 무너진다.
 *
 * <h2>빈 집합을 캐시하는 법</h2>
 * Redis 에는 「빈 SET」이 없다 — 마지막 원소를 지우면 키 자체가 사라진다. 그래서 아무 섬에도 안 속한
 * 유저를 그냥 캐시하면 <b>키가 안 생기고, 매 요청이 캐시 미스가 되어 상류로 간다</b>(가장 캐시가
 * 필요한 경우가 캐시를 못 받는 역설). 그걸 막으려고 {@link #SENTINEL} 하나를 항상 넣는다 — 덕분에
 * 「캐시에 있음」과 「소속이 없음」이 구분되고, 조회는 SMEMBERS 한 번으로 끝난다.
 *
 * <h2>무효화는 TTL 뿐이다</h2>
 * 가입·탈퇴·강퇴가 즉시 반영되지 않는다. 최대 {@code chat.membership.cache-ttl-seconds} 만큼
 * 늦는다 — 탈퇴한 사람이 그동안 대화를 계속 볼 수 있다는 뜻이라, TTL 을 늘리는 건 상류 부하를
 * 줄이는 대신 그 창을 넓히는 거래다. 즉시 무효화를 원하면 Data API 가 멤버십 변경 이벤트를
 * 발행하고 채팅이 키를 지우는 배선이 필요하다(이 PR 범위 밖).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MembershipService {

    /**
     * 「이 캐시는 채워졌다」를 뜻하는 표식. UUID 로 파싱될 수 없는 값이어야 한다 — 그래야 실수로
     * groupId 로 읽히지 않는다.
     */
    private static final String SENTINEL = "-";

    private final GroupClient groupClient;
    private final StringRedisTemplate redis;

    @Value("${chat.membership.cache-ttl-seconds:120}")
    private long cacheTtlSeconds;

    /**
     * @param groupId 들어가려는 섬
     * @param userId 요청자
     * @param bearerToken 요청자의 {@code Authorization} 헤더 통째로 — 캐시 미스일 때만 쓰인다
     * @return 그 섬의 활성 멤버면 true
     * @throws com.oneorthree.chat.common.exception.UpstreamUnavailableException
     *         캐시가 비었고 상류도 답하지 않아 판정을 내릴 수 없을 때
     */
    public boolean isMember(UUID groupId, UUID userId, String bearerToken) {
        return myGroupIds(userId, bearerToken).contains(groupId);
    }

    /**
     * 요청자가 속한 섬 전부. 방 목록 화면이 이걸로 그려진다.
     *
     * @return 그룹 id 집합. 아무 섬에도 안 속했으면 빈 집합
     */
    public Set<UUID> myGroupIds(UUID userId, String bearerToken) {
        String key = RedisKeys.memberCache(userId);

        Set<String> cached = redis.opsForSet().members(key);
        // 표식을 항상 넣으므로, 캐시에 있는 키는 결코 비어 있지 않다 → 비었으면 확실한 미스다.
        if (cached != null && !cached.isEmpty()) {
            return parse(cached);
        }

        Set<UUID> fresh = groupClient.fetchMyGroupIds(bearerToken);
        store(key, fresh);
        return fresh;
    }

    /**
     * 캐시 적재 — 실패해도 요청을 막지 않는다.
     *
     * <p>적재는 부가 작업이다. 여기서 예외가 나면 판정 자체는 이미 상류에서 받아 왔으므로,
     * 그 요청은 정상 처리하고 다음 요청이 다시 시도하게 둔다.
     */
    private void store(String key, Set<UUID> groupIds) {
        try {
            String[] values = Stream.concat(
                            Stream.of(SENTINEL),
                            groupIds.stream().map(UUID::toString))
                    .toArray(String[]::new);
            redis.opsForSet().add(key, values);
            redis.expire(key, Duration.ofSeconds(cacheTtlSeconds));
        } catch (RuntimeException e) {
            log.warn("멤버십 캐시 적재 실패 — key={}", key, e);
        }
    }

    /** 표식을 걸러 내고 UUID 로 되돌린다. 파싱 안 되는 값은 조용히 버린다(표식이 그 경로로 빠진다). */
    private Set<UUID> parse(Set<String> cached) {
        return cached.stream()
                .filter(v -> !SENTINEL.equals(v))
                .map(MembershipService::toUuidOrNull)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
    }

    private static UUID toUuidOrNull(String value) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            // 캐시에 이물질이 들어온 경우다 — 판정에서 빼고 넘어간다. 남겨 두면 매번 예외가 된다.
            log.warn("멤버십 캐시에 UUID 아닌 값 — 무시");
            return null;
        }
    }
}
