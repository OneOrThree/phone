package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.focus.dto.session.FocusVersionedCommandRequest;
import com.oneorthree.phone.focus.dto.session.SeaFocusSessionStartCommandRequest;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.dto.IntroArrivalRequest;
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
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
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
    com.oneorthree.phone.internal.service.IntroVoyageService intro;
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
    @DisplayName("빈 목록의 무인도 후보는 시간대 내에 고정되지만 섬·예약 행을 만들지 않는다")
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
        assertThat(telescope.list(user, Instant.now().plusSeconds(7200)).items().get(0).islandId())
                .isNotEqualTo(island);
        assertThat(count("select count(*) from group_members where user_id=?", user)).isZero();
        assertThat(count("select count(*) from islands where id=?", island)).isZero();
        assertThat(count("select count(*) from onboarding_islands where user_id=?", user)).isZero();
        assertThat(telescope.list(user()).items().get(0).islandId()).isNotEqualTo(island);
    }

    @Test
    @DisplayName("동시 첫 조회도 같은 가상 후보를 돌려주며 섬을 만들지 않는다")
    void concurrentFirstRead() throws Exception {
        UUID user = user();
        var pool = Executors.newFixedThreadPool(2);
        try {
            var a = pool.submit(() -> telescope.list(user).items().get(0).islandId());
            var b = pool.submit(() -> telescope.list(user).items().get(0).islandId());
            assertThat(a.get(20, TimeUnit.SECONDS)).isEqualTo(b.get(20, TimeUnit.SECONDS));
            assertThat(count("select count(*) from onboarding_islands where user_id=?", user)).isZero();
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("일반 목록의 가입 가능 여부와 무관하게 무소속·기존 주민 모두 무인도를 본다")
    void alwaysShownAlongsideNormalIslands() {
        UUID owner = user();
        UUID island = islands.create(owner, new CreateIslandCommandRequest("열린 섬", null, false, 2),
                UUID.randomUUID()).id();
        UUID visitor = user();
        assertThat(telescope.list(visitor).items()).extracting(item -> item.islandId()).contains(island);
        assertThat(telescope.list(visitor).items()).extracting(item -> item.slot()).contains("uninhabited");
        assertThat(count("select count(*) from onboarding_islands where user_id=?", visitor)).isZero();
        assertThat(telescope.list(owner).items()).extracting(item -> item.islandId()).contains(island);
        assertThat(telescope.list(owner).items()).extracting(item -> item.slot()).contains("uninhabited");
        jdbc.update("update islands set max_members=1 where id=?", island);
        assertThat(telescope.list(visitor).items()).anySatisfy(item -> {
            assertThat(item.slot()).isEqualTo("uninhabited");
            assertThat(item.sailingMinutes()).isEqualTo(15);
        });
        assertThat(count("select count(*) from onboarding_islands where user_id=?", visitor)).isZero();
    }

    @Test
    @DisplayName("항해 전·중도 종료 후 가상 목적지로 도착하거나 가입할 수 없다")
    void requiresActualArrival() {
        UUID user = user();
        UUID island = telescope.list(user).items().get(0).islandId();
        assertThatThrownBy(() -> islands.arrive(user, island, UUID.randomUUID()))
                .isInstanceOf(GroupException.class)
                .hasMessage(GroupErrorCode.GROUP_NOT_FOUND.getMessage());
        assertThatThrownBy(() -> islands.arrive(user(), island, UUID.randomUUID()))
                .isInstanceOf(GroupException.class).hasMessage(GroupErrorCode.GROUP_NOT_FOUND.getMessage());
        assertThatThrownBy(() -> joins.join(user, island, null, UUID.randomUUID()))
                .isInstanceOf(GroupException.class).hasMessage(GroupErrorCode.GROUP_NOT_FOUND.getMessage());
        assertThatThrownBy(() -> joins.join(user(), island, null, UUID.randomUUID()))
                .isInstanceOf(GroupException.class).hasMessage(GroupErrorCode.GROUP_NOT_FOUND.getMessage());
        var started = focus.startSea(user, new SeaFocusSessionStartCommandRequest(island), UUID.randomUUID());
        var finished = focus.finish(user, started.id(), new FocusVersionedCommandRequest(1L), UUID.randomUUID());
        assertThat(finished.arrived()).isFalse();
        // 도착하지 못했으면 섬을 만들지 않으므로 플래그는 거짓이다(GROMO-2650).
        assertThat(finished.createdIsland()).isFalse();
        assertThatThrownBy(() -> islands.arrive(user, island, UUID.randomUUID())).isInstanceOf(GroupException.class);
        assertThat(count("select count(*) from group_members where user_id=?", user)).isZero();
        assertThat(count("select count(*) from islands where id=?", island)).isZero();
    }

    @Test
    @DisplayName("15분 항해 성공 정산에서 섬과 방장 소속이 한 번만 생긴다")
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
        // 무인도 항해 성공으로 섬이 새로 생겼으므로 앱에 이름 짓기 팝업 플래그가 참이다(GROMO-2650).
        assertThat(finished.createdIsland()).isTrue();
        UUID created = finished.islandId();
        assertThat(created).isNotEqualTo(island);
        assertThat(count("select count(*) from islands where id=?", island)).isZero();
        assertThat(count("select count(*) from group_members where user_id=? and group_id=?", user, created)).isEqualTo(1);
        // 마을회관은 완공 상태로 함께 생기되(GROMO-2650), 완공 안내가 뜨지 않도록 recipient 행은 만들지 않는다.
        assertThat(count("select count(*) from island_facilities where island_id=? and building_id='hall'"
                + " and status='COMPLETED'", created)).isEqualTo(1);
        assertThat(count("select count(*) from island_facilities where island_id=?", created)).isEqualTo(1);
        assertThat(count("select count(*) from construction_guide_recipients where island_id=?", created)).isZero();
        // 완공 회관은 공동 외양 맵에도 등록돼야 테마 PATCH 가 422 로 거절되지 않는다(GROMO-2650 코드리뷰).
        assertThat(jdbc.queryForObject("select jsonb_exists(building_themes, 'hall') from island_appearances"
                + " where island_id=?", Boolean.class, created)).isTrue();
        UUID key = UUID.randomUUID();
        var arrival = islands.arrive(user, created, key);
        assertThat(arrival.membershipStatus()).isEqualTo("active");
        assertThat(arrival.currentIslandId()).isEqualTo(created);
        assertThat(arrival.arrivedBefore()).isFalse();
        assertThat(islands.arrive(user, created, key)).isEqualTo(arrival);
        assertThat(islands.arrive(user, created, UUID.randomUUID()).arrivedBefore()).isTrue();
        assertThat(jdbc.queryForObject("select role from group_members where user_id=? and group_id=?",
                String.class, user, created)).isEqualTo("OWNER");
        assertThat(count("select count(*) from onboarding_islands where user_id=?", user)).isZero();
        assertThat(jdbc.queryForObject("select is_private from islands where id=?", Boolean.class, created)).isFalse();
        assertThat(telescope.list(user).items()).anySatisfy(item -> {
            assertThat(item.islandId()).isEqualTo(created);
            assertThat(item.membershipStatus()).isEqualTo("active");
        });
    }

    @Test
    @DisplayName("정착 전 계정 탈퇴에는 제거할 예약 섬이 없다")
    void withdrawalClosesPendingDestination() {
        UUID user = user();
        UUID island = telescope.list(user).items().get(0).islandId();
        withdrawal.withdraw(user);
        assertThat(count("select count(*) from onboarding_islands where user_id=?", user)).isZero();
        assertThat(count("select count(*) from islands where id=?", island)).isZero();
    }

    @Test
    @DisplayName("항해 중 다른 섬에 가입해도 상한 이내면 성공 정산에서 새 섬을 만든다")
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
        var finished = focus.finish(user, started.id(), new FocusVersionedCommandRequest(1L), UUID.randomUUID());
        assertThat(finished.arrived()).isTrue();
        assertThat(finished.islandId()).isNotEqualTo(island);
        assertThat(count("select count(*) from group_members where user_id=? and group_id=?", user, island)).isZero();
        assertThat(count("select count(*) from group_members where user_id=? and group_id=?", user,
                finished.islandId())).isEqualTo(1);
        assertThat(count("select count(*) from onboarding_islands where user_id=?", user)).isZero();
    }

    @Test
    @DisplayName("출항 뒤 소속 상한에 도달해도 항해는 종료되고 무인도는 생성되지 않는다")
    void membershipLimitReachedDuringVoyage() {
        UUID user = user();
        UUID candidate = telescope.list(user).items().get(0).islandId();
        var started = focus.startSea(user, new SeaFocusSessionStartCommandRequest(candidate), UUID.randomUUID());
        for (int i = 0; i < 3; i++) {
            UUID other = islands.create(user(), new CreateIslandCommandRequest("가입 섬 " + i, null, false, 5),
                    UUID.randomUUID()).id();
            joins.join(user, other, new JoinIslandCommandRequest(null, "telescope"), UUID.randomUUID());
        }
        Timestamp at = Timestamp.from(Instant.now().minusSeconds(901));
        jdbc.update("update focus_sessions set started_at=? where id=?", at, started.id());
        jdbc.update("update focus_session_details set last_transition_at=? where session_id=?", at, started.id());
        jdbc.update("update focus_session_intervals set started_at=? where session_id=? and ordinal=1", at, started.id());

        var finished = focus.finish(user, started.id(), new FocusVersionedCommandRequest(1L), UUID.randomUUID());
        assertThat(finished.arrived()).isFalse();
        assertThat(finished.islandId()).isEqualTo(candidate);
        assertThat(count("select count(*) from islands where id=?", candidate)).isZero();
        assertThat(count("select count(*) from group_members where user_id=?", user)).isEqualTo(3);
    }

    @Test
    @DisplayName("첫 항해 체험은 무인도를 한 번만 만들고 집중·보상 없이 도착한다")
    void introductoryArrivalIsAtomicAndReplayable() {
        UUID user = user();
        UUID candidate = telescope.list(user).items().get(0).islandId();
        UUID key = UUID.randomUUID();
        var arrival = intro.arrive(user, candidate, key, null);
        assertThat(arrival.islandId()).isNotEqualTo(candidate);
        assertThat(arrival.currentIslandId()).isEqualTo(arrival.islandId());
        assertThat(arrival.membershipStatus()).isEqualTo("active");
        assertThat(arrival.arrivedBefore()).isFalse();
        assertThat(intro.arrive(user, candidate, key, null)).isEqualTo(arrival);
        assertThat(count("select count(*) from group_members where user_id=?", user)).isEqualTo(1);
        assertThat(count("select count(*) from focus_sessions where user_id=?", user)).isZero();
        assertThat(count("select count(*) from island_arrivals where user_id=?", user)).isEqualTo(1);
        assertThat(count("select count(*) from island_wallets where island_id=? and balance=0",
                arrival.islandId())).isEqualTo(1);
        assertThat(count("select count(*) from event_outbox where type='island.member.arrived' and user_id=?",
                user)).isEqualTo(1);
    }

    @Test
    @DisplayName("첫 항해 체험의 기존 섬 도착은 가입을 강제하지 않고 새 키도 허용한다")
    void introductoryArrivalVisitsAnExistingIslandWithoutJoining() {
        UUID owner = user();
        UUID destination = islands.create(owner, new CreateIslandCommandRequest("친구 섬", null, false, 5),
                UUID.randomUUID()).id();
        UUID user = user();
        var arrival = intro.arrive(user, destination, UUID.randomUUID(), null);
        assertThat(arrival.islandId()).isEqualTo(destination);
        assertThat(arrival.membershipStatus()).isEqualTo("none");
        assertThat(arrival.currentIslandId()).isNull();
        assertThat(intro.arrive(user, destination, UUID.randomUUID(), null).islandId()).isEqualTo(destination);
        assertThat(count("select count(*) from group_members where user_id=?", user)).isZero();
        assertThat(count("select count(*) from focus_sessions where user_id=?", user)).isZero();
    }

    @Test
    @DisplayName("목록 밖 목적지와 진행 세션은 첫 항해 체험으로 우회하지 못한다")
    void introductoryArrivalChecksDestinationAndLiveSession() {
        UUID user = user();
        assertThatThrownBy(() -> intro.arrive(user, UUID.randomUUID(), UUID.randomUUID(), null))
                .hasFieldOrPropertyWithValue("errorCode",
                        com.oneorthree.phone.focus.exception.FocusErrorCode.SEA_DESTINATION_UNAVAILABLE);
        UUID candidate = telescope.list(user).items().get(0).islandId();
        focus.startSea(user, new SeaFocusSessionStartCommandRequest(candidate), UUID.randomUUID());
        assertThatThrownBy(() -> intro.arrive(user, candidate, UUID.randomUUID(), null))
                .hasFieldOrPropertyWithValue("errorCode",
                        com.oneorthree.phone.focus.exception.FocusErrorCode.SESSION_IN_PROGRESS);
        assertThat(count("select count(*) from group_members where user_id=?", user)).isZero();
    }

    private static IntroArrivalRequest meta(String anonId) {
        List<String> ext = new ArrayList<>(Collections.nCopies(16, ""));
        ext.set(0, "i2");
        ext.set(4, "17.5.1");
        return new IntroArrivalRequest(new IntroArrivalRequest.Meta(anonId, true, ext), "203.0.113.7");
    }

    @Test
    @DisplayName("첫 항해 체험이 계정의 첫 도착이면 메타 값과 함께 PENDING 행을 한 번만 남긴다")
    void firstArrivalIsRecordedOncePerAccountWithMeta() {
        UUID user = user();
        UUID candidate = telescope.list(user).items().get(0).islandId();
        UUID key = UUID.randomUUID();
        var arrival = intro.arrive(user, candidate, key, meta("anon-1"));
        var row = jdbc.queryForMap("select * from first_island_arrivals where user_id=?", user);
        assertThat(row.get("send_status")).isEqualTo("PENDING");
        assertThat(row.get("anon_id")).isEqualTo("anon-1");
        assertThat(row.get("client_ip")).isEqualTo("203.0.113.7");
        assertThat(row.get("advertiser_tracking_enabled")).isEqualTo(true);
        assertThat(row.get("extinfo").toString()).contains("i2", "17.5.1");
        assertThat(row.get("next_attempt_at")).isNotNull();
        assertThat(row.get("island_id")).isEqualTo(arrival.islandId());
        assertThat(jdbc.queryForObject("select f.occurred_at = a.first_arrived_at from first_island_arrivals f "
                + "join island_arrivals a on a.user_id=f.user_id and a.island_id=f.island_id where f.user_id=?",
                Boolean.class, user)).isTrue();
        // 같은 키 재시도와 재설치 뒤 새 키 모두 행을 늘리거나 바꾸지 않는다.
        assertThat(intro.arrive(user, candidate, key, meta("anon-1"))).isEqualTo(arrival);
        // 첫 도착 응답은 행의 event_id 를 싣고, 같은 키 재시도(위 isEqualTo)도 같은 값을 재생한다. 새 키 도착은 싣지 않는다.
        assertThat(arrival.firstArrivalEventId())
                .isEqualTo(jdbc.queryForObject("select event_id from first_island_arrivals where user_id=?",
                        UUID.class, user));
        assertThat(intro.arrive(user, arrival.islandId(), UUID.randomUUID(), meta("anon-2"))
                .firstArrivalEventId()).isNull();
        assertThat(count("select count(*) from first_island_arrivals where user_id=?", user)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select anon_id from first_island_arrivals where user_id=?", String.class,
                user)).isEqualTo("anon-1");
        // 탈퇴하면 지운다
        withdrawal.withdraw(user);
        assertThat(count("select count(*) from first_island_arrivals where user_id=?", user)).isZero();
    }

    @Test
    @DisplayName("열 길이(45)를 넘는 클라이언트 IP 는 버리고 도착과 PENDING 행은 그대로 남긴다")
    void overlongClientIpIsDroppedWithoutBreakingArrival() {
        UUID user = user();
        UUID candidate = telescope.list(user).items().get(0).islandId();
        var base = meta("anon-1");
        var arrival = intro.arrive(user, candidate, UUID.randomUUID(),
                new IntroArrivalRequest(base.meta(), "x".repeat(46)));
        assertThat(arrival.islandId()).isNotNull();
        var row = jdbc.queryForMap("select * from first_island_arrivals where user_id=?", user);
        assertThat(row.get("send_status")).isEqualTo("PENDING");
        assertThat(row.get("client_ip")).isNull();
    }

    @Test
    @DisplayName("extinfo 에 NUL 이 든 meta 는 버리고(SKIPPED) 도착은 처리한다 — jsonb 변환 실패로 되돌리지 않는다")
    void extinfoWithNulIsSkippedWithoutBreakingArrival() {
        UUID user = user();
        UUID candidate = telescope.list(user).items().get(0).islandId();
        var base = meta("anon-1");
        List<String> ext = new ArrayList<>(base.meta().extinfo());
        ext.set(15, "Asia\u0000Seoul");
        var arrival = intro.arrive(user, candidate, UUID.randomUUID(), new IntroArrivalRequest(
                new IntroArrivalRequest.Meta("anon-1", true, ext), base.clientIp()));
        assertThat(arrival.islandId()).isNotNull();
        assertThat(jdbc.queryForObject("select send_status from first_island_arrivals where user_id=?",
                String.class, user)).isEqualTo("SKIPPED");
    }

    @Test
    @DisplayName("메타 없이 시작한 기존 섬 방문 도착도 첫 도착 사건을 SKIPPED 로 기록한다")
    void firstArrivalWithoutMetaIsSkipped() {
        UUID owner = user();
        UUID destination = islands.create(owner, new CreateIslandCommandRequest("친구 섬", null, false, 5),
                UUID.randomUUID()).id();
        UUID user = user();
        var arrival = intro.arrive(user, destination, UUID.randomUUID(), null);
        var row = jdbc.queryForMap("select * from first_island_arrivals where user_id=?", user);
        // 메타가 없어 SKIPPED 여도 SDK 로그용 사건 ID 는 내려간다.
        assertThat(arrival.firstArrivalEventId()).isEqualTo(row.get("event_id"));
        assertThat(row.get("send_status")).isEqualTo("SKIPPED");
        assertThat(row.get("anon_id")).isNull();
        assertThat(row.get("next_attempt_at")).isNull();
    }

    @Test
    @DisplayName("형식이 틀린 메타는 버리고 도착은 처리하며 행은 SKIPPED 다")
    void invalidMetaIsDroppedButArrivalSucceeds() {
        UUID user = user();
        UUID candidate = telescope.list(user).items().get(0).islandId();
        var bad = new IntroArrivalRequest(new IntroArrivalRequest.Meta("x".repeat(129), true, List.of("i2")), null);
        assertThat(intro.arrive(user, candidate, UUID.randomUUID(), bad).islandId()).isNotNull();
        assertThat(jdbc.queryForObject("select send_status from first_island_arrivals where user_id=?",
                String.class, user)).isEqualTo("SKIPPED");
    }

    @Test
    @DisplayName("이미 도착 기록이 있는 계정의 첫 항해 체험은 행을 만들지 않는다")
    void priorArrivalMeansNoFirstArrivalRow() {
        UUID user = user();
        islands.create(user, new CreateIslandCommandRequest("내 섬", null, false, 5), UUID.randomUUID());
        assertThat(count("select count(*) from island_arrivals where user_id=?", user)).isEqualTo(1);
        UUID candidate = telescope.list(user).items().get(0).islandId();
        assertThat(intro.arrive(user, candidate, UUID.randomUUID(), meta("anon-3")).firstArrivalEventId()).isNull();
        assertThat(count("select count(*) from first_island_arrivals where user_id=?", user)).isZero();
    }

    @Test
    @DisplayName("실패한 첫 항해 체험은 첫 도착 행을 남기지 않는다")
    void failedIntroLeavesNoFirstArrivalRow() {
        UUID user = user();
        assertThatThrownBy(() -> intro.arrive(user, UUID.randomUUID(), UUID.randomUUID(), meta("anon-4")))
                .hasFieldOrPropertyWithValue("errorCode",
                        com.oneorthree.phone.focus.exception.FocusErrorCode.SEA_DESTINATION_UNAVAILABLE);
        assertThat(count("select count(*) from first_island_arrivals where user_id=?", user)).isZero();
    }

    private UUID user() {
        return jwt.extractUserId(auth.guestSession(java.util.UUID.randomUUID().toString()).accessToken());
    }

    private long count(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }
}
