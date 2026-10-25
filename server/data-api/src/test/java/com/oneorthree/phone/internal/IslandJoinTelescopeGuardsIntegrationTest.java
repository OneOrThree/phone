package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.dto.JoinIslandCommandRequest;
import com.oneorthree.phone.internal.dto.JoinIslandResultView;
import com.oneorthree.phone.internal.service.IslandJoinService;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 망원경 가입은 현재 섬을 옮기지 않으므로 이동 가드(진행 중 집중·출발 섬 전망대)를 타지 않는다 (GROMO-2260).
 *
 * <p>전망대 판정이 실제 {@code island_facilities} 를 보도록 시설 게이트를 켠다 — 꺼 두면 전망대가 늘 열린 것으로
 * 판정돼 «잠긴 출발 섬» 을 만들 수 없다. 시드는 생산 서비스와 SQL 로만 만든다.
 */
@SpringBootTest
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class IslandJoinTelescopeGuardsIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("notification.dispatch.mode", () -> "OUTBOX");
        registry.add("construction.facility-gates.enforce", () -> true);
    }

    @Autowired
    IslandMembershipService islands;
    @Autowired
    IslandJoinService joins;
    @Autowired
    GroupRepository groups;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    JdbcTemplate jdbc;

    @Test
    @DisplayName("출발 섬 전망대가 잠겨 있어도 망원경 가입은 된다 — 방문 가입은 종전대로 403")
    void lockedDepartureObservatoryDoesNotBlockATelescopeJoin() {
        UUID user = newUser();
        // 막 만든 섬은 전망대가 없다 — 지금 서 있는 섬이 곧 «잠긴 출발 섬» 이다.
        UUID home = islands.create(user, new CreateIslandCommandRequest("잠긴섬", null, false, null),
                UUID.randomUUID()).id();
        UUID target = openIsland("너머섬");

        assertThatThrownBy(() -> joins.join(user, target, new JoinIslandCommandRequest(null, "visit"),
                UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.OBSERVATORY_LOCKED);

        JoinIslandResultView joined = joins.join(user, target, new JoinIslandCommandRequest(null, "telescope"),
                UUID.randomUUID());
        assertThat(joined.status()).isEqualTo("active");
        assertThat(joined.currentIslandId()).isEqualTo(home);
        assertThat(currentIsland(user)).as("망원경 가입은 옮기지 않는다").isEqualTo(home);
        assertThat(activeMembership(user, target)).isTrue();
    }

    @Test
    @DisplayName("집중 중이어도 망원경 가입은 된다 — 세션은 그대로, 방문 가입은 종전대로 409")
    void liveFocusSessionDoesNotBlockATelescopeJoin() {
        UUID user = newUser();
        UUID home = islands.create(user, new CreateIslandCommandRequest("집중섬", null, false, null),
                UUID.randomUUID()).id();
        // 출발 섬 전망대는 열어 둔다 — 방문 가입을 막는 것이 집중 가드뿐이게 한다.
        jdbc.update("INSERT INTO island_facilities (island_id, building_id, status, cost, cost_revision)"
                + " VALUES (?, 'tower', 'COMPLETED', 1, 1)", home);
        jdbc.update("INSERT INTO focus_sessions (id, user_id, started_at, total_distraction_seconds) VALUES (?, ?, now(), 0)",
                UUID.randomUUID(), user);
        UUID target = openIsland("집중중가입섬");

        assertThatThrownBy(() -> joins.join(user, target, new JoinIslandCommandRequest(null, "visit"),
                UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", FocusErrorCode.SESSION_IN_PROGRESS);

        JoinIslandResultView joined = joins.join(user, target, new JoinIslandCommandRequest(null, "telescope"),
                UUID.randomUUID());
        assertThat(joined.status()).isEqualTo("active");
        assertThat(currentIsland(user)).isEqualTo(home);
        assertThat(jdbc.queryForObject(
                "select count(*) from focus_sessions where user_id=? and ended_at is null", Long.class, user))
                .as("진행 중 세션은 건드리지 않는다").isEqualTo(1L);
    }

    // ---------------------------------------------------------------- 도구

    private UUID newUser() {
        return jwt.extractUserId(auth.guestSession(java.util.UUID.randomUUID().toString()).accessToken());
    }

    private UUID openIsland(String name) {
        return groups.save(Group.builder().name(name).description(null).maxMembers(10)
                .isPrivate(false).approvalRequired(false).status(GroupStatus.WAITING).build()).getId();
    }

    private boolean activeMembership(UUID userId, UUID islandId) {
        Long count = jdbc.queryForObject("select count(*) from group_members where user_id=? and group_id=?"
                + " and is_left=false", Long.class, userId, islandId);
        return count != null && count == 1L;
    }

    private UUID currentIsland(UUID userId) {
        List<UUID> rows = jdbc.queryForList(
                "select current_island_id from user_island_contexts where user_id=?", UUID.class, userId);
        return rows.isEmpty() ? null : rows.get(0);
    }
}
