package com.oneorthree.phone.focus.service;

import com.fasterxml.uuid.Generators;
import com.fasterxml.uuid.UUIDClock;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.common.port.FocusPresencePort;
import com.oneorthree.phone.common.port.FocusPresenceState;
import com.oneorthree.phone.focus.dto.FocusSessionStartRequest;
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

import java.time.Duration;
import java.time.Instant;
import java.util.Random;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 집중 프레즌스의 순서는 <b>DB 순번</b>이 정한다 — 세션 id 를 만든 인스턴스의 시계가 아니다 (GROMO-1743).
 *
 * <p>운영 마이그레이션(V77 포함)을 돈 Postgres · 실제 Redis · 실제 시작 경로 위에서 본다. 순번이 INSERT 때
 * 채워져 커밋 콜백까지 실려 가는지는 목으로 확인되지 않는다(쓰기 지연이면 {@code null} 이 실린다).
 */
@SpringBootTest(properties = "focus.presence.enabled=true")
class FocusPresenceDbOrderIntegrationTest {

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

    @Autowired FocusService focusService;
    @Autowired FocusPresencePort presence;
    @Autowired AuthService auth;
    @Autowired JwtProvider jwt;
    @Autowired StringRedisTemplate redis;
    @Autowired JdbcTemplate jdbc;

    @Test
    @DisplayName("시계가 앞선 인스턴스가 만든 «이전» 세션의 늦은 시작·종료도 «DB 순번이 큰» 새 세션의 리스를 못 건드린다")
    void newerDbOrderWinsOverSkewedInstanceClock() {
        UUID user = jwt.extractUserId(auth.guestLogin().accessToken());
        String lease = "presence:focus:" + user;

        // 인스턴스 A(시계 5분 앞섬)가 이전 세션을 만든 상황 — id 만 A 의 시계로 바꿔 둔다.
        UUID older = focusService.startFocusSession(user, new FocusSessionStartRequest(null,
                Instant.now().minus(Duration.ofMinutes(1)))).sessionId();
        UUID olderIdFromFastClock = uuidV7At(Instant.now().plus(Duration.ofMinutes(5)));
        jdbc.update("update focus_sessions set id = ? where id = ?", olderIdFromFastClock, older);
        long olderOrder = presenceOrder(olderIdFromFastClock);

        // 인스턴스 B(시계 정확)가 다음 세션을 연다 — 이전 마커를 닫고 새 리스를 놓는다.
        UUID newer = focusService.startFocusSession(user, new FocusSessionStartRequest(null, null)).sessionId();
        long newerOrder = presenceOrder(newer);

        // UUID 로 비교했다면 A 의 옛 세션이 «더 새로워» 보인다. DB 순번은 그렇지 않다.
        assertThat(olderIdFromFastClock.toString()).isGreaterThan(newer.toString());
        assertThat(newerOrder).isGreaterThan(olderOrder);
        assertThat(redis.opsForValue().get(lease)).isEqualTo(newerOrder + ":0:active");

        // A 의 커밋 콜백이 늦게 도착한다 — 옛 시작도, 옛 종료도 새 리스를 바꾸지 못한다.
        presence.focusStateChanged(user, olderOrder, 0L, FocusPresenceState.ACTIVE, Instant.now());
        presence.focusEnded(user, olderOrder);
        assertThat(redis.opsForValue().get(lease)).isEqualTo(newerOrder + ":0:active");

        // 새 세션의 종료는 지운다.
        presence.focusEnded(user, newerOrder);
        assertThat(redis.hasKey(lease)).isFalse();
    }

    private long presenceOrder(UUID sessionId) {
        Long order = jdbc.queryForObject("select presence_order from focus_sessions where id = ?", Long.class,
                sessionId);
        assertThat(order).as("V77 의 DEFAULT nextval 이 INSERT 때 순번을 채운다").isNotNull();
        return order;
    }

    private static UUID uuidV7At(Instant at) {
        return Generators.timeBasedEpochGenerator(new Random(), new UUIDClock() {
            @Override
            public long currentTimeMillis() {
                return at.toEpochMilli();
            }
        }).generate();
    }
}
