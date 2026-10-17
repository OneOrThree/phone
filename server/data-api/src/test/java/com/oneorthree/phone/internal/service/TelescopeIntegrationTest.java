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
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 망원경 목록 (GROMO-2265) — 실 Flyway 스키마 위에 운영 엔티티·저장소로 섬·주민·강퇴·도착·평균을 심고 생산
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
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        registry.add("internal.api.callers.business.allow[0]", () -> "GET /internal/users/*/telescope");
    }

    @MockitoBean
    Clock clock;

    @Autowired
    TelescopeService telescope;
    @Autowired
    UserRepository users;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    IslandJoinRequestRepository joinRequests;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    MockMvc mvc;

    @BeforeEach
    void isolate() {
        when(clock.instant()).thenAnswer(invocation -> NOW.get());
        when(clock.getZone()).thenReturn(ZoneOffset.UTC);
        NOW.set(BASE);
        jdbc.update("update groups set deleted_at = now() where deleted_at is null");
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
    @DisplayName("비공개·강퇴·종료 섬은 0건이고 자진 탈퇴한 섬은 discover 와 같이 후보에 나온다")
    void privateKickedAndEndedIslandsNeverAppearButLeftIslandsDo() {
        User viewer = user();
        groups.save(Group.builder().name("비공개섬").maxMembers(10).isPrivate(true).build());
        groups.save(Group.builder().name("끝난섬").maxMembers(10).status(GroupStatus.ENDED).build());
        GroupMember kicked = join(viewer, island("강퇴섬", 10));
        kicked.kick(BASE);
        members.save(kicked);
        Group left = island("나간섬", 10);
        GroupMember leftMembership = join(viewer, left);
        leftMembership.leave(BASE);
        members.save(leftMembership);
        Group open = island("열린섬", 10);

        List<TelescopeItemView> items = telescope.list(viewer.getId()).items();

        assertThat(items).extracting(TelescopeItemView::islandId)
                .containsExactlyElementsOf(byHash(viewer, List.of(left.getId(), open.getId())));
        assertThat(items).extracting(TelescopeItemView::membershipStatus).containsOnly("none");
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

        List<TelescopeItemView> items = telescope.list(viewer.getId()).items();

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
        Group home = groups.save(Group.builder().name("윤슬").description("같이 집중해요").maxMembers(5).build());
        join(viewer, home);
        join(user(), home);
        jdbc.update("insert into island_arrivals (user_id, island_id, first_arrived_at, last_arrived_at) "
                + "values (?, ?, now(), now())", viewer.getId(), home.getId());
        jdbc.update("insert into island_focus_averages (snapshot_date, island_id, member_count, "
                + "avg_minutes_per_member_day) values (?, ?, 2, 83)", LocalDate.of(2026, 10, 12), home.getId());
        Group applied = groups.save(Group.builder().name("물결").maxMembers(10).approvalRequired(true).build());
        join(user(), applied);
        joinRequests.save(IslandJoinRequest.pending(applied, viewer, null));

        assertThat(telescope.list(viewer.getId()).items()).containsExactly(
                new TelescopeItemView(home.getId(), "윤슬", "같이 집중해요", 2, 5, false, "active", "joined",
                        SailingTimes.minutes(viewer.getId(), home.getId(), BUCKET), 83, false, true, null, null, null),
                new TelescopeItemView(applied.getId(), "물결", "", 1, 10, true, "pending", "nearby", 15, null,
                        false, false, null, null, null));
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
        Group ended = groups.save(Group.builder().name("끝난섬").maxMembers(10).status(GroupStatus.ENDED).build());
        join(viewer, alive);
        join(viewer, deleted);
        join(viewer, ended);
        jdbc.update("update groups set deleted_at = now() where id = ?", deleted.getId());

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
        return groups.save(Group.builder().name(name).maxMembers(maxMembers).build());
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

    /** 서비스와 같은 시드의 셔플 순서 — SQL 의 {@code md5(seed || id)} 와 같은 값으로 정렬한다. */
    private static List<UUID> byHash(User viewer, List<UUID> islandIds) {
        String seed = viewer.getId() + ":" + BUCKET.getEpochSecond();
        return islandIds.stream()
                .sorted(Comparator.comparing(id -> IslandMembershipService.handle(seed, id)))
                .toList();
    }
}
