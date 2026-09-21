package com.oneorthree.phone.withdrawal.service;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.common.port.FocusPresencePort;
import com.oneorthree.phone.common.port.FocusPresenceState;
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

import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 탈퇴가 공유 Redis 의 프레즌스 사본을 파기하고 tombstone 으로 재생성을 막는지 — <b>실제 탈퇴 TX · 실제 Redis</b>
 * 위에서 본다 (GROMO-1943 · 계정 LLD §4 Redis 행).
 *
 * <p>랭킹 ZSET 은 Target-2(A20) 로 아직 존재하지 않아 파기할 멤버가 없다 — 이 테스트는 지금 있는 사본인
 * {@code presence:focus:{userId}} 리스·{@code :closed} 표식만 본다.
 */
@SpringBootTest(properties = "focus.presence.enabled=true")
class AccountWithdrawalPresenceErasureIntegrationTest {

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

    @Autowired AccountWithdrawalService withdrawal;
    @Autowired FocusPresencePort presence;
    @Autowired AuthService auth;
    @Autowired JwtProvider jwt;
    @Autowired StringRedisTemplate redis;
    @Autowired JdbcTemplate jdbc;

    @Test
    @DisplayName("탈퇴 후 presence:focus:* 는 0건 · tombstone 1건, 늦은 시작·재구축은 리스를 되살리지 못하고 재전달은 같은 결과다")
    void withdrawalErasesPresenceAndFencesLateWrites() {
        UUID w = guest();
        UUID other = guest();
        Long ended = sessionId();
        started(w, ended);
        presence.focusEnded(w, ended);                        // :closed 표식
        started(w, sessionId());          // 진행 중 리스
        started(other, sessionId());
        assertThat(presenceKeys(w)).isEqualTo(2);

        withdrawal.withdraw(w);

        assertThat(presenceKeys(w)).isZero();
        assertThat(tombstones(w)).isEqualTo(1);
        assertThat(redis.getExpire("presence:withdrawn:" + w)).isPositive();
        assertThat(redis.hasKey("presence:focus:" + other)).isTrue();

        // 탈퇴 커밋 전에 걸린 시작 콜백·재구축이 늦게 도착해도 리스가 생기지 않는다.
        started(w, sessionId());
        assertThat(presence.restoreLeaseIfMissing(w, sessionId(), 0L, FocusPresenceState.ACTIVE,
                Instant.now())).isTrue();
        presence.focusEnded(w, sessionId());
        assertThat(presenceKeys(w)).isZero();

        // 같은 user.withdrawn 재전달 — 키 수가 1회 때와 같다.
        presence.userWithdrawn(w);
        assertThat(presenceKeys(w)).isZero();
        assertThat(tombstones(w)).isEqualTo(1);

        // realtime 커서 파기 대상도 같은 커밋에 적혀 transport 가 붙을 때까지 보존된다.
        assertThat(jdbc.queryForObject("select count(*) from event_outbox_deliveries d join event_outbox o"
                + " on o.id = d.outbox_id where o.user_id = ? and o.type = 'user.withdrawn'"
                + " and d.target = 'REALTIME' and d.delivered_at is null", Long.class, w)).isEqualTo(1L);
    }

    /** 「집중이 시작됐다」 — 레거시 마커와 같은 모양(controlVersion 0 · active). */
    private void started(UUID userId, Long presenceOrder) {
        presence.focusStateChanged(userId, presenceOrder, 0L, FocusPresenceState.ACTIVE, Instant.now());
    }

    private UUID guest() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
    }

    private int presenceKeys(UUID userId) {
        return redis.keys("presence:focus:" + userId + "*").size();
    }

    private int tombstones(UUID userId) {
        return redis.keys("presence:withdrawn:" + userId).size();
    }

    /** DB 순번을 흉내 낸다 — 먼저 뽑힌 것이 더 작다. */
    private static final AtomicLong ORDER = new AtomicLong();

    private static Long sessionId() {
        return ORDER.incrementAndGet();
    }
}
