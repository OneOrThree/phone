package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.focus.dto.session.FocusSessionStartCommandRequest;
import com.oneorthree.phone.focus.dto.session.FocusSessionView;
import com.oneorthree.phone.focus.dto.session.FocusVersionedCommandRequest;
import com.oneorthree.phone.focus.dto.session.SeaFocusSessionStartCommandRequest;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.domain.FocusIntervalKind;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.service.FocusSessionLifecycleService;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.ranking.repository.IslandWeeklyFocusRepository;
import com.oneorthree.phone.ranking.service.IslandRankingFreezeService;
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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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
    @Autowired
    PlatformTransactionManager transactionManager;
    @Autowired
    IslandRankingFreezeService freezeService;

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

    /**
     * P1 회귀(codex 사전 게이트) — 재계산과 집중 완료가 같은 섬을 동시에 만져도 교착하지 않는다.
     *
     * <p>A 는 finish 와 같은 모양이다: 섬 {@code groups} 행을 FOR UPDATE 로 잠근 «뒤» 세션을 완료하고 가산한다.
     * B 는 A 가 행을 쥔 사이 그 주를 재계산한다(테이블 잠금 → 정본 INSERT). read model 에 groups FK 가 있으면 B 의
     * INSERT 가 그 행의 KEY SHARE 를 기다리고, A 의 가산은 B 의 테이블 잠금을 기다려 교착(40P01)한다. FK 가 없으면
     * B 는 groups 를 건드리지 않고 끝나고, A 는 그 뒤에 더한다 — 최종 값이 정본과 같다.
     */
    @Test
    @DisplayName("재계산과 완료 가산이 같은 섬에서 겹쳐도 10초 안에 둘 다 끝나고 결과는 정본 집계와 같다")
    void recomputeAndCompletionDoNotDeadlock() throws Exception {
        LocalDate week = RankingWeek.weekStart(Instant.parse("2041-03-06T00:00:00Z"));
        race(week, "recomputeAndCompletionDoNotDeadlock", () -> weeklyFocus.recompute(week));
    }

    /**
     * P1 회귀(codex r1) — 주 마감(재계산 + 분모 동결)도 완료와 교착하지 않는다. 종전에는 둘이 한 트랜잭션이라
     * 재계산의 테이블 잠금이 동결까지 남고, 동결 INSERT 의 {@code island_weekly_member_counts → groups} FK 검사가
     * A 가 쥔 groups 행을 기다렸다. 지금은 재계산 트랜잭션이 커밋된 뒤 동결 트랜잭션이 열린다.
     */
    @Test
    @DisplayName("주 마감(재계산 → 동결)과 완료 가산이 같은 섬에서 겹쳐도 10초 안에 끝나고 분자·분모가 맞다")
    void weekCloseAndCompletionDoNotDeadlock() throws Exception {
        // 동결은 끝난 주만 적는다 — 지난 주를 쓴다(그 주의 다른 섬 행은 이 섬 단언과 무관하다).
        LocalDate week = RankingWeek.weekStart(Instant.parse("2025-06-04T00:00:00Z"));
        UUID islandId = race(week, "weekCloseAndCompletionDoNotDeadlock", () -> freezeService.closeWeek(week));
        assertThat(jdbc.queryForObject("SELECT member_count FROM island_weekly_member_counts "
                + "WHERE week_start = ? AND island_id = ?", Integer.class, java.sql.Date.valueOf(week), islandId))
                .as("주민 1명이 동결됐다 — FK 가 있는 표에 실제로 썼다").isEqualTo(1);
    }

    @Test
    @DisplayName("재계산은 트랜잭션 안에서 부르면 거절한다 — 테이블 잠금이 바깥 트랜잭션 끝까지 남기 때문이다")
    void recomputeRefusesAnOuterTransaction() {
        LocalDate week = RankingWeek.weekStart(Instant.parse("2041-05-08T00:00:00Z"));
        assertThatThrownBy(() -> new TransactionTemplate(transactionManager)
                .executeWithoutResult(status -> weeklyFocus.recompute(week)))
                .isInstanceOf(IllegalStateException.class);
    }

    /**
     * A(완료 모양: groups 행 FOR UPDATE → 잠시 멈춤 → 상태 변경·가산 → 커밋)와 B 를 겹쳐 돌린다. B 는 A 가 행을 쥔
     * 사이에 시작한다. 둘 다 10초 안에 끝나야 하고, 최종 분자는 정본 집계(완료 600 + A 300 = 900초)와 같아야 한다.
     *
     * @return 심은 섬 — 주민(방장) 1명이 있다
     */
    private UUID race(LocalDate week, String label, java.util.function.Supplier<Integer> b) throws Exception {
        Instant base = RankingWeek.startInstant(week).plusSeconds(86_400);
        UUID userId = UUID.randomUUID();
        jdbc.update("INSERT INTO users (id, is_guest) VALUES (?, true)", userId);
        UUID islandId = UUID.randomUUID();
        jdbc.update("INSERT INTO groups (id, name, max_members, is_chat_enabled, invite_permission, status) "
                + "VALUES (?, '교착섬', 10, true, 'OWNER_ONLY', 'WAITING')", islandId);
        jdbc.update("INSERT INTO group_members (id, user_id, group_id, role, notification_enabled, is_left, "
                + "created_at, updated_at) VALUES (?, ?, ?, 'OWNER', true, false, TIMESTAMPTZ '2020-01-01Z', now())",
                UUID.randomUUID(), userId, islandId);
        // 이미 끝난 세션 — 재계산 INSERT 가 이 섬 행을 쓰게 한다.
        seedSession(userId, islandId, "COMPLETED", base, base.plusSeconds(600));
        // A 가 완료시킬 세션 — 구간은 이미 닫혀 있고 상태만 바뀐다.
        Instant aStart = base.plusSeconds(3_600);
        Instant aEnd = aStart.plusSeconds(300);
        UUID finishing = seedSession(userId, islandId, "PAUSED", aStart, aEnd);

        CountDownLatch locked = new CountDownLatch(1);
        CountDownLatch proceed = new CountDownLatch(1);
        long started = System.nanoTime();
        CompletableFuture<Void> a = CompletableFuture.runAsync(() -> new TransactionTemplate(transactionManager)
                .executeWithoutResult(status -> {
                    jdbc.queryForList("SELECT id FROM groups WHERE id = ? FOR UPDATE", islandId);
                    locked.countDown();
                    await(proceed);
                    jdbc.update("UPDATE focus_session_details SET lifecycle = 'COMPLETED' WHERE session_id = ?",
                            finishing);
                    weeklyFocus.addCompleted(islandId, List.of(FocusSessionInterval.builder().sessionId(finishing)
                            .ordinal(1).kind(FocusIntervalKind.ACTIVE).startedAt(aStart).endedAt(aEnd).build()));
                }));
        await(locked);
        CompletableFuture<Integer> bRun = CompletableFuture.supplyAsync(b);
        // B 가 끝났거나 잠금 대기에 들어갈 때까지 기다린 뒤 A 를 진행시킨다.
        for (int i = 0; i < 100 && !bRun.isDone() && waitingLocks() == 0; i++) {
            Thread.sleep(50);
        }
        proceed.countDown();

        CompletableFuture.allOf(a, bRun).get(10, TimeUnit.SECONDS);
        System.out.printf("%s: %d ms%n", label, (System.nanoTime() - started) / 1_000_000);

        long canonical = details.sumIslandActiveSeconds(RankingWeek.startInstant(week), RankingWeek.endInstant(week))
                .stream().filter(row -> row.getIslandId().equals(islandId)).mapToLong(row -> row.getSeconds())
                .sum();
        assertThat(canonical).isEqualTo(900);
        assertThat(readModel(week, Set.of(islandId))).containsExactly(Map.entry(islandId, canonical));
        return islandId;
    }

    private UUID seedSession(UUID userId, UUID islandId, String lifecycle, Instant start, Instant end) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO focus_sessions (id, user_id, started_at, total_distraction_seconds, status) "
                + "VALUES (?, ?, ?, 0, 'COMPLETED')", id, userId, Timestamp.from(start));
        jdbc.update("INSERT INTO focus_session_details (session_id, user_id, island_id, membership_epoch_at_start, "
                + "subject, lifecycle, last_transition_at, kind) VALUES (?, ?, ?, 1, '공부', ?, ?, 'ISLAND')",
                id, userId, islandId, lifecycle, Timestamp.from(end));
        jdbc.update("INSERT INTO focus_session_intervals (session_id, ordinal, kind, started_at, ended_at) "
                + "VALUES (?, 1, 'ACTIVE', ?, ?)", id, Timestamp.from(start), Timestamp.from(end));
        return id;
    }

    private int waitingLocks() {
        Integer waiting = jdbc.queryForObject("SELECT count(*) FROM pg_locks WHERE NOT granted", Integer.class);
        return waiting == null ? 0 : waiting;
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(10, TimeUnit.SECONDS)) {
                throw new IllegalStateException("래치 대기 시간 초과");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
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
