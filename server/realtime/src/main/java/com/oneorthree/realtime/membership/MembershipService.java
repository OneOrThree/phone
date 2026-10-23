package com.oneorthree.realtime.membership;

import com.oneorthree.realtime.common.exception.UpstreamUnavailableException;
import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.common.redis.Sourced;
import com.oneorthree.realtime.membership.client.GroupClient;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
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
 * 상류의 불완전한 성공 응답은 적재하지 않는다 — {@link GroupClient.Membership}의
 * {@code cacheable}이 구분한다. 사용자 자격 거절과 서비스 배선 오류는 예외로 전파한다.
 *
 * <h2>무효화는 TTL 과 사건 둘이다(GROMO-2140)</h2>
 * Data 가 {@code island.members.updated}(MEMBER_ADDED·MEMBER_REMOVED) 를 발행하면
 * {@link com.oneorthree.realtime.event.InboundEventService} 가 그 {@code params.memberUserId} 로
 * {@link #evict} 를 불러 그 유저 하나의 캐시만 즉시 지운다 — 강퇴·탈퇴가 다음 발신까지 기다리지 않는다.
 * {@code chat.membership.cache-ttl-seconds} 는 <b>여전히 백스톱</b>이다: 사건이 옛 Data 버전이라 필드가
 * 없거나, 유실되거나, 무효화 자체가 실패해도 최대 그 초만큼 뒤에는 저절로 닫힌다. TTL 을 늘리는 건
 * 그 백스톱 창을 늘리는 거래인 건 그대로다.
 *
 * <h2>무효화보다 늦게 도착한 적재를 거른다(GROMO-2141)</h2>
 * 키를 지우기만 하면 순서가 보장되지 않는다. 강퇴 커밋 직전에 상류 조회를 시작한 요청 A 가 있고, 강퇴 사건을 받은 B 가 키를 지운
 * 뒤에 A 가 «옛 집합»을 적재하면 강퇴된 사람이 TTL 동안 그 섬의 대화를 계속 받는다. 그래서 무효화는 키를 지우기 «전에»
 * {@link RedisKeys#memberGeneration 표식}을 새 무작위 값으로 쓰고, 조회는 상류를 부르기 «전에» 표식을 읽어 두었다가 적재 때
 * <b>표식이 그대로일 때만</b> 쓴다(Lua 한 번 — 비교와 쓰기 사이에 무효화가 끼지 못한다). 사건은 한 인스턴스에만 닿으므로
 * 표식은 JVM 이 아니라 Redis 에 있어야 한다. 캐시 값 형식은 그대로다 — 세대를 값에 싣지 않는다.
 *
 * <p>표식이 어긋나 적재가 건너뛰어져도 그 한 번의 호출은 받아 온 답으로 판정한다(그 조회는 무효화 «이후»의 답일 수도 있고, 어느 쪽이든
 * 다음 호출이 다시 묻는다). 표식을 못 읽었으면 적재하지 않는다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MembershipService {

    /** 구분자. UUID 표기에 절대 나오지 않는 문자여야 한다 — 나오면 값이 조용히 쪼개진다. */
    private static final String SEPARATOR = ",";

    /**
     * 무효화 표식 수명의 하한(초). 표식 없음(빈 문자열)으로 읽은 조회가 표식 TTL 보다 오래 멈췄다 깨어나면 «표식 없음 == 표식 없음»으로
     * 통과해 옛 집합을 적재한다 — 그 창을 캐시 TTL(기본 120 s)이 아니라 이 값으로 닫는다. 표식은 동일성 비교에만 쓰여
     * 캐시보다 오래 살아도 해가 없다.
     */
    private static final long MARK_MIN_TTL_SECONDS = 600;

    /**
     * 표식이 {@code ARGV[1]}(조회 전에 읽은 값, 없었으면 빈 문자열) 그대로일 때만 캐시를 쓴다 — 반환 1 적재, 0 건너뜀.
     * KEYS: 캐시, 표식. ARGV: 읽어 둔 표식, 값, 수명(초). 값과 수명은 여전히 한 {@code SET … EX} 명령이다.
     */
    private static final RedisScript<Long> STORE_IF_UNMARKED = new DefaultRedisScript<>("""
            if (redis.call('GET', KEYS[2]) or '') ~= ARGV[1] then return 0 end
            redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3]) return 1
            """, Long.class);

    private final GroupClient groupClient;
    private final StringRedisTemplate redis;

    @Value("${chat.membership.cache-ttl-seconds:120}")
    private long cacheTtlSeconds;

    /**
     * @param groupId 들어가려는 섬
     * @param userId 요청자
     * @param bearerToken 요청자의 {@code Authorization} 헤더 통째로 — 캐시 미스일 때만 쓰인다
     * @return 그 섬의 활성 멤버면 true
     * @throws com.oneorthree.realtime.common.exception.UpstreamUnavailableException
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
        // 캐시와 무효화 표식을 한 번에 읽는다 — 표식은 상류를 부르기 «전에» 잡아야 하므로 캐시와 같은 시점이 가장 안전하다.
        List<String> read = redis.opsForValue().multiGet(
                List.of(RedisKeys.memberCache(userId), RedisKeys.memberGeneration(userId)));
        // null 이면 캐시 없음. 빈 문자열은 «아무 섬에도 안 속함»이라는 «캐시된 답»이다 — 그 둘을
        // 구분할 수 있어야 소속 없는 유저가 매 요청 상류로 새지 않는다.
        String cached = read == null ? null : read.get(0);
        if (cached != null) {
            return parse(cached);
        }
        // 표식을 못 읽었으면(응답 없음) null — readMark 와 같은 규칙으로 적재를 건너뛴다. Redis 예외는 캐시 읽기 실패와
        // 같이 올라간다(예전 GET 과 같다).
        String mark = read == null ? null : markOf(read.get(1));
        return fetchAndStore(userId, bearerToken, mark).groupIds();
    }

    /**
     * 캐시를 <b>읽지 않고</b> 상류에 바로 묻는다 — 이동 방의 강퇴 재검사용(GROMO-2247, N7). 받은 답은 캐시에도
     * 다시 적재해 이후 판정이 그 답을 쓴다.
     *
     * <p>재검사가 캐시를 읽으면, 사건의 캐시 삭제({@link #evict})가 실패했을 때 남은 옛 답(「멤버」)이 강퇴된 사람을
     * 그대로 통과시킨다. 정본에 바로 물으면 그 실패가 판정에 끼어들 자리가 없다.
     *
     * <p>방문자 응원(GROMO-2258)도 같은 이유로 이걸 쓴다 — 가입 직후 남은 «비주민» 캐시를 믿으면 세션 없는 주민이
     * 방문자로 위장해 {@code NOT_FOCUSING} 을 비켜 간다.
     *
     * <p><b>비주민은 성공한 조회로만 확정한다</b>(GROMO-2258). 본문·items·id가 없는 불완전한 답은
     * 소속에 대한 사실이 아니다. 이를 false로 접으면 조회가 실패한 주민이 방문자로 승인된다.
     *
     * @throws com.oneorthree.realtime.common.exception.UpstreamUnavailableException 상류 장애·서비스 인증 실패
     *         또는 형식이 깨진 성공 응답일 때
     */
    public boolean isMemberUncached(UUID groupId, UUID userId, String bearerToken) {
        GroupClient.Membership fresh = fetchAndStore(userId, bearerToken, readMark(userId));
        if (!fresh.cacheable()) {
            throw new UpstreamUnavailableException();
        }
        return fresh.groupIds().contains(groupId);
    }

    /** 상류를 부르기 «전에» 읽어 둔 표식. 없으면 빈 문자열, 읽기가 실패하면 {@code null} — 그러면 적재하지 않는다. */
    private String readMark(UUID userId) {
        try {
            return markOf(redis.opsForValue().get(RedisKeys.memberGeneration(userId)));
        } catch (RuntimeException e) {
            log.warn("멤버십 무효화 표식 읽기 실패 — 이번 조회는 캐시에 적재하지 않는다. userId={}", userId, e);
            return null;
        }
    }

    /** 표식 없음(null)은 빈 문자열로 접는다 — 적재 스크립트가 «없음»을 같은 값으로 비교한다. */
    private static String markOf(String raw) {
        return raw == null ? "" : raw;
    }

    /** @param mark 상류를 부르기 전에 읽은 무효화 표식 — {@code null} 이면 적재를 건너뛴다 */
    private GroupClient.Membership fetchAndStore(UUID userId, String bearerToken, String mark) {
        GroupClient.Membership fresh = groupClient.fetchMyGroupIds(bearerToken);
        // 형식이 불완전한 답을 무소속으로 캐시하면 정상 주민까지 TTL 동안 방문자로 오인한다.
        if (fresh.cacheable() && mark != null) {
            store(userId, mark, fresh.groupIds());
        }
        return fresh;
    }

    /**
     * 캐시 적재 — <b>한 명령으로</b> 값과 수명을 같이 걸되, 표식이 {@code mark} 그대로일 때만 쓴다(GROMO-2141).
     *
     * <p>표식이 바뀌었으면 조회 도중 무효화가 지나갔다는 뜻이라 이 값은 옛 집합일 수 있다 — 쓰지 않고 호출자에게는 받아 온 답을
     * 그대로 돌려준다(예외로 올리지 않는다).
     *
     * <p>실패해도 요청을 막지 않는다. 판정 자체는 이미 상류에서 받아 왔으므로 그 요청은 정상 처리하고
     * 다음 요청이 다시 시도하게 둔다. 적재가 «부분적으로» 성공할 수는 없다는 점이 중요하다 —
     * 값만 남고 수명이 안 걸리는 상태가 이 캐시에서는 영구 멤버십을 뜻하기 때문이다.
     */
    private void store(UUID userId, String mark, Set<UUID> groupIds) {
        try {
            String value = groupIds.stream().map(UUID::toString).collect(Collectors.joining(SEPARATOR));
            Long stored = redis.execute(STORE_IF_UNMARKED,
                    List.of(RedisKeys.memberCache(userId), RedisKeys.memberGeneration(userId)),
                    mark, value, Long.toString(cacheTtlSeconds));
            if (stored == null || stored == 0L) {
                log.debug("멤버십 캐시 적재 건너뜀 — 조회 도중 무효화됨. userId={}", userId);
            }
        } catch (RuntimeException e) {
            log.warn("멤버십 캐시 적재 실패 — userId={}", userId, e);
        }
    }

    /**
     * 사건이 준 즉시 무효화 — 그 유저의 캐시만 지운다(GROMO-2140).
     *
     * <p>실패해도 사건 처리를 막지 않는다({@link #store} 와 같은 이유) — 지우기가 실패해도 그 TTL 이
     * 지나면 어차피 만료되므로, 여기서 예외를 올려 사건 적용 전체를 되돌릴 값어치가 없다. 다만 실패를 돌려줘
     * 부르는 쪽이 그 TTL 동안의 옛 답을 피해 갈 수 있게 한다(강퇴 뒤 이동 구독, GROMO-2247).
     *
     * <p>지우기 «전에» 표식을 새 값으로 쓴다(GROMO-2141) — 이미 상류를 부르던 조회가 지운 뒤에 옛 집합을 적재하지 못하게.
     * 순서가 반대면 지운 직후·표식을 쓰기 직전 틈에 그 적재가 통과한다.
     *
     * <p>표식 쓰기와 지우기는 서로 독립이다 — 한쪽이 실패해도 다른 쪽은 시도한다.
     *
     * @return 표식 쓰기와 지우기가 모두 되었으면(지울 게 없었어도) true, 하나라도 Redis 가 실패했으면 false
     */
    public boolean evict(UUID userId) {
        boolean failed = false;
        try {
            // ponytail: 표식 수명은 상류 조회가 멈출 수 있는 최장 시간을 넘어야 한다(정상은 GroupClient 타임아웃 ≈ 6 s) —
            // 캐시 TTL 과 하한 MARK_MIN_TTL_SECONDS 중 큰 값. 그보다 오래 멈춘 조회는 못 거른다.
            redis.opsForValue().set(RedisKeys.memberGeneration(userId), UUID.randomUUID().toString(),
                    Duration.ofSeconds(Math.max(cacheTtlSeconds, MARK_MIN_TTL_SECONDS)));
        } catch (RuntimeException e) {
            // 표식 쓰기가 실패해도 지우기는 시도한다 — 이 PR 이전에는 지우기만 있었다. 둘 중 하나라도 실패하면 false.
            log.warn("멤버십 무효화 표식 쓰기 실패 — 캐시 삭제는 계속 시도한다. userId={}", userId, e);
            failed = true;
        }
        try {
            redis.delete(RedisKeys.memberCache(userId));
        } catch (RuntimeException e) {
            log.warn("멤버십 캐시 무효화 실패 — userId={}", userId, e);
            failed = true;
        }
        return !failed;
    }

    /**
     * 캐시된 소속과 <b>그 값의</b> 만료를 한 원자 단위로 읽는다 — 상류는 부르지 않는다(GROMO-2340). 전달 직전 인가 캐시가
     * 「이 판정을 언제까지 믿어도 되는가」를 이 값에서 얻는다. 캐시가 없으면 값이 {@code null}, 만료는
     * {@link Sourced#EXPIRED} 다.
     *
     * @throws RuntimeException Redis 실패 — 부르는 쪽은 담지 않는다
     */
    public Sourced<Set<UUID>> cachedGroupIdsSourced(UUID userId) {
        Sourced<List<String>> read = Sourced.read(redis, RedisKeys.memberCache(userId));
        return read.expiresAtNanos() == Sourced.EXPIRED ? new Sourced<>(null, Sourced.EXPIRED)
                : new Sourced<>(parse(read.value().get(0)), read.expiresAtNanos());
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
