package com.oneorthree.chat.membership;

import com.oneorthree.chat.common.redis.RedisKeys;
import com.oneorthree.chat.membership.client.GroupClient;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 「이 사람이 이 섬의 멤버인가」 — 채팅의 첫 번째 규칙을 판정한다.
 *
 * <p>정본은 Data API 고({@link GroupClient}) 여기는 그 답을 {@code cache:chat:member:{userId}} 에
 * 잠깐 얹어 두는 층이다. 캐시가 필요한 이유는 <b>발신 한 건마다 이 판정이 돌기 때문</b>이다 —
 * 캐시가 없으면 메시지 1건이 서버 간 HTTP 왕복 1회가 되어, 대화가 활발할수록 상류가 무너진다.
 *
 * <h2>SET 이 아니라 문자열 하나로 저장한다</h2>
 * 그룹 id 를 구분자로 이어 붙여 <b>{@code SET key value EX ttl} 한 명령</b>으로 쓴다. SADD 로 원소를
 * 넣고 EXPIRE 로 수명을 거는 자연스러운 모양을 쓰지 않는 이유는 <b>그 둘이 원자적이지 않기</b> 때문이다:
 * SADD 가 성공한 뒤 EXPIRE 가 실패하면(프로세스 종료·타임아웃·연결 끊김) <b>수명 없는 캐시가 영구히
 * 남는다</b>. 이 서비스는 탈퇴·강퇴를 «캐시 만료»로만 반영하므로, 그 한 번의 사고가 그 유저에게
 * 영구 멤버십을 준다 — 탈퇴한 사람이 영영 그 섬의 대화를 보고 쓴다. 값 하나로 접으면 그 창이 없다.
 *
 * <p>부수 효과로 표식(sentinel)도 사라졌다. Redis 에는 「빈 SET」이 없어서 아무 섬에도 안 속한 유저를
 * SET 으로 캐시하면 키가 아예 안 생기는데(그래서 매 요청이 상류로 샌다), 문자열은 빈 값
 * ({@code ""})을 그대로 담을 수 있다.
 *
 * <h2>캐시하지 «않는» 답이 하나 있다</h2>
 * 상류가 이 토큰을 거절해서(401/403) 나온 빈 집합은 적재하지 않는다 — 자세한 근거는
 * {@link GroupClient.Membership} 에 있다. 「소속이 없다」와 「이 토큰으로는 못 본다」는 둘 다
 * 빈 집합이지만 캐시해도 되는지가 정반대다.
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

    /** 구분자. UUID 표기에 절대 나오지 않는 문자여야 한다 — 나오면 값이 조용히 쪼개진다. */
    private static final String SEPARATOR = ",";

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

        // null 이면 캐시 없음. 빈 문자열은 «아무 섬에도 안 속함»이라는 «캐시된 답»이다 — 그 둘을
        // 구분할 수 있어야 소속 없는 유저가 매 요청 상류로 새지 않는다.
        String cached = redis.opsForValue().get(key);
        if (cached != null) {
            return parse(cached);
        }

        GroupClient.Membership fresh = groupClient.fetchMyGroupIds(bearerToken);
        // 상류가 «이 토큰»을 거절해서 나온 빈 집합은 캐시하지 않는다. 캐시는 userId 로만 조회되므로,
        // 만료 토큰의 401 을 적재하면 유저가 곧바로 토큰을 갱신해 새로 붙어도 그 새 토큰이 상류에
        // 닿지 못한 채 TTL 동안 모든 방에서 차단된다 — 토큰 만료가 「2분간 전면 차단」으로 번진다.
        if (fresh.cacheable()) {
            store(key, fresh.groupIds());
        }
        return fresh.groupIds();
    }

    /**
     * 캐시 적재 — <b>한 명령으로</b> 값과 수명을 같이 건다.
     *
     * <p>실패해도 요청을 막지 않는다. 판정 자체는 이미 상류에서 받아 왔으므로 그 요청은 정상 처리하고
     * 다음 요청이 다시 시도하게 둔다. 적재가 «부분적으로» 성공할 수는 없다는 점이 중요하다 —
     * 값만 남고 수명이 안 걸리는 상태가 이 캐시에서는 영구 멤버십을 뜻하기 때문이다.
     */
    private void store(String key, Set<UUID> groupIds) {
        try {
            String value = groupIds.stream().map(UUID::toString).collect(Collectors.joining(SEPARATOR));
            redis.opsForValue().set(key, value, Duration.ofSeconds(cacheTtlSeconds));
        } catch (RuntimeException e) {
            log.warn("멤버십 캐시 적재 실패 — key={}", key, e);
        }
    }

    /** 파싱 안 되는 조각은 조용히 버린다 — 이물질 하나가 판정 전체를 예외로 만들지 않게. */
    private Set<UUID> parse(String cached) {
        if (cached.isEmpty()) {
            return Set.of();
        }
        return Arrays.stream(cached.split(SEPARATOR))
                .map(MembershipService::toUuidOrNull)
                .filter(Objects::nonNull)
                .collect(Collectors.toCollection(LinkedHashSet::new));
    }

    private static UUID toUuidOrNull(String value) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            log.warn("멤버십 캐시에 UUID 아닌 값 — 무시");
            return null;
        }
    }
}
