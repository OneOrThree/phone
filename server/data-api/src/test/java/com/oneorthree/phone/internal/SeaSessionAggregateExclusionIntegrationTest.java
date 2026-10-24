package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.focus.dto.session.FocusSessionStartCommandRequest;
import com.oneorthree.phone.focus.dto.session.FocusSessionView;
import com.oneorthree.phone.focus.dto.session.FocusVersionedCommandRequest;
import com.oneorthree.phone.focus.dto.session.SeaFocusSessionStartCommandRequest;
import com.oneorthree.phone.focus.repository.FocusFishEarningsRepository;
import com.oneorthree.phone.focus.repository.FocusRewardAccrualRepository;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.service.FocusSessionLifecycleService;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserQueryService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 섬 단위 집계가 바다 세션을 섬 기여로 세지 않는다 (GROMO-2299 감사) — 세션의 {@code island_id} 로 섬을 묶는 쿼리는
 * 바다 세션의 목적지 id 를 보면 안 된다. 같은 섬 주민이 «목적지가 그 섬인» 바다 세션을 마쳐도 섬 집중 시간·기록판·주간
 * 랭킹 분자·물고기 수익·하루 상한·진행 중 목록에 한 줄도 잡히지 않는다. 섬 세션 대조군은 같은 쿼리에 잡힌다.
 */
@SpringBootTest
class SeaSessionAggregateExclusionIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("focus.session.start-enabled", () -> true);
    }

    @Autowired
    FocusSessionLifecycleService focus;
    @Autowired
    FocusSessionDetailRepository details;
    @Autowired
    FocusSessionIntervalRepository intervals;
    @Autowired
    FocusFishEarningsRepository earnings;
    @Autowired
    FocusRewardAccrualRepository accruals;
    @Autowired
    IslandMembershipService islands;
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

    @Test
    @DisplayName("목적지가 소속 섬인 바다 세션은 그 섬의 집중 구간·기록판·주간 분자·수익·하루 상한·진행 목록에 안 들어간다")
    void seaSessionsNeverCountTowardTheDestinationIsland() {
        UUID owner = newUser();
        UUID island = islands.create(owner, new CreateIslandCommandRequest("집계섬", null, false, null),
                UUID.randomUUID()).id();
        UUID voyager = newUser();
        UUID resident = newUser();
        join(voyager, island);
        join(resident, island);

        // 대조군: 섬 세션을 마친 주민.
        FocusSessionView control = focus.start(resident, new FocusSessionStartCommandRequest(island, "공부", 25),
                UUID.randomUUID());
        backdate(control.id(), 600);
        // 바다 세션: 목적지가 같은 섬. 진행 중 목록 쿼리를 위해 먼저 ACTIVE 상태로 본다.
        FocusSessionView sea = focus.startSea(voyager, new SeaFocusSessionStartCommandRequest(island),
                UUID.randomUUID());
        backdate(sea.id(), 1200);
        jdbc.update("insert into focus_reward_accruals (id, session_id, accrued_on, earned_fish) values (?, ?, ?, 5)",
                UUID.randomUUID(), sea.id(), LocalDate.now(ZoneOffset.UTC));
        jdbc.update("insert into focus_reward_accruals (id, session_id, accrued_on, earned_fish) values (?, ?, ?, 7)",
                UUID.randomUUID(), control.id(), LocalDate.now(ZoneOffset.UTC));

        Instant from = Instant.now().minusSeconds(3 * 3600);
        Instant to = Instant.now().plusSeconds(3600);
        List<FocusSessionLifecycle> active = List.of(FocusSessionLifecycle.ACTIVE);
        assertThat(details.findIslandIdsWithAtLeast(FocusSessionLifecycle.ACTIVE, 2))
                .as("ACTIVE 가 2건 이상인 섬 — 섬 세션 1 + 바다 1 이라 후보가 아니다").doesNotContain(island);
        assertThat(details.findSessionIdsByIslandIdAndLifecycle(island, FocusSessionLifecycle.ACTIVE))
                .containsExactly(control.id());
        assertThat(intervals.findActiveSpansOnIsland(island, List.of(voyager, resident), active, from, to))
                .extracting(FocusSessionIntervalRepository.ActiveSpan::getUserId).containsOnly(resident);
        assertThat(details.findOverlappingOnIsland(island, List.of(voyager, resident), active, from, to))
                .extracting(d -> d.getUserId()).containsOnly(resident);
        assertThat(earnings.sumEarnedFishByUser(island, List.of(voyager, resident)))
                .extracting(FocusFishEarningsRepository.UserEarnings::getUserId).containsExactly(resident);
        assertThat(accruals.sumEarnedFishOnDay(voyager, island, LocalDate.now(ZoneOffset.UTC)))
                .as("하루 상한은 섬 기준 — 바다 적립은 세지 않는다").isZero();
        assertThat(accruals.sumEarnedFishOnDay(resident, island, LocalDate.now(ZoneOffset.UTC))).isEqualTo(7);

        // 둘 다 끝낸 뒤의 주간 분자(COMPLETED 만) — 섬 세션 분만 잡힌다.
        focus.finish(resident, control.id(), new FocusVersionedCommandRequest(1L), UUID.randomUUID());
        focus.finish(voyager, sea.id(), new FocusVersionedCommandRequest(1L), UUID.randomUUID());
        // 8) 자진 탈퇴 가드 — 바다 세션 중인 주민은 진행 중 세션으로 세지 않는다(강퇴 경로와 같은 기준).
        UUID sailing = newUser();
        join(sailing, island);
        focus.startSea(sailing, new SeaFocusSessionStartCommandRequest(island), UUID.randomUUID());
        assertThat(details.existsByUserIdAndIslandIdAndLifecycleIn(sailing, island, active)).isFalse();
        var seconds = details.sumIslandActiveSeconds(from, to);
        assertThat(seconds).filteredOn(row -> island.equals(row.getIslandId())).hasSize(1);
        long islandSeconds = seconds.stream().filter(row -> island.equals(row.getIslandId()))
                .mapToLong(FocusSessionDetailRepository.IslandFocusSeconds::getSeconds).sum();
        assertThat(islandSeconds).as("섬 세션 10분만 — 바다 20분은 더하지 않는다").isBetween(600L, 640L);
    }

    private void join(UUID userId, UUID islandId) {
        members.save(GroupMember.builder().user(users.getCaller(userId)).group(groups.findById(islandId).orElseThrow())
                .role(GroupMemberRole.MEMBER).build());
        islands.arrive(userId, islandId, UUID.randomUUID());
    }

    private UUID newUser() {
        return jwt.extractUserId(auth.guestSession(java.util.UUID.randomUUID().toString()).accessToken());
    }

    private void backdate(UUID sessionId, long seconds) {
        Timestamp at = Timestamp.from(Instant.now().minusSeconds(seconds));
        jdbc.update("update focus_sessions set started_at=? where id=?", at, sessionId);
        jdbc.update("update focus_session_details set last_transition_at=? where session_id=?", at, sessionId);
        jdbc.update("update focus_session_intervals set started_at=? where session_id=? and ordinal=1", at,
                sessionId);
    }
}
