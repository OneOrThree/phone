package com.oneorthree.phone.user.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationInfo;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V95(기존 닉네임 앞뒤 공백 제거, GROMO-2051)의 <b>실 SQL</b> 검증.
 *
 * <p>이 검사가 필요한 이유는 V51 테스트와 같다 — <b>CI 는 마이그레이션을 돌리지 않는다</b>
 * ({@code create-drop} + {@code flyway.enabled=false}). 게다가 V95 는 DDL 이 아니라 <b>데이터</b>를
 * 고치므로, 마이그레이션 체인이 그냥 통과하는 것만으로는 「무엇을 잘랐는가」가 전혀 검증되지 않는다.
 *
 * <p>보는 것: ① U+2003 같은 U+0020 «초과» 공백을 실제로 자른다(이 티켓이 고치는 결함 그 자체),
 * ② Java {@code String.strip()} 이 자르지 않는 NBSP 는 <b>건드리지 않는다</b>(SQL 이 더 넓게 자르면
 * 코드가 저장할 값과 DB 값이 다시 갈라진다), ③ 정규화가 새 중복을 만들면 배포를 멈춘다,
 * ④ 정규화가 빈 닉네임을 만들면 배포를 멈춘다.
 */
class UserNicknameV95MigrationTest {

    /** U+2003 EM SPACE — {@code trim()} 은 못 자르고 {@code strip()} 은 자르는 대표 문자. */
    private static final String EM_SPACE = Character.toString(0x2003);

    /** U+00A0 NO-BREAK SPACE — {@code Character.isWhitespace} 가 false 라 {@code strip()} 도 안 자른다. */
    private static final String NBSP = Character.toString(0x00A0);

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
    @DisplayName("V94 까지 남아 있던 앞뒤 공백을 V95 가 지운다 — trim 이 못 자르던 U+2003 포함")
    void stripsLeadingAndTrailingWhitespace() {
        migrate("94");
        UUID emSpaced = insertUser(EM_SPACE + "앨리스" + EM_SPACE);
        UUID asciiSpaced = insertUser("  Bob\t");
        UUID clean = insertUser("캐럴");

        migrate("95");

        assertThat(nicknameOf(emSpaced)).isEqualTo("앨리스");
        assertThat(nicknameOf(asciiSpaced)).isEqualTo("Bob");
        assertThat(nicknameOf(clean)).isEqualTo("캐럴");
    }

    @Test
    @DisplayName("NBSP 는 자르지 않는다 — Java String.strip() 과 같은 공백 정의를 써야 값이 갈라지지 않는다")
    void keepsNonBreakingSpaceLikeJavaStrip() {
        migrate("94");
        UUID nbsp = insertUser(NBSP + "데이브" + NBSP);

        migrate("95");

        assertThat(nicknameOf(nbsp)).isEqualTo(NBSP + "데이브" + NBSP);
    }

    @Test
    @DisplayName("공백을 지우면 대소문자 무시 중복이 되는 행이 있으면 배포를 멈춘다 — 조용히 한쪽을 잃지 않는다")
    void haltsWhenNormalizationCreatesCollision() {
        migrate("94");
        // V89 의 uq_users_nickname_lower 는 지금 이 둘을 서로 «다른» 키로 본다 — 이것이 이 티켓이 닫는 구멍이다.
        insertUser(EM_SPACE + "Alice");
        insertUser("alice");

        assertThatThrownBy(() -> migrate("95"))
                .hasStackTraceContaining("GROMO-2051")
                .hasStackTraceContaining("alice");

        // 멈췄으므로 아무 값도 바뀌지 않았다.
        assertThat(count("users WHERE nickname = '" + EM_SPACE + "Alice'")).isEqualTo(1);
    }

    @Test
    @DisplayName("공백뿐인 닉네임이 있으면 배포를 멈춘다 — 빈 문자열은 NULL 과 달리 유니크 인덱스에 걸리는 값이다")
    void haltsWhenNormalizationEmptiesNickname() {
        migrate("94");
        UUID blank = insertUser(EM_SPACE + EM_SPACE);

        assertThatThrownBy(() -> migrate("95"))
                .hasStackTraceContaining("GROMO-2051")
                .hasStackTraceContaining(blank.toString());
    }

    // ── 시드 ────────────────────────────────────────────────────────────

    private UUID insertUser(String nickname) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users (id, is_guest, nickname) VALUES (?, false, ?)", id, nickname);
        return id;
    }

    private String nicknameOf(UUID id) {
        return jdbc.queryForObject("SELECT nickname FROM users WHERE id = ?", String.class, id);
    }

    private int count(String fromClause) {
        Integer found = jdbc.queryForObject("SELECT count(*) FROM " + fromClause, Integer.class);
        return found == null ? 0 : found;
    }

    private void migrate(String target) {
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .target(resolveTarget(target))
                .load()
                .migrate();
    }

    /**
     * 요청 버전 이하의 <b>실재하는</b> 최고 버전으로 타깃을 해석한다(V41·V42·V44·V49·V51 테스트 관례) —
     * 형제 배치의 마이그레이션이 아직 없는 워크트리에서도 돌게 하는 장치다.
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
