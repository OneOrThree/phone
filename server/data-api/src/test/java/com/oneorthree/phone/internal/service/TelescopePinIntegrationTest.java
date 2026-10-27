package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.GroupRepository.TelescopeCandidate;
import com.oneorthree.phone.group.repository.IslandJoinRequestRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.group.repository.domain.IslandJoinRequest;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.dto.TelescopeItemView;
import com.oneorthree.phone.internal.dto.TelescopePinView;
import com.oneorthree.phone.internal.dto.TelescopeView;
import com.oneorthree.phone.internal.support.SailingTimes;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.withdrawal.service.AccountWithdrawalService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import javax.sql.DataSource;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 망원경 핀 (GROMO-2268, 섬 외부 계약 §6) — 실 Flyway 스키마(V115) 위에서 운영 엔티티·서비스·내부 HTTP 로 핀을 넣고
 * 빼고 목록에 끼운다. 후보 SQL·핀 가시성 SQL 을 대역으로 덮지 않는다. 시계는 고정이고 테스트가 직접 옮긴다.
 *
 * <p>후보가 «DB 의 공개 섬 전부» 라 테스트마다 앞 테스트의 섬을 묘비(소프트 삭제)로 돌려 그 테스트가 심은 섬만 후보로
 * 남긴다. 이 컨텍스트는 전용 database 라({@link OutboxTestPostgres}) 다른 테스트 클래스에 번지지 않는다. 기대 순서는
 * 서비스와 같은 시드로 {@link IslandMembershipService#handle} 를 계산해 만든다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class TelescopePinIntegrationTest {

    private static final String TOKEN = "test-telescope-pin-business";
    /** KST 14:23:41 — 버킷 05:00Z 안이고, 이 버킷의 끝(핀 만료)은 06:00Z 다. */
    private static final Instant BASE = Instant.parse("2026-10-12T05:23:41Z");
    private static final Instant BUCKET = Instant.parse("2026-10-12T05:00:00Z");
    private static final Instant BUCKET_END = Instant.parse("2026-10-12T06:00:00Z");
    private static final AtomicReference<Instant> NOW = new AtomicReference<>();
    /** 테스트가 쥐었다 놓는 어드바이저리 락 번호 — 어드바이저리 락은 database 마다 따로라 다른 컨텍스트와 겹치지 않는다. */
    private static final long GATE_KEY = 2268L;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        registry.add("internal.api.callers.business.allow[0]", () -> "GET /internal/users/*/telescope");
        registry.add("internal.api.callers.business.allow[1]", () -> "POST /internal/users/*/telescope/pins");
        registry.add("internal.api.callers.business.allow[2]", () -> "DELETE /internal/users/*/telescope/pins/*");
    }

    @MockitoBean
    Clock clock;

    @Autowired
    TelescopeService telescope;
    @Autowired
    TelescopePinService pinService;
    @Autowired
    IslandMembershipService islands;
    @Autowired
    IslandManagementService management;
    @Autowired
    AccountWithdrawalService withdrawal;
    @Autowired
    UserQueryService users;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    IslandJoinRequestRepository joinRequests;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    DataSource dataSource;
    @Autowired
    MockMvc mvc;

    @BeforeEach
    void isolate() {
        when(clock.instant()).thenAnswer(invocation -> NOW.get());
        when(clock.getZone()).thenReturn(ZoneOffset.UTC);
        when(clock.withZone(any())).thenAnswer(invocation -> Clock.fixed(NOW.get(), invocation.getArgument(0)));
        NOW.set(BASE);
        jdbc.update("update islands set deleted_at = now() where deleted_at is null");
    }

    // ---------------------------------------------------------------- ① 넣기 4개

    @Test
    @DisplayName("핀 4개 — 핀 4 + 새 섬 1칸이고 무작위 칸은 0이다. 핀 섬은 스냅샷 칸에서 감춰지고, 가까운 섬(스냅샷 첫 섬)을 핀으로 "
            + "넣으면 이 버킷엔 가까운 섬이 없다 — 다음 섬이 가까운 섬으로 올라오지 않는다")
    void fourPinsLeaveOneNewIslandSlot() throws Exception {
        UUID viewer = newUser();
        Group home = island("소속섬", 10);
        join(viewer, home);
        List<UUID> order = byHash(viewer, islandIds(12));
        // 첫 핀(7번)을 넣을 때 스냅샷이 뽑힌다 — 7번을 뺀 해시 순 0~4번이고 0번이 가까운 섬이다. 그다음 0·1번(스냅샷 섬)을
        // 핀으로 넣는다 — 스냅샷 칸에서 안 감추면 한 섬이 두 번 나온다.
        List<UUID> pinned = List.of(order.get(7), order.get(0), order.get(5), order.get(1));
        for (int i = 0; i < pinned.size(); i++) {
            pin(viewer, pinned.get(i), i % 2 == 0 ? "observatory" : "magazine", BASE.plusSeconds(i));
        }
        NOW.set(BASE.plusSeconds(10));

        List<TelescopeItemView> items = telescope.list(viewer).items();

        assertThat(TelescopeService.MAX_PINS).as("핀은 무작위 칸을 대신한다 — 새 섬 칸이 1 아래로 내려가면 안 된다")
                .isLessThanOrEqualTo(TelescopeService.RANDOM_SLOTS);
        assertThat(items).extracting(TelescopeItemView::islandId).containsExactly(home.getId(),
                pinned.get(0), pinned.get(1), pinned.get(2), pinned.get(3), order.get(2));
        assertThat(items).extracting(TelescopeItemView::slot)
                .containsExactly("joined", "pinned", "pinned", "pinned", "pinned", "random");
        assertThat(items).extracting(TelescopeItemView::pinnedFrom)
                .containsExactly(null, "observatory", "magazine", "observatory", "magazine", null);
        assertThat(items).extracting(TelescopeItemView::pinnedAt).containsExactly(null, BASE,
                BASE.plusSeconds(1), BASE.plusSeconds(2), BASE.plusSeconds(3), null);
        assertThat(items.subList(1, 6)).allSatisfy(item -> {
            assertThat(item.sailingMinutes()).isIn(30, 60, 90)
                    .isEqualTo(SailingTimes.minutes(viewer, item.islandId(), BUCKET));
            assertThat(item.membershipStatus()).isEqualTo("none");
            assertThat(item.full()).isFalse();
        });

        // 공개 경로 모양 — 핀 칸에만 pinnedFrom·pinnedAt 이 값으로 있다(내부 JSON 은 나머지 칸에 null).
        mvc.perform(get("/internal/users/" + viewer + "/telescope")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", viewer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[5].slot").value("random"))
                .andExpect(jsonPath("$.items[5].pinnedFrom").value(nullValue()))
                .andExpect(jsonPath("$.items[1].slot").value("pinned"))
                .andExpect(jsonPath("$.items[1].pinnedFrom").value("observatory"))
                .andExpect(jsonPath("$.items[1].pinnedAt").value("2026-10-12T05:23:41Z"));
    }

    @Test
    @DisplayName("핀이 없으면 종전 목록 그대로다 — 빈 제외 배열 '{}' 은 아무 섬도 빼지 않고, 배열에 든 섬만 후보에서 빠진다")
    void withoutPinsTheCandidateQueryExcludesNothing() {
        UUID viewer = newUser();
        List<UUID> order = byHash(viewer, islandIds(8));
        String seed = viewer + ":" + BUCKET.getEpochSecond();

        assertThat(groups.findTelescopeCandidates(viewer.toString(), seed, 5, "{}"))
                .extracting(TelescopeCandidate::getId).containsExactlyElementsOf(order.subList(0, 5));
        assertThat(groups.findTelescopeCandidates(viewer.toString(), seed, 5, "{" + order.get(0) + "," + order.get(2) + "}"))
                .extracting(TelescopeCandidate::getId)
                .containsExactly(order.get(1), order.get(3), order.get(4), order.get(5), order.get(6));

        TelescopeView view = telescope.list(viewer);
        assertThat(view.items()).extracting(TelescopeItemView::islandId).containsExactlyElementsOf(order.subList(0, 5));
        assertThat(view.items()).extracting(TelescopeItemView::slot)
                .containsExactly("nearby", "random", "random", "random", "random");
        assertThat(view.items()).extracting(TelescopeItemView::pinnedFrom).containsOnlyNulls();
        assertThat(view.items()).extracting(TelescopeItemView::pinnedAt).containsOnlyNulls();
    }

    @Test
    @DisplayName("핀 2개 — 새 섬 칸은 3(가까운 섬 1 + 무작위 2)이고 순서는 joined → nearby → pinned → random 이다")
    void twoPinsKeepTheSlotOrder() {
        UUID viewer = newUser();
        Group home = island("소속섬", 10);
        join(viewer, home);
        List<UUID> order = byHash(viewer, islandIds(10));
        pin(viewer, order.get(6), "magazine", BASE);
        pin(viewer, order.get(3), "observatory", BASE.plusSeconds(1));

        List<TelescopeItemView> items = telescope.list(viewer).items();

        assertThat(items).extracting(TelescopeItemView::slot)
                .containsExactly("joined", "nearby", "pinned", "pinned", "random", "random");
        assertThat(items).extracting(TelescopeItemView::islandId).containsExactly(home.getId(), order.get(0),
                order.get(6), order.get(3), order.get(1), order.get(2));
    }

    // ---------------------------------------------------------------- ② 5번째

    @Test
    @DisplayName("5번째를 넣으면 pinned_at 이 가장 오래된 핀이 빠지고 응답의 evicted 로 알려 준다 — 앞의 넷은 201 + evicted null")
    void fifthPinEvictsTheOldestOne() throws Exception {
        UUID viewer = newUser();
        List<Group> islands = islandEntities(5);
        assertThat(users.getCaller(viewer).isGuest()).as("게스트도 핀을 넣는다").isTrue();

        for (int i = 0; i < 4; i++) {
            NOW.set(BASE.plusSeconds(i));
            postPin(viewer, islands.get(i).getId(), "observatory")
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.created").value(true))
                    .andExpect(jsonPath("$.evicted").value(nullValue()))
                    .andExpect(jsonPath("$.item.slot").value("pinned"))
                    .andExpect(jsonPath("$.item.islandId").value(islands.get(i).getId().toString()))
                    .andExpect(jsonPath("$.item.pinnedFrom").value("observatory"));
        }
        NOW.set(BASE.plusSeconds(4));
        postPin(viewer, islands.get(4).getId(), "magazine")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.created").value(true))
                .andExpect(jsonPath("$.evicted.islandId").value(islands.get(0).getId().toString()))
                .andExpect(jsonPath("$.evicted.name").value(islands.get(0).getName()))
                .andExpect(jsonPath("$.item.islandId").value(islands.get(4).getId().toString()))
                .andExpect(jsonPath("$.item.pinnedFrom").value("magazine"))
                .andExpect(jsonPath("$.item.pinnedAt").value("2026-10-12T05:23:45Z"));

        assertThat(pinnedIds(viewer)).containsExactly(islands.get(1).getId(), islands.get(2).getId(),
                islands.get(3).getId(), islands.get(4).getId());
        assertThat(count("select count(*) from telescope_pins where user_id=?", viewer)).isEqualTo(4);
        assertThat(count("select count(*) from telescope_pins where user_id=? and island_id=?", viewer,
                islands.get(0).getId())).as("밀려난 핀은 행도 지운다").isZero();
    }

    @Test
    @DisplayName("같은 사람의 핀 넣기 둘이 동시에 와도 줄을 서서 4개를 넘지 않는다 — 정확히 하나만 밀어낸다")
    void concurrentPinsOfOneUserNeverExceedTheLimit() throws Exception {
        UUID viewer = newUser();
        List<Group> islands = islandEntities(5);
        for (int i = 0; i < 3; i++) {
            pin(viewer, islands.get(i).getId(), "observatory", BASE.plusSeconds(i));
        }
        NOW.set(BASE.plusSeconds(10));
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch go = new CountDownLatch(1);
            List<Future<TelescopePinView>> results = new ArrayList<>();
            for (int i = 3; i < 5; i++) {
                UUID islandId = islands.get(i).getId();
                results.add(pool.submit(() -> {
                    go.await();
                    return pinService.pin(viewer, islandId, "observatory", null);
                }));
            }
            go.countDown();
            List<TelescopePinView> views = new ArrayList<>();
            for (Future<TelescopePinView> result : results) {
                views.add(result.get(60, TimeUnit.SECONDS));
            }

            assertThat(views).extracting(TelescopePinView::created).containsOnly(true);
            assertThat(views).filteredOn(view -> view.evicted() != null).hasSize(1)
                    .singleElement().satisfies(view -> assertThat(view.evicted().islandId())
                            .isEqualTo(islands.get(0).getId()));
            assertThat(count("select count(*) from telescope_pins where user_id=?", viewer)).isEqualTo(4);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("이미 있는 핀을 다시 넣는 도중 같은 핀 빼기가 끼어들어도 넣기는 404 가 되지 않는다 — 빼기가 사용자 행 잠금 뒤에 줄을 선다")
    void reAddingAnExistingPinNeverFailsWhenADeleteOverlaps() throws Exception {
        UUID viewer = newUser();
        UUID island = islandIds(1).get(0);
        pin(viewer, island, "magazine", BASE);
        NOW.set(BASE.plusSeconds(10));

        // 다시 넣기를 «INSERT 가 0행으로 끝난 직후, 목록을 다시 읽기 전» 에 세워 둔다. 핀 INSERT 문장이 끝나면 도는 문장 단위
        // 트리거가 어드바이저리 락을 기다리게 하고(충돌로 0행이어도 문장 단위 트리거는 돈다), 락은 테스트가 쥐었다 놓는다.
        jdbc.execute("CREATE OR REPLACE FUNCTION telescope_pins_test_gate() RETURNS trigger AS $$ BEGIN "
                + "PERFORM pg_advisory_lock(" + GATE_KEY + "); PERFORM pg_advisory_unlock(" + GATE_KEY + "); "
                + "RETURN NULL; END $$ LANGUAGE plpgsql");
        jdbc.execute("CREATE TRIGGER telescope_pins_test_gate AFTER INSERT ON telescope_pins "
                + "FOR EACH STATEMENT EXECUTE FUNCTION telescope_pins_test_gate()");
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try (Connection gate = dataSource.getConnection()) {
            try {
                execute(gate, "select pg_advisory_lock(" + GATE_KEY + ")");
                Future<TelescopePinView> add = pool.submit(() -> pinService.pin(viewer, island, "observatory", null));
                awaitUntil("다시 넣기가 INSERT 직후 트리거에서 멈춘다", () -> waitingOnGate() == 1);

                Future<?> remove = pool.submit(() -> pinService.unpin(viewer, island));
                try {
                    remove.get(1, TimeUnit.SECONDS);
                } catch (TimeoutException queued) {
                    // 사용자 행 잠금에서 기다리는 중이다 — 기대한 길. 잠금이 없으면 빼기는 여기서 이미 커밋되고,
                    // 아래 add.get 이 목록에서 자기 핀을 못 찾은 넣기의 404 로 터진다.
                }
                execute(gate, "select pg_advisory_unlock(" + GATE_KEY + ")");

                TelescopePinView view = add.get(30, TimeUnit.SECONDS);
                remove.get(30, TimeUnit.SECONDS);
                assertThat(view.created()).as("이미 있던 핀이다 — 빼기는 넣기가 끝난 뒤에 돈다").isFalse();
                assertThat(view.item().islandId()).isEqualTo(island);
                assertThat(view.item().slot()).isEqualTo("pinned");
                assertThat(count("select count(*) from telescope_pins where user_id=?", viewer))
                        .as("빼기는 넣기 뒤에 실행돼 핀이 없다").isZero();
            } finally {
                execute(gate, "select pg_advisory_unlock_all()");
                jdbc.execute("DROP TRIGGER IF EXISTS telescope_pins_test_gate ON telescope_pins");
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("사용자 행 잠금 앞에서 함께 기다리던 다시 넣기와 빼기는 어느 쪽이 먼저든 넣기가 404 가 되지 않는다")
    void reAddAndDeleteQueuedOnTheUserLockEndInEitherOrder() throws Exception {
        UUID viewer = newUser();
        UUID island = islandIds(1).get(0);
        pin(viewer, island, "magazine", BASE);
        NOW.set(BASE.plusSeconds(10));

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try (Connection holder = dataSource.getConnection()) {
            holder.setAutoCommit(false);
            Future<TelescopePinView> add;
            Future<?> remove;
            try {
                execute(holder, "select id from users where id = '" + viewer + "' for update");
                add = pool.submit(() -> pinService.pin(viewer, island, "observatory", null));
                remove = pool.submit(() -> pinService.unpin(viewer, island));
                // 둘 다 사용자 행 잠금에서 기다린다 — 빼기가 잠금 없이 먼저 끝나 버리면 여기서 걸린다.
                awaitUntil("다시 넣기와 빼기가 사용자 행 잠금에서 함께 기다린다", () -> waitingOnLock() == 2);
            } finally {
                holder.commit();
            }

            TelescopePinView view = add.get(30, TimeUnit.SECONDS);
            remove.get(30, TimeUnit.SECONDS);
            assertThat(view.item().islandId()).isEqualTo(island);
            // 빼기가 뒤였다면 넣기가 자기 핀을 봤고(created=false) 핀은 지워졌다. 빼기가 먼저였다면 넣기가 핀을 다시 넣었다(created=true).
            assertThat(count("select count(*) from telescope_pins where user_id=?", viewer))
                    .isEqualTo(view.created() ? 1L : 0L);
        } finally {
            pool.shutdownNow();
        }
    }

    // ---------------------------------------------------------------- ③ 빼기

    @Test
    @DisplayName("빼기 — 200 {deleted:true}, 그 자리에 이번 1시간 스냅샷에서 밀려났던 섬이 스냅샷 순서대로 돌아온다(새로 뽑지 "
            + "않는다). 없는 핀도 200")
    void unpinPutsTheDisplacedSnapshotIslandBack() throws Exception {
        UUID viewer = newUser();
        Group home = island("소속섬", 10);
        join(viewer, home);
        List<UUID> order = byHash(viewer, islandIds(12));
        // 핀 없이 먼저 본다 — 스냅샷은 해시 순 0~4번이다.
        assertThat(telescope.list(viewer).items()).extracting(TelescopeItemView::islandId)
                .containsExactly(home.getId(), order.get(0), order.get(1), order.get(2), order.get(3), order.get(4));
        // 스냅샷 섬 1·2번과 스냅샷 밖 8·9번을 핀으로 — 무작위 칸이 0이 되어 3·4번이 밀려난다.
        List<UUID> pinned = List.of(order.get(1), order.get(8), order.get(2), order.get(9));
        for (int i = 0; i < pinned.size(); i++) {
            pin(viewer, pinned.get(i), "observatory", BASE.plusSeconds(i));
        }
        assertThat(telescope.list(viewer).items()).extracting(TelescopeItemView::islandId)
                .containsExactly(home.getId(), order.get(0), order.get(1), order.get(8), order.get(2), order.get(9));

        // 스냅샷 밖 핀을 빼면 밀려났던 3번이 돌아온다 — 해시 순 5번 같은 새 섬이 아니다.
        deletePin(viewer, order.get(8)).andExpect(status().isOk()).andExpect(jsonPath("$.deleted").value(true));
        List<TelescopeItemView> items = telescope.list(viewer).items();
        assertThat(items).extracting(TelescopeItemView::slot)
                .containsExactly("joined", "nearby", "pinned", "pinned", "pinned", "random");
        assertThat(items).extracting(TelescopeItemView::islandId).containsExactly(home.getId(), order.get(0),
                order.get(1), order.get(2), order.get(9), order.get(3));

        // 스냅샷 섬 핀을 빼면 그 섬이 제 스냅샷 자리(3번 앞)로 random 칸에 돌아온다.
        deletePin(viewer, order.get(1)).andExpect(status().isOk()).andExpect(jsonPath("$.deleted").value(true));
        items = telescope.list(viewer).items();
        assertThat(items).extracting(TelescopeItemView::slot)
                .containsExactly("joined", "nearby", "pinned", "pinned", "random", "random");
        assertThat(items).extracting(TelescopeItemView::islandId).containsExactly(home.getId(), order.get(0),
                order.get(2), order.get(9), order.get(1), order.get(3));
        assertThat(count("select count(*) from telescope_pins where user_id=?", viewer)).isEqualTo(2);
        List<UUID> pinnedLeft = List.of(order.get(2), order.get(9));

        // 이미 빠진 핀·넣은 적 없는 섬·없는 섬도 200 이다 — «핀이 없어도» 의 뜻이다. 호출자(users 행)가 없는 빼기는 별개로 404 다
        // (unpinOfAMissingCallerIs404UserNotFound).
        deletePin(viewer, order.get(8)).andExpect(status().isOk()).andExpect(jsonPath("$.deleted").value(true));
        deletePin(viewer, order.get(0)).andExpect(status().isOk()).andExpect(jsonPath("$.deleted").value(true));
        deletePin(viewer, UUID.randomUUID()).andExpect(status().isOk()).andExpect(jsonPath("$.deleted").value(true));
        assertThat(count("select count(*) from telescope_pins where user_id=?", viewer)).isEqualTo(2);
        assertThat(pinnedIds(viewer)).containsExactlyElementsOf(pinnedLeft);
    }

    @Test
    @DisplayName("없는·탈퇴한 사용자의 빼기는 200 이 아니라 404 USER_NOT_FOUND 다 — «핀이 없어도 200» 과 별개로 호출자 잠금이 먼저다")
    void unpinOfAMissingCallerIs404UserNotFound() throws Exception {
        UUID viewer = newUser();
        UUID island = islandIds(1).get(0);

        // 현재 동작을 고정한다. «빼기는 늘 200» 은 «핀이 없어도(만료됐거나 넣은 적 없어도)» 의 뜻일 뿐 «호출자가 없어도» 가 아니다 —
        // unpin 은 getCallerForUpdate 를 가장 먼저 부르므로 활성 users 행이 없으면(없는 id·탈퇴) 핀 삭제까지 가지 못하고
        // UserException(USER_NOT_FOUND) 이 404 로 나간다. 요청자 본인의 부재라 TARGET_USER_NOT_FOUND 가 아니다(앱은 재로그인).
        deletePin(viewer, island).andExpect(status().isOk()).andExpect(jsonPath("$.deleted").value(true));
        deletePin(UUID.randomUUID(), island).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("USER_NOT_FOUND"));
        UUID withdrawn = newUser();
        withdrawal.withdraw(withdrawn);
        deletePin(withdrawn, island).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("USER_NOT_FOUND"));
    }

    // ---------------------------------------------------------------- ④ 버킷·만료

    @Test
    @DisplayName("다음 1시간 버킷이 되면 핀은 무작위 섬과 함께 사라지고 새 목록이 나온다 — 핀 행은 다음 핀 넣기가, "
            + "지난 버킷 스냅샷은 새 버킷 행을 넣는 목록 조립이 지운다")
    void pinsVanishInTheNextBucket() {
        UUID viewer = newUser();
        List<UUID> order = byHash(viewer, islandIds(8));
        pin(viewer, order.get(5), "magazine", BASE);
        pin(viewer, order.get(6), "observatory", BASE.plusSeconds(1));
        assertThat(pinnedIds(viewer)).containsExactly(order.get(5), order.get(6));
        assertThat(count("select count(*) from telescope_buckets where user_id=?", viewer)).isEqualTo(1);

        NOW.set(BUCKET_END);
        TelescopeView onTheHour = telescope.list(viewer);
        assertThat(onTheHour.bucketStart()).isEqualTo(BUCKET_END);
        assertThat(onTheHour.items()).extracting(TelescopeItemView::slot).as("정각부터 핀은 없다").doesNotContain("pinned");

        NOW.set(BASE.plus(Duration.ofHours(1)));
        TelescopeView next = telescope.list(viewer);

        assertThat(next.bucketStart()).isEqualTo(BUCKET_END);
        assertThat(next.items()).extracting(TelescopeItemView::slot).doesNotContain("pinned")
                .hasSize(1 + TelescopeService.RANDOM_SLOTS);
        assertThat(count("select count(*) from telescope_pins where user_id=?", viewer))
                .as("핀 행은 정리 잡 없이 남는다 — 읽을 때 거른다").isEqualTo(2);
        assertThat(jdbc.queryForList("select bucket_start from telescope_buckets where user_id=?",
                java.sql.Timestamp.class, viewer)).as("새 버킷 행을 넣으며 지난 버킷 행을 지웠다")
                .extracting(java.sql.Timestamp::toInstant).containsExactly(BUCKET_END);

        // 다음 버킷에 핀을 넣으면 지난(만료) 핀 행도 지운다.
        pin(viewer, order.get(0), "observatory", BASE.plus(Duration.ofHours(1)).plusSeconds(1));
        assertThat(count("select count(*) from telescope_pins where user_id=?", viewer)).isEqualTo(1);
    }

    @Test
    @DisplayName("핀은 넣은 버킷의 끝(다음 정시)에 사라진다 — 05:59:59 까지 보이고 06:00:00 정각부터 안 보이며, 행은 정리 잡 없이 남는다")
    void aPinExpiresAtTheEndOfItsBucket() {
        UUID viewer = newUser();
        UUID island = islandIds(1).get(0);
        pin(viewer, island, "magazine", BASE);
        assertThat(jdbc.queryForObject("select expires_at from telescope_pins where user_id=?", java.sql.Timestamp.class,
                viewer).toInstant()).isEqualTo(BUCKET_END);

        NOW.set(BUCKET_END.minusSeconds(1));
        assertThat(pinnedIds(viewer)).containsExactly(island);
        NOW.set(BUCKET_END);
        assertThat(pinnedIds(viewer)).isEmpty();
        NOW.set(BUCKET_END.plus(Duration.ofHours(30)));
        assertThat(pinnedIds(viewer)).isEmpty();
        assertThat(count("select count(*) from telescope_pins where user_id=?", viewer)).isEqualTo(1);
    }

    @Test
    @DisplayName("만료 시각은 넣은 시각의 다음 정시다 — 정시 정각에 넣으면 1시간 뒤, 정시 1ms 전이면 그 정시")
    void nextResetIsTheEndOfTheBucket() {
        assertThat(TelescopePinService.nextReset(BUCKET)).isEqualTo(BUCKET_END);
        assertThat(TelescopePinService.nextReset(BUCKET.plusMillis(1))).isEqualTo(BUCKET_END);
        assertThat(TelescopePinService.nextReset(BASE)).isEqualTo(BUCKET_END);
        assertThat(TelescopePinService.nextReset(BUCKET_END.minusMillis(1))).isEqualTo(BUCKET_END);
        assertThat(TelescopePinService.nextReset(BUCKET_END)).isEqualTo(BUCKET_END.plus(Duration.ofHours(1)));
        assertThat(TelescopePinService.nextReset(Instant.parse("2026-10-11T22:00:00Z"))).as("07:00 KST 정각도 1시간")
                .isEqualTo(Instant.parse("2026-10-11T23:00:00Z"));
    }

    // ---------------------------------------------------------------- ⑤ 멱등·덮어쓰기

    @Test
    @DisplayName("이미 만료 안 된 핀을 다시 넣으면 200 으로 같은 항목을 돌려주고 출처·넣은 시각을 바꾸지 않는다")
    void pinningTwiceIsIdempotent() throws Exception {
        UUID viewer = newUser();
        UUID island = islandIds(1).get(0);
        postPin(viewer, island, "magazine").andExpect(status().isCreated()).andExpect(jsonPath("$.created").value(true));

        NOW.set(BASE.plus(Duration.ofMinutes(10)));
        postPin(viewer, island, "observatory")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.created").value(false))
                .andExpect(jsonPath("$.evicted").value(nullValue()))
                .andExpect(jsonPath("$.item.islandId").value(island.toString()))
                .andExpect(jsonPath("$.item.slot").value("pinned"))
                .andExpect(jsonPath("$.item.pinnedFrom").value("magazine"))
                .andExpect(jsonPath("$.item.pinnedAt").value("2026-10-12T05:23:41Z"));

        assertThat(count("select count(*) from telescope_pins where user_id=?", viewer)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select source from telescope_pins where user_id=?", String.class, viewer))
                .isEqualTo("magazine");
    }

    @Test
    @DisplayName("만료된 핀이 있으면 지우고 새로 넣는다 — 출처·넣은 시각·만료 시각이 새 값이고 201 이다")
    void anExpiredPinIsOverwritten() throws Exception {
        UUID viewer = newUser();
        UUID island = islandIds(1).get(0);
        pin(viewer, island, "magazine", BASE);

        NOW.set(BUCKET_END);
        postPin(viewer, island, "observatory")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.created").value(true))
                .andExpect(jsonPath("$.item.pinnedFrom").value("observatory"))
                .andExpect(jsonPath("$.item.pinnedAt").value("2026-10-12T06:00:00Z"));

        assertThat(count("select count(*) from telescope_pins where user_id=?", viewer)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select source from telescope_pins where user_id=?", String.class, viewer))
                .isEqualTo("observatory");
        assertThat(jdbc.queryForObject("select expires_at from telescope_pins where user_id=?",
                java.sql.Timestamp.class, viewer).toInstant()).as("06:00:00 정각에 넣으면 07:00")
                .isEqualTo(BUCKET_END.plus(Duration.ofHours(1)));
    }

    @Test
    @DisplayName("다른 섬을 넣을 때는 그 사람의 만료 행만 지운다 — 만료된 옛 핀이 쌓이지 않고 남의 핀은 그대로다")
    void pinningCleansOnlyTheCallersExpiredRows() {
        UUID viewer = newUser();
        UUID other = newUser();
        List<UUID> ids = islandIds(3);
        pin(viewer, ids.get(0), "magazine", BASE);
        pin(other, ids.get(0), "magazine", BASE);

        pin(viewer, ids.get(1), "observatory", BUCKET_END.plusSeconds(5));

        assertThat(count("select count(*) from telescope_pins where user_id=?", viewer)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select island_id from telescope_pins where user_id=?", UUID.class, viewer))
                .as("남은 행은 방금 넣은 새 섬이다").isEqualTo(ids.get(1));
        assertThat(count("select count(*) from telescope_pins where user_id=?", other))
                .as("남의 만료 행은 그 사람이 넣을 때 지운다").isEqualTo(1);
    }

    // ---------------------------------------------------------------- ⑥ 오류

    @Test
    @DisplayName("없는·종료·삭제·비공개 섬은 404 GROUP_NOT_FOUND 로 존재를 숨긴다 — 핀 행은 만들지 않는다")
    void missingEndedDeletedAndPrivateIslandsAre404() throws Exception {
        UUID viewer = newUser();
        UUID ended = groups.save(Group.builder().name("끝난섬").maxMembers(10).status(GroupStatus.ENDED).build()).getId();
        UUID deleted = islandIds(1).get(0);
        jdbc.update("update islands set deleted_at = now() where id = ?", deleted);
        UUID hidden = groups.save(Group.builder().name("비공개섬").maxMembers(10).isPrivate(true).build()).getId();
        // 비공개 섬을 «떠난» 옛 주민도 새로 알려 줄 게 없다 — 강퇴가 아니면 같은 404 다.
        Group privateHome = groups.save(Group.builder().name("옛비공개섬").maxMembers(10).isPrivate(true).build());
        GroupMember left = join(viewer, privateHome);
        left.leave(BASE);
        members.save(left);

        for (UUID missing : List.of(UUID.randomUUID(), ended, deleted, hidden, privateHome.getId())) {
            postPin(viewer, missing, "observatory").andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.code").value("GROUP_NOT_FOUND"));
        }
        assertThat(count("select count(*) from telescope_pins where user_id=?", viewer)).isZero();
    }

    @Test
    @DisplayName("강퇴된 섬은 넣을 수 있고(GROMO-2315), 내가 속한 섬은 409 ALREADY_MEMBER 다 — 비공개 섬이어도 본인 사실은 숨기지 않는다")
    void kickedIslandPinsAndAlreadyMemberIs409() throws Exception {
        UUID viewer = newUser();
        Group kickedFrom = island("강퇴섬", 10);
        GroupMember kicked = join(viewer, kickedFrom);
        kicked.kick(BASE);
        members.save(kicked);
        Group home = island("소속섬", 10);
        join(viewer, home);
        Group privateHome = groups.save(Group.builder().name("비공개소속섬").maxMembers(10).isPrivate(true).build());
        join(viewer, privateHome);

        // 강퇴된 섬도 다시 신청할 수 있는 섬이라 망원경에 넣고 목록에도 보인다(10/20 결정) — 종전 403 KICKED_CANNOT_REJOIN.
        postPin(viewer, kickedFrom.getId(), "observatory").andExpect(status().isCreated())
                .andExpect(jsonPath("$.created").value(true));
        postPin(viewer, home.getId(), "observatory").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ALREADY_MEMBER"));
        postPin(viewer, privateHome.getId(), "magazine").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ALREADY_MEMBER"));
        assertThat(count("select count(*) from telescope_pins where user_id=?", viewer)).isEqualTo(1);
    }

    @ParameterizedTest(name = "비공개 섬 + 본인이 {0} → {1} {2}")
    @CsvSource({"kicked,404,GROUP_NOT_FOUND", "member,409,ALREADY_MEMBER", "left,404,GROUP_NOT_FOUND",
            "none,404,GROUP_NOT_FOUND"})
    @DisplayName("비공개 섬에서도 판정 순서는 내 소속 409 → 비공개 404 다 — 강퇴된 옛 주민도 자진 탈퇴와 같은 404 다(GROMO-2315)")
    void aPrivateIslandAnswersByTheCallersRelationBeforeHidingItself(String relation, int httpStatus, String code)
            throws Exception {
        UUID viewer = newUser();
        Group secret = groups.save(Group.builder().name("비공개섬").maxMembers(10).isPrivate(true).build());
        // kicked = 강퇴 이력, member = 활성 주민, left = 자진 탈퇴 마킹(운영에서는 다른 주민이 남아 섬이 살아 있을 때의 상태),
        // none = 관계 없음. 멤버십 행은 직접 마킹한다.
        switch (relation) {
            case "kicked" -> {
                GroupMember kicked = join(viewer, secret);
                kicked.kick(BASE);
                members.save(kicked);
            }
            case "member" -> join(viewer, secret);
            case "left" -> {
                GroupMember left = join(viewer, secret);
                left.leave(BASE);
                members.save(left);
            }
            case "none" -> { }
            default -> throw new IllegalArgumentException(relation);
        }

        // 본인이 아는 사실(소속)은 비공개 판정보다 먼저다 — 비공개 판정이 앞서면 member 도 404 로 바뀐다. 그 밖에는
        // (자진해서 나갔거나 강퇴된 옛 주민 포함) 존재를 숨겨 관계 없는 사람과 같은 404 다.
        postPin(viewer, secret.getId(), "magazine").andExpect(status().is(httpStatus))
                .andExpect(jsonPath("$.code").value(code));
        assertThat(count("select count(*) from telescope_pins where user_id=?", viewer)).isZero();
    }

    @Test
    @DisplayName("본문이 모양을 어기면 400 이고 핀 행은 만들지 않는다 — 출처는 magazine·observatory 뿐이다")
    void malformedBodiesAre400() throws Exception {
        UUID viewer = newUser();
        UUID island = islandIds(1).get(0);
        String path = "/internal/users/" + viewer + "/telescope/pins";
        for (String body : List.of("{}", "{\"islandId\":\"" + island + "\"}", "{\"source\":\"magazine\"}",
                "{\"islandId\":\"" + island + "\",\"source\":\"ad\"}",
                "{\"islandId\":\"" + island + "\",\"source\":null}",
                "{\"islandId\":\"not-a-uuid\",\"source\":\"magazine\"}")) {
            mvc.perform(post(path).header("Authorization", "Bearer " + TOKEN).header("X-User-Id", viewer)
                            .contentType("application/json").content(body))
                    .andExpect(status().isBadRequest());
        }
        assertThat(count("select count(*) from telescope_pins where user_id=?", viewer)).isZero();
    }

    // ---------------------------------------------------------------- ⑦ 보이는 핀

    @ParameterizedTest
    @ValueSource(strings = {"private", "ended", "deleted", "joined"})
    @DisplayName("핀 섬이 그사이 비공개·종료·삭제·내 소속이 되면 목록에서 빠지고 그 칸은 random 이 채운다 — 핀 행은 남는다")
    void aPinnedIslandThatBecomesUnavailableLeavesTheList(String change) {
        UUID viewer = newUser();
        List<UUID> order = byHash(viewer, islandIds(12));
        UUID changing = order.get(10);
        UUID staying = order.get(11);
        pin(viewer, changing, "magazine", BASE);
        pin(viewer, staying, "observatory", BASE.plusSeconds(1));
        NOW.set(BASE.plusSeconds(5));
        assertThat(telescope.list(viewer).items()).extracting(TelescopeItemView::slot)
                .containsExactly("nearby", "pinned", "pinned", "random", "random");

        switch (change) {
            case "private" -> jdbc.update("update islands set is_private = true where id = ?", changing);
            case "ended" -> jdbc.update("update islands set status = 'ENDED' where id = ?", changing);
            case "deleted" -> jdbc.update("update islands set deleted_at = now() where id = ?", changing);
            case "joined" -> join(viewer, groups.findById(changing).orElseThrow());
            default -> throw new IllegalArgumentException(change);
        }

        List<TelescopeItemView> items = telescope.list(viewer).items();
        List<UUID> expectedIds = new ArrayList<>();
        List<String> expectedSlots = new ArrayList<>();
        if ("joined".equals(change)) {
            expectedIds.add(changing);
            expectedSlots.add("joined");
        }
        expectedIds.addAll(List.of(order.get(0), staying, order.get(1), order.get(2), order.get(3)));
        expectedSlots.addAll(List.of("nearby", "pinned", "random", "random", "random"));
        assertThat(items).extracting(TelescopeItemView::islandId).containsExactlyElementsOf(expectedIds);
        assertThat(items).extracting(TelescopeItemView::slot).containsExactlyElementsOf(expectedSlots);
        assertThat(count("select count(*) from telescope_pins where user_id=?", viewer))
                .as("핀 행은 만료까지 남는다 — 목록에서만 빠진다").isEqualTo(2);
    }

    @Test
    @DisplayName("보이지 않는 핀은 4개 한도에 들지 않는다 — 가입해서 가려진 핀이 있어도 새 핀이 밀려나지 않는다")
    void hiddenPinsDoNotCountTowardsTheLimit() throws Exception {
        UUID viewer = newUser();
        List<Group> islands = islandEntities(6);
        for (int i = 0; i < 4; i++) {
            pin(viewer, islands.get(i).getId(), "observatory", BASE.plusSeconds(i));
        }
        // 가장 오래된 핀 섬에 가입 — 그 핀은 목록에서 가려진다(소속이므로).
        join(viewer, islands.get(0));
        NOW.set(BASE.plusSeconds(10));

        postPin(viewer, islands.get(4).getId(), "observatory").andExpect(status().isCreated())
                .andExpect(jsonPath("$.evicted").value(nullValue()));

        assertThat(pinnedIds(viewer)).containsExactly(islands.get(1).getId(), islands.get(2).getId(),
                islands.get(3).getId(), islands.get(4).getId());
        assertThat(count("select count(*) from telescope_pins where user_id=?", viewer))
                .as("가려진 핀 행은 남아 있다").isEqualTo(5);
    }

    @Test
    @DisplayName("가려졌던 핀이 되살아나 5개가 보이면 가장 오래된 것부터 감추고, 다음 핀을 넣을 때 넘친 만큼 지운다 — 알림은 방금까지 보이던 마지막 핀이다")
    void revivedPinsOverflowFromTheOldestEnd() throws Exception {
        UUID viewer = newUser();
        List<Group> islands = islandEntities(6);
        for (int i = 0; i < 4; i++) {
            pin(viewer, islands.get(i).getId(), "observatory", BASE.plusSeconds(i));
        }
        // 가장 오래된 핀 섬에 가입해 그 핀을 가린 채 다섯 번째를 넣고, 그 섬의 멤버십을 자진 탈퇴로 마킹해 핀을 되살린다 — 운영
        // 나가기 API 가 아니라 멤버십 마킹만 같은 상태를 직접 만든 것이다(truncatedOldestPin 주석 참조).
        GroupMember joined = join(viewer, islands.get(0));
        pin(viewer, islands.get(4).getId(), "observatory", BASE.plusSeconds(4));
        joined.leave(BASE.plusSeconds(5));
        members.save(joined);
        NOW.set(BASE.plusSeconds(6));

        List<TelescopeItemView> items = telescope.list(viewer).items();
        assertThat(pinnedIds(viewer)).as("보이는 핀은 5개지만 가장 오래된 0번은 감춘다").containsExactly(
                islands.get(1).getId(), islands.get(2).getId(), islands.get(3).getId(), islands.get(4).getId());
        // 남은 새 섬은 5번 하나다. 가까운 섬 라벨은 5번이 스냅샷 첫 섬일 때만 붙는다(해시 순) — 칸 수만 본다.
        assertThat(items).as("새 섬 칸은 1 아래로 내려가지 않는다").filteredOn(item -> !"pinned".equals(item.slot()))
                .extracting(TelescopeItemView::islandId).containsExactly(islands.get(5).getId());
        assertThat(items).extracting(TelescopeItemView::slot).filteredOn("pinned"::equals).hasSize(4);

        NOW.set(BASE.plusSeconds(7));
        postPin(viewer, islands.get(5).getId(), "magazine").andExpect(status().isCreated())
                .andExpect(jsonPath("$.evicted.islandId").value(islands.get(1).getId().toString()));

        assertThat(pinnedIds(viewer)).containsExactly(islands.get(2).getId(), islands.get(3).getId(),
                islands.get(4).getId(), islands.get(5).getId());
        assertThat(count("select count(*) from telescope_pins where user_id=?", viewer))
                .as("넘친 두 개(0번·1번)를 지웠다").isEqualTo(4);
    }

    @Test
    @DisplayName("목록에서 잘려 있던 핀을 다시 넣으면 404 가 아니라 200 이다 — 넣은 섬은 남고 다른 가장 오래된 핀이 밀려나 evicted 로 알린다")
    void reAddingATruncatedPinKeepsItAndEvictsTheOldestOtherPin() throws Exception {
        UUID viewer = newUser();
        List<Group> islands = truncatedOldestPin(viewer);
        UUID truncated = islands.get(0).getId();
        assertThat(pinnedIds(viewer)).as("보이는 핀은 다섯이지만 목록은 최근 넷만 보여 준다 — 가장 오래된 0번은 잘려 있다")
                .containsExactly(islands.get(1).getId(), islands.get(2).getId(), islands.get(3).getId(),
                        islands.get(4).getId());

        NOW.set(BASE.plusSeconds(7));
        postPin(viewer, truncated, "observatory")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.created").value(false))
                .andExpect(jsonPath("$.evicted.islandId").value(islands.get(1).getId().toString()))
                .andExpect(jsonPath("$.evicted.name").value(islands.get(1).getName()))
                .andExpect(jsonPath("$.item.islandId").value(truncated.toString()))
                .andExpect(jsonPath("$.item.slot").value("pinned"))
                .andExpect(jsonPath("$.item.pinnedFrom").value("magazine"))
                .andExpect(jsonPath("$.item.pinnedAt").value("2026-10-12T05:23:41Z"));

        assertThat(pinnedIds(viewer)).as("넣은 섬은 넣은 시각 그대로 남고, 넣은 섬을 뺀 가장 오래된 1번이 밀려났다")
                .containsExactly(truncated, islands.get(2).getId(), islands.get(3).getId(), islands.get(4).getId());
        assertThat(count("select count(*) from telescope_pins where user_id=?", viewer)).isEqualTo(4);
        assertThat(count("select count(*) from telescope_pins where user_id=? and island_id=?", viewer,
                islands.get(1).getId())).as("밀려난 핀은 행도 지운다").isZero();

        // 같은 다시 넣기를 한 번 더 — 넘침은 이미 정리됐으니 evicted 는 null 이고 상태는 그대로다(멱등).
        postPin(viewer, truncated, "observatory")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.created").value(false))
                .andExpect(jsonPath("$.evicted").value(nullValue()))
                .andExpect(jsonPath("$.item.islandId").value(truncated.toString()))
                .andExpect(jsonPath("$.item.pinnedAt").value("2026-10-12T05:23:41Z"));
        assertThat(pinnedIds(viewer)).containsExactly(truncated, islands.get(2).getId(), islands.get(3).getId(),
                islands.get(4).getId());
        assertThat(count("select count(*) from telescope_pins where user_id=?", viewer)).isEqualTo(4);
    }

    @Test
    @DisplayName("보이는 핀이 6개(잘린 핀 둘)일 때 가장 오래된 0번을 다시 넣으면 0번은 남고 그다음 오래된 1·2번이 함께 지워진다 — evicted 는 지운 것 중 가장 최근인 2번이다")
    void reAddingTheOldestOfSixVisiblePinsEvictsTheNextTwoOldest() throws Exception {
        UUID viewer = newUser();
        List<Group> islands = truncatedTwoOldestPins(viewer);
        UUID truncated = islands.get(0).getId();
        assertThat(telescope.visiblePins(viewer, NOW.get())).as("보이는 핀은 여섯이다 — 넘침이 둘")
                .extracting(entry -> entry.row().getId())
                .containsExactlyElementsOf(islands.stream().map(Group::getId).toList());
        assertThat(pinnedIds(viewer)).as("그래도 목록은 최근 넷(2~5번)만 보여 준다 — 가장 오래된 0·1번은 잘려 있다")
                .containsExactly(islands.get(2).getId(), islands.get(3).getId(), islands.get(4).getId(),
                        islands.get(5).getId());

        NOW.set(BASE.plusSeconds(8));
        postPin(viewer, truncated, "observatory")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.created").value(false))
                // 지운 것은 1·2번 둘이고 알림은 그중 가장 최근인 2번 하나다 — 1번은 사용자가 목록에서 못 본 핀이다.
                .andExpect(jsonPath("$.evicted.islandId").value(islands.get(2).getId().toString()))
                .andExpect(jsonPath("$.evicted.name").value(islands.get(2).getName()))
                .andExpect(jsonPath("$.item.islandId").value(truncated.toString()))
                .andExpect(jsonPath("$.item.slot").value("pinned"))
                .andExpect(jsonPath("$.item.pinnedFrom").value("magazine"))
                .andExpect(jsonPath("$.item.pinnedAt").value("2026-10-12T05:23:41Z"));

        assertThat(pinnedIds(viewer)).as("넣은 0번은 넣은 시각 그대로 남아 목록 맨 앞이다")
                .containsExactly(truncated, islands.get(3).getId(), islands.get(4).getId(), islands.get(5).getId());
        assertThat(count("select count(*) from telescope_pins where user_id=?", viewer)).isEqualTo(4);
        assertThat(count("select count(*) from telescope_pins where user_id=? and island_id=?", viewer,
                islands.get(1).getId())).as("알림에 안 나온 1번도 행째 지운다 — 넘친 만큼 모두 지운다").isZero();
        assertThat(count("select count(*) from telescope_pins where user_id=? and island_id=?", viewer,
                islands.get(2).getId())).as("알림에 나온 2번도 행째 지운다").isZero();
    }

    @Test
    @DisplayName("목록에 있는 핀을 다시 넣어도 넘침은 가장 오래된 핀부터 지운다 — 잘려 있던 0번이 지워져 evicted 로 알린다(사용자가 목록에서 못 본 핀일 수 있다)")
    void reAddingAPinOnTheListEvictsTheTruncatedOldestPin() throws Exception {
        UUID viewer = newUser();
        List<Group> islands = truncatedOldestPin(viewer);
        Group onTheList = islands.get(2);

        NOW.set(BASE.plusSeconds(7));
        postPin(viewer, onTheList.getId(), "magazine")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.created").value(false))
                // 현재 동작을 고정한다: 지워지는 것은 목록에서 잘려 있던 0번 하나뿐이고 evicted 는 그 0번이다. 다시 넣은 핀이
                // 목록에 있어도 사용자는 한 번도 못 본 핀이 «밀려났다» 는 알림을 받을 수 있다.
                .andExpect(jsonPath("$.evicted.islandId").value(islands.get(0).getId().toString()))
                .andExpect(jsonPath("$.evicted.name").value(islands.get(0).getName()))
                .andExpect(jsonPath("$.item.islandId").value(onTheList.getId().toString()))
                .andExpect(jsonPath("$.item.slot").value("pinned"))
                .andExpect(jsonPath("$.item.pinnedFrom").value("observatory"))
                .andExpect(jsonPath("$.item.pinnedAt").value("2026-10-12T05:23:43Z"));

        assertThat(pinnedIds(viewer)).as("목록은 그대로다 — 1~4번, 같은 순서")
                .containsExactly(islands.get(1).getId(), islands.get(2).getId(), islands.get(3).getId(),
                        islands.get(4).getId());
        assertThat(count("select count(*) from telescope_pins where user_id=?", viewer)).isEqualTo(4);
        assertThat(count("select count(*) from telescope_pins where user_id=? and island_id=?", viewer,
                islands.get(0).getId())).as("잘려 있던 0번이 행째 지워졌다").isZero();
    }

    @Test
    @DisplayName("목록에서 잘려 있는 핀은 가까운 섬·무작위 칸에도 나오지 않는다 — 후보가 그 섬 하나뿐이어도 «찜» 표시 없는 일반 칸으로 나오지 않는다")
    void aTruncatedPinNeverShowsUpInAnotherSlot() {
        UUID viewer = newUser();
        // 공개 섬은 이 다섯뿐이고 0번 말고는 전부 핀이다 — 0번이 후보에서 안 빠지면 가까운 섬으로 나온다.
        List<Group> islands = truncatedOldestPin(viewer);

        List<TelescopeItemView> items = telescope.list(viewer).items();

        assertThat(items).extracting(TelescopeItemView::slot).containsExactly("pinned", "pinned", "pinned", "pinned");
        assertThat(items).extracting(TelescopeItemView::islandId).containsExactly(islands.get(1).getId(),
                islands.get(2).getId(), islands.get(3).getId(), islands.get(4).getId());
        assertThat(count("select count(*) from telescope_pins where user_id=? and island_id=?", viewer,
                islands.get(0).getId())).as("잘린 핀 행은 다음 넣기가 정리할 때까지 남는다").isEqualTo(1);
    }

    @Test
    @DisplayName("목록에서 잘려 있는 핀이 정원 찬 섬이어도 random 폴백으로 새지 않는다 — 정원 남은 후보가 없을 때 찬 섬이 채우는 «구경만» 칸에도 나오지 않는다")
    void aTruncatedFullPinNeverLeaksIntoTheRandomFallback() {
        UUID viewer = newUser();
        // 공개 섬은 이 다섯뿐이고 0번 말고는 전부 핀이다. 0번이 정원까지 차면 후보에서 안 빠질 때 가까운 섬이 아니라 찬 섬을
        // 채우는 random 폴백으로 나온다.
        List<Group> islands = truncatedOldestPin(viewer);
        UUID truncated = islands.get(0).getId();
        jdbc.update("update islands set max_members = 1 where id = ?", truncated);
        join(newUser(), islands.get(0));
        assertThat(telescope.visiblePins(viewer, NOW.get())).as("잘린 0번도 «보이는 핀» 이고 정원이 찼다")
                .anySatisfy(entry -> {
                    assertThat(entry.row().getId()).isEqualTo(truncated);
                    assertThat(entry.row().getMemberCount()).isEqualTo(entry.row().getMaxMembers());
                });

        List<TelescopeItemView> items = telescope.list(viewer).items();

        assertThat(items).extracting(TelescopeItemView::slot).containsExactly("pinned", "pinned", "pinned", "pinned");
        assertThat(items).extracting(TelescopeItemView::islandId).containsExactly(islands.get(1).getId(),
                islands.get(2).getId(), islands.get(3).getId(), islands.get(4).getId());
        assertThat(count("select count(*) from telescope_pins where user_id=? and island_id=?", viewer, truncated))
                .as("잘린 핀 행은 다음 넣기가 정리할 때까지 남는다").isEqualTo(1);
    }

    @Test
    @DisplayName("정원 찬 섬도 넣을 수 있다 — full=true 로 내려가고, 대기 중인 가입 신청·도착·평균·항해 분도 다른 칸과 같이 채워진다")
    void aFullIslandCanBePinnedAndCarriesTheSameFieldsAsAnyOtherSlot() {
        UUID viewer = newUser();
        Group island = groups.save(Group.builder().name("물결").description("같이 집중해요").maxMembers(2)
                .approvalRequired(true).build());
        join(newUser(), island);
        join(newUser(), island);
        joinRequests.save(IslandJoinRequest.pending(island, users.getCaller(viewer), null));
        jdbc.update("insert into island_arrivals (user_id, island_id, first_arrived_at, last_arrived_at) "
                + "values (?, ?, now(), now())", viewer, island.getId());
        jdbc.update("insert into island_focus_averages (snapshot_date, island_id, member_count, "
                + "avg_minutes_per_member_day) values (?, ?, 2, 83)", LocalDate.of(2026, 10, 12), island.getId());

        TelescopePinView view = pin(viewer, island.getId(), "magazine", BASE);

        TelescopeItemView expected = new TelescopeItemView(island.getId(), "물결", "같이 집중해요", 2, 2, true,
                "pending", "pinned", SailingTimes.minutes(viewer, island.getId(), BUCKET), 83, true, true,
                "magazine", BASE, null, 0);
        assertThat(view.item()).isEqualTo(expected);
        assertThat(view.evicted()).isNull();
        assertThat(view.created()).isTrue();
        List<TelescopeItemView> listed = telescope.list(viewer).items();
        assertThat(listed).hasSize(2);
        assertThat(listed.get(0).memberCount()).isZero();
        assertThat(listed.get(0).sailingMinutes()).isEqualTo(15);
        assertThat(listed.get(1)).isEqualTo(expected);
    }

    // ---------------------------------------------------------------- ⑧ 정리 (계약 §0 N42)

    @Test
    @DisplayName("섬이 닫히면(purge) 그 섬의 핀이 모든 사람 몫으로 사라지고 다른 섬의 핀은 남는다")
    void closingTheIslandPurgesItsPins() {
        UUID host = newUser();
        UUID closing = islands.create(host, new CreateIslandCommandRequest("닫힐섬", null, false, null),
                UUID.randomUUID()).id();
        UUID staying = islandIds(1).get(0);
        UUID viewer = newUser();
        UUID other = newUser();
        pin(viewer, closing, "magazine", BASE);
        pin(viewer, staying, "observatory", BASE.plusSeconds(1));
        pin(other, closing, "observatory", BASE.plusSeconds(2));
        assertThat(count("select count(*) from telescope_pins where island_id=?", closing)).isEqualTo(2);

        management.leave(host, closing, UUID.randomUUID());

        assertThat(count("select count(*) from islands where id=? and deleted_at is not null", closing))
                .as("삭제 묘비 — 하드 삭제가 아니라 CASCADE 가 돌지 않는다").isEqualTo(1);
        assertThat(count("select count(*) from telescope_pins where island_id=?", closing)).isZero();
        assertThat(count("select count(*) from telescope_pins where island_id=?", staying))
                .as("다른 섬의 핀은 그대로").isEqualTo(1);
    }

    @Test
    @DisplayName("계정 탈퇴는 그 사람의 핀만 전부 지운다 — 같은 섬을 넣은 다른 사람의 핀은 남는다")
    void withdrawalErasesOnlyTheWithdrawnUsersPins() {
        UUID leaving = newUser();
        UUID staying = newUser();
        List<UUID> ids = islandIds(2);
        pin(leaving, ids.get(0), "magazine", BASE);
        pin(leaving, ids.get(1), "observatory", BASE.plusSeconds(1));
        pin(staying, ids.get(0), "observatory", BASE.plusSeconds(2));

        withdrawal.withdraw(leaving);

        assertThat(count("select count(*) from telescope_pins where user_id=?", leaving)).isZero();
        assertThat(count("select count(*) from telescope_pins where user_id=?", staying))
                .as("다른 사람의 핀").isEqualTo(1);
    }

    // ---------------------------------------------------------------- 도구

    /** 사람은 전부 게스트다 — 망원경과 핀은 게스트도 쓴다. */
    private UUID newUser() {
        return jwt.extractUserId(auth.guestSession(java.util.UUID.randomUUID().toString()).accessToken());
    }

    private Group island(String name, int maxMembers) {
        return groups.save(Group.builder().name(name).maxMembers(maxMembers).build());
    }

    private List<Group> islandEntities(int count) {
        List<Group> created = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            created.add(island("핀섬" + i + "-" + UUID.randomUUID().toString().substring(0, 8), 10));
        }
        return created;
    }

    private List<UUID> islandIds(int count) {
        return islandEntities(count).stream().map(Group::getId).toList();
    }

    private GroupMember join(UUID userId, Group island) {
        return members.save(GroupMember.builder().user(users.getCaller(userId)).group(island)
                .role(GroupMemberRole.MEMBER).build());
    }

    /**
     * 가장 오래된 핀이 목록에서 «잘린» 상태 — 0번 섬을 넣고 그 섬에 가입해 가린 채 1~4번을 넣은 뒤 0번의 멤버십을 자진 탈퇴로
     * 마킹해 핀을 되살린다. 보이는 핀은 0~4번(0번이 가장 오래됨)의 다섯이고 목록은 최근 넷(1~4번)만 보여 준다. 시계는
     * BASE+6 이다.
     *
     * <p><b>운영 나가기 API 가 만든 상태가 아니다.</b> 멤버십 마킹({@code GroupMember.leave} 의 {@code is_left=true}·
     * {@code left_reason=LEFT})만 같은 상태를 직접 만든다. 이 섬의 주민은 viewer 한 명뿐이라 운영의 «마지막 1인 나가기» 는
     * 섬을 닫고 purge 하며 핀도 함께 지운다({@link #closingTheIslandPurgesItsPins} 가 그쪽을 덮는다). 운영에서 핀이
     * 되살아나려면 방장이 남아 섬이 살아 있어야 한다.
     */
    private List<Group> truncatedOldestPin(UUID viewer) {
        List<Group> islands = islandEntities(5);
        pin(viewer, islands.get(0).getId(), "magazine", BASE);
        GroupMember joined = join(viewer, islands.get(0));
        for (int i = 1; i < islands.size(); i++) {
            pin(viewer, islands.get(i).getId(), "observatory", BASE.plusSeconds(i));
        }
        joined.leave(BASE.plusSeconds(5));
        members.save(joined);
        NOW.set(BASE.plusSeconds(6));
        return islands;
    }

    /**
     * 가장 오래된 핀 <b>둘</b>이 목록에서 «잘린» 상태 — 0·1번 섬을 넣자마자 가입해 가린 채 2~5번을 넣은 뒤 0·1번의 멤버십을
     * 자진 탈퇴로 마킹해 핀을 되살린다. 보이는 핀은 0~5번(0번이 가장 오래됨)의 여섯이고 목록은 최근 넷(2~5번)만 보여 준다.
     * 시계는 BASE+7 이다.
     *
     * <p>{@link #truncatedOldestPin} 처럼 <b>운영 나가기 API 가 만든 상태가 아니다</b> — 멤버십 마킹만 같은 상태를 직접
     * 만든다. 섬마다 주민이 viewer 한 명뿐이라 운영의 «마지막 1인 나가기» 는 섬을 닫으며 핀도 지운다
     * ({@link #closingTheIslandPurgesItsPins} 가 그쪽을 덮는다).
     */
    private List<Group> truncatedTwoOldestPins(UUID viewer) {
        List<Group> islands = islandEntities(6);
        List<GroupMember> joined = new ArrayList<>();
        for (int i = 0; i < islands.size(); i++) {
            pin(viewer, islands.get(i).getId(), i == 0 ? "magazine" : "observatory", BASE.plusSeconds(i));
            if (i < 2) {
                joined.add(join(viewer, islands.get(i)));
            }
        }
        for (GroupMember member : joined) {
            member.leave(BASE.plusSeconds(6));
            members.save(member);
        }
        NOW.set(BASE.plusSeconds(7));
        return islands;
    }

    /** 시계를 {@code at} 으로 옮기고 운영 서비스로 핀을 넣는다. */
    private TelescopePinView pin(UUID viewer, UUID islandId, String source, Instant at) {
        NOW.set(at);
        return pinService.pin(viewer, islandId, source, null);
    }

    private ResultActions postPin(UUID viewer, UUID islandId, String source) throws Exception {
        return mvc.perform(post("/internal/users/" + viewer + "/telescope/pins")
                .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", viewer)
                .contentType("application/json")
                .content("{\"islandId\":\"" + islandId + "\",\"source\":\"" + source + "\"}"));
    }

    private ResultActions deletePin(UUID viewer, UUID islandId) throws Exception {
        return mvc.perform(delete("/internal/users/" + viewer + "/telescope/pins/" + islandId)
                .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", viewer));
    }

    private List<TelescopeItemView> pinnedItems(UUID viewer) {
        return telescope.list(viewer).items().stream().filter(item -> "pinned".equals(item.slot())).toList();
    }

    private List<UUID> pinnedIds(UUID viewer) {
        return pinnedItems(viewer).stream().map(TelescopeItemView::islandId).toList();
    }

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0L : value;
    }

    private static void execute(Connection connection, String sql) throws SQLException {
        try (Statement statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }

    /** 테스트가 쥔 어드바이저리 락 때문에 기다리는 세션 수 — 핀 INSERT 직후 트리거에 선 다시 넣기를 센다. */
    private long waitingOnGate() {
        return count("select count(*) from pg_locks where locktype = 'advisory' and objid = " + GATE_KEY
                + " and not granted and database = (select oid from pg_database where datname = current_database())");
    }

    /** 이 database 에서 행·트랜잭션 잠금을 기다리는 세션 수. */
    private long waitingOnLock() {
        return count("select count(*) from pg_stat_activity where wait_event_type = 'Lock' "
                + "and datname = current_database()");
    }

    private static void awaitUntil(String what, BooleanSupplier condition) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
        while (!condition.getAsBoolean()) {
            if (System.nanoTime() > deadline) {
                throw new AssertionError("제때 일어나지 않았다: " + what);
            }
            Thread.sleep(20);
        }
    }

    /** 서비스와 같은 시드의 셔플 순서 — SQL 의 {@code md5(seed || id)} 와 같은 값으로 정렬한다. */
    private static List<UUID> byHash(UUID viewer, List<UUID> islandIds) {
        String seed = viewer + ":" + BUCKET.getEpochSecond();
        return islandIds.stream()
                .sorted(Comparator.comparing(id -> IslandMembershipService.handle(seed, id)))
                .toList();
    }
}
