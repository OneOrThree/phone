package com.oneorthree.phone.db;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 빈 V0와 기존 DB 정리 SQL을 실제 PostgreSQL에서 검증한다. */
class V0BaselineMigrationTest {
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
    void 빈_DB는_V0만_적용하고_사용자나_봇을_생성하지_않는다() {
        migrate("classpath:db/v0");
        // V0 체인 — 후속 V1(GROMO-2477)부터 같은 디렉터리에서 이어 붙는다. 과거 V1~V138 은 섞이지 않는다.
        assertThat(jdbc.queryForList("SELECT version FROM flyway_schema_history", String.class))
                .containsExactly("0", "1");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM pg_tables WHERE schemaname='public' "
                + "AND tablename<>'flyway_schema_history'", Integer.class)).isEqualTo(77);
        assertThat(jdbc.queryForObject("SELECT to_regclass('public.islands') IS NOT NULL", Boolean.class)).isTrue();
        assertThat(jdbc.queryForObject("SELECT to_regclass('public.groups') IS NULL", Boolean.class)).isTrue();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM users", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM focus_sessions", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM construction_cost_policies", Integer.class))
                .isEqualTo(7);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM focus_reward_policies", Integer.class))
                .isEqualTo(1);
    }

    @Test
    void 구_열린_마커만_마감하고_현행_집중과_공유_이벤트를_보존한다() throws Exception {
        migrate("classpath:db/migration");
        UUID legacyUser = user();
        UUID activeUser = user();
        UUID pausedUser = user();
        UUID legacy = marker(legacyUser);
        UUID active = marker(activeUser);
        UUID paused = marker(pausedUser);
        UUID island = UUID.randomUUID();
        jdbc.update("INSERT INTO groups(id,is_chat_enabled,invite_permission,max_members,name,status) "
                + "VALUES (?,true,'OWNER_ONLY',10,'보존할 섬','ACTIVE')", island);
        Map<String, Object> islandBefore = jdbc.queryForMap("SELECT * FROM groups WHERE id=?", island);
        UUID member = UUID.randomUUID();
        jdbc.update("INSERT INTO group_members(id,group_id,user_id,notification_enabled,role,membership_epoch) "
                + "VALUES (?, ?, ?,true,'OWNER',7)", member, island, activeUser);
        detail(active, activeUser, island, "ACTIVE");
        detail(paused, pausedUser, island, "PAUSED");
        Map<String, Object> activeBefore = markerRow(active);
        Map<String, Object> pausedBefore = markerRow(paused);
        UUID event = UUID.randomUUID();
        jdbc.update("INSERT INTO event_outbox(id,event_id,schema_version,type,occurred_at,user_id,"
                + "aggregate_type,aggregate_id,version,params,created_at) "
                + "VALUES (?, ?,1,'TEST',now(),?,'USER',?,1,'{}',now())",
                event, event.toString(), activeUser, activeUser.toString());
        for (String target : new String[]{"LINK", "KAFKA"}) {
            jdbc.update("INSERT INTO event_outbox_deliveries(id,outbox_id,target,aggregate_type,aggregate_id,"
                    + "aggregate_version,payload,attempt_count,next_attempt_at,created_at) "
                    + "VALUES (?, ?, ?,'USER',?,1,'{}',0,now(),now())",
                    UUID.randomUUID(), event, target, activeUser.toString());
        }
        // 새 API의 current/end는 상세를 읽으므로 이 구 마커를 종료할 수 없다.
        assertThat(jdbc.queryForObject("SELECT count(*) FROM focus_session_details WHERE session_id=?",
                Integer.class, legacy)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM focus_sessions WHERE user_id=? AND ended_at IS NULL",
                Integer.class, legacyUser)).isOne();

        jdbc.execute(Files.readString(Path.of("docs/db/v0-rebase/retire.sql")));

        assertThat(jdbc.queryForMap("SELECT status,ended_at=started_at AS zero_seconds "
                + "FROM focus_sessions WHERE id=?", legacy))
                .containsEntry("status", "AUTO_CLOSED").containsEntry("zero_seconds", true);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM focus_sessions WHERE user_id=? AND ended_at IS NULL",
                Integer.class, legacyUser)).isZero();
        assertThat(jdbc.queryForMap("SELECT * FROM islands WHERE id=?", island)).isEqualTo(islandBefore);
        assertThat(jdbc.queryForObject("SELECT to_regclass('public.groups') IS NULL", Boolean.class)).isTrue();
        assertThat(jdbc.queryForMap("SELECT group_id,user_id,membership_epoch FROM group_members WHERE id=?", member))
                .containsEntry("group_id", island).containsEntry("user_id", activeUser).containsEntry("membership_epoch", 7L);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM pg_constraint WHERE conrelid='group_members'::regclass "
                + "AND contype='f' AND confrelid='islands'::regclass", Integer.class)).isOne();
        assertThat(markerRow(active)).isEqualTo(activeBefore);
        assertThat(markerRow(paused)).isEqualTo(pausedBefore);
        assertThat(jdbc.queryForList("SELECT lifecycle FROM focus_session_details ORDER BY lifecycle", String.class))
                .containsExactly("ACTIVE", "PAUSED");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM event_outbox WHERE id=?", Integer.class, event)).isOne();
        assertThat(jdbc.queryForList("SELECT target FROM event_outbox_deliveries WHERE outbox_id=?",
                String.class, event)).containsExactly("KAFKA");
    }

    @Test
    void 링크전용_원본만_삭제하고_공유_탈퇴와_다른위성_전달은_보존한다() throws Exception {
        migrate("classpath:db/migration");
        UUID user = user();
        UUID orphan = event(user, "user.displayNameChanged", 1);
        UUID shared = event(user, "user.displayNameChanged", 2);
        UUID withdrawn = event(user, "user.withdrawn", 3);
        UUID existingOrphan = event(user, "link.revoked", 4);
        delivery(orphan, user, "LINK");
        delivery(shared, user, "LINK");
        delivery(shared, user, "KAFKA");
        delivery(withdrawn, user, "LINK");
        Map<String, Object> sharedBefore = jdbc.queryForMap("SELECT * FROM event_outbox WHERE id=?", shared);
        Map<String, Object> withdrawnBefore = jdbc.queryForMap("SELECT * FROM event_outbox WHERE id=?", withdrawn);

        jdbc.execute(Files.readString(Path.of("docs/db/v0-rebase/retire.sql")));

        assertThat(jdbc.queryForObject("SELECT count(*) FROM event_outbox WHERE id IN (?,?)",
                Integer.class, orphan, existingOrphan)).isZero();
        assertThat(jdbc.queryForMap("SELECT * FROM event_outbox WHERE id=?", shared)).isEqualTo(sharedBefore);
        assertThat(jdbc.queryForMap("SELECT * FROM event_outbox WHERE id=?", withdrawn)).isEqualTo(withdrawnBefore);
        assertThat(jdbc.queryForList("SELECT target FROM event_outbox_deliveries WHERE outbox_id=?",
                String.class, shared)).containsExactly("KAFKA");
    }

    @Test
    void 다른_스키마의_사용자_FK가_있으면_데이터를_변경하지_않고_거부한다() throws Exception {
        migrate("classpath:db/v0");
        List<String> history = jdbc.queryForList("SELECT version FROM flyway_schema_history", String.class);
        String guard = Files.readString(Path.of("docs/db/v0-rebase/public-schema.sql"));
        jdbc.execute(guard);
        UUID user = user();
        jdbc.execute("CREATE SCHEMA current_business");
        try {
            jdbc.execute("CREATE TABLE current_business.user_dependency(user_id uuid PRIMARY KEY "
                    + "REFERENCES public.users(id) ON DELETE CASCADE)");
            jdbc.update("INSERT INTO current_business.user_dependency VALUES (?)", user);

            assertThatThrownBy(() -> jdbc.execute(guard))
                    .hasStackTraceContaining("public 밖 사용자 객체가 있어 전환을 거부합니다: current_business");

            assertThat(jdbc.queryForObject("SELECT count(*) FROM current_business.user_dependency",
                    Integer.class)).isOne();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM users WHERE id=?", Integer.class, user)).isOne();
            assertThat(jdbc.queryForList("SELECT version FROM flyway_schema_history", String.class))
                    .isEqualTo(history);
            jdbc.execute("DROP TABLE current_business.user_dependency");
            jdbc.execute("CREATE TYPE current_business.state AS ENUM ('ACTIVE')");
            assertThatThrownBy(() -> jdbc.execute(guard)).hasStackTraceContaining("public 밖 사용자 객체");
        } finally {
            jdbc.execute("DROP SCHEMA current_business CASCADE");
        }
    }

    private UUID event(UUID user, String type, long version) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO event_outbox(id,event_id,schema_version,type,occurred_at,user_id,"
                + "aggregate_type,aggregate_id,version,params,created_at) "
                + "VALUES (?, ?,1,?,now(),?,'USER',?,?,'{\"inviterDisplayName\":\"이전 이름\"}',now())",
                id, id.toString(), type, user, user.toString(), version);
        return id;
    }

    private void delivery(UUID event, UUID user, String target) {
        jdbc.update("INSERT INTO event_outbox_deliveries(id,outbox_id,target,aggregate_type,aggregate_id,"
                + "aggregate_version,payload,attempt_count,next_attempt_at,created_at) "
                + "VALUES (?, ?, ?,'USER',?,1,'{}',0,now(),now())", UUID.randomUUID(), event, target, user.toString());
    }

    private void migrate(String location) {
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations(location).load().migrate();
    }

    private UUID user() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,is_guest,nickname) VALUES (?,false,?)", id, id.toString());
        return id;
    }

    private UUID marker(UUID user) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO focus_sessions(id,user_id,started_at,total_distraction_seconds) "
                + "VALUES (?, ?, now()-interval '1 hour',0)", id, user);
        return id;
    }

    private void detail(UUID session, UUID user, UUID island, String lifecycle) {
        jdbc.update("INSERT INTO focus_session_details(session_id,user_id,island_id,membership_epoch_at_start,"
                + "subject,lifecycle,last_transition_at,policy_revision) VALUES (?, ?, ?,1,'유지할 과목',?,now(),1)",
                session, user, island, lifecycle);
    }

    private Map<String, Object> markerRow(UUID session) {
        return jdbc.queryForMap("SELECT id,user_id,started_at,ended_at,status,presence_order "
                + "FROM focus_sessions WHERE id=?", session);
    }
}
