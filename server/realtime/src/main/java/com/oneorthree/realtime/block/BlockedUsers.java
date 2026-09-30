package com.oneorthree.realtime.block;

import com.oneorthree.realtime.block.client.BlockClient;
import com.oneorthree.realtime.common.exception.UpstreamUnavailableException;
import com.oneorthree.realtime.common.redis.RedisKeys;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 받는 사람 기준 차단 판정 (GROMO-2182) — 「이 세션의 주체가 이 발신자를 차단했는가」.
 *
 * <h2>세대와 캐시</h2>
 * 차단 집합은 Data 정본({@code user_blocks})의 사본이다. 채팅 한 건이 구독 세션 수만큼 이 판정을 부르므로
 * 매번 HTTP 를 칠 수 없어 Redis 에 캐시한다. 캐시를 믿을 수 있게 하는 것은 TTL 이 아니라 <b>세대</b>다.
 * <ol>
 *   <li><b>사건</b> — Data 가 차단·해제 트랜잭션 안에서 outbox 에 {@code user.blocks.updated}(REALTIME) 를 적고,
 *       {@code InboundEventService} 가 받을 때마다 {@link #advanceGeneration} 으로 그 차단자의 세대를 올린다.
 *       캐시 값에는 적재 당시 세대가 함께 실려 있어, 세대가 바뀐 순간 그 값은 읽히지 않는다 — 차단 직전에 시작된
 *       조회가 무효화보다 늦게 옛 집합을 써도 그 값은 이미 «옛 세대»라 버려진다. 이 논증은 사건이 Data 커밋
 *       <b>이후</b> relay 로 도착한다는 전제 위에 있다 — 커밋과 INCR 사이(relay 지연)에는 옛 집합이 현재 세대로
 *       읽힐 수 있고, 그 창은 relay 지연만큼이다.</li>
 *   <li><b>TTL</b>({@code realtime.blocks.cache-ttl-seconds}) — 사건이 유실되거나 relay 가 꺼진 배포의 백스톱일
 *       뿐이다. relay 가 꺼져 있으면 차단은 TTL 뒤에야 반영된다 — 그 상태를 «즉시 차단»이라 부르지 않는다.</li>
 * </ol>
 * 판정은 프레임을 소켓에 쓰기 직전({@code ChatOutboundChannelInterceptor#beforeHandle})에 하므로, 세대가 바뀌기
 * 전에 큐에 들어가 있던 프레임도 그 시점의 새 세대로 다시 걸러진다(character-report policy RP-차단).
 *
 * <h2>판정 실패는 전달하지 않는다(fail-closed, 2026-10-01 결정)</h2>
 * Redis 조회·Data 조회·응답 계약 중 어느 하나라도 실패하면 {@link UpstreamUnavailableException} 을 올리고,
 * 호출자는 그 프레임을 보내지 않는다. «아무도 차단 안 함»으로 접으면 장애가 곧 차단 해제가 된다. 실패는
 * 캐시하지 않으므로 다음 프레임이 다시 묻는다. 이전 캐시로 대신 판정하지도 않는다(세대가 다르면 근거가 아니다).
 *
 * <h2>켜는 스위치 — {@code realtime.blocks.filter-enabled}(기본 false)</h2>
 * fail-closed 는 «켜진 필터가 판정을 못 내리면 보내지 않는다»이지, 배선도 안 된 배포에서 채팅을 끊으라는 뜻이
 * 아니다. Data 의 realtime caller 허용목록·{@code SVC_TOKEN_REALTIME_TO_DATA} 배선이 서비스마다 독립 배포라
 * 순서를 보장할 수 없으므로(티켓 1954 의 relay 도 같다), 필터는 배선 확인 뒤 env 로 켠다. 꺼져 있으면 조회하지 않고
 * 거르지도 않는다 — 이 PR 이전과 같다. 세대 올리기({@link #advanceGeneration})는 스위치와 무관하게 적용한다.
 */
@Slf4j
@Service
public class BlockedUsers {

    private static final String GENERATION_SEPARATOR = "|";
    private static final String ID_SEPARATOR = ",";

    /**
     * 세대 키 수명 — <b>캐시 TTL 보다 반드시 길어야 한다.</b> 세대 키가 먼저 사라지면 현재 세대가 0 으로 돌아가,
     * 세대 0 에 적재된 차단 전 캐시가 다시 «현재»로 읽힌다. 그래서 생성자가 캐시 TTL 을 이 값 미만으로 강제한다.
     */
    static final Duration GENERATION_TTL = Duration.ofDays(1);

    private final BlockClient blockClient;
    private final StringRedisTemplate redis;
    private final Duration cacheTtl;
    private final boolean enabled;

    public BlockedUsers(BlockClient blockClient, StringRedisTemplate redis,
            @Value("${realtime.blocks.cache-ttl-seconds:120}") long cacheTtlSeconds,
            @Value("${realtime.blocks.filter-enabled:false}") boolean enabled) {
        if (cacheTtlSeconds <= 0 || Duration.ofSeconds(cacheTtlSeconds).compareTo(GENERATION_TTL) >= 0) {
            throw new IllegalArgumentException("realtime.blocks.cache-ttl-seconds 는 1 이상, 세대 키 수명(1일) 미만이어야 합니다.");
        }
        this.blockClient = blockClient;
        this.redis = redis;
        this.cacheTtl = Duration.ofSeconds(cacheTtlSeconds);
        this.enabled = enabled;
    }

    /**
     * @param viewerId 받는 세션의 주체
     * @param senderId 보낸 사람. {@code null}(탈퇴 발신자)·본인이면 거르지 않고 조회도 하지 않는다
     * @return 받는 사람이 보낸 사람을 차단했으면 {@code true}
     * @throws UpstreamUnavailableException 판정할 수 없을 때 — 호출자는 전달하지 않는다
     */
    public boolean hasBlocked(UUID viewerId, UUID senderId) {
        if (!enabled || senderId == null || senderId.equals(viewerId)) {
            return false;
        }
        return blockedBy(viewerId).contains(senderId);
    }

    /**
     * 그 차단자의 세대를 올린다 — 캐시된 집합은 이 순간부터 읽히지 않는다.
     *
     * <p>실패를 삼키지 않는다. 사건 처리 트랜잭션이 롤백돼 수신 기록이 남지 않고 relay 가 다시 보낸다.
     */
    public void advanceGeneration(UUID blockerId) {
        String key = RedisKeys.blockGeneration(blockerId);
        redis.opsForValue().increment(key);
        redis.expire(key, GENERATION_TTL);
    }

    private Set<UUID> blockedBy(UUID viewerId) {
        String generationKey = RedisKeys.blockGeneration(viewerId);
        String cacheKey = RedisKeys.blockCache(viewerId);
        String generation;
        try {
            List<String> values = redis.opsForValue().multiGet(List.of(generationKey, cacheKey));
            if (values == null || values.size() != 2) {
                throw new IllegalStateException("MGET 응답이 비었다");
            }
            generation = values.get(0) == null ? "0" : values.get(0);
            Set<UUID> hit = values.get(1) == null ? null : parseIfCurrent(values.get(1), generation);
            if (hit != null) {
                return hit;
            }
        } catch (RuntimeException e) {
            log.warn("차단 캐시 조회 실패 — 이 프레임은 보내지 않는다. reason={}", e.getClass().getSimpleName());
            throw new UpstreamUnavailableException();
        }
        Set<UUID> fresh = blockClient.fetchBlockedIds(viewerId);
        // 조회 도중 세대가 올랐으면(차단 커밋 직전에 읽은 옛 목록일 수 있다) 이 결과로 지금 프레임을 판정하지 않는다.
        // 재조회하지 않고 판정 불가로 올린다 — 재조회도 같은 경합을 다시 탈 수 있고, 한 프레임을 버리는 비용이 더 싸다.
        if (!generation.equals(currentGeneration(generationKey))) {
            log.debug("차단 목록 조회 중 세대가 바뀌었다 — 이 프레임은 보내지 않는다");
            throw new UpstreamUnavailableException();
        }
        store(cacheKey, generation, fresh);
        return fresh;
    }

    private String currentGeneration(String generationKey) {
        try {
            String value = redis.opsForValue().get(generationKey);
            return value == null ? "0" : value;
        } catch (RuntimeException e) {
            log.warn("차단 세대 재확인 실패 — 이 프레임은 보내지 않는다. reason={}", e.getClass().getSimpleName());
            throw new UpstreamUnavailableException();
        }
    }

    /**
     * 조회 «전에» 읽은 세대로 적재한다 — 조회 도중 세대가 올랐으면 이 값은 다음 읽기에서 버려진다.
     *
     * <p>적재 실패는 이 판정을 막지 않는다. 판정은 방금 Data 정본에서 받아 왔고, 다음 프레임이 다시 묻는다.
     */
    private void store(String cacheKey, String generation, Set<UUID> ids) {
        try {
            String value = generation + GENERATION_SEPARATOR
                    + ids.stream().map(UUID::toString).collect(Collectors.joining(ID_SEPARATOR));
            redis.opsForValue().set(cacheKey, value, cacheTtl);
        } catch (RuntimeException e) {
            log.warn("차단 캐시 적재 실패 — reason={}", e.getClass().getSimpleName());
        }
    }

    /**
     * @return 세대가 같으면 집합. 세대가 다르거나 값이 깨졌으면 {@code null} — 정본을 다시 읽는다.
     *         깨진 값의 일부만 읽어 «덜 차단된» 집합으로 판정하지 않는다
     */
    static Set<UUID> parseIfCurrent(String cached, String generation) {
        int bar = cached.indexOf(GENERATION_SEPARATOR);
        if (bar < 0 || !cached.substring(0, bar).equals(generation)) {
            return null;
        }
        String ids = cached.substring(bar + 1);
        if (ids.isEmpty()) {
            return Set.of();
        }
        try {
            Set<UUID> parsed = new HashSet<>();
            Arrays.stream(ids.split(ID_SEPARATOR)).forEach(raw -> parsed.add(UUID.fromString(raw)));
            return Set.copyOf(parsed);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
