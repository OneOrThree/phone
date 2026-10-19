package com.oneorthree.phone.group.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * V129 확장성 부분 인덱스 둘 (GROMO-2287) — 전용 컨테이너에서 Flyway 체인을 실제로 돌린다(V114 테스트 선례).
 * 보는 것: ① 인덱스가 V129 에서만 생기고 열 순서·부분 조건이 계약대로다, ② 플래너가 방명록 «살아 있는 최근 30개»
 * 와 «섬의 활성 주민» 접근에 새 인덱스를 고른다(행이 적어 순차 읽기가 이기므로 {@code enable_seqscan=off} 로 «탈 수 있음» 만 본다).
 */
class IslandOutsideScalabilityV129MigrationTest {

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
    @DisplayName("V128 까지는 없고 V129 가 두 부분 인덱스를 만든다 — 열 순서·정렬 방향·WHERE")
    void createsPartialIndexes() {
        migrate(MigrationVersion.fromVersion("128"));
        assertThat(indexdef("group_members_active_group_user_idx")).isEmpty();
        assertThat(indexdef("island_guestbook_live_recent_idx")).isEmpty();

        migrate(MigrationVersion.fromVersion("129"));

        assertThat(indexdef("group_members_active_group_user_idx").orElseThrow())
                .contains("(group_id, user_id)").contains("WHERE (is_left = false)");
        assertThat(indexdef("island_guestbook_live_recent_idx").orElseThrow())
                .contains("(island_id, created_at DESC, id DESC)").contains("WHERE (deleted_at IS NULL)");
        // 기존 인덱스는 그대로다(되돌림은 새 마이그레이션의 DROP INDEX).
        assertThat(indexdef("island_guestbook_island_created_idx")).isPresent();
    }

    @Test
    @DisplayName("플래너가 새 인덱스를 고른다 — 방명록 최근 30개(지운 글 100개 사이)와 섬의 활성 주민")
    void plannerCanUseTheIndexes() {
        migrate(MigrationVersion.LATEST);
        JdbcTemplate jdbc = jdbc();
        UUID island = UUID.randomUUID();
        jdbc.update("INSERT INTO groups (id, name, max_members, is_chat_enabled, invite_permission, status) "
                + "VALUES (?, '섬', 10, true, 'OWNER_ONLY', 'WAITING')", island);
        jdbc.update("INSERT INTO users (id, is_guest) SELECT gen_random_uuid(), false FROM generate_series(1, 140)");
        jdbc.update("INSERT INTO island_guestbook_entries (id, island_id, author_id, content, written_on, created_at, deleted_at) "
                + "SELECT gen_random_uuid(), ?, u.id, 'hi', DATE '2034-01-01', now() - (u.rn || ' hours')::interval, "
                + "CASE WHEN u.rn > 40 THEN now() END "
                + "FROM (SELECT id, row_number() OVER () rn FROM users) u", island);
        jdbc.update("INSERT INTO group_members (id, notification_enabled, role, group_id, user_id) "
                + "SELECT gen_random_uuid(), true, 'MEMBER', ?, id FROM users LIMIT 20", island);
        jdbc.execute("ANALYZE");

        assertThat(planWithoutSeqScan("SELECT id FROM island_guestbook_entries WHERE island_id = '" + island
                + "' AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 30"))
                .contains("island_guestbook_live_recent_idx");
        assertThat(planWithoutSeqScan("SELECT user_id FROM group_members WHERE group_id = '" + island
                + "' AND is_left = false"))
                .contains("group_members_active_group_user_idx").contains("Index Only Scan");
        // 부분 조건 밖(is_left = true)은 이 인덱스를 못 탄다.
        assertThat(planWithoutSeqScan("SELECT user_id FROM group_members WHERE group_id = '" + island
                + "' AND is_left = true")).doesNotContain("group_members_active_group_user_idx");
    }

    private java.util.Optional<String> indexdef(String name) {
        List<String> defs = jdbc().queryForList("SELECT indexdef FROM pg_indexes WHERE indexname = ?",
                String.class, name);
        return defs.stream().findFirst();
    }

    /** 순차 읽기를 끈 한 커넥션에서 EXPLAIN 한다 — 인덱스를 «탈 수 있는지» 만 본다. */
    private String planWithoutSeqScan(String sql) {
        return jdbc().execute((java.sql.Connection connection) -> {
            try (java.sql.Statement statement = connection.createStatement()) {
                statement.execute("SET enable_seqscan = off");
                StringBuilder plan = new StringBuilder();
                try (java.sql.ResultSet rows = statement.executeQuery("EXPLAIN " + sql)) {
                    while (rows.next()) {
                        plan.append(rows.getString(1)).append('\n');
                    }
                }
                return plan.toString();
            }
        });
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
