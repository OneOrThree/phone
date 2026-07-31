package com.oneorthree.phone.league.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class LeagueLegacyMigrationTest {

    private static final Instant WEEK_START = Instant.parse("2026-07-05T15:00:00Z");

    /**
     * 이 클래스 전용 컨테이너.
     *
     * <p>공용 {@code TestPostgres} 를 쓰지 않는다 — 아래 {@link #resetSchema()} 가 스키마를 통째로 비우는데,
     * 그 컨테이너는 다른 22 개 테스트 클래스가 공유하는 Spring 컨텍스트의 데이터소스라 같이 깨진다.
     *
     * <p>대신 테스트 메서드마다 컨테이너를 새로 띄우던 것을 클래스당 하나로 줄였다. 이 테스트는 V1 부터
     * 마이그레이션을 다시 올려 검증하므로 <b>매번 빈 DB 가 필요한 것은 맞지만</b>, 그 조건은 스키마 초기화로
     * 충족되고 컨테이너 기동까지 반복할 이유는 없었다.
     *
     * <p>정리는 Testcontainers 의 Ryuk 사이드카가 JVM 종료 시 수행한다.
     */
    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    /**
     * 매 테스트 전 스키마를 통째로 비운다 — Flyway 이력 테이블({@code flyway_schema_history})까지 사라져야
     * 다음 테스트가 V1 부터 다시 올릴 수 있다. 컨테이너를 새로 띄우던 것과 동일한 출발 상태다.
     */
    @BeforeEach
    void resetSchema() {
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        jdbcTemplate.execute("DROP SCHEMA public CASCADE");
        jdbcTemplate.execute("CREATE SCHEMA public");
    }

    @Test
    @DisplayName("V1~V13 레거시 arena·snapshot 중복 fixture를 V15 전역 모델로 안전하게 전환")
    void migratesLegacyDuplicatesToSingleGlobalAnchor() {
        migrate(MigrationVersion.fromVersion("13"));
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        List<UUID> arenaIds = insertLegacyArenas(jdbcTemplate);
        insertArenaSnapshots(jdbcTemplate, arenaIds);

        migrate(MigrationVersion.LATEST);

        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM league_arenas WHERE started_at = ?",
                Integer.class,
                Timestamp.from(WEEK_START))).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT id FROM league_arenas WHERE started_at = ?",
                UUID.class,
                Timestamp.from(WEEK_START))).isEqualTo(arenaIds.get(3));
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM league_rank_snapshots", Integer.class)).isZero();
        assertThatThrownBy(() -> jdbcTemplate.update(
                "INSERT INTO league_arenas"
                        + " (id, status, started_at, created_at) VALUES (?, 'ACTIVE', ?, ?)",
                UUID.randomUUID(),
                Timestamp.from(WEEK_START),
                Timestamp.from(Instant.parse("2026-07-06T00:00:00Z"))))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("프로덕션식 — 유니크 제약 이름이 베이스라인과 달라도 V14가 arena_id DROP으로 전환")
    void migratesWhenLegacyUniqueConstraintHasDifferentName() {
        migrate(MigrationVersion.fromVersion("13"));
        JdbcTemplate jdbcTemplate = jdbcTemplate();

        // 프로덕션 재현: Flyway 도입(GROMO-670) 전 레거시 스키마는 유니크 제약 이름이
        // 베이스라인(uq_league_rank_snapshots_arena_user_day)과 다르다. Hibernate 자동 생성명
        // 흉내로 rename 해, V14가 이름에 의존하지 않고 arena_id 컬럼 DROP으로 전환하는지 검증한다.
        jdbcTemplate.execute(
                "ALTER TABLE league_rank_snapshots"
                        + " RENAME CONSTRAINT uq_league_rank_snapshots_arena_user_day"
                        + " TO uk_legacy_hibernate_generated_name");

        migrate(MigrationVersion.LATEST);

        // arena_id 컬럼과 (그를 포함한) 옛 유니크 제약이 이름과 무관하게 제거됐다.
        assertThat(columnExists(jdbcTemplate, "league_rank_snapshots", "arena_id")).isFalse();

        // 새 전역 유니크 (user_id, created_at) 가 강제된다.
        UUID userId = UUID.randomUUID();
        LocalDate day = LocalDate.of(2026, 7, 6);
        jdbcTemplate.update(
                "INSERT INTO league_rank_snapshots (id, created_at, rank, user_id) VALUES (?, ?, ?, ?)",
                UUID.randomUUID(), day, 1, userId);
        assertThatThrownBy(() -> jdbcTemplate.update(
                "INSERT INTO league_rank_snapshots (id, created_at, rank, user_id) VALUES (?, ?, ?, ?)",
                UUID.randomUUID(), day, 2, userId))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    private boolean columnExists(JdbcTemplate jdbcTemplate, String table, String column) {
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM information_schema.columns"
                        + " WHERE table_name = ? AND column_name = ?",
                Integer.class, table, column);
        return count != null && count > 0;
    }

    private void migrate(MigrationVersion target) {
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .target(target)
                .load()
                .migrate();
    }

    private JdbcTemplate jdbcTemplate() {
        return new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
    }

    private List<UUID> insertLegacyArenas(JdbcTemplate jdbcTemplate) {
        List<UUID> arenaIds = new ArrayList<>();
        for (int tierLevel = 1; tierLevel <= 5; tierLevel++) {
            UUID arenaId = UUID.randomUUID();
            arenaIds.add(arenaId);
            String status = tierLevel == 4 ? "ACTIVE" : "ENDED";
            Instant createdAt = Instant.parse("2026-07-05T15:00:00Z").plusSeconds(tierLevel);
            jdbcTemplate.update(
                    "INSERT INTO league_arenas"
                            + " (id, ended_at, status, started_at, tier_level, created_at, updated_at)"
                            + " VALUES (?, ?, ?, ?, ?, ?, ?)",
                    arenaId,
                    status.equals("ACTIVE") ? null : Timestamp.from(WEEK_START.plusSeconds(3600)),
                    status,
                    Timestamp.from(WEEK_START),
                    tierLevel,
                    Timestamp.from(createdAt),
                    null);
        }
        return arenaIds;
    }

    private void insertArenaSnapshots(JdbcTemplate jdbcTemplate, List<UUID> arenaIds) {
        UUID userId = UUID.randomUUID();
        for (int index = 0; index < 2; index++) {
            jdbcTemplate.update(
                    "INSERT INTO league_rank_snapshots"
                            + " (id, arena_id, created_at, rank, user_id) VALUES (?, ?, ?, ?, ?)",
                    UUID.randomUUID(),
                    arenaIds.get(index),
                    LocalDate.of(2026, 7, 6),
                    index + 1,
                    userId);
        }
    }
}
