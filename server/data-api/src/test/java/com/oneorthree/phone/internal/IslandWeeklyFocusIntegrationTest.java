package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.focus.dto.session.FocusSessionStartCommandRequest;
import com.oneorthree.phone.focus.dto.session.FocusSessionView;
import com.oneorthree.phone.focus.dto.session.FocusVersionedCommandRequest;
import com.oneorthree.phone.focus.dto.session.SeaFocusSessionStartCommandRequest;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.service.FocusSessionLifecycleService;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.ranking.repository.IslandWeeklyFocusRepository;
import com.oneorthree.phone.ranking.service.IslandWeeklyFocusService;
import com.oneorthree.phone.ranking.support.RankingWeek;
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
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 주간 섬 랭킹 분자 read model 의 정합성 (GROMO-2343) — 운영 완료 경로(start·pause·resume·finish)로 세션을 끝낸 뒤
 * read model 이 정본 집계({@code FocusSessionDetailRepository.sumIslandActiveSeconds})와 같은지, 그리고 정본으로
 * 다시 채운 값({@link IslandWeeklyFocusService#recompute})과 μs 까지 같은지 본다.
 *
 * <p>심는 것: 주 경계를 걸친 세션(중간 휴식 포함) · 다른 섬 세션 · 1초 미만 세션 · 같은 섬이 목적지인 바다 세션 ·
 * 끝나지 않은 세션 · 같은 세션의 두 번째 finish.
 */
@SpringBootTest
class IslandWeeklyFocusIntegrationTest {

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
    IslandWeeklyFocusRepository weeklyFocusRows;
    @Autowired
    IslandWeeklyFocusService weeklyFocus;
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
    @DisplayName("완료 전이 가산 = 정본 집계 = 재계산 — 주 경계·휴식·다른 섬·1초 미만·바다·진행 중·두 번째 finish")
    void completionIncrementsMatchTheCanonicalAggregate() {
        LocalDate thisWeek = RankingWeek.weekStart(Instant.now());
        LocalDate lastWeek = thisWeek.minusWeeks(1);
        Instant boundary = RankingWeek.startInstant(thisWeek);

        UUID ownerA = newUser();
        UUID islandA = island(ownerA, "가산섬A");
        UUID ownerB = newUser();
        UUID islandB = island(ownerB, "가산섬B");
        UUID ownerC = newUser();
        UUID islandC = island(ownerC, "가산섬C");
        UUID residentA = newUser();
        join(residentA, islandA);
        UUID voyager = newUser();
        join(voyager, islandA);
        UUID runner = newUser();
        join(runner, islandA);

        // ① 주 경계를 걸친 세션 — 첫 ACTIVE 가 지난 주 마지막 10분부터다. 중간에 휴식을 넣는다.
        FocusSessionView straddling = start(ownerA, islandA);
        backdate(straddling.id(), boundary.minusSeconds(600));
        long sinceBoundary = Instant.now().getEpochSecond() - boundary.getEpochSecond();
        focus.pause(ownerA, straddling.id(), new FocusVersionedCommandRequest(1L), UUID.randomUUID());
        focus.resume(ownerA, straddling.id(), new FocusVersionedCommandRequest(2L), UUID.randomUUID());
        focus.finish(ownerA, straddling.id(), new FocusVersionedCommandRequest(3L), UUID.randomUUID());
        // ② 같은 섬 주민의 이번 주 세션 20분
        FocusSessionView plain = start(residentA, islandA);
        backdate(plain.id(), Instant.now().minusSeconds(1200));
        focus.finish(residentA, plain.id(), new FocusVersionedCommandRequest(1L), UUID.randomUUID());
        // ③ 다른 섬
        FocusSessionView other = start(ownerB, islandB);
        backdate(other.id(), Instant.now().minusSeconds(900));
        focus.finish(ownerB, other.id(), new FocusVersionedCommandRequest(1L), UUID.randomUUID());
        // ④ 1초 미만으로 끝난 세션 — 행은 생기지만 내린 뒤 0초라 랭킹에 나오지 않는다
        FocusSessionView blink = start(ownerC, islandC);
        focus.finish(ownerC, blink.id(), new FocusVersionedCommandRequest(1L), UUID.randomUUID());
        // ⑤ 목적지가 섬 A 인 바다 세션 — 섬 기여가 아니다
        FocusSessionView sea = focus.startSea(voyager, new SeaFocusSessionStartCommandRequest(islandA),
                UUID.randomUUID());
        backdate(sea.id(), Instant.now().minusSeconds(1800));
        focus.finish(voyager, sea.id(), new FocusVersionedCommandRequest(1L), UUID.randomUUID());
        // ⑥ 끝나지 않은 세션
        FocusSessionView running = start(runner, islandA);
        backdate(running.id(), Instant.now().minusSeconds(3000));
        // ⑦ 같은 세션의 두 번째 finish(새 멱등 키) — 이미 끝난 결과를 돌려줄 뿐 다시 더하지 않는다
        focus.finish(residentA, plain.id(), new FocusVersionedCommandRequest(1L), UUID.randomUUID());

        Set<UUID> ours = Set.of(islandA, islandB, islandC);
        for (LocalDate week : List.of(lastWeek, thisWeek)) {
            assertThat(readModel(week, ours)).as("read model == 정본 집계, week=" + week)
                    .isEqualTo(canonical(week, ours));
        }
        // 값 단언은 주가 바뀐 지 1시간이 지났을 때만 — 그 전에는 «지금 − 20분» 세션도 경계를 걸친다.
        if (Instant.now().isAfter(boundary.plusSeconds(3600))) {
            assertThat(readModel(lastWeek, ours)).as("경계 앞 10분은 지난 주 몫").containsOnlyKeys(islandA);
            assertThat(readModel(lastWeek, ours).get(islandA)).isBetween(600L, 601L);
            assertThat(readModel(thisWeek, ours)).as("1초 미만 섬은 빠진다").containsOnlyKeys(islandA, islandB);
            // 이번 주 몫 = 걸친 세션의 경계 뒤 몫(≈ 경계부터 pause 까지) + 주민 세션 20분.
            assertThat(readModel(thisWeek, ours).get(islandA)).as("바다·진행 중·두 번째 finish 는 더하지 않는다")
                    .isBetween(sinceBoundary + 1200L, sinceBoundary + 1260L);
        }

        Map<String, Long> incremented = rawMicros(ours);
        assertThat(incremented).as("1초 미만 섬도 μs 는 남는다").containsKey(thisWeek + "/" + islandC);
        weeklyFocus.recompute(lastWeek);
        weeklyFocus.recompute(thisWeek);
        assertThat(rawMicros(ours)).as("가산 결과 == 정본 재계산 (μs 단위)").isEqualTo(incremented);
    }

    private Map<UUID, Long> readModel(LocalDate week, Set<UUID> ours) {
        Map<UUID, Long> result = new HashMap<>();
        weeklyFocusRows.findSeconds(week).stream().filter(row -> ours.contains(row.getIslandId()))
                .forEach(row -> result.put(row.getIslandId(), row.getSeconds()));
        return result;
    }

    private Map<UUID, Long> canonical(LocalDate week, Set<UUID> ours) {
        Map<UUID, Long> result = new HashMap<>();
        details.sumIslandActiveSeconds(RankingWeek.startInstant(week), RankingWeek.endInstant(week)).stream()
                .filter(row -> ours.contains(row.getIslandId()))
                .forEach(row -> result.put(row.getIslandId(), row.getSeconds()));
        return result;
    }

    private Map<String, Long> rawMicros(Set<UUID> ours) {
        Map<String, Long> result = new HashMap<>();
        jdbc.query("select week_start, island_id, active_micros from island_weekly_focus", row -> {
            UUID islandId = row.getObject("island_id", UUID.class);
            if (ours.contains(islandId)) {
                result.put(row.getDate("week_start").toLocalDate() + "/" + islandId, row.getLong("active_micros"));
            }
        });
        return result;
    }

    private FocusSessionView start(UUID userId, UUID islandId) {
        return focus.start(userId, new FocusSessionStartCommandRequest(islandId, "공부", 25), UUID.randomUUID());
    }

    private UUID island(UUID owner, String name) {
        return islands.create(owner, new CreateIslandCommandRequest(name, null, false, null), UUID.randomUUID()).id();
    }

    private void join(UUID userId, UUID islandId) {
        members.save(GroupMember.builder().user(users.getCaller(userId)).group(groups.findById(islandId).orElseThrow())
                .role(GroupMemberRole.MEMBER).build());
        islands.arrive(userId, islandId, UUID.randomUUID());
    }

    private UUID newUser() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
    }

    /** 진행 중 세션의 시작을 과거로 옮긴다 — 첫 ACTIVE 구간이 열려 있을 때만 부른다. */
    private void backdate(UUID sessionId, Instant at) {
        Timestamp ts = Timestamp.from(at);
        jdbc.update("update focus_sessions set started_at=? where id=?", ts, sessionId);
        jdbc.update("update focus_session_details set last_transition_at=? where session_id=?", ts, sessionId);
        jdbc.update("update focus_session_intervals set started_at=? where session_id=? and ordinal=1", ts,
                sessionId);
    }
}
