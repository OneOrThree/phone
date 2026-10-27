package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.IslandJoinRequestRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.group.repository.domain.IslandJoinRequest;
import com.oneorthree.phone.internal.dto.TelescopeItemView;
import com.oneorthree.phone.internal.dto.TelescopeView;
import com.oneorthree.phone.internal.support.SailingTimes;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import javax.sql.DataSource;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
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
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 망원경 목록 (GROMO-2265, 1시간 고정 GROMO-2306) — 실 Flyway 스키마 위에 운영 엔티티·저장소로 섬·주민·강퇴·도착·평균을 심고 생산
 * 진입점(서비스와 내부 HTTP)으로 부른다. 후보 SQL·주민 수·평균 reader 를 대역으로 덮지 않는다.
 *
 * <p>후보가 «DB 의 공개 섬 전부» 라 테스트마다 앞 테스트의 섬을 묘비(소프트 삭제)로 돌려 그 테스트가 심은 섬만 후보로
 * 남긴다. 이 컨텍스트는 전용 database 라({@link OutboxTestPostgres}) 다른 테스트 클래스에 번지지 않는다.
 *
 * <p>기대 순서는 서비스와 같은 시드로 {@link IslandMembershipService#handle}(SQL {@code md5(seed || id)} 와 같은 값)을
 * 계산해 만든다 — 시드 규칙({@code userId:버킷 epoch 초})까지 이 테스트가 고정한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
class TelescopeIntegrationTest {

    private static final String TOKEN = "test-telescope-business";
    /** 버킷 05:00Z 안의 23분 41초 — 다음 목록까지 37분. */
    private static final Instant BASE = Instant.parse("2026-10-12T05:23:41Z");
    private static final Instant BUCKET = Instant.parse("2026-10-12T05:00:00Z");
    private static final AtomicReference<Instant> NOW = new AtomicReference<>();

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        registry.add("internal.api.callers.business.allow[0]", () -> "GET /internal/users/*/telescope");
    }

    @MockitoBean
    Clock clock;

    @Autowired
    TelescopeService telescope;
    @Autowired
    TelescopePinService pinService;
    @Autowired
    UserRepository users;
    @Autowired
    GroupRepository islands;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    IslandJoinRequestRepository joinRequests;
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
        NOW.set(BASE);
        jdbc.update("update islands set deleted_at = now() where deleted_at is null");
    }

    // ---------------------------------------------------------------- ① 같은 버킷

    @Test
    @DisplayName("같은 1시간 안에 다시 부르면 같은 목록·순서·항해 분이고, 다음 버킷이면 bucketStart 가 바뀐다")
    void sameBucketGivesTheSameList() {
        User viewer = user();
        join(viewer, island("소속섬", 10));
        for (int i = 0; i < 6; i++) {
            island("열린섬" + i, 10);
        }
        fullIsland("찬섬A");
        fullIsland("찬섬B");

        TelescopeView first = telescope.list(viewer.getId());
        NOW.set(BASE.plus(Duration.ofMinutes(20)));
        TelescopeView again = telescope.list(viewer.getId());

        assertThat(first.bucketStart()).isEqualTo(BUCKET);
        assertThat(first.items()).hasSize(1 + 1 + TelescopeService.RANDOM_SLOTS);
        assertThat(again.bucketStart()).isEqualTo(BUCKET);
        assertThat(again.items()).isEqualTo(first.items());
        assertThat(first.nextRefreshMinutes()).isEqualTo(37);
        assertThat(again.nextRefreshMinutes()).isEqualTo(17);

        // 목록이 바뀌는지는 확률적이라 보지 않는다 — 버킷과 남은 분만 본다.
        NOW.set(BASE.plus(Duration.ofHours(1)));
        TelescopeView next = telescope.list(viewer.getId());
        assertThat(next.bucketStart()).isEqualTo(BUCKET.plus(Duration.ofHours(1)));
        assertThat(next.nextRefreshMinutes()).isEqualTo(37);
    }

    // ---------------------------------------------------------------- ①-1 1시간 고정 (GROMO-2306)

    @Test
    @DisplayName("같은 버킷 안에 후보 섬이 정원까지 차도 목록·순서·칸·항해 분이 같고 full 만 true 로 바뀐다 — 가까운 섬도 15분 그대로")
    void fillingUpCandidatesOnlyFlipsFull() {
        User viewer = user();
        List<UUID> open = new ArrayList<>();
        for (int i = 0; i < 7; i++) {
            open.add(island("두자리섬" + i, 2).getId());
        }
        TelescopeView first = telescope.list(viewer.getId());
        assertThat(first.items()).extracting(TelescopeItemView::full).containsOnly(false);
        UUID nearby = first.items().get(0).islandId();
        UUID random = first.items().get(2).islandId();

        // 가까운 섬과 무작위 섬 하나를 정원(2)까지 채운다 — 다시 뽑는다면 정원 찬 섬은 맨 뒤로 밀린다.
        for (UUID id : List.of(nearby, random)) {
            Group island = islands.findById(id).orElseThrow();
            join(user(), island);
            join(user(), island);
        }
        NOW.set(BASE.plus(Duration.ofMinutes(30)));
        TelescopeView again = telescope.list(viewer.getId());

        assertThat(again.items()).extracting(TelescopeItemView::islandId, TelescopeItemView::slot,
                        TelescopeItemView::sailingMinutes)
                .containsExactlyElementsOf(first.items().stream()
                        .map(item -> tuple(item.islandId(), item.slot(), item.sailingMinutes())).toList());
        assertThat(again.items().get(0)).satisfies(item -> {
            assertThat(item.slot()).isEqualTo("nearby");
            assertThat(item.sailingMinutes()).isEqualTo(15);
        });
        assertThat(again.items()).filteredOn(TelescopeItemView::full).extracting(TelescopeItemView::islandId)
                .containsExactlyInAnyOrder(nearby, random);
        assertThat(again.items()).filteredOn(item -> item.islandId().equals(nearby)).singleElement()
                .satisfies(item -> assertThat(item.memberCount()).isEqualTo(2));
    }

    @Test
    @DisplayName("같은 버킷 안에 새 공개 섬이 생겨 시드 순으로 앞에 서도 목록은 그대로다")
    void aNewPublicIslandDoesNotChangeTheBucket() {
        User viewer = user();
        List<UUID> open = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            open.add(island("열린섬" + i, 10).getId());
        }
        List<UUID> first = ids(telescope.list(viewer.getId()));
        assertThat(first).containsExactlyElementsOf(byHash(viewer, open).subList(0, 5));

        // 시드 순으로 지금 다섯 번째 섬보다 앞에 서는 새 섬이 나올 때까지 만든다 — 다시 뽑으면 목록에 들어갈 섬이다.
        UUID fifth = first.get(4);
        UUID newcomer = null;
        for (int i = 0; i < 100 && newcomer == null; i++) {
            UUID id = island("새섬" + i, 10).getId();
            if (byHash(viewer, List.of(id, fifth)).get(0).equals(id)) {
                newcomer = id;
            }
        }
        assertThat(newcomer).as("시드 순으로 앞에 서는 새 섬").isNotNull();

        assertThat(ids(telescope.list(viewer.getId()))).containsExactlyElementsOf(first);
    }

    @Test
    @DisplayName("같은 버킷 안에 무작위 섬에 가입하면 그 섬은 joined 로 옮기고 무작위 칸은 새로 채우지 않는다")
    void joiningARandomIslandMovesItToJoinedWithoutRefill() {
        User viewer = user();
        List<UUID> open = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            open.add(island("열린섬" + i, 10).getId());
        }
        List<TelescopeItemView> first = telescope.list(viewer.getId()).items();
        UUID joined = first.get(3).islandId();

        join(viewer, islands.findById(joined).orElseThrow());
        List<TelescopeItemView> again = telescope.list(viewer.getId()).items();

        List<UUID> rest = first.stream().map(TelescopeItemView::islandId).filter(id -> !id.equals(joined)).toList();
        assertThat(again).extracting(TelescopeItemView::islandId)
                .containsExactly(joined, rest.get(0), rest.get(1), rest.get(2), rest.get(3));
        assertThat(again).extracting(TelescopeItemView::slot)
                .containsExactly("joined", "nearby", "random", "random", "random");
        assertThat(again.get(0).membershipStatus()).isEqualTo("active");
    }

    @Test
    @DisplayName("같은 버킷 안에 후보 섬이 비공개로 바뀌면 그 칸이 빠지고 새로 채우지 않는다 — 가까운 섬이 빠지면 다음 섬이 가까운 섬이 되지 않는다")
    void aCandidateTurningPrivateLeavesAHole() {
        User viewer = user();
        for (int i = 0; i < 8; i++) {
            island("열린섬" + i, 10);
        }
        List<TelescopeItemView> first = telescope.list(viewer.getId()).items();
        UUID randomGone = first.get(2).islandId();
        jdbc.update("update islands set is_private = true where id = ?", randomGone);

        List<TelescopeItemView> afterRandom = telescope.list(viewer.getId()).items();
        assertThat(afterRandom).extracting(TelescopeItemView::islandId).containsExactly(first.get(0).islandId(),
                first.get(1).islandId(), first.get(3).islandId(), first.get(4).islandId());
        assertThat(afterRandom).extracting(TelescopeItemView::slot)
                .containsExactly("nearby", "random", "random", "random");

        jdbc.update("update islands set is_private = true where id = ?", first.get(0).islandId());
        List<TelescopeItemView> afterNearby = telescope.list(viewer.getId()).items();
        assertThat(afterNearby).extracting(TelescopeItemView::islandId).containsExactly(first.get(1).islandId(),
                first.get(3).islandId(), first.get(4).islandId());
        assertThat(afterNearby).extracting(TelescopeItemView::slot).containsOnly("random");
        assertThat(afterNearby.get(0).sailingMinutes()).isEqualTo(first.get(1).sailingMinutes());
    }

    @Test
    @DisplayName("다음 버킷에는 새 시드로 새 목록을 뽑고, 그 사람의 지난 버킷 스냅샷 행을 지운다")
    void theNextBucketDrawsAgainAndDropsTheOldSnapshot() {
        User viewer = user();
        User other = user();
        List<UUID> open = new ArrayList<>();
        for (int i = 0; i < 9; i++) {
            open.add(island("열린섬" + i, 10).getId());
        }
        telescope.list(viewer.getId());
        telescope.list(other.getId());

        Instant nextBucket = BUCKET.plus(Duration.ofHours(1));
        NOW.set(BASE.plus(Duration.ofHours(1)));
        TelescopeView next = telescope.list(viewer.getId());

        assertThat(next.bucketStart()).isEqualTo(nextBucket);
        assertThat(ids(next)).containsExactlyElementsOf(byHash(viewer, open, nextBucket).subList(0, 5));
        assertThat(jdbc.queryForList("select bucket_start from telescope_buckets where user_id = ?",
                java.sql.Timestamp.class, viewer.getId())).extracting(java.sql.Timestamp::toInstant)
                .containsExactly(nextBucket);
        assertThat(jdbc.queryForObject("select count(*) from telescope_buckets where user_id = ?", Long.class,
                other.getId())).as("남의 지난 행은 그 사람이 볼 때 지운다").isEqualTo(1L);
    }

    @Test
    @DisplayName("다른 기기가 같은 버킷 행을 먼저 넣고 아직 커밋하지 않았으면 목록은 그 커밋을 기다렸다가 자기 뽑기가 아니라 "
            + "그 행(먼저 넣은 순서)을 다시 읽어 쓴다 — 스냅샷 행은 하나다")
    void aLosingFirstRequestRereadsTheWinningSnapshot() throws Exception {
        User viewer = user();
        List<UUID> open = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            open.add(island("열린섬" + i, 10).getId());
        }
        // 이 사람이 뽑을 순서(해시 순 0~4)와 다른 목록 — 해시 순 뒤쪽 다섯을 거꾸로.
        List<UUID> order = byHash(viewer, open);
        List<UUID> planted = List.of(order.get(7), order.get(6), order.get(5), order.get(4), order.get(3));
        String literal = planted.stream().map(UUID::toString).collect(Collectors.joining(",", "{", "}"));

        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection winner = dataSource.getConnection()) {
            winner.setAutoCommit(false);
            try (PreparedStatement insert = winner.prepareStatement("insert into telescope_buckets "
                    + "(user_id, bucket_start, island_ids, has_nearby) values (?, ?, cast(? as uuid[]), true)")) {
                insert.setObject(1, viewer.getId());
                insert.setTimestamp(2, Timestamp.from(BUCKET));
                insert.setString(3, literal);
                insert.executeUpdate();
            }
            Future<TelescopeView> loser = pool.submit(() -> telescope.list(viewer.getId()));
            awaitUntil("목록의 INSERT 가 먼저 넣은 행의 커밋을 기다린다", () -> waitingOnLock() >= 1);
            winner.commit();

            TelescopeView view = loser.get(30, TimeUnit.SECONDS);
            assertThat(ids(view)).as("자기 뽑기(해시 순 0~4)가 아니라 이긴 행의 순서다")
                    .containsExactlyElementsOf(planted).doesNotContain(order.get(0));
            assertThat(view.items()).extracting(TelescopeItemView::slot)
                    .containsExactly("nearby", "random", "random", "random", "random");
            assertThat(jdbc.queryForObject("select count(*) from telescope_buckets where user_id = ?", Long.class,
                    viewer.getId())).isEqualTo(1L);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("스냅샷 island_ids 에 없는 섬 id 가 섞여 있어도 목록은 던지지 않고 그 칸만 빠진다")
    void aMissingIslandInTheSnapshotIsSkipped() {
        User viewer = user();
        for (int i = 0; i < 8; i++) {
            island("열린섬" + i, 10);
        }
        List<UUID> first = ids(telescope.list(viewer.getId()));
        jdbc.update("update telescope_buckets set island_ids = island_ids[1:1] || ?::uuid || island_ids[2:] "
                + "where user_id = ?", UUID.randomUUID(), viewer.getId());
        assertThat(jdbc.queryForObject("select cardinality(island_ids) from telescope_buckets where user_id = ?",
                Integer.class, viewer.getId())).isEqualTo(6);

        assertThat(ids(telescope.list(viewer.getId()))).containsExactlyElementsOf(first);
    }

    @Test
    @DisplayName("두 기기가 같은 버킷의 첫 목록을 동시에 불러도 같은 목록이고 스냅샷 행은 하나다")
    void concurrentFirstRequestsAgreeOnOneSnapshot() throws Exception {
        User viewer = user();
        for (int i = 0; i < 8; i++) {
            island("열린섬" + i, 10);
        }
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch go = new CountDownLatch(1);
            List<Future<TelescopeView>> results = new ArrayList<>();
            for (int i = 0; i < 2; i++) {
                results.add(pool.submit(() -> {
                    go.await();
                    return telescope.list(viewer.getId());
                }));
            }
            go.countDown();
            TelescopeView a = results.get(0).get(60, TimeUnit.SECONDS);
            TelescopeView b = results.get(1).get(60, TimeUnit.SECONDS);

            assertThat(a.items()).hasSize(5).isEqualTo(b.items());
            assertThat(jdbc.queryForObject("select count(*) from telescope_buckets where user_id = ?", Long.class,
                    viewer.getId())).isEqualTo(1L);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("스냅샷 섬 다섯이 전부 비공개로 바뀌면 새 섬 칸은 0이고 joined·pinned 만 남는다 — 새로 뽑지 않는다")
    void aSnapshotEmptiedByPrivacyLeavesOnlyJoinedAndPinned() {
        User viewer = user();
        Group home = island("소속섬", 10);
        join(viewer, home);
        List<UUID> open = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            open.add(island("열린섬" + i, 10).getId());
        }
        UUID pinnedId = open.get(7);
        // 첫 핀 넣기가 스냅샷을 뽑는다 — 핀 섬을 뺀 다섯이다.
        pinService.pin(viewer.getId(), pinnedId, "observatory", null);
        List<UUID> snapshot = telescope.list(viewer.getId()).items().stream()
                .filter(item -> "nearby".equals(item.slot()) || "random".equals(item.slot()))
                .map(TelescopeItemView::islandId).toList();
        assertThat(snapshot).hasSize(TelescopeService.RANDOM_SLOTS);

        String all = jdbc.queryForObject("select array_to_string(island_ids, ',') from telescope_buckets "
                + "where user_id = ?", String.class, viewer.getId());
        for (String id : all.split(",")) {
            jdbc.update("update islands set is_private = true where id = ?::uuid", id);
        }

        List<TelescopeItemView> items = telescope.list(viewer.getId()).items();
        assertThat(items).extracting(TelescopeItemView::islandId, TelescopeItemView::slot)
                .containsExactly(tuple(home.getId(), "joined"), tuple(pinnedId, "pinned"));
    }

    @Test
    @DisplayName("공개 섬이 없으면 빈 스냅샷과 개인 무인도를 유지한다 — 늦게 생긴 공개 섬은 다음 버킷에 뽑는다")
    void anEmptyDrawIsStoredAndReread() {
        User viewer = user();

        UUID destination = telescope.list(viewer.getId()).items().get(0).islandId();
        assertThat(jdbc.queryForObject("select cardinality(island_ids) || ':' || has_nearby from telescope_buckets "
                + "where user_id = ?", String.class, viewer.getId())).isEqualTo("0:false");

        island("늦게생긴섬", 10);
        assertThat(telescope.list(viewer.getId()).items()).extracting(TelescopeItemView::islandId)
                .containsExactly(destination);
        assertThat(jdbc.queryForObject("select count(*) from telescope_buckets where user_id = ?", Long.class,
                viewer.getId())).isEqualTo(1L);
    }

    @Test
    @DisplayName("칸마다 buildingCount 는 완공(COMPLETED) 시설 수다 — 짓는 중(BUILDING)은 세지 않고 시설이 없으면 0")
    void buildingCountCountsCompletedFacilitiesOnly() {
        User viewer = user();
        Group home = island("소속섬", 10);
        join(viewer, home);
        facility(home, "hall", "COMPLETED");
        facility(home, "board", "COMPLETED");
        facility(home, "gram", "BUILDING");
        Group built = island("지은섬", 10);
        facility(built, "hall", "COMPLETED");
        Group bare = island("빈섬", 10);

        List<TelescopeItemView> items = telescope.list(viewer.getId()).items();

        assertThat(items).extracting(TelescopeItemView::islandId, TelescopeItemView::buildingCount)
                .containsExactlyInAnyOrder(tuple(home.getId(), 2), tuple(built.getId(), 1), tuple(bare.getId(), 0));
    }

    // ---------------------------------------------------------------- ② 항해 분

    @Test
    @DisplayName("가까운 섬은 시드 순 첫 열린 섬 하나·15분이고 나머지는 SailingTimes 의 30·60·90 이다")
    void nearbyIsFifteenMinutesAndTheRestComeFromSailingTimes() {
        User viewer = user();
        Group home = island("소속섬", 10);
        join(viewer, home);
        List<UUID> open = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            open.add(island("열린섬" + i, 10).getId());
        }

        List<TelescopeItemView> items = telescope.list(viewer.getId()).items();

        List<UUID> order = byHash(viewer, open);
        assertThat(items).extracting(TelescopeItemView::islandId).containsExactly(
                home.getId(), order.get(0), order.get(1), order.get(2), order.get(3), order.get(4));
        assertThat(items).extracting(TelescopeItemView::slot)
                .containsExactly("joined", "nearby", "random", "random", "random", "random");
        assertThat(items.get(1).sailingMinutes()).isEqualTo(15);
        assertThat(items).filteredOn(item -> !item.slot().equals("nearby")).allSatisfy(item ->
                assertThat(item.sailingMinutes()).isIn(30, 60, 90)
                        .isEqualTo(SailingTimes.minutes(viewer.getId(), item.islandId(), BUCKET)));
    }

    // ---------------------------------------------------------------- ③ 비공개·강퇴

    @Test
    @DisplayName("비공개·종료 섬은 0건이고 자진 탈퇴·강퇴된 섬은 discover 와 같이 후보에 나온다")
    void privateAndEndedIslandsNeverAppearButLeftAndKickedIslandsDo() {
        User viewer = user();
        Group privateIsland = islands.save(Group.builder().name("비공개섬").maxMembers(10).isPrivate(true).build());
        // 잡지에 홍보 칸이 실린 비공개 섬이라도 후보·목록에서 빠진다.
        jdbc.update("insert into island_promotions (id, island_id, issue_date, applied_by, applied_at, updated_at, "
                + "body, layout) values (?, ?, ?, ?, ?, ?, '홍보', ?::jsonb)", UUID.randomUUID(), privateIsland.getId(),
                java.sql.Date.valueOf("2026-10-12"), viewer.getId(), Timestamp.from(BASE), Timestamp.from(BASE),
                "{\"v\":1,\"frameId\":\"mag.frame-scallop\",\"stickers\":[],\"tape\":null}");
        islands.save(Group.builder().name("끝난섬").maxMembers(10).status(GroupStatus.ENDED).build());
        GroupMember kicked = join(viewer, island("강퇴섬", 10));
        kicked.kick(BASE);
        members.save(kicked);
        Group left = island("나간섬", 10);
        GroupMember leftMembership = join(viewer, left);
        leftMembership.leave(BASE);
        members.save(leftMembership);
        Group open = island("열린섬", 10);

        List<TelescopeItemView> items = telescope.list(viewer.getId()).items();

        // 강퇴된 섬도 다시 보인다(GROMO-2315, 10/20 결정) — 그 섬의 가입은 승인 대기 신청이 된다.
        assertThat(items).extracting(TelescopeItemView::islandId).containsExactlyElementsOf(
                byHash(viewer, List.of(left.getId(), open.getId(), kicked.getGroup().getId())));
        assertThat(items).extracting(TelescopeItemView::membershipStatus).containsOnly("none");
        // 강퇴된 섬은 이 사람에게만 승인제로 보인다 — 실제 가입이 신청(pending)이라 「바로 가입」을 띄우면 안 된다.
        assertThat(items).filteredOn(item -> item.islandId().equals(kicked.getGroup().getId()))
                .singleElement().extracting(TelescopeItemView::approvalRequired).isEqualTo(true);
        assertThat(items).filteredOn(item -> !item.islandId().equals(kicked.getGroup().getId()))
                .extracting(TelescopeItemView::approvalRequired).containsOnly(false);
    }

    // ---------------------------------------------------------------- ④ 정원 찬 섬 채우기

    @Test
    @DisplayName("열린 섬 2 + 찬 섬 5 → 가까운 섬 1 + 무작위 4(열린 1 + 찬 3, full=true)")
    void fullIslandsFillTheRandomSlotsAfterOpenOnes() {
        User viewer = user();
        List<UUID> open = List.of(island("열린섬A", 10).getId(), island("열린섬B", 10).getId());
        List<UUID> full = fullIslands(5);

        List<TelescopeItemView> items = telescope.list(viewer.getId()).items();

        List<UUID> openOrder = byHash(viewer, open);
        List<UUID> fullOrder = byHash(viewer, full);
        assertThat(items).extracting(TelescopeItemView::islandId).containsExactly(
                openOrder.get(0), openOrder.get(1), fullOrder.get(0), fullOrder.get(1), fullOrder.get(2));
        assertThat(items).extracting(TelescopeItemView::slot)
                .containsExactly("nearby", "random", "random", "random", "random");
        assertThat(items).extracting(TelescopeItemView::full).containsExactly(false, false, true, true, true);
    }

    @Test
    @DisplayName("열린 섬이 없으면 가까운 섬 라벨 없이 새 섬 5칸을 전부 찬 섬(random)으로 채운다")
    void withoutOpenIslandsAllFiveSlotsAreFullRandomIslands() {
        User viewer = user();
        List<UUID> full = fullIslands(6);

        List<TelescopeItemView> items = telescope.list(viewer.getId()).items().stream()
                .filter(TelescopeItemView::full).toList();

        assertThat(items).extracting(TelescopeItemView::islandId)
                .containsExactlyElementsOf(byHash(viewer, full).subList(0, 1 + TelescopeService.RANDOM_SLOTS));
        assertThat(items).extracting(TelescopeItemView::slot).containsOnly("random");
        assertThat(items).extracting(TelescopeItemView::full).containsOnly(true);
        assertThat(items).extracting(TelescopeItemView::sailingMinutes).allSatisfy(minutes ->
                assertThat(minutes).isIn(30, 60, 90));
    }

    @Test
    @DisplayName("후보가 2개뿐이면 2칸만 나오고, 탈퇴 계정은 주민 수·정원 판정에 세지 않는다")
    void fewCandidatesShrinkTheListAndWithdrawnAccountsDoNotCount() {
        User viewer = user();
        Group open = island("열린섬", 10);
        Group ghost = island("유령섬", 1);
        join(users.save(User.builder().nickname("탈퇴-" + UUID.randomUUID()).isDeleted(true).build()), ghost);

        List<TelescopeItemView> items = telescope.list(viewer.getId()).items();

        assertThat(items).extracting(TelescopeItemView::islandId)
                .containsExactlyElementsOf(byHash(viewer, List.of(open.getId(), ghost.getId())));
        assertThat(items).extracting(TelescopeItemView::slot).containsExactly("nearby", "random");
        assertThat(items).filteredOn(item -> item.islandId().equals(ghost.getId())).singleElement()
                .satisfies(item -> {
                    assertThat(item.memberCount()).isZero();
                    assertThat(item.full()).isFalse();
                });
    }

    // ---------------------------------------------------------------- ⑤ 항목 필드

    @Test
    @DisplayName("항목마다 이름·소개·주민 수/정원·평균·항해 분이 있고 소속 섬은 joined·도착 기록, 평균이 없으면 null")
    void itemsCarryTheFiveFieldsAndJoinedIslandsTheirArrival() {
        User viewer = user();
        Group home = islands.save(Group.builder().name("윤슬").description("같이 집중해요").maxMembers(5).build());
        join(viewer, home);
        join(user(), home);
        jdbc.update("insert into island_arrivals (user_id, island_id, first_arrived_at, last_arrived_at) "
                + "values (?, ?, now(), now())", viewer.getId(), home.getId());
        jdbc.update("insert into island_focus_averages (snapshot_date, island_id, member_count, "
                + "avg_minutes_per_member_day) values (?, ?, 2, 83)", LocalDate.of(2026, 10, 12), home.getId());
        Group applied = islands.save(Group.builder().name("물결").maxMembers(10).approvalRequired(true).build());
        join(user(), applied);
        joinRequests.save(IslandJoinRequest.pending(applied, viewer, null));

        assertThat(telescope.list(viewer.getId()).items()).containsExactly(
                new TelescopeItemView(home.getId(), "윤슬", "같이 집중해요", 2, 5, false, "active", "joined",
                        SailingTimes.minutes(viewer.getId(), home.getId(), BUCKET), 83, false, true, null, null, null, 0),
                new TelescopeItemView(applied.getId(), "물결", "", 1, 10, true, "pending", "nearby", 15, null,
                        false, false, null, null, null, 0));
    }

    // ---------------------------------------------------------------- 칸 순서·소속 섬

    @Test
    @DisplayName("소속 3 + 새 섬 5 = 8칸 — joined 3(가입 순) → nearby → random 4")
    void eightSlotsAreJoinedInJoinOrderThenNearbyThenRandom() {
        User viewer = user();
        Group first = island("첫째섬", 10);
        Group second = island("둘째섬", 10);
        Group third = island("셋째섬", 10);
        // 가입 순을 섬 생성 순과 다르게 둔다 — joined 는 섬 id 순이 아니라 가입(멤버십) 순이다.
        join(viewer, third);
        join(viewer, first);
        join(viewer, second);
        List<UUID> open = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            open.add(island("열린섬" + i, 10).getId());
        }

        List<TelescopeItemView> items = telescope.list(viewer.getId()).items();

        List<UUID> order = byHash(viewer, open);
        assertThat(items).extracting(TelescopeItemView::islandId).containsExactly(
                third.getId(), first.getId(), second.getId(),
                order.get(0), order.get(1), order.get(2), order.get(3), order.get(4));
        assertThat(items).extracting(TelescopeItemView::slot).containsExactly(
                "joined", "joined", "joined", "nearby", "random", "random", "random", "random");
    }

    @Test
    @DisplayName("삭제·종료된 소속 섬은 멤버십이 남아 있어도 joined 칸에 나오지 않는다")
    void deadJoinedIslandsAreLeftOut() {
        User viewer = user();
        Group alive = island("살아있는섬", 10);
        Group deleted = island("지운섬", 10);
        Group ended = islands.save(Group.builder().name("끝난섬").maxMembers(10).status(GroupStatus.ENDED).build());
        join(viewer, alive);
        join(viewer, deleted);
        join(viewer, ended);
        jdbc.update("update islands set deleted_at = now() where id = ?", deleted.getId());

        assertThat(telescope.list(viewer.getId()).items())
                .extracting(TelescopeItemView::islandId, TelescopeItemView::slot)
                .containsExactly(tuple(alive.getId(), "joined"));
    }

    // ---------------------------------------------------------------- ⑥ 다음 목록까지

    @ParameterizedTest
    @CsvSource({"05:00:00Z,60", "05:00:00.001Z,60", "05:30:00Z,30", "05:58:59Z,2", "05:59:00Z,1",
            "05:59:59Z,1", "05:59:59.999Z,1"})
    @DisplayName("다음 목록까지 남은 분은 ceil(버킷 끝 − 지금) — 정각 직후 60, 59분 59초 1")
    void nextRefreshMinutesCountsUpToTheEndOfTheBucket(String time, int minutes) {
        NOW.set(Instant.parse("2026-10-12T" + time));

        TelescopeView view = telescope.list(user().getId());

        assertThat(view.bucketStart()).isEqualTo(BUCKET);
        assertThat(view.nextRefreshMinutes()).isEqualTo(minutes);
    }

    @Test
    @DisplayName("KST 정각(06:00:00)이면 그 시각이 버킷 시작이고 다음 목록까지 60분이다")
    void exactlyOnTheKstHourGivesSixtyMinutes() {
        Instant sixAm = OffsetDateTime.parse("2026-10-13T06:00:00+09:00").toInstant();
        NOW.set(sixAm);

        TelescopeView view = telescope.list(user().getId());

        assertThat(view.bucketStart()).isEqualTo(sixAm);
        assertThat(view.nextRefreshMinutes()).isEqualTo(60);
    }

    // ---------------------------------------------------------------- ⑦ 게이트 없음

    @Test
    @DisplayName("게스트도, 전망대 없는 섬의 주민도 내부 경로로 200 을 받는다")
    void guestOnAnObservatoryLessIslandGets200() throws Exception {
        User guest = user();
        Group home = island("전망대없는섬", 10);
        join(guest, home);

        assertThat(guest.isGuest()).isTrue();
        mvc.perform(get("/internal/users/" + guest.getId() + "/telescope")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", guest.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bucketStart").value("2026-10-12T05:00:00Z"))
                .andExpect(jsonPath("$.nextRefreshMinutes").value(37))
                .andExpect(jsonPath("$.items[0].islandId").value(home.getId().toString()))
                .andExpect(jsonPath("$.items[0].slot").value("joined"))
                .andExpect(jsonPath("$.items[0].averageFocusMinutesPerDay").hasJsonPath());
    }

    // ---------------------------------------------------------------- 도구

    /** 사람은 전부 게스트다 — 망원경은 게스트 읽기를 허용한다. */
    private User user() {
        return users.save(User.builder().nickname("망원경-" + UUID.randomUUID()).isGuest(true).build());
    }

    private Group island(String name, int maxMembers) {
        return islands.save(Group.builder().name(name).maxMembers(maxMembers).build());
    }

    /** 정원 1에 주민 1명 — 가득 찬 섬. */
    private Group fullIsland(String name) {
        Group island = island(name, 1);
        join(user(), island);
        return island;
    }

    private List<UUID> fullIslands(int count) {
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            ids.add(fullIsland("찬섬" + i).getId());
        }
        return ids;
    }

    private GroupMember join(User user, Group island) {
        return members.save(GroupMember.builder().user(user).group(island).role(GroupMemberRole.MEMBER).build());
    }

    /** 이 database 에서 행·트랜잭션 잠금을 기다리는 세션 수 — {@code TelescopePinIntegrationTest} 와 같은 헬퍼. */
    private long waitingOnLock() {
        Long value = jdbc.queryForObject("select count(*) from pg_stat_activity where wait_event_type = 'Lock' "
                + "and datname = current_database()", Long.class);
        return value == null ? 0L : value;
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

    private void facility(Group island, String buildingId, String status) {
        jdbc.update("insert into island_facilities (island_id, building_id, status, cost, cost_revision) "
                + "values (?, ?, ?, 0, 1)", island.getId(), buildingId, status);
    }

    private static List<UUID> ids(TelescopeView view) {
        return view.items().stream().map(TelescopeItemView::islandId).toList();
    }

    private static List<UUID> byHash(User viewer, List<UUID> islandIds) {
        return byHash(viewer, islandIds, BUCKET);
    }

    /** 서비스와 같은 시드의 셔플 순서 — SQL 의 {@code md5(seed || id)} 와 같은 값으로 정렬한다. */
    private static List<UUID> byHash(User viewer, List<UUID> islandIds, Instant bucket) {
        String seed = viewer.getId() + ":" + bucket.getEpochSecond();
        return islandIds.stream()
                .sorted(Comparator.comparing(id -> IslandMembershipService.handle(seed, id)))
                .toList();
    }
}
