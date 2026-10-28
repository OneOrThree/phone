package com.oneorthree.phone.internal.service;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static java.util.Map.entry;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * 섬 purge 목록 누락 가드 (GROMO-2284) — {@link IslandPurgeService#PURGE_STATEMENTS} 와 섬 참조 표 전수를 맞춘다.
 *
 * <p>V0 를 올린 전용 DB 에서 {@code islands} 를 가리키는 FK 표 전부({@code pg_constraint})와 FK 없이 섬 id 를 가진 표
 * ({@link #ISLAND_ID_WITHOUT_FK})를 모아, 표마다 purge 문장이 지우거나 {@link #KEPT} 에 남기는 사유가 있는지 본다.
 * 새 섬 참조 표가 생기면 이 테스트가 깨져 «지울지 남길지» 를 정하게 만든다. 간접 참조(통장 원장·건설 기여·공지 댓글처럼
 * 섬 참조 표를 가리키는 표)는 대상이 아니다 — 그 순서는 purge 목록의 «자식 먼저» 규칙이 맡는다.
 *
 * <p>Spring 컨텍스트는 필요 없다. 선례는 {@code V0BaselineMigrationTest}(전용 컨테이너 + {@code classpath:db/v0}).
 */
class IslandPurgeGuardTest {

    /** 이 클래스 전용 컨테이너 — 공용 TestPostgres 는 스키마를 새로 올리는 이 테스트와 함께 쓸 수 없다. */
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    /**
     * purge 문장 머리의 대상 표 — 하위 질의의 FROM 은 «지우는 표»가 아니라서 문장 머리만 읽는다.
     * 현재 문장은 스키마 접두어를 안 쓰지만, {@code public.x} 처럼 붙어도 표 이름({@code x})을 잡는다.
     */
    private static final Pattern PURGE_TARGET =
            Pattern.compile("^\\s*(?:DELETE\\s+FROM|UPDATE)\\s+(?:\\w+\\.)?(\\w+)", Pattern.CASE_INSENSITIVE);

    private static final Map<String, String> ON_DELETE = Map.of(
            "a", "NO ACTION", "r", "RESTRICT", "c", "CASCADE", "n", "SET NULL", "d", "SET DEFAULT");

    /** FK 없이 섬 id 를 가진 표 → 그 열. {@code pg_constraint} 로는 안 보이므로 손으로 적는다 — 새로 생기면 여기에도. */
    private static final Map<String, String> ISLAND_ID_WITHOUT_FK = Map.of(
            "focus_session_details", "island_id",
            "island_weekly_focus", "island_id",
            "telescope_buckets", "island_ids");

    /** purge 가 지우지 않는 섬 참조 표 → 남기는 사유. 남기는 표와 그 사유의 정본이다. */
    private static final Map<String, String> KEPT = Map.ofEntries(
            entry("group_members", "이탈 마킹으로 소속이 이미 끊겼고, 정산과 지난 주 랭킹 분모(경계 시점 소속 판정)의 증거다"),
            entry("island_join_requests", "섬 종결이 ISLAND_CLOSED 로 닫는다 — 신청은 공동 기록이 아니라 신청자의 기록이다"),
            entry("focus_session_details", "개인 집중 기록이라 정책이 유지한다 — 가상 무인도 목적지를 위해 island_id FK 는 없다"),
            entry("focus_tutorial_rewards", "사용자의 튜토리얼 보상 기록이다 — FK 가 SET NULL 인 것도 섬이 없어져도 기록은 남긴다는 뜻이다"),
            entry("letters", "친구 사이 편지는 보낸·받은 사용자의 기록이다 — FK 가 SET NULL 인 것도 기록은 남긴다는 뜻이다"),
            entry("user_main_islands", "마지막 주민이 나갈 때 MainIslandService#onMembershipRevoked 가 같은 트랜잭션에서 옮기거나 "
                    + "지워 purge 에 닿을 땐 이 섬을 가리키는 행이 없다 — 또 지우면 같은 사실의 장부가 둘이 된다"),
            entry("user_island_contexts", "UserIslandContextRecovery 가 이미 옮기거나 비웠다 — 행 자체가 사용자의 것이다"),
            entry("group_invite_links", "닫힌 섬의 코드는 행을 지우지 않고 읽을 때 INVITATION_EXPIRED 로 거른다 — "
                    + "IslandInvitationService#requireLiveInvitation(isAlive)·IslandJoinService#requireIssuerCurrent"
                    + "(발급자 활성 멤버십). 남기는 island_join_requests.invite_link_id 가 RESTRICT 라 지우면 purge 가 롤백된다"),
            entry("telescope_buckets", "사용자별 1시간 스냅샷이다 — 읽기가 TELESCOPE_VISIBLE_SQL(deleted_at·status)로 죽은 섬을 "
                    + "거르고, 지난 버킷 행은 TelescopeService 의 다음 조회가 deleteOlderThan 으로 지운다"));

    private static JdbcTemplate jdbc;

    @BeforeAll
    static void migrateV0() {
        POSTGRES.start();
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/v0").load().migrate();
        jdbc = new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
    }

    @Test
    void 섬을_참조하는_표는_purge_목록이나_허용목록에_있다() {
        Map<String, String> missing = islandReferences();
        missing.keySet().removeAll(purgedTables());
        missing.keySet().removeAll(KEPT.keySet());
        assertThat(missing)
                .as("purge 에도 허용목록에도 없는 섬 참조 표(표=열 ON DELETE) — IslandPurgeService.PURGE_STATEMENTS 에 "
                        + "넣거나 IslandPurgeGuardTest.KEPT 에 남기는 사유를 적어라")
                .isEmpty();
    }

    @Test
    void purge_목록과_허용목록에_함께_있는_표는_없다() {
        Set<String> both = purgedTables();
        both.retainAll(KEPT.keySet());
        assertThat(both).as("purge 와 허용목록에 이중 등록된 표 — 지울지 남길지 한쪽에만 적어라").isEmpty();
    }

    @Test
    void 허용목록의_표는_지금도_섬을_참조한다() {
        Set<String> dead = new TreeSet<>(KEPT.keySet());
        dead.removeAll(islandReferences().keySet());
        assertThat(dead).as("허용목록에 있지만 섬을 참조하지 않는 표(죽은 항목) — IslandPurgeGuardTest.KEPT 에서 지워라")
                .isEmpty();
    }

    @Test
    void FK_없는_섬_id_열은_DB에_있다() {
        Set<String> dead = new TreeSet<>();
        ISLAND_ID_WITHOUT_FK.forEach((table, column) -> {
            Integer found = jdbc.queryForObject("SELECT count(*) FROM information_schema.columns "
                    + "WHERE table_schema = 'public' AND table_name = ? AND column_name = ?",
                    Integer.class, table, column);
            if (found == null || found == 0) {
                dead.add(table + "." + column);
            }
        });
        assertThat(dead).as("FK 없는 섬 id 목록에 있지만 DB 에 없는 열(죽은 항목) — ISLAND_ID_WITHOUT_FK 에서 지워라")
                .isEmpty();
    }

    /** 섬 참조 표 → 「열 ON DELETE 동작」. FK 표는 DB 에서 읽고 FK 없는 표를 더한다. */
    private static Map<String, String> islandReferences() {
        Map<String, String> references = new TreeMap<>();
        jdbc.query("SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, c.confdeltype::text AS del "
                + "FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) "
                + "WHERE c.contype = 'f' AND c.confrelid = 'islands'::regclass", rs -> {
                    references.merge(rs.getString("tbl"),
                            rs.getString("col") + " ON DELETE " + ON_DELETE.get(rs.getString("del")),
                            (left, right) -> left + ", " + right);
                });
        ISLAND_ID_WITHOUT_FK.forEach((table, column) ->
                references.merge(table, column + " (FK 없음)", (left, right) -> left + ", " + right));
        return references;
    }

    /** purge 문장이 지우거나 고치는 표. */
    private static Set<String> purgedTables() {
        Set<String> tables = new TreeSet<>();
        for (String statement : IslandPurgeService.PURGE_STATEMENTS) {
            Matcher target = PURGE_TARGET.matcher(statement);
            assertThat(target.find()).as("표 이름을 읽을 수 없는 purge 문장: %s", statement).isTrue();
            tables.add(target.group(1).toLowerCase());
        }
        return tables;
    }
}
