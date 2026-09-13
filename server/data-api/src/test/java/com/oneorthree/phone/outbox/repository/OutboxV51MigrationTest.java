package com.oneorthree.phone.outbox.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationInfo;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V51(내구 이벤트·명령 기반, GROMO-1659·1660 공통)의 <b>실 SQL</b> 검증.
 *
 * <p>이 검사가 필요한 이유는 하나다 — <b>CI 는 마이그레이션을 돌리지 않는다</b>({@code create-drop} +
 * {@code flyway.enabled=false}). 그래서 마이그레이션에만 있는 것(제약·부분 인덱스·CHECK)은 실제
 * Flyway 를 태워야만 드러난다. 수동 DDL 로 테이블을 만들어 검사하면 검증되는 것은 그 DDL 뿐이다.
 *
 * <p>보는 것: ① V50 까지는 네 테이블이 없다, ② V51 이 만든다, ③ 순서·dedup 을 지키는 <b>제약이
 * 실제로 거부</b>한다(같은 eventId · 같은 (축, version) · 한 봉투의 같은 대상 · 모르는 target).
 */
class OutboxV51MigrationTest {

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
    @DisplayName("V50 까지는 네 테이블이 없고, V51 이 만든다")
    void createsFourTablesAtV51() {
        migrate("50");
        assertThat(hasTable("event_outbox")).isFalse();
        assertThat(hasTable("event_outbox_deliveries")).isFalse();
        assertThat(hasTable("aggregate_versions")).isFalse();
        assertThat(hasTable("command_idempotency")).isFalse();

        migrate("51");

        assertThat(hasTable("event_outbox")).isTrue();
        assertThat(hasTable("event_outbox_deliveries")).isTrue();
        assertThat(hasTable("aggregate_versions")).isTrue();
        assertThat(hasTable("command_idempotency")).isTrue();
    }

    @Test
    @DisplayName("같은 eventId 는 두 번 적히지 않는다 — 소비 측 dedup 의 근거가 유일해야 한다")
    void rejectsDuplicateEventId() {
        migrate("51");
        UUID userId = UUID.randomUUID();
        insertEnvelope(UUID.randomUUID(), "friend.requested:abc", userId, "USER", userId.toString(), 1);

        assertThatThrownBy(() -> insertEnvelope(
                UUID.randomUUID(), "friend.requested:abc", userId, "USER", userId.toString(), 2))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("같은 순서 축에서 같은 version 이 두 번 나오면 거부한다 — 발급 경로의 버그를 즉시 드러낸다")
    void rejectsDuplicateVersionInSameAggregate() {
        migrate("51");
        UUID userId = UUID.randomUUID();
        insertEnvelope(UUID.randomUUID(), "a", userId, "USER", userId.toString(), 7);

        assertThatThrownBy(() -> insertEnvelope(
                UUID.randomUUID(), "b", userId, "USER", userId.toString(), 7))
                .isInstanceOf(DataIntegrityViolationException.class);

        // 축이 다르면 같은 번호가 정상이다 — 링크 멤버십 전이는 유저와 «다른 축»이다(A22 ㋥).
        insertEnvelope(UUID.randomUUID(), "c", userId, "LINK_MEMBERSHIP", "g:i", 7);
        assertThat(count("event_outbox")).isEqualTo(2);
    }

    @Test
    @DisplayName("한 봉투에 같은 대상 행은 하나뿐이다 — 둘이면 그 대상이 두 번 전달된다")
    void rejectsDuplicateTargetForSameEnvelope() {
        migrate("51");
        UUID userId = UUID.randomUUID();
        UUID outboxId = UUID.randomUUID();
        insertEnvelope(outboxId, "a", userId, "USER", userId.toString(), 1);
        insertDelivery(outboxId, "KAFKA", userId.toString(), 1);

        assertThatThrownBy(() -> insertDelivery(outboxId, "KAFKA", userId.toString(), 1))
                .isInstanceOf(DataIntegrityViolationException.class);

        insertDelivery(outboxId, "LINK", userId.toString(), 1);
        assertThat(count("event_outbox_deliveries")).isEqualTo(2);
    }

    @Test
    @DisplayName("모르는 전달 대상은 CHECK 가 막는다 — 오타 난 대상이 조용히 미전달로 쌓이지 않게")
    void rejectsUnknownTarget() {
        migrate("51");
        UUID userId = UUID.randomUUID();
        UUID outboxId = UUID.randomUUID();
        insertEnvelope(outboxId, "a", userId, "USER", userId.toString(), 1);

        assertThatThrownBy(() -> insertDelivery(outboxId, "SLACK", userId.toString(), 1))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("봉투를 지우면 전달 행도 함께 지워진다 — 고아 전달 행이 영원히 재시도되지 않게")
    void cascadesDeliveriesOnEnvelopeDelete() {
        migrate("51");
        UUID userId = UUID.randomUUID();
        UUID outboxId = UUID.randomUUID();
        insertEnvelope(outboxId, "a", userId, "USER", userId.toString(), 1);
        insertDelivery(outboxId, "KAFKA", userId.toString(), 1);

        jdbc.update("DELETE FROM event_outbox WHERE id = ?", outboxId);

        assertThat(count("event_outbox_deliveries")).isZero();
    }

    @Test
    @DisplayName("미전달 부분 인덱스 둘이 실제로 존재한다 — relay 의 매 틱 전체 스캔을 막는 것이 이 둘이다")
    void createsPartialIndexesForRelayScan() {
        migrate("51");
        assertThat(indexDefinition("idx_event_outbox_deliveries_pending"))
                .contains("delivered_at IS NULL");
        assertThat(indexDefinition("idx_event_outbox_deliveries_ordering"))
                .contains("delivered_at IS NULL");
    }

    // ── 시드 ────────────────────────────────────────────────────────────

    private void insertEnvelope(UUID id, String eventId, UUID userId, String type, String aggId, long version) {
        jdbc.update("INSERT INTO event_outbox (id, event_id, schema_version, type, occurred_at,"
                        + " user_id, aggregate_type, aggregate_id, version, params, created_at)"
                        + " VALUES (?, ?, 1, 'TEST', now(), ?, ?, ?, ?, '{}'::jsonb, now())",
                id, eventId, userId, type, aggId, version);
    }

    private void insertDelivery(UUID outboxId, String target, String aggId, long version) {
        jdbc.update("INSERT INTO event_outbox_deliveries (id, outbox_id, target, aggregate_type,"
                        + " aggregate_id, aggregate_version, payload, attempt_count, next_attempt_at, created_at)"
                        + " VALUES (?, ?, ?, 'USER', ?, ?, '{}'::jsonb, 0, now(), now())",
                UUID.randomUUID(), outboxId, target, aggId, version);
    }

    private boolean hasTable(String table) {
        Integer found = jdbc.queryForObject(
                "SELECT count(*) FROM information_schema.tables"
                        + " WHERE table_schema = 'public' AND table_name = ?", Integer.class, table);
        return found != null && found > 0;
    }

    private int count(String table) {
        Integer found = jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
        return found == null ? 0 : found;
    }

    private String indexDefinition(String indexName) {
        return jdbc.queryForObject(
                "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = ?",
                String.class, indexName);
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
     * 요청 버전 이하의 <b>실재하는</b> 최고 버전으로 타깃을 해석한다(V41·V42·V44·V49 테스트 관례) —
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
