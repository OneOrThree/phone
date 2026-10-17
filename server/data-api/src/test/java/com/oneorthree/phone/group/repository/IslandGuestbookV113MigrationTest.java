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
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * V113 섬 인사말 컬럼 + 방명록 테이블의 실 SQL 검증 (GROMO-2262). 검증 방식은
 * {@code LoginAttemptV101MigrationTest} 선례 — 전용 컨테이너에 Flyway 체인을 실제로 돌린다.
 *
 * <p>보는 것: ① V112 까지 올린 스키마의 기존 섬이 {@code greeting=null}(= 기본 문구)로 남는다, ② 컬럼 타입·
 * nullability, ③ 하루 1개 유니크·FK 연쇄 삭제·최근순 인덱스.
 */
class IslandGuestbookV113MigrationTest {

    /** 이 클래스 전용 컨테이너 — 공용 TestPostgres 는 스키마 초기화와 함께 쓸 수 없다. */
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
    @DisplayName("V112 의 기존 섬 위에 V113 이 적용되고, 기존 섬의 greeting 은 null(기본 문구)로 남는다")
    void existingIslandsKeepNullGreeting() {
        migrate(MigrationVersion.fromVersion("112"));
        JdbcTemplate jdbc = jdbc();
        UUID islandId = UUID.randomUUID();
        jdbc.update("INSERT INTO groups (id, name, max_members, is_chat_enabled, invite_permission, status) "
                + "VALUES (?, '옛섬', 10, true, 'OWNER_ONLY', 'WAITING')", islandId);

        migrate(MigrationVersion.LATEST);

        assertThat(jdbc.queryForObject("SELECT greeting FROM groups WHERE id = ?", String.class, islandId)).isNull();
        Map<String, Object> column = jdbc.queryForMap("SELECT data_type, is_nullable, character_maximum_length "
                + "FROM information_schema.columns WHERE table_name = 'groups' AND column_name = 'greeting'");
        assertThat(column).containsEntry("data_type", "character varying").containsEntry("is_nullable", "YES")
                .containsEntry("character_maximum_length", 160);
    }

    @Test
    @DisplayName("방명록 테이블의 열·유니크·FK 연쇄 삭제·최근순 인덱스가 정확히 생긴다")
    void guestbookTableShape() {
        migrate(MigrationVersion.LATEST);
        JdbcTemplate jdbc = jdbc();

        List<Map<String, Object>> rows = jdbc.queryForList("SELECT column_name, data_type, is_nullable "
                + "FROM information_schema.columns WHERE table_name = 'island_guestbook_entries'");
        assertThat(rows).hasSize(7);
        Map<String, String> nullable = new java.util.HashMap<>();
        rows.forEach(row -> nullable.put((String) row.get("column_name"), (String) row.get("is_nullable")));
        assertThat(nullable).containsEntry("id", "NO").containsEntry("island_id", "NO")
                .containsEntry("author_id", "NO").containsEntry("content", "NO")
                .containsEntry("written_on", "NO").containsEntry("created_at", "NO")
                .containsEntry("deleted_at", "YES");
        assertThat(jdbc.queryForObject("SELECT character_maximum_length FROM information_schema.columns "
                + "WHERE table_name = 'island_guestbook_entries' AND column_name = 'content'", Integer.class))
                .isEqualTo(80);

        assertThat(jdbc.queryForObject("SELECT count(*) FROM pg_constraint WHERE conname = 'uq_island_guestbook_day' "
                + "AND contype = 'u'", Integer.class)).isEqualTo(1);
        // FK 둘 다 ON DELETE CASCADE ('c').
        assertThat(jdbc.queryForList("SELECT confdeltype::text FROM pg_constraint "
                + "WHERE conrelid = 'island_guestbook_entries'::regclass AND contype = 'f'", String.class))
                .containsExactly("c", "c");
        assertThat(jdbc.queryForObject("SELECT indexdef FROM pg_indexes "
                + "WHERE indexname = 'island_guestbook_island_created_idx'", String.class))
                .contains("(island_id, created_at DESC)");
    }

    @Test
    @DisplayName("같은 (섬, 작성자, 날짜) 두 번째 행은 유니크가 막고, 섬이 지워지면 방명록도 함께 지워진다")
    void uniquePerDayAndCascade() {
        migrate(MigrationVersion.LATEST);
        JdbcTemplate jdbc = jdbc();
        UUID islandId = UUID.randomUUID();
        UUID authorId = UUID.randomUUID();
        jdbc.update("INSERT INTO groups (id, name, max_members, is_chat_enabled, invite_permission, status) "
                + "VALUES (?, '섬', 10, true, 'OWNER_ONLY', 'WAITING')", islandId);
        jdbc.update("INSERT INTO users (id, nickname, is_guest) VALUES (?, '글쓴이', false)", authorId);
        String insert = "INSERT INTO island_guestbook_entries (id, island_id, author_id, content, written_on) "
                + "VALUES (?, ?, ?, '안녕', DATE '2026-10-12')";
        jdbc.update(insert, UUID.randomUUID(), islandId, authorId);

        org.assertj.core.api.Assertions.assertThatThrownBy(
                () -> jdbc.update(insert, UUID.randomUUID(), islandId, authorId))
                .isInstanceOf(org.springframework.dao.DuplicateKeyException.class);

        jdbc.update("DELETE FROM groups WHERE id = ?", islandId);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM island_guestbook_entries", Integer.class)).isZero();
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
