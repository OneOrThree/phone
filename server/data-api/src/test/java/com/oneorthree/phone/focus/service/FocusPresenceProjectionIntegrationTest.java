package com.oneorthree.phone.focus.service;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.focus.dto.session.FocusSessionStartCommandRequest;
import com.oneorthree.phone.focus.dto.session.FocusSessionView;
import com.oneorthree.phone.focus.dto.session.FocusVersionedCommandRequest;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.service.FocusSessionLifecycleService;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.utility.DockerImageName;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 한 전이는 프레즌스를 <b>정확히 한 번씩</b> 적는다 (GROMO-2003 · focus-rest-session LLD §6).
 *
 * <p>프레즌스는 두 곳에 나간다 — 섬 목록 사건(내구 outbox, 같은 TX)과 공유 Redis 리스(커밋 이후).
 * 종전에는 전이마다 호출부가 둘을 각각 불렀고, 그 호출부가 네 클래스 13곳에 흩어져 있었다. 그래서
 * 이 티켓이 «적는 자리»를 {@link FocusPresenceProjection} 하나로 모았다. 그 통합이 실제로 통합인지는
 * <b>두 저장소를 같은 전이 뒤에 나란히 세어</b>야 알 수 있다 — 어느 한쪽만 보면 「사건은 둘인데 리스는
 * 안 갱신」이나 그 반대가 초록으로 지나간다.
 *
 * <p>중복이 왜 문제인가: 같은 전이의 사건이 둘이면 소비측이 같은 {@code (projection, islandId, userId)}
 * 축에서 같은 version 을 두 번 보고, 리스가 두 번 써지면 그중 하나가 <b>낡은 상태</b>일 수 있다.
 *
 * <p>실제 Flyway PostgreSQL · 실제 Redis 위에서 본다. 리스는 Lua 조건부 연산이라 목으로는 한 글자도
 * 검증되지 않고, 순번({@code presence_order})은 DB 시퀀스가 INSERT 때 채운다.
 */
@SpringBootTest(properties = {"focus.presence.enabled=true", "focus.session.start-enabled=true"})
class FocusPresenceProjectionIntegrationTest {

    @SuppressWarnings("resource")
    private static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:7-alpine")).withExposedPorts(6379);

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        REDIS.start();
        registry.add("spring.data.redis.host", REDIS::getHost);
        registry.add("spring.data.redis.port", REDIS::getFirstMappedPort);
    }

    @Autowired FocusSessionLifecycleService focus;
    @Autowired IslandMembershipService islands;
    @Autowired AuthService auth;
    @Autowired JwtProvider jwt;
    @Autowired StringRedisTemplate redis;
    @Autowired JdbcTemplate jdbc;

    @Test
    @DisplayName("start·pause·resume·finish 가 각각 사건 둘과 리스 하나만 남긴다 — 어디에도 중복이 없다")
    void everyTransitionRecordsPresenceExactlyOnce() {
        UUID user = newUser();
        UUID island = islands.create(user, new CreateIslandCommandRequest("프레즌스섬", null, false, null),
                UUID.randomUUID()).id();

        FocusSessionView started = focus.start(user,
                new FocusSessionStartCommandRequest(island, "알고리즘", 25), UUID.randomUUID());
        long order = presenceOrder(started.id());
        assertPresence(user, started, order, "active");

        FocusSessionView paused = focus.pause(user, started.id(),
                new FocusVersionedCommandRequest(started.version()), UUID.randomUUID());
        // 휴식도 리스를 «갱신»한다 — 값이 상태를 담게 됐기 때문이다. 키는 그대로라 채팅 차단은 그대로다.
        assertPresence(user, paused, order, "paused");

        FocusSessionView resumed = focus.resume(user, paused.id(),
                new FocusVersionedCommandRequest(paused.version()), UUID.randomUUID());
        assertPresence(user, resumed, order, "active");

        focus.finish(user, resumed.id(), new FocusVersionedCommandRequest(resumed.version()), UUID.randomUUID());

        // 종료는 목록에서 지우는 사건 둘 + 리스 삭제다. 리스가 남으면 그 사람은 TTL 13시간 동안 채팅에 못 든다.
        assertThat(events("focus.member.updated", started.id(), 4L)).isEqualTo(1);
        assertThat(events("rest.member.updated", started.id(), 4L)).isEqualTo(1);
        assertThat(redis.hasKey(lease(user))).isFalse();

        // 네 전이 × 사건 둘 = 여덟. 하나라도 더 있으면 어딘가가 두 번 적은 것이다.
        assertThat(count("select count(*) from event_outbox where params->>'sessionId'=? "
                + "and type in ('focus.member.updated','rest.member.updated')",
                started.id().toString())).isEqualTo(8);
    }

    /**
     * 그 전이 뒤의 두 저장소를 나란히 본다 — 사건은 종류마다 <b>정확히 하나</b>, 리스는 그 전이의 값
     * <b>하나</b>.
     *
     * <p>리스 값이 {@code 순번:controlVersion:상태} 인 것이 계약이다. version 을 함께 보는 이유는,
     * 같은 세션의 전이가 전부 같은 순번을 싣기 때문이다 — 순번만 보면 pause 가 반영됐는지 알 수 없다.
     */
    private void assertPresence(UUID userId, FocusSessionView view, long order, String state) {
        assertThat(events("focus.member.updated", view.id(), view.version()))
                .as("focus 사건은 이 전이에 정확히 하나")
                .isEqualTo(1);
        assertThat(events("rest.member.updated", view.id(), view.version()))
                .as("rest 사건은 이 전이에 정확히 하나")
                .isEqualTo(1);
        assertThat(redis.opsForValue().get(lease(userId)))
                .as("리스는 그 전이의 순번·controlVersion·절대 상태를 싣는다")
                .isEqualTo(order + ":" + view.version() + ":" + state);
        assertThat(redis.keys("presence:focus:" + userId + "*"))
                .as("리스와 «끝났다» 표식 말고 다른 키가 생기지 않는다")
                .hasSizeLessThanOrEqualTo(2);
    }

    private long events(String type, UUID sessionId, long sessionVersion) {
        return count("select count(*) from event_outbox where type=? and params->>'sessionId'=? "
                + "and params->>'sessionVersion'=?", type, sessionId.toString(), String.valueOf(sessionVersion));
    }

    private long presenceOrder(UUID sessionId) {
        Long order = jdbc.queryForObject("select presence_order from focus_sessions where id=?", Long.class,
                sessionId);
        assertThat(order).as("V77 의 DEFAULT nextval 이 INSERT 때 순번을 채운다").isNotNull();
        return order;
    }

    private static String lease(UUID userId) {
        return "presence:focus:" + userId;
    }

    private UUID newUser() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
    }

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0L : value;
    }
}
