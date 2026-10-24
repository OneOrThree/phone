package com.oneorthree.phone.internal;

import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.internal.service.IslandFocusAverageSnapshotService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
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
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 섬별 7일 평균의 운영 경로 (GROMO-2280) — 운영자 수동 실행(내부 관리 API)과 오래된 행 정리를 실 Flyway PostgreSQL 위에서
 * 본다. 수동 실행은 생산 진입점(MockMvc — 등록된 {@code InternalAuthFilter} 가 그대로 붙는다)으로 부르고 시계는 고정한다.
 *
 * <p>스냅샷은 DB 의 모든 섬을 훑으므로 테스트마다 2주씩 떨어진 다른 날을 쓴다. 정리는 표 전체가 대상이라 이 컨텍스트
 * 전용 DB 에서 다른 테스트의 날짜와 겹치지 않는 먼 과거(2001년)에 행을 직접 심는다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class IslandFocusAverageOpsIntegrationTest {

    private static final String PATH = "/internal/admin/island-focus-averages/snapshots";
    private static final String OPS_TOKEN = "test-ops-to-data";
    private static final String BIZ_TOKEN = "test-biz-to-data";
    private static final LocalDate FIRST_DATE = LocalDate.of(2036, 1, 7);
    private static final AtomicInteger DATE_SEQ = new AtomicInteger();

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.ops.token", () -> OPS_TOKEN);
        registry.add("internal.api.callers.ops.optional", () -> true);
        registry.add("internal.api.callers.ops.allow[0]", () -> "POST " + PATH);
        registry.add("internal.api.callers.business.token", () -> BIZ_TOKEN);
        registry.add("internal.api.callers.business.allow[0]", () -> "GET /internal/users/*/activation");
    }

    @MockitoBean
    Clock clock;
    @Autowired
    MockMvc mvc;
    @Autowired
    IslandFocusAverageSnapshotService service;
    @Autowired
    GroupRepository islands;
    @Autowired
    JdbcTemplate jdbc;

    private final AtomicReference<Instant> now = new AtomicReference<>();
    /** 이 테스트의 날짜(KST). */
    private LocalDate date;

    @BeforeEach
    void setUp() {
        date = FIRST_DATE.plusDays(14L * DATE_SEQ.getAndIncrement());
        now.set(kst(date, 8, 0));
        when(clock.instant()).thenAnswer(invocation -> now.get());
        when(clock.getZone()).thenReturn(ZonePolicy.KST);
        when(clock.withZone(any())).thenAnswer(invocation -> Clock.fixed(now.get(), invocation.getArgument(0)));
        island();
    }

    // ---------------------------------------------------------------- 수동 실행

    @Test
    @DisplayName("ops 가 부르면 가장 최근에 닫힌 날(07:00 KST 정각이면 그날)을 적고, 두 번 불러도 행이 늘거나 바뀌지 않는다")
    void opsSnapshotIsIdempotent() throws Exception {
        now.set(kst(date, 7, 0));
        int alive = aliveIslandCount();

        mvc.perform(post(PATH).header("Authorization", "Bearer " + OPS_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.snapshotDate").value(date.toString()))
                .andExpect(jsonPath("$.inserted").value(alive));
        List<String> first = rowsOn(date);
        assertThat(first).hasSize(alive);

        mvc.perform(post(PATH).param("date", date.toString()).header("Authorization", "Bearer " + OPS_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.snapshotDate").value(date.toString()))
                .andExpect(jsonPath("$.inserted").value(0));
        assertThat(rowsOn(date)).as("행 수도 computed_at 도 그대로다").isEqualTo(first);
    }

    @Test
    @DisplayName("07:00 KST 전에는 그날을 적지 않는다(400 · 행 없음) — date 를 빼면 전날을 적는다")
    void beforeSevenKstTheLastClosedDateIsYesterday() throws Exception {
        now.set(kst(date, 6, 59));

        mvc.perform(post(PATH).param("date", date.toString()).header("Authorization", "Bearer " + OPS_TOKEN))
                .andExpect(status().isBadRequest());
        assertThat(rowsOn(date)).as("덜 닫힌 창의 값이 PK 에 박히지 않는다").isEmpty();

        mvc.perform(post(PATH).header("Authorization", "Bearer " + OPS_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.snapshotDate").value(date.minusDays(1).toString()));
        assertThat(rowsOn(date.minusDays(1))).hasSize(aliveIslandCount());
    }

    @Test
    @DisplayName("ops 토큰만 통과한다 — business 토큰은 허용목록 밖이라 403, 토큰이 없으면 401")
    void onlyTheOpsCallerReachesTheSnapshot() throws Exception {
        mvc.perform(post(PATH).header("Authorization", "Bearer " + BIZ_TOKEN)).andExpect(status().isForbidden());
        mvc.perform(post(PATH)).andExpect(status().isUnauthorized());

        assertThat(rowsOn(date)).isEmpty();
    }

    // ---------------------------------------------------------------- 정리

    @Test
    @DisplayName("정리는 보존 일수(90일)보다 오래된 행을 지우되 섬마다 최신 행은 cutoff 를 넘어도 남긴다 — 섬끼리는 영향이 없다")
    void cleanupKeepsTheLatestRowPerIsland() {
        LocalDate asOf = LocalDate.of(2001, 6, 1);
        UUID refreshed = island();
        UUID stale = island();
        UUID boundary = island();
        seed(refreshed, asOf.minusDays(120), asOf.minusDays(91), asOf.minusDays(1));
        seed(stale, asOf.minusDays(120), asOf.minusDays(100));
        seed(boundary, asOf.minusDays(90), asOf.minusDays(10));

        assertThat(service.cleanup(asOf)).isEqualTo(3);

        assertThat(datesOf(refreshed)).containsExactly(asOf.minusDays(1).toString());
        assertThat(datesOf(stale)).as("새 행이 없는 섬의 마지막 행은 cutoff 보다 오래됐어도 남는다")
                .containsExactly(asOf.minusDays(100).toString());
        assertThat(datesOf(boundary)).as("cutoff 당일 행은 지우지 않는다")
                .containsExactly(asOf.minusDays(90).toString(), asOf.minusDays(10).toString());
        assertThat(service.cleanup(asOf)).as("다시 돌려도 지울 것이 없다").isZero();
    }

    // ---------------------------------------------------------------- 도구

    private UUID island() {
        return islands.save(Group.builder().name("운영섬").maxMembers(15).build()).getId();
    }

    private static Instant kst(LocalDate day, int hour, int minute) {
        return day.atTime(hour, minute).atZone(ZonePolicy.KST).toInstant();
    }

    private int aliveIslandCount() {
        return jdbc.queryForObject("SELECT count(*) FROM islands WHERE deleted_at IS NULL AND status <> 'ENDED'",
                Integer.class);
    }

    /** 그날 행을 «섬 id @ computed_at» 으로 — 다시 불러 행이 덮이면 computed_at 이 바뀐다. */
    private List<String> rowsOn(LocalDate day) {
        return jdbc.queryForList("SELECT island_id::text || '@' || computed_at::text FROM island_focus_averages "
                + "WHERE snapshot_date = ? ORDER BY island_id", String.class, day);
    }

    private void seed(UUID islandId, LocalDate... days) {
        for (LocalDate day : days) {
            jdbc.update("INSERT INTO island_focus_averages (snapshot_date, island_id, member_count, "
                    + "avg_minutes_per_member_day) VALUES (?, ?, 1, 10)", day, islandId);
        }
    }

    private List<String> datesOf(UUID islandId) {
        return jdbc.queryForList("SELECT snapshot_date::text FROM island_focus_averages WHERE island_id = ? "
                + "ORDER BY snapshot_date", String.class, islandId);
    }
}
