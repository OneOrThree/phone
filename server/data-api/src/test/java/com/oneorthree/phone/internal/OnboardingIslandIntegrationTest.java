package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.focus.dto.session.FocusVersionedCommandRequest;
import com.oneorthree.phone.focus.dto.session.SeaFocusSessionStartCommandRequest;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.dto.JoinIslandCommandRequest;
import com.oneorthree.phone.internal.service.FocusSessionLifecycleService;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.internal.service.IslandJoinService;
import com.oneorthree.phone.internal.service.TelescopeService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.withdrawal.service.AccountWithdrawalService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 실제 Flyway DB로 무인도 준비 → 바다 집중 → 도착 → 방장 소속을 검증한다. */
@SpringBootTest
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class OnboardingIslandIntegrationTest {
    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("focus.session.start-enabled", () -> true);
    }

    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    TelescopeService telescope;
    @Autowired
    FocusSessionLifecycleService focus;
    @Autowired
    IslandMembershipService islands;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    IslandJoinService joins;
    @Autowired
    AccountWithdrawalService withdrawal;

    @BeforeEach
    void isolate() {
        jdbc.update("update islands set deleted_at = now() where deleted_at is null");
    }

    @Test
    @DisplayName("빈 목록은 주민 0명·건물 0채·15분 무인도 하나이고 재시작·다음 시간에도 목적지가 같다")
    void stablePrivateDestination() {
        UUID user = user();
        var first = telescope.list(user).items();
        assertThat(first).singleElement().satisfies(item -> {
            assertThat(item.name()).isEqualTo("무인도");
            assertThat(item.memberCount()).isZero();
            assertThat(item.buildingCount()).isZero();
            assertThat(item.sailingMinutes()).isEqualTo(15);
        });
        UUID island = first.get(0).islandId();
        assertThat(telescope.list(user).items()).isEqualTo(first);
        assertThat(telescope.list(user, Instant.now().plusSeconds(7200)).items()).isEqualTo(first);
        assertThat(count("select count(*) from group_members where user_id=?", user)).isZero();
        assertThat(jdbc.queryForObject("select is_private from islands where id=?", Boolean.class, island)).isTrue();
        assertThat(telescope.list(user()).items().get(0).islandId()).isNotEqualTo(island);
    }

    @Test
    @DisplayName("동시 첫 조회도 사용자당 무인도를 하나만 만든다")
    void concurrentFirstRead() throws Exception {
        UUID user = user();
        var pool = Executors.newFixedThreadPool(2);
        try {
            var a = pool.submit(() -> telescope.list(user).items().get(0).islandId());
            var b = pool.submit(() -> telescope.list(user).items().get(0).islandId());
            assertThat(a.get(20, TimeUnit.SECONDS)).isEqualTo(b.get(20, TimeUnit.SECONDS));
            assertThat(count("select count(*) from onboarding_islands where user_id=?", user)).isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("정원이 남은 섬이 있거나 이미 소속이 있으면 무인도를 만들지 않는다 — 찬 섬만 있으면 만든다")
    void onlyWhenNeeded() {
        UUID owner = user();
        UUID island = islands.create(owner, new CreateIslandCommandRequest("열린 섬", null, false, 2),
                UUID.randomUUID()).id();
        UUID visitor = user();
        assertThat(telescope.list(visitor).items()).extracting(item -> item.islandId()).containsExactly(island);
        assertThat(count("select count(*) from onboarding_islands where user_id=?", visitor)).isZero();
        assertThat(telescope.list(owner).items()).extracting(item -> item.islandId()).containsExactly(island);
        jdbc.update("update islands set max_members=1 where id=?", island);
        assertThat(telescope.list(visitor).items().get(0).memberCount()).isZero();
        assertThat(count("select count(*) from onboarding_islands where user_id=?", visitor)).isEqualTo(1);
    }

    @Test
    @DisplayName("항해 전·중도 종료 후 도착 요청으로 정착을 우회할 수 없고 남의 예약에도 들어갈 수 없다")
    void requiresActualArrival() {
        UUID user = user();
        UUID island = telescope.list(user).items().get(0).islandId();
        assertThatThrownBy(() -> islands.arrive(user, island, UUID.randomUUID()))
                .isInstanceOf(GroupException.class)
                .hasMessage(GroupErrorCode.ISLAND_NOT_ARRIVED.getMessage());
        assertThatThrownBy(() -> islands.arrive(user(), island, UUID.randomUUID()))
                .isInstanceOf(GroupException.class).hasMessage(GroupErrorCode.GROUP_NOT_FOUND.getMessage());
        assertThatThrownBy(() -> joins.join(user, island, null, UUID.randomUUID()))
                .isInstanceOf(GroupException.class).hasMessage(GroupErrorCode.INVITATION_REQUIRED.getMessage());
        assertThatThrownBy(() -> joins.join(user(), island, null, UUID.randomUUID()))
                .isInstanceOf(GroupException.class).hasMessage(GroupErrorCode.INVITATION_REQUIRED.getMessage());
        var started = focus.startSea(user, new SeaFocusSessionStartCommandRequest(island), UUID.randomUUID());
        var finished = focus.finish(user, started.id(), new FocusVersionedCommandRequest(1L), UUID.randomUUID());
        assertThat(finished.arrived()).isFalse();
        assertThatThrownBy(() -> islands.arrive(user, island, UUID.randomUUID())).isInstanceOf(GroupException.class);
        assertThat(count("select count(*) from group_members where user_id=?", user)).isZero();
        assertThat(telescope.list(user).items().get(0).islandId()).isEqualTo(island);
    }

    @Test
    @DisplayName("15분 항해 뒤 내리면 내 섬과 방장 소속이 생기며 응답 유실 재시도에도 한 번만 정착한다")
    void settleOnceAfterVoyage() {
        UUID user = user();
        UUID island = telescope.list(user).items().get(0).islandId();
        var started = focus.startSea(user, new SeaFocusSessionStartCommandRequest(island), UUID.randomUUID());
        assertThat(count("select count(*) from group_members where user_id=?", user)).isZero();
        Timestamp at = Timestamp.from(Instant.now().minusSeconds(901));
        jdbc.update("update focus_sessions set started_at=? where id=?", at, started.id());
        jdbc.update("update focus_session_details set last_transition_at=? where session_id=?", at, started.id());
        jdbc.update("update focus_session_intervals set started_at=? where session_id=? and ordinal=1", at, started.id());
        var finished = focus.finish(user, started.id(), new FocusVersionedCommandRequest(1L), UUID.randomUUID());
        assertThat(finished.arrived()).isTrue();
        UUID key = UUID.randomUUID();
        var arrival = islands.arrive(user, island, key);
        assertThat(arrival.membershipStatus()).isEqualTo("active");
        assertThat(arrival.currentIslandId()).isEqualTo(island);
        assertThat(arrival.arrivedBefore()).isFalse();
        assertThat(islands.arrive(user, island, key)).isEqualTo(arrival);
        assertThat(islands.arrive(user, island, UUID.randomUUID()).arrivedBefore()).isTrue();
        assertThat(jdbc.queryForObject("select role from group_members where user_id=? and group_id=?",
                String.class, user, island)).isEqualTo("OWNER");
        assertThat(count("select count(*) from onboarding_islands where user_id=?", user)).isZero();
        assertThat(jdbc.queryForObject("select is_private from islands where id=?", Boolean.class, island)).isFalse();
        assertThat(telescope.list(user).items().get(0).membershipStatus()).isEqualTo("active");
    }

    @Test
    @DisplayName("정착 전 계정 탈퇴는 예약을 지우고 주민 없는 개인 섬도 닫는다")
    void withdrawalClosesPendingDestination() {
        UUID user = user();
        UUID island = telescope.list(user).items().get(0).islandId();
        withdrawal.withdraw(user);
        assertThat(count("select count(*) from onboarding_islands where user_id=?", user)).isZero();
        assertThat(jdbc.queryForObject("select status from islands where id=?", String.class, island))
                .isEqualTo("ENDED");
        assertThat(count("select count(*) from islands where id=? and deleted_at is null", island)).isZero();
    }

    @Test
    @DisplayName("화면 밖의 별도 가입 API로 소속이 생겼으면 무인도 첫 정착 조건을 다시 검사한다")
    void rejectsSettlementWhenAnotherApiAddedMembership() {
        UUID user = user();
        UUID island = telescope.list(user).items().get(0).islandId();
        var started = focus.startSea(user, new SeaFocusSessionStartCommandRequest(island), UUID.randomUUID());
        UUID other = islands.create(user(), new CreateIslandCommandRequest("다른 섬", null, false, 5),
                UUID.randomUUID()).id();
        joins.join(user, other, new JoinIslandCommandRequest(null, "telescope"), UUID.randomUUID());
        Timestamp at = Timestamp.from(Instant.now().minusSeconds(901));
        jdbc.update("update focus_sessions set started_at=? where id=?", at, started.id());
        jdbc.update("update focus_session_details set last_transition_at=? where session_id=?", at, started.id());
        jdbc.update("update focus_session_intervals set started_at=? where session_id=? and ordinal=1", at, started.id());
        assertThat(focus.finish(user, started.id(), new FocusVersionedCommandRequest(1L), UUID.randomUUID())
                .arrived()).isTrue();
        assertThatThrownBy(() -> islands.arrive(user, island, UUID.randomUUID()))
                .isInstanceOf(GroupException.class).hasMessage(GroupErrorCode.ISLAND_JOIN_UNAVAILABLE.getMessage());
        assertThat(count("select count(*) from group_members where user_id=? and group_id=?", user, island)).isZero();
        assertThat(jdbc.queryForObject("select is_private from islands where id=?", Boolean.class, island)).isTrue();
        assertThat(count("select count(*) from onboarding_islands where user_id=?", user)).isEqualTo(1);
    }

    private UUID user() {
        return jwt.extractUserId(auth.guestSession(java.util.UUID.randomUUID().toString()).accessToken());
    }

    private long count(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }
}
