package com.oneorthree.phone.appearance.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationInfo;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * V64 백필의 실 SQL 검증 (GROMO-1783) — 「building_themes key 집합 = 완공 건물 집합」을
 * 배포 전 데이터에도 적용하는지 본다.
 *
 * <p>보는 것: ① V62 시점에 이미 있던 섬의 완공 시설이 {@code default} 로 백필되고 BUILDING
 * 행은 key 를 만들지 않는다, ② 시설 없는 섬도 빈 맵 행이 생긴다(모든 섬이 외양 행을 갖는다),
 * ③ <b>재실행 안전</b> — 백필 문장을 다시 돌려도 기존 key 는 보존되고 누락 key 만 채워진다.
 * 검증 방식은 {@code GroupBetV49MigrationTest} 선례 — 전용 컨테이너에 운영 Flyway 체인을
 * 실제로 돌린다. 엔티티 ↔ 스키마 validate 는 {@code AppearanceServiceIntegrationTest} 가
 * 같은 배선({@code ddl-auto=validate})으로 커버한다.
 */
class IslandAppearanceV64MigrationTest {

    /** 이 클래스 전용 컨테이너 — 공용 TestPostgres 는 스키마 초기화와 함께 쓸 수 없다. */
    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    private JdbcTemplate jdbc;

    @BeforeEach
    void resetSchema() {
        jdbc = new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        jdbc.execute("DROP SCHEMA public CASCADE");
        jdbc.execute("CREATE SCHEMA public");
    }

    @Test
    @DisplayName("V62 의 완공 시설은 default 로 백필되고, 공사 중 시설·무시설 섬은 key 없이 빈 맵이다")
    void backfillsCompletedFacilities() {
        migrate("62");
        UUID islandId = newIsland();
        UUID emptyIslandId = newIsland();
        facility(islandId, "hall", "COMPLETED");
        facility(islandId, "board", "COMPLETED");
        facility(islandId, "library", "BUILDING");

        migrate("64");

        assertThat(theme(islandId, "hall")).isEqualTo("default");
        assertThat(theme(islandId, "board")).isEqualTo("default");
        assertThat(theme(islandId, "library"))
                .as("공사 중 시설은 외양 대상이 아니다 — key 를 만들면 GET 전체 맵 불변식이 깨진다")
                .isNull();
        assertThat(theme(emptyIslandId, "hall")).isNull();
        // 모든 섬이 외양 행을 갖는다 — writer 가 최초 PATCH 때 행을 만들지 않아도 된다.
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM groups g"
                        + " WHERE NOT EXISTS (SELECT 1 FROM island_appearances a"
                        + " WHERE a.island_id = g.id)", Integer.class)).isZero();
        // 백필은 writer 의 변경이 아니다 — version·테마는 기본값 그대로.
        assertThat(jdbc.queryForObject(
                "SELECT version FROM island_appearances WHERE island_id = ?",
                Long.class, islandId)).isZero();
        assertThat(jdbc.queryForObject(
                "SELECT island_theme_id FROM island_appearances WHERE island_id = ?",
                String.class, islandId)).isEqualTo("default");
    }

    @Test
    @DisplayName("재실행 안전 — 백필 문장을 다시 돌려도 기존 key 는 보존되고 누락 key 만 default 로 채워진다")
    void rerunPreservesExistingKeys() {
        migrate("62");
        UUID islandId = newIsland();
        facility(islandId, "hall", "COMPLETED");
        facility(islandId, "board", "COMPLETED");
        migrate("64");

        // 배포 후 writer 가 채운 상태를 흉내 낸다 — hall 커스텀 + board key 소실.
        jdbc.update("UPDATE island_appearances"
                + " SET building_themes = (building_themes - 'board')"
                + " || '{\"hall\": \"custom\"}'::jsonb WHERE island_id = ?", islandId);
        // 백필 이후 완공된 시설 — 재실행이 채워야 할 누락 key.
        facility(islandId, "mail", "COMPLETED");

        jdbc.execute(backfillStatement());
        jdbc.execute(backfillStatement());   // 두 번 돌려도 같아야 진짜 멱등이다

        assertThat(theme(islandId, "hall"))
                .as("이미 있는 key 의 값은 백필이 덮지 않는다").isEqualTo("custom");
        assertThat(theme(islandId, "board")).isEqualTo("default");
        assertThat(theme(islandId, "mail")).isEqualTo("default");
    }

    // ── 시드·조회 (V49 테스트 관례) ──────────────────────────────────────

    private UUID newIsland() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO groups (id, is_chat_enabled, invite_permission, max_members, name,"
                + " status) VALUES (?, false, 'OWNER_ONLY', 10, '스터디', 'ACTIVE')", id);
        return id;
    }

    private void facility(UUID islandId, String buildingId, String status) {
        jdbc.update("INSERT INTO island_facilities (island_id, building_id, status, cost,"
                + " cost_revision, completed_at) VALUES (?, ?, ?, 60, 1,"
                + " CASE WHEN ? = 'COMPLETED' THEN now() END)",
                islandId, buildingId, status, status);
    }

    private String theme(UUID islandId, String buildingId) {
        return jdbc.queryForObject(
                "SELECT building_themes ->> ? FROM island_appearances WHERE island_id = ?",
                String.class, buildingId, islandId);
    }

    /** V64 파일의 마지막 문장(백필 INSERT)만 떼어 온다 — 재실행 검증이 운영 SQL 그대로 돌게 한다. */
    private String backfillStatement() {
        try (InputStream in = getClass().getResourceAsStream(
                "/db/migration/V64__island_appearance.sql")) {
            String script = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            return script.substring(script.indexOf("INSERT INTO island_appearances"));
        } catch (Exception e) {
            throw new IllegalStateException("V64 마이그레이션 파일을 읽지 못했다", e);
        }
    }

    private void migrate(String requested) {
        Flyway flyway = Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .target(resolveTarget(requested))
                .load();
        flyway.migrate();
    }

    /**
     * 요청 버전 이하의 <b>실재하는</b> 최고 버전으로 타깃을 해석한다(V41·V42·V49 테스트 관례) —
     * 선행 배치의 마이그레이션이 아직 없는 워크트리에서도 돌게 하는 장치다.
     */
    private MigrationVersion resolveTarget(String requested) {
        MigrationVersion wanted = MigrationVersion.fromVersion(requested);
        Flyway flyway = Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .load();
        MigrationVersion best = null;
        for (MigrationInfo info : flyway.info().all()) {
            MigrationVersion version = info.getVersion();
            if (version == null || version.compareTo(wanted) > 0) {
                continue;
            }
            if (best == null || version.compareTo(best) > 0) {
                best = version;
            }
        }
        if (best == null) {
            throw new IllegalStateException("적용 가능한 마이그레이션이 없습니다 — target=" + requested);
        }
        return best;
    }
}
