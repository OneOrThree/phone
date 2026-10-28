package com.oneorthree.phone.screentime.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Date;
import java.time.LocalDate;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V38 마이그레이션의 실 SQL 검증 — daily_screen_time_stats.total_screen_time_minutes nullable 화
 * (GROMO-1267, FR-16 · 정책 B7 "0분과 미집계는 다르다").
 *
 * <p>보는 것 세 가지: ① V37 까지는 NOT NULL 이라 NULL 삽입이 거부된다(전제 확인),
 * ② V38 적용 후 NULL(미집계) 삽입이 허용된다, ③ 기존 0 저장 행은 값 그대로 보존된다
 * (0 ↔ 미집계 사후 구분 불가 — 데이터 정정 없음은 V38 주석의 결정). 검증 방식은
 * {@code GroupMemberV31MigrationTest} 선례 — 전용 컨테이너에 Flyway 체인을 실제로 돌린다.
 */
class DailyScreenTimeStatV38MigrationTest {

    /** 이 클래스 전용 컨테이너 — 공용 TestPostgres 는 스키마 초기화와 함께 쓸 수 없다(V28 테스트 주석). */
    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    private static final UUID USER_ID = UUID.randomUUID();
    private static final UUID ZERO_ROW_ID = UUID.randomUUID();

    @BeforeEach
    void resetSchema() {
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        jdbcTemplate.execute("DROP SCHEMA public CASCADE");
        jdbcTemplate.execute("CREATE SCHEMA public");
    }

    @Test
    @DisplayName("V37 까지는 NOT NULL — 미집계(NULL) 삽입이 거부된다 (V38 이 풀어야 할 전제)")
    void rejectsNullMinutesBeforeV38() {
        migrate(MigrationVersion.fromVersion("37"));
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertUser(jdbcTemplate);

        assertThatThrownBy(() -> insertStat(jdbcTemplate, UUID.randomUUID(),
                LocalDate.of(2026, 8, 1), null))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("V38 적용 후 미집계(NULL) 저장이 허용되고, 기존 0 저장 행은 값 그대로 보존된다")
    void allowsNullMinutesAfterV38AndPreservesZeroRows() {
        migrate(MigrationVersion.fromVersion("37"));
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertUser(jdbcTemplate);
        // V38 이전에 저장된 "0분"(실제 0분인지 미집계 뭉개짐인지 사후 구분 불가) 행.
        insertStat(jdbcTemplate, ZERO_ROW_ID, LocalDate.of(2026, 7, 31), 0);

        migrate(MigrationVersion.fromVersion("38"));

        // 미집계는 이제 null 로 저장된다 — "0분 사용"과 저장 단계부터 구분(정책 B7).
        insertStat(jdbcTemplate, UUID.randomUUID(), LocalDate.of(2026, 8, 1), null);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT is_nullable FROM information_schema.columns"
                        + " WHERE table_name = 'daily_screen_time_stats'"
                        + " AND column_name = 'total_screen_time_minutes'", String.class))
                .isEqualTo("YES");
        // 기존 0 행은 정정하지 않는다(V38 주석의 결정 — forward-only 수용).
        assertThat(jdbcTemplate.queryForObject(
                "SELECT total_screen_time_minutes FROM daily_screen_time_stats WHERE id = ?",
                Integer.class, ZERO_ROW_ID)).isZero();
    }

    private void insertUser(JdbcTemplate jdbcTemplate) {
        jdbcTemplate.update(
                "INSERT INTO users (id, created_at, is_guest, nickname) VALUES (?, now(), false, '재영')",
                USER_ID);
    }

    private void insertStat(JdbcTemplate jdbcTemplate, UUID id, LocalDate date, Integer minutes) {
        jdbcTemplate.update(
                "INSERT INTO daily_screen_time_stats"
                        + " (id, user_id, date, total_screen_time_minutes,"
                        + " is_screen_time_goal_achieved, is_screen_time_finalized, created_at, updated_at)"
                        + " VALUES (?, ?, ?, ?, false, false, now(), now())",
                id, USER_ID, Date.valueOf(date), minutes);
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
}
