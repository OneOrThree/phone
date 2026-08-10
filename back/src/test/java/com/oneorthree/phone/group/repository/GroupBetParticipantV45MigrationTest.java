package com.oneorthree.phone.group.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * V45(참가 행 {@code (user_id, session_id)} 인덱스, GROMO-1415 조회 성능)의 실 SQL 검증.
 *
 * <p>보는 것: ① V42 까지는 user_id <b>선두</b> 인덱스가 없다(V39 유니크는 선두가 session_id 라
 * 참가자 스코프 조회 {@code /me/*} 가 못 쓴다), ② V45 가 그 인덱스를 만든다, ③ 컬럼 순서가
 * (user_id, session_id) 다 — 순서가 뒤집히면 존재해도 같은 이유로 안 쓰인다.
 */
class GroupBetParticipantV45MigrationTest {

    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    private static final String INDEX_NAME = "idx_group_challenge_bet_participants_user_session";

    private JdbcTemplate jdbc;

    @BeforeEach
    void resetSchema() {
        jdbc = new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        jdbc.execute("DROP SCHEMA public CASCADE");
        jdbc.execute("CREATE SCHEMA public");
    }

    @Test
    @DisplayName("V42 까지는 user_id 선두 인덱스가 없다 — V45 가 (user_id, session_id) 로 만든다")
    void userSessionIndexAppearsAtV45() {
        migrate("42");
        assertThat(indexDefinition()).isNull();

        migrate("45");

        String definition = indexDefinition();
        assertThat(definition).isNotNull();
        // 컬럼 순서까지 단정 — (session_id, user_id) 로 뒤집히면 존재해도 /me 조회가 못 쓴다.
        assertThat(definition.replace(" ", "")).contains("(user_id,session_id)");
    }

    private String indexDefinition() {
        return jdbc.query(
                "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public'"
                        + " AND tablename = 'group_challenge_bet_participants' AND indexname = ?",
                rs -> rs.next() ? rs.getString(1) : null,
                INDEX_NAME);
    }

    private void migrate(String target) {
        Flyway flyway = Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .target(resolveTarget(target))
                .load();
        flyway.migrate();
    }

    /**
     * 요청 버전 이하의 <b>실재하는</b> 최고 버전으로 타깃을 해석한다 — 선행 배치(B7 의 V43·B4 의
     * V44)가 아직 없는 워크트리에서도 동작한다({@code GroupBetV41MigrationTest} 와 같은 장치).
     */
    private MigrationVersion resolveTarget(String requested) {
        MigrationVersion wanted = MigrationVersion.fromVersion(requested);
        Flyway flyway = Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .load();
        MigrationVersion best = null;
        for (org.flywaydb.core.api.MigrationInfo info : flyway.info().all()) {
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
