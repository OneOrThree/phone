package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.focus.dto.session.FocusSessionStartCommandRequest;
import com.oneorthree.phone.focus.dto.session.FocusSessionView;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.dto.HallLessIslandCleanupView;
import com.oneorthree.phone.internal.service.FocusSessionLifecycleService;
import com.oneorthree.phone.internal.service.HallLessIslandCleanupService;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserQueryService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 마을회관 없는 섬 일회성 정리 (GROMO-2763) — 실 Flyway PostgreSQL 위에서 주민·집중·지갑·사건을 본다.
 *
 * <p>정리는 DB 의 모든 대상 섬을 훑는다. 테스트끼리 섞이지 않게 매 테스트 전에 남은 대상을 먼저 정리해 «대상 0» 에서
 * 시작한다. 회관 없는 섬은 {@code POST /islands} 로 만든 뒤 회관 행을 지워 만든다 — 옛 경로로 생긴 섬과 같은 모양이다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class HallLessIslandCleanupIntegrationTest {

    private static final String PATH = "/internal/admin/hall-less-islands/cleanup";
    private static final String OPS_TOKEN = "test-hall-cleanup-ops";
    private static final String BIZ_TOKEN = "test-hall-cleanup-biz";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("notification.dispatch.mode", () -> "OUTBOX");
        registry.add("internal.api.callers.ops.token", () -> OPS_TOKEN);
        registry.add("internal.api.callers.ops.optional", () -> true);
        registry.add("internal.api.callers.ops.allow[0]", () -> "POST " + PATH);
        registry.add("internal.api.callers.business.token", () -> BIZ_TOKEN);
        registry.add("internal.api.callers.business.allow[0]", () -> "GET /internal/users/*/activation");
    }

    @Autowired
    HallLessIslandCleanupService cleanup;
    @Autowired
    IslandMembershipService islands;
    @Autowired
    FocusSessionLifecycleService focus;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    UserQueryService users;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    MockMvc mvc;

    @BeforeEach
    void clearLeftoverTargets() {
        cleanup.execute();
    }

    @Test
    @DisplayName("방장과 주민을 LEFT 로 내보내고 섬·지갑·홍보를 지운다 — 다른 섬이 있으면 그리로, 없으면 먼바다(LEFT)로 간다")
    void executeClosesTheIslandAndMovesEveryResidentOut() {
        UUID host = newUser();
        UUID island = hallLessIsland(host, true);
        UUID withHome = newUser();
        UUID home = islands.create(withHome, new CreateIslandCommandRequest("본섬", null, false, null),
                UUID.randomUUID()).id();
        joinAndMoveTo(withHome, island);
        UUID toSea = newUser();
        joinAndMoveTo(toSea, island);
        // 가입만 하고 그 섬으로 옮긴 적 없는 주민 — 컨텍스트 행이 없다.
        UUID neverMoved = newUser();
        join(neverMoved, island);
        // 앞서 다른 섬에서 강퇴돼 먼바다(KICKED)에 있다가 망원경으로 가입만 한 주민.
        UUID kickedBefore = newUser();
        join(kickedBefore, island);
        jdbc.update("insert into user_island_contexts (user_id, current_island_id, loss_reason) values (?, null,"
                + " 'KICKED')", kickedBefore);
        UUID applicant = newUser();
        jdbc.update("insert into island_join_requests (id, island_id, applicant_id) values (?, ?, ?)",
                UUID.randomUUID(), island, applicant);
        jdbc.update("update island_wallets set balance=42 where island_id=?", island);
        promote(island, host, today());

        HallLessIslandCleanupView result = cleanup.execute();

        assertThat(result.dryRun()).isFalse();
        assertThat(result.summary().islandIds()).containsExactly(island);
        assertThat(result.outcomes()).singleElement().satisfies(outcome -> {
            assertThat(outcome.islandId()).isEqualTo(island);
            assertThat(outcome.result()).isEqualTo("CLOSED");
        });
        assertThat(jdbc.queryForObject("select status from islands where id=?", String.class, island))
                .isEqualTo("ENDED");
        assertThat(count("select count(*) from islands where id=? and deleted_at is not null", island)).isEqualTo(1);
        assertThat(count("select count(*) from island_wallets where island_id=?", island)).as("물고기 잔액은 섬과 함께")
                .isZero();
        assertThat(count("select count(*) from island_promotions where island_id=?", island)).isZero();
        assertThat(jdbc.queryForMap("select status, terminal_reason from island_join_requests where island_id=?",
                island)).containsEntry("status", "CANCELLED").containsEntry("terminal_reason", "ISLAND_CLOSED");
        assertThat(jdbc.queryForList("select left_reason from group_members where group_id=?", String.class, island))
                .as("강퇴가 아니라 자진 이탈과 같다").hasSize(5).containsOnly("LEFT");

        // 다른 섬이 있으면 그 섬으로(나가기와 같은 규칙), 메인 섬도 그 섬으로 옮기되 이전 알림은 내지 않는다.
        assertThat(context(withHome)).containsEntry("current_island_id", home).containsEntry("loss_reason", null);
        assertThat(jdbc.queryForObject("select island_id from user_main_islands where user_id=?", UUID.class,
                withHome)).isEqualTo(home);
        // 남은 섬이 없으면 먼바다다 — LEFT 가 없으면 앱이 첫 항해 튜토리얼 대상으로 본다.
        for (UUID user : List.of(host, toSea, neverMoved, kickedBefore)) {
            assertThat(context(user)).as("user %s", user)
                    .containsEntry("current_island_id", null).containsEntry("loss_reason", "LEFT");
        }
        for (UUID user : List.of(host, withHome, toSea, neverMoved)) {
            assertThat(count("select count(*) from event_outbox where user_id=? and type='notification.requested'",
                    user)).as("메인 섬 이전·강퇴 알림이 없다 — user %s", user).isZero();
        }

        // 주민 목록 사건은 일반 주민 먼저, 방장이 마지막이다.
        List<String> removed = jdbc.queryForList("select params->>'memberUserId' from event_outbox"
                + " where type='island.members.updated' and aggregate_id=? and params->>'changeKind'='MEMBER_REMOVED'"
                + " order by version", String.class, island.toString());
        assertThat(removed).hasSize(5).last().isEqualTo(host.toString());
        assertThat(count("select count(*) from event_outbox where type='island.updated' and aggregate_id=?"
                + " and params->>'changeKind'='CLOSED'", island.toString())).isEqualTo(1);
    }

    @Test
    @DisplayName("집중 중인 주민은 미정산으로 끝나고, 다른 섬에서 새 집중을 열 수 있다")
    void residentMidFocusEndsWithoutRewardAndCanFocusAgain() {
        UUID host = newUser();
        UUID island = hallLessIsland(host, false);
        UUID focuser = newUser();
        joinAndMoveTo(focuser, island);
        FocusSessionView started = start(focuser, island);

        cleanup.execute();

        assertThat(jdbc.queryForObject("select lifecycle from focus_session_details where session_id=?", String.class,
                started.id())).isEqualTo("MEMBERSHIP_LOST");
        assertThat(jdbc.queryForObject("select status from focus_sessions where id=?", String.class, started.id()))
                .as("기본 마커는 통계 제외로 닫힌다 — 미정산").isEqualTo("AUTO_CLOSED");
        assertThat(count("select count(*) from focus_settlements where session_id=?", started.id())).isZero();
        UUID next = islands.create(focuser, new CreateIslandCommandRequest("새출발섬", null, false, null),
                UUID.randomUUID()).id();
        assertThat(start(focuser, next).status()).isEqualTo(FocusSessionView.STATUS_ACTIVE);
    }

    @Test
    @DisplayName("짓는 중(BUILDING)인 회관이 있는 섬은 대상이 아니다")
    void islandWithAHallUnderConstructionIsLeftAlone() {
        UUID host = newUser();
        UUID island = hallLessIsland(host, false);
        jdbc.update("insert into island_facilities (island_id, building_id, status, cost, cost_revision)"
                + " values (?, 'hall', 'BUILDING', 1, 1)", island);

        assertThat(cleanup.dryRun().summary().islandIds()).doesNotContain(island);
        assertThat(cleanup.execute().outcomes()).extracting(HallLessIslandCleanupView.Outcome::islandId)
                .doesNotContain(island);
        assertThat(count("select count(*) from islands where id=? and status<>'ENDED' and deleted_at is null",
                island)).isEqualTo(1);
        assertThat(count("select count(*) from group_members where group_id=? and is_left=false", island))
                .isEqualTo(1);
    }

    @Test
    @DisplayName("파라미터가 없으면 dry-run 이다 — 영향을 세기만 하고 아무것도 바꾸지 않는다. dryRun=false 일 때만 닫는다")
    void dryRunIsTheDefaultAndChangesNothing() throws Exception {
        UUID host = newUser();
        UUID island = hallLessIsland(host, true);
        UUID withHome = newUser();
        islands.create(withHome, new CreateIslandCommandRequest("다른섬", null, false, null), UUID.randomUUID());
        joinAndMoveTo(withHome, island);
        UUID focuser = newUser();
        joinAndMoveTo(focuser, island);
        FocusSessionView focusing = start(focuser, island);
        jdbc.update("update island_wallets set balance=42 where island_id=?", island);
        jdbc.update("insert into island_join_requests (id, island_id, applicant_id) values (?, ?, ?)",
                UUID.randomUUID(), island, newUser());
        promote(island, host, today());
        promote(island, host, today().minusDays(1));
        // 이 섬을 목적지로 항해 중인 다른 사람 — 섬 집중을 바다 항해로 바꿔 심는다.
        UUID sailor = newUser();
        UUID harbor = islands.create(sailor, new CreateIslandCommandRequest("항구섬", null, false, null),
                UUID.randomUUID()).id();
        UUID voyage = start(sailor, harbor).id();
        jdbc.update("update focus_session_details set kind='SEA', sailing_minutes=15, island_id=?,"
                + " membership_epoch_at_start=null where session_id=?", island, voyage);
        // 주민 0명인 옛 무인도 예약 섬.
        UUID reserved = groups.save(Group.builder().name("무인도").description("").maxMembers(15).isPrivate(true)
                .approvalRequired(false).build()).getId();
        jdbc.update("insert into onboarding_islands (user_id, island_id) values (?, ?)", newUser(), reserved);
        long outboxBefore = count("select count(*) from event_outbox");

        mvc.perform(post(PATH).header("Authorization", "Bearer " + OPS_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.dryRun").value(true))
                .andExpect(jsonPath("$.summary.islandCount").value(2))
                .andExpect(jsonPath("$.summary.residents").value(3))
                .andExpect(jsonPath("$.summary.residentsWithAnotherIsland").value(1))
                .andExpect(jsonPath("$.summary.residentsGoingToSea").value(2))
                .andExpect(jsonPath("$.summary.activeIslandFocusSessions").value(1))
                .andExpect(jsonPath("$.summary.activeSeaVoyages").value(1))
                .andExpect(jsonPath("$.summary.walletFish").value(42))
                .andExpect(jsonPath("$.summary.pendingJoinRequests").value(1))
                .andExpect(jsonPath("$.summary.upcomingPromotions").value(1))
                .andExpect(jsonPath("$.summary.onboardingReservations").value(1))
                .andExpect(jsonPath("$.outcomes").isEmpty());

        assertThat(count("select count(*) from event_outbox")).isEqualTo(outboxBefore);
        assertThat(count("select count(*) from islands where id in (?, ?) and status<>'ENDED' and deleted_at is null",
                island, reserved)).isEqualTo(2);
        assertThat(count("select count(*) from group_members where group_id=? and is_left=false", island))
                .isEqualTo(3);
        assertThat(count("select balance from island_wallets where island_id=?", island)).isEqualTo(42);
        assertThat(context(focuser)).containsEntry("current_island_id", island);
        assertThat(jdbc.queryForObject("select lifecycle from focus_session_details where session_id=?", String.class,
                focusing.id())).isEqualTo("ACTIVE");

        mvc.perform(post(PATH).param("dryRun", "false").header("Authorization", "Bearer " + OPS_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.dryRun").value(false))
                .andExpect(jsonPath("$.outcomes.length()").value(2))
                .andExpect(jsonPath("$.outcomes[*].result").value(everyItem(is("CLOSED"))));

        assertThat(count("select count(*) from islands where id in (?, ?) and status='ENDED'", island, reserved))
                .isEqualTo(2);
        assertThat(count("select count(*) from onboarding_islands where island_id=?", reserved)).isZero();
        assertThat(jdbc.queryForObject("select lifecycle from focus_session_details where session_id=?", String.class,
                voyage)).as("목적지가 닫혀도 항해는 끝내지 않는다 — 섬이 닫힐 때의 기존 동작").isEqualTo("ACTIVE");
        assertThat(cleanup.dryRun().summary().islandCount()).isZero();
    }

    @Test
    @DisplayName("운영자 토큰이 아니면 부를 수 없다")
    void onlyTheOpsCallerCanCall() throws Exception {
        mvc.perform(post(PATH).header("Authorization", "Bearer " + BIZ_TOKEN)).andExpect(status().isForbidden());
        mvc.perform(post(PATH)).andExpect(status().isUnauthorized());
    }

    // ---------------------------------------------------------------- 도구

    private UUID newUser() {
        return jwt.extractUserId(auth.guestSession(UUID.randomUUID().toString()).accessToken());
    }

    /** 방장이 {@code POST /islands} 로 만든 섬에서 회관 행을 지운다 — 회관 시드 이전에 생긴 섬과 같은 모양이다. */
    private UUID hallLessIsland(UUID host, boolean approvalRequired) {
        UUID island = islands.create(host, new CreateIslandCommandRequest("회관없는섬", null, approvalRequired, null),
                UUID.randomUUID()).id();
        jdbc.update("delete from island_facilities where island_id=?", island);
        return island;
    }

    private void join(UUID userId, UUID islandId) {
        Group island = groups.findById(islandId).orElseThrow();
        members.save(GroupMember.builder().user(users.getCaller(userId)).group(island).role(GroupMemberRole.MEMBER)
                .build());
    }

    /** 주민으로 넣고 그 섬에 도착해 현재 섬으로 둔다 — 출발 섬 전망대 조건은 이 테스트의 관심이 아니다. */
    private void joinAndMoveTo(UUID userId, UUID islandId) {
        join(userId, islandId);
        jdbc.update("insert into island_arrivals (user_id, island_id, first_arrived_at, last_arrived_at)"
                + " values (?, ?, now(), now()) on conflict do nothing", userId, islandId);
        jdbc.update("insert into user_island_contexts (user_id, current_island_id) values (?, ?)"
                + " on conflict (user_id) do update set current_island_id=excluded.current_island_id,"
                + " loss_reason=null", userId, islandId);
    }

    private FocusSessionView start(UUID userId, UUID islandId) {
        return focus.start(userId, new FocusSessionStartCommandRequest(islandId, "알고리즘", 25), UUID.randomUUID());
    }

    private void promote(UUID islandId, UUID host, LocalDate issueDate) {
        jdbc.update("insert into island_promotions (id, island_id, issue_date, applied_by, applied_at, updated_at,"
                + " body, layout) values (?, ?, ?, ?, now(), now(), '홍보', '{}'::jsonb)",
                UUID.randomUUID(), islandId, issueDate, host);
    }

    private static LocalDate today() {
        return LocalDate.now(ZoneId.of("Asia/Seoul"));
    }

    private Map<String, Object> context(UUID userId) {
        return jdbc.queryForMap("select current_island_id, loss_reason from user_island_contexts where user_id=?",
                userId);
    }

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0L : value;
    }
}
