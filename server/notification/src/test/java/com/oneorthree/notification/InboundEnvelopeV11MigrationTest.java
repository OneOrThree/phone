package com.oneorthree.notification;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** V11 수신 원문 파기 백필의 실 SQL 검증(GROMO-2212). V10 까지 올려 기존 행을 시드한 뒤 V11 을 태운다. */
@Testcontainers
class InboundEnvelopeV11MigrationTest {

    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    static final UUID ACTIVE = UUID.fromString("11111111-1111-4111-8111-111111111111");
    static final UUID WITHDRAWN = UUID.fromString("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    @Test
    void backfillPurgesOnlyWithdrawnEnvelopesAndKeepsTombstonesAndDeduplication() {
        JdbcTemplate jdbc = new JdbcTemplate(new DriverManagerDataSource(
                PG.getJdbcUrl(), PG.getUsername(), PG.getPassword()));
        migrate(MigrationVersion.fromVersion("10"));
        jdbc.update("INSERT INTO user_fences(user_id,auth_generation,withdrawn) VALUES(?,0,false),(?,3,true)",
                ACTIVE, WITHDRAWN);
        jdbc.update("INSERT INTO device_tokens(device_token,user_id,ownership_token,auth_generation,active)"
                + " VALUES('tombstone',?,?,3,false)", WITHDRAWN, UUID.randomUUID());
        // V11 이전 앱이 쓰던 그대로 Jackson 직렬화 원문을 jsonb 로 넣는다. 탈퇴자는 대문자 표기로 정규식을 확인한다.
        Map<String, Map<String, Object>> envelopes = Map.of(
                "active", envelope("active", ACTIVE.toString()),
                "withdrawn", envelope("withdrawn", WITHDRAWN.toString().toUpperCase()),
                "short", envelope("short", "1-1-1-1-1"));
        envelopes.forEach((id, body) -> jdbc.update("INSERT INTO inbound_events(event_id,envelope) VALUES(?,?::jsonb)",
                id, Json.write(body)));
        List<Map<String, Object>> fences = jdbc.queryForList("SELECT * FROM user_fences ORDER BY user_id");
        List<Map<String, Object>> tokens = jdbc.queryForList("SELECT * FROM device_tokens ORDER BY device_token");
        String activeBefore = jdbc.queryForObject("SELECT envelope::text FROM inbound_events WHERE event_id='active'",
                String.class);

        // V11 에서 멈춘다. LATEST 로 올리면 뒤 마이그레이션이 더한 열(V13 delivery_tag)이 아래 SELECT * 비교를 깬다.
        migrate(MigrationVersion.fromVersion("11"));

        assertThat(jdbc.queryForMap("SELECT user_id,envelope IS NULL AS purged FROM inbound_events"
                + " WHERE event_id='withdrawn'")).containsEntry("user_id", WITHDRAWN).containsEntry("purged", true);
        assertThat(jdbc.queryForMap("SELECT user_id,envelope::text AS envelope FROM inbound_events"
                + " WHERE event_id='active'")).containsEntry("user_id", ACTIVE).containsEntry("envelope", activeBefore);
        // 축약형 userId 는 캐스트하지 않는다 — 마이그레이션이 실패하지 않고 원문이 남는다.
        assertThat(jdbc.queryForMap("SELECT user_id,envelope IS NULL AS purged FROM inbound_events"
                + " WHERE event_id='short'")).containsEntry("user_id", null).containsEntry("purged", false);
        assertThat(jdbc.queryForList("SELECT * FROM user_fences ORDER BY user_id")).isEqualTo(fences);
        assertThat(jdbc.queryForList("SELECT * FROM device_tokens ORDER BY device_token")).isEqualTo(tokens);
        // 백필 해시는 실행 중 비교식과 같다 — 원문이 지워진 행도 같은 봉투의 재전달을 중복으로 알아본다.
        envelopes.forEach((id, body) -> assertThat(jdbc.queryForObject("SELECT envelope_hash="
                + InboundService.ENVELOPE_HASH + " FROM inbound_events WHERE event_id=?", Boolean.class,
                Json.write(body), id)).as(id).isTrue());
    }

    private static Map<String, Object> envelope(String id, String user) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("eventId", id);
        body.put("schemaVersion", 1);
        body.put("type", "notification.requested");
        body.put("userId", user);
        body.put("version", 1);
        body.put("occurredAt", "2026-10-24T00:00:00Z");
        body.put("params", Map.of("kind", "FRIEND_REQUEST", "counterpartNickname", "탈퇴 전 이름"));
        return body;
    }

    private static void migrate(MigrationVersion target) {
        Flyway.configure()
                .dataSource(PG.getJdbcUrl(), PG.getUsername(), PG.getPassword())
                .locations("classpath:db/migration")
                .target(target)
                .load()
                .migrate();
    }
}
