package com.oneorthree.phone.ranking.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V130 주간 섬 랭킹 분자 read model 의 실 SQL 검증 (GROMO-2343·2344). 방식은 {@code IslandFocusAverageV114MigrationTest}
 * 선례 — 전용 컨테이너에 Flyway 체인을 실제로 돌린다.
 *
 * <p>보는 것: ① 열·PK 순서(주, 섬)·일요일 CHECK·FK 연쇄 삭제·상세 시간 인덱스, ② V128 까지 올린 스키마의 기존 세션을
 * V130 이 «원본 집계와 같은 술어»로 백필한다 — 주 경계를 걸친 구간은 주마다 나뉘고, 휴식·진행 중·바다·포기 세션은
 * 빠진다, ③ 빈 DB 의 전체 경로.
 */
class IslandWeeklyFocusV130MigrationTest {

    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    @BeforeEach
    void resetSchema() {
        JdbcTemplate jdbc = jdbc();
        jdbc.execute("DROP SCHEMA public CASCADE");
        jdbc.execute("CREATE SCHEMA public");
    }

    @Test
    @DisplayName("열·PK 순서(주, 섬)·일요일 CHECK·FK 연쇄 삭제와 상세 (user_id, island_id, last_transition_at) 인덱스가 생긴다")
    void tableShape() {
        migrate(MigrationVersion.fromVersion("130"));
        JdbcTemplate jdbc = jdbc();

        Map<String, Map<String, Object>> columns = new HashMap<>();
        jdbc.queryForList("SELECT column_name, data_type, is_nullable FROM information_schema.columns "
                + "WHERE table_name = 'island_weekly_focus'")
                .forEach(row -> columns.put((String) row.get("column_name"), row));
        assertThat(columns).containsOnlyKeys("week_start", "island_id", "active_micros", "updated_at");
        assertThat(columns.get("week_start")).containsEntry("data_type", "date").containsEntry("is_nullable", "NO");
        assertThat(columns.get("island_id")).containsEntry("data_type", "uuid").containsEntry("is_nullable", "NO");
        assertThat(columns.get("active_micros")).containsEntry("data_type", "bigint")
                .containsEntry("is_nullable", "NO");
        assertThat(columns.get("updated_at")).containsEntry("data_type", "timestamp with time zone");

        assertThat(jdbc.queryForList("SELECT column_name FROM information_schema.key_column_usage "
                + "WHERE constraint_name = 'island_weekly_focus_pk' ORDER BY ordinal_position", String.class))
                .containsExactly("week_start", "island_id");
        assertThat(jdbc.queryForList("SELECT confdeltype::text FROM pg_constraint "
                + "WHERE conrelid = 'island_weekly_focus'::regclass AND contype = 'f'", String.class))
                .containsExactly("c");
        assertThat(jdbc.queryForObject("SELECT indexdef FROM pg_indexes "
                + "WHERE indexname = 'focus_session_details_user_transition_idx'", String.class))
                .contains("(user_id, island_id, last_transition_at)");

        UUID islandId = island(jdbc);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO island_weekly_focus (week_start, island_id) "
                + "VALUES (DATE '2034-05-08', ?)", islandId)).as("월요일 주는 거절").hasMessageContaining("sunday_ck");
        jdbc.update("INSERT INTO island_weekly_focus (week_start, island_id) VALUES (DATE '2034-05-07', ?)",
                islandId);
        jdbc.update("DELETE FROM groups WHERE id = ?", islandId);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM island_weekly_focus", Integer.class)).isZero();
    }

    @Test
    @DisplayName("V128 의 기존 세션을 원본 집계와 같은 술어로 백필한다 — 주 경계에서 나누고 휴식·진행 중·바다·포기는 뺀다")
    void backfillsFromTheCanonicalIntervals() {
        migrate(MigrationVersion.fromVersion("128"));
        JdbcTemplate jdbc = jdbc();
        UUID userId = UUID.randomUUID();
        jdbc.update("INSERT INTO users (id, is_guest) VALUES (?, true)", userId);
        UUID home = island(jdbc);
        UUID other = island(jdbc);

        // 2034-05-07(일) 00:00Z 경계를 10분 걸친 ACTIVE + 휴식 + 다음 ACTIVE 0.5초
        UUID straddling = session(jdbc, userId, home, "COMPLETED", "ISLAND");
        interval(jdbc, straddling, 1, "ACTIVE", "2034-05-06T23:50:00Z", "2034-05-07T00:10:00Z");
        interval(jdbc, straddling, 2, "REST", "2034-05-07T00:10:00Z", "2034-05-07T00:20:00Z");
        interval(jdbc, straddling, 3, "ACTIVE", "2034-05-07T00:20:00Z", "2034-05-07T00:20:00.5Z");
        UUID elsewhere = session(jdbc, userId, other, "COMPLETED", "ISLAND");
        interval(jdbc, elsewhere, 1, "ACTIVE", "2034-05-08T10:00:00Z", "2034-05-08T11:00:00Z");
        // 빠져야 하는 것들 — 바다(목적지가 home), 포기, 진행 중
        UUID sea = session(jdbc, userId, home, "COMPLETED", "SEA");
        interval(jdbc, sea, 1, "ACTIVE", "2034-05-08T10:00:00Z", "2034-05-08T11:00:00Z");
        UUID abandoned = session(jdbc, userId, home, "ABANDONED", "ISLAND");
        interval(jdbc, abandoned, 1, "ACTIVE", "2034-05-08T12:00:00Z", "2034-05-08T13:00:00Z");

        migrate(MigrationVersion.fromVersion("130"));

        Map<String, Long> rows = new HashMap<>();
        jdbc.query("SELECT week_start, island_id, active_micros FROM island_weekly_focus", row -> {
            rows.put(row.getDate("week_start").toLocalDate() + "/" + row.getObject("island_id", UUID.class),
                    row.getLong("active_micros"));
        });
        assertThat(rows).containsOnly(
                Map.entry(LocalDate.of(2034, 4, 30) + "/" + home, 600_000_000L),
                Map.entry(LocalDate.of(2034, 5, 7) + "/" + home, 600_500_000L),
                Map.entry(LocalDate.of(2034, 5, 7) + "/" + other, 3_600_000_000L));
    }

    @Test
    @DisplayName("빈 DB 의 전체 마이그레이션 경로에서도 V130 이 성공으로 기록된다")
    void appliesOnEmptyDatabase() {
        migrate(MigrationVersion.LATEST);

        assertThat(jdbc().queryForObject("SELECT success::text FROM flyway_schema_history WHERE version = '130'",
                String.class)).isEqualTo("true");
    }

    private static UUID island(JdbcTemplate jdbc) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO groups (id, name, max_members, is_chat_enabled, invite_permission, status) "
                + "VALUES (?, '섬', 10, true, 'OWNER_ONLY', 'WAITING')", id);
        return id;
    }

    private static UUID session(JdbcTemplate jdbc, UUID userId, UUID islandId, String lifecycle, String kind) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO focus_sessions (id, user_id, started_at, total_distraction_seconds, status) "
                + "VALUES (?, ?, now(), 0, 'COMPLETED')", id, userId);
        jdbc.update("INSERT INTO focus_session_details (session_id, user_id, island_id, membership_epoch_at_start, "
                + "subject, lifecycle, last_transition_at, kind, sailing_minutes) "
                + "VALUES (?, ?, ?, 1, '공부', ?, now(), ?, ?)",
                id, userId, islandId, lifecycle, kind, "SEA".equals(kind) ? 30 : null);
        return id;
    }

    private static void interval(JdbcTemplate jdbc, UUID sessionId, int ordinal, String kind, String start,
                                 String end) {
        jdbc.update("INSERT INTO focus_session_intervals (session_id, ordinal, kind, started_at, ended_at) "
                + "VALUES (?, ?, ?, CAST(? AS timestamptz), CAST(? AS timestamptz))", sessionId, ordinal, kind, start,
                end);
    }

    private void migrate(MigrationVersion target) {
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .target(target)
                .load()
                .migrate();
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
    }
}
