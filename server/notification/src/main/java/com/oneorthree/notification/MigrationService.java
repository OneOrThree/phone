package com.oneorthree.notification;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;

/**
 * 이관 적재·검증과 «공통 발송 게이트»(§7.1.2 · A22 ㋭).
 * 게이트 개방은 태그 하나를 믿지 않는다 — 개방 시점에 실제 DB 를 다시 훑어 건수·체크섬·렌더까지
 * 재확인하고, 정지 창 증거가 없으면 fail-closed 로 닫힌 채 둔다.
 */
@Service
class MigrationService {

    private static final int MAX_REPLAY = 200;
    private static final int MAX_FAILURES = 50;
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private final Store store;
    private final AdminAudit audit;
    private final Renderer renderer;
    private final Clock clock;
    private final boolean generationRequired;

    MigrationService(Store store, AdminAudit audit, Renderer renderer, Clock clock,
            @Value("${notification.generation-required:false}") boolean generationRequired) {
        this.store = store;
        this.audit = audit;
        this.renderer = renderer;
        this.clock = clock;
        this.generationRequired = generationRequired;
    }

    // ── 상태 조회 ───────────────────────────────────────────────────────

    @Transactional
    public Map<String, Object> state(String actor, String migrationId) {
        audit.record(actor, "migration.state", migrationId, Map.of());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("migrationId", migrationId);
        Map<String, Object> state = store.one("SELECT version,manifest::text AS manifest,verified_at,opened_at"
                + " FROM migration_state WHERE id=?", migrationId);
        result.put("version", state == null ? 0L : state.get("version"));
        result.put("manifest", state == null ? null : Json.map(state.get("manifest")));
        result.put("verifiedAt", state == null ? null : AdminCatalog.instant(state.get("verified_at")));
        result.put("openedAt", state == null ? null : AdminCatalog.instant(state.get("opened_at")));
        result.put("imported", store.rows("SELECT split_part(record_key,':',1) AS resource,count(*) AS total"
                + " FROM imports WHERE migration_id=? GROUP BY 1 ORDER BY 1", migrationId));
        result.put("dispatch", gate());
        return result;
    }

    private Map<String, Object> gate() {
        Map<String, Object> row = store.one("SELECT enabled,ever_opened,active_migration_id,updated_at"
                + " FROM dispatch_control WHERE id=1");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("enabled", row != null && Boolean.TRUE.equals(row.get("enabled")));
        result.put("everOpened", row != null && Boolean.TRUE.equals(row.get("ever_opened")));
        result.put("activeMigrationId", row == null ? null : row.get("active_migration_id"));
        result.put("updatedAt", row == null ? null : AdminCatalog.instant(row.get("updated_at")));
        return result;
    }

    /**
     * 이관 경로의 «첫 잠금». import·verify·open 이 전부 같은 순서(gate → migration_state → 실제 행)로
     * 들어가게 만든다.
     *
     * <p>순서를 통일하지 않으면 두 가지가 동시에 깨진다. ① 같은 id 의 import(gate→state)와
     * open(state→gate)이 반대 순서라 교착할 수 있다. ② open 이 실제 행 검사를 «끝낸 뒤»에야 게이트를
     * 잡으면, 그 사이에 커밋된 다른 적재의 미검증 쓰기를 포함한 채로 발송이 열린다. open 은 배타
     * 잠금을 먼저 확보해 진행 중인 적재가 전부 끝난 뒤에 최종 검사를 시작한다.
     *
     * <p>{@code active_migration_id} 는 그 위에 하나를 더 닫는다 — settings·device_tokens·deliveries 는
     * 이관들 사이에 «공유»되므로, 서로 다른 id 가 같은 저장소에 적재하면 한쪽의 최종 검사 대상과 실제
     * 열리는 데이터가 어긋난다. 같은 id 의 재개는 그대로 통과한다.
     *
     * @param exclusive open·import 처럼 뒤에 쓰기가 따르면 true (FOR UPDATE), verify 는 false (FOR SHARE)
     */
    private Map<String, Object> lockGate(String migrationId, boolean exclusive) {
        Map<String, Object> control = store.one("SELECT ever_opened,active_migration_id FROM dispatch_control"
                + " WHERE id=1 " + (exclusive ? "FOR UPDATE" : "FOR SHARE"));
        if (control == null) {
            throw new NotificationFailure(409, "DISPATCH_CONTROL_MISSING");
        }
        Object active = control.get("active_migration_id");
        if (active != null && !active.toString().equals(migrationId)) {
            throw new NotificationFailure(409, "MIGRATION_ID_CONFLICT");
        }
        return control;
    }

    /** 활성 이관을 이 id 로 묶는다. 이미 같은 id 면 no-op 이고, 다른 id 는 lockGate 가 이미 막았다. */
    private void bind(String migrationId) {
        store.update("UPDATE dispatch_control SET active_migration_id=? WHERE id=1 AND active_migration_id IS NULL",
                migrationId);
    }

    // ── 적재 ────────────────────────────────────────────────────────────

    /** 게이트가 한 번이라도 열린 뒤에는 적재를 받지 않는다 — 개방 시점부터 roll-forward 전용이다. */
    @Transactional
    public Map<String, Object> importRecords(String actor, String migrationId, Map<String, Object> body, String key) {
        List<?> records = list(body);
        audit.record(actor, "migration.import", migrationId, Map.of("records", records.size()));
        return store.command("migration-import:" + migrationId, key,
                Map.of("migrationId", migrationId, "records", records), () -> {
                    // 배타 잠금이다 — 동시에 들어온 open 은 이 적재가 커밋된 «뒤에» 최종 검사를 시작한다.
                    // FOR SHARE 로는 open 이 검사를 먼저 끝내고 그 결과로 열어 버릴 수 있다.
                    Map<String, Object> control = lockGate(migrationId, true);
                    if (Boolean.TRUE.equals(control.get("ever_opened"))) {
                        throw new NotificationFailure(409, "IMPORT_CLOSED");
                    }
                    bind(migrationId);
                    return apply(migrationId, records);
                });
    }

    private List<?> list(Map<String, Object> body) {
        if (!(body.get("records") instanceof List<?> records) || records.isEmpty()) {
            throw new NotificationFailure(400, "INVALID_records");
        }
        if (records.size() > MigrationRecords.MAX_RECORDS) {
            throw new NotificationFailure(400, "TOO_MANY_RECORDS");
        }
        return records;
    }

    private Map<String, Object> apply(String migrationId, List<?> records) {
        Map<String, Long> outcome = new TreeMap<>();
        List<String> seen = new ArrayList<>();
        for (Object entry : records) {
            if (!(entry instanceof Map<?, ?>)) {
                throw new NotificationFailure(400, "INVALID_records");
            }
            Map<String, Object> record = Json.map(entry);
            String resource = Json.text(record, "resource");
            Map<String, Object> canonical = MigrationRecords.canonical(resource, AdminCatalog.object(record, "data"));
            String bare = MigrationRecords.recordKey(resource, canonical);
            String declared = Json.nullableText(record, "recordKey");
            if (declared != null && !declared.equals(bare)) {
                throw new NotificationFailure(400, "RECORD_KEY_MISMATCH");
            }
            String recordKey = resource + ":" + bare;
            if (seen.contains(recordKey)) {
                throw new NotificationFailure(400, "DUPLICATE_RECORD_KEY");
            }
            seen.add(recordKey);
            String checksum = MigrationRecords.checksum(canonical);
            Map<String, Object> previous = store.one("SELECT checksum FROM imports"
                    + " WHERE migration_id=? AND record_key=? FOR UPDATE", migrationId, recordKey);
            if (previous != null && checksum.equals(previous.get("checksum"))) {
                outcome.merge("SKIPPED", 1L, Long::sum);
                continue;
            }
            // 체크섬이 다르면 «전체 레코드»를 다시 쓴다. 부분 갱신은 뒤늦은 opt-out 을 영구히 건너뛴다.
            String status = write(resource, canonical);
            store.update("INSERT INTO imports(migration_id,record_key,checksum,record,status,imported_at)"
                    + " VALUES(?,?,?,?::jsonb,?,?) ON CONFLICT(migration_id,record_key) DO UPDATE SET"
                    + " checksum=EXCLUDED.checksum,record=EXCLUDED.record,status=EXCLUDED.status,"
                    + "imported_at=EXCLUDED.imported_at", migrationId, recordKey, checksum,
                    Json.write(canonical), status, Timestamp.from(clock.instant()));
            outcome.merge(status, 1L, Long::sum);
        }
        // 데이터가 바뀌었으므로 이전 검증은 무효다. 재검증 없이 열 수 없게 만든다.
        store.update("UPDATE migration_state SET verified_at=NULL WHERE id=?", migrationId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("migrationId", migrationId);
        result.put("total", (long) records.size());
        result.put("outcome", outcome);
        result.put("verificationCleared", true);
        return result;
    }

    private String write(String resource, Map<String, Object> record) {
        return switch (resource) {
            case "settings" -> writeSettings(record);
            case "device" -> writeDevice(record);
            case "delivery" -> writeDelivery(record);
            default -> throw new NotificationFailure(400, "UNKNOWN_MIGRATION_RESOURCE");
        };
    }

    private String writeSettings(Map<String, Object> record) {
        UUID user = MigrationRecords.uuid(record.get("userId"));
        // 라이브 변경이 더 최신이면 덮지 않는다. SettingsService 와 같은 version 규칙이다.
        int written = store.update("INSERT INTO settings(user_id,version,notification_enabled,sound_enabled,"
                + "night_mode_enabled,night_start_time,night_end_time) VALUES(?,?,?,?,?,?::time,?::time)"
                + " ON CONFLICT(user_id) DO UPDATE SET version=EXCLUDED.version,"
                + "notification_enabled=EXCLUDED.notification_enabled,sound_enabled=EXCLUDED.sound_enabled,"
                + "night_mode_enabled=EXCLUDED.night_mode_enabled,night_start_time=EXCLUDED.night_start_time,"
                + "night_end_time=EXCLUDED.night_end_time WHERE settings.version<EXCLUDED.version",
                user, record.get("version"), record.get("notificationEnabled"), record.get("soundEnabled"),
                record.get("nightModeEnabled"), record.get("nightStartTime"), record.get("nightEndTime"));
        return written == 0 ? "SUPERSEDED" : "IMPORTED";
    }

    /**
     * 기기 토큰 적재. 이관은 «자기가 만든 최초 행»만 갱신한다.
     * 라이브 등록이 남긴 흔적(부트스트랩 해시 · 세션 epoch · 올라간 ownership_version)이 하나라도 있으면
     * 건드리지 않는다 — 계정 전환으로 B 에게 넘어간 토큰을 A 의 구 export 가 되돌리면 A 의 알림이
     * B 의 기기로 가고, ownership_token 은 B 값 그대로라 등록 CAS 로도 잡히지 않는다.
     * 전역 락은 «동시 실행»만 막지 순서 역행을 막지 못하므로 provenance 로 닫는다.
     */
    private String writeDevice(Map<String, Object> record) {
        UUID user = MigrationRecords.uuid(record.get("userId"));
        store.lock("device-ownership");
        Long generation = record.get("authGeneration") == null ? null
                : ((Number) record.get("authGeneration")).longValue();
        Map<String, Object> fence = store.one("SELECT auth_generation,withdrawn FROM user_fences WHERE user_id=?",
                user);
        if (fence != null) {
            if (Boolean.TRUE.equals(fence.get("withdrawn"))) {
                return "SKIPPED";
            }
            // 오래된 «등록»도 막아야 한다(A22 ㉴). 세대가 올라간 뒤 도착한 구 export 는 버린다.
            if (generation != null && generation < ((Number) fence.get("auth_generation")).longValue()) {
                return "SKIPPED";
            }
        }
        // ownership_token 은 충돌 시 손대지 않는다. active 는 AND 로만 접혀 tombstone 을 되살리지 못한다(ⓡ).
        int written = store.update("INSERT INTO device_tokens(device_token,user_id,ownership_token,auth_generation,"
                + "active) VALUES(?,?,?,?,?) ON CONFLICT(device_token) DO UPDATE SET "
                + "auth_generation=GREATEST(COALESCE(device_tokens.auth_generation,0),"
                + "COALESCE(EXCLUDED.auth_generation,0)),active=device_tokens.active AND EXCLUDED.active,"
                + "updated_at=now() WHERE device_tokens.user_id=EXCLUDED.user_id"
                + " AND device_tokens.bootstrap_hash IS NULL AND device_tokens.session_epoch IS NULL"
                + " AND device_tokens.ownership_version=1 AND device_tokens.active",
                record.get("deviceToken"), user, UUID.randomUUID(), generation, record.get("active"));
        return written == 0 ? "SUPERSEDED" : "IMPORTED";
    }

    private String writeDelivery(Map<String, Object> record) {
        UUID user = MigrationRecords.uuid(record.get("userId"));
        if (withdrawn(user)) {
            return "SKIPPED";
        }
        if (store.one("SELECT id FROM kinds WHERE id=?", record.get("kind")) == null) {
            throw new NotificationFailure(422, "UNKNOWN_NOTIFICATION_KIND");
        }
        // SENT·SUPPRESSED 종결 행은 되살리지 않는다 — 재훑기가 같은 회차를 다시 선점해 중복 푸시가 된다(ⓗ).
        int written = store.update("INSERT INTO deliveries(id,event_id,user_id,kind,subject_id,group_id,slot_at,"
                + "payload,locale,status,attempts,next_attempt_at,sent_at) "
                + "VALUES(?,?,?,?,?,?,?,?::jsonb,?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET"
                + " user_id=EXCLUDED.user_id,kind=EXCLUDED.kind,subject_id=EXCLUDED.subject_id,"
                + "group_id=EXCLUDED.group_id,slot_at=EXCLUDED.slot_at,payload=EXCLUDED.payload,"
                + "locale=EXCLUDED.locale,status=EXCLUDED.status,attempts=EXCLUDED.attempts,"
                + "next_attempt_at=EXCLUDED.next_attempt_at,sent_at=EXCLUDED.sent_at"
                + " WHERE deliveries.status NOT IN ('SENT','SUPPRESSED')",
                UUID.randomUUID(), record.get("eventId"), user, record.get("kind"), record.get("subjectId"),
                MigrationRecords.uuid(record.get("groupId")), MigrationRecords.timestamp(record.get("slotAt")),
                Json.write(record.get("params")), record.get("locale"),
                MigrationRecords.status(record.get("status").toString()), record.get("attempts"),
                MigrationRecords.timestamp(record.get("nextAttemptAt")),
                MigrationRecords.timestamp(record.get("sentAt")));
        return written == 0 ? "SUPERSEDED" : "IMPORTED";
    }

    private boolean withdrawn(UUID user) {
        Map<String, Object> fence = store.one("SELECT withdrawn FROM user_fences WHERE user_id=?", user);
        return fence != null && Boolean.TRUE.equals(fence.get("withdrawn"));
    }

    // ── 검증 ────────────────────────────────────────────────────────────

    @Transactional
    public Map<String, Object> verify(String actor, String migrationId, Map<String, Object> body) {
        Map<String, Object> manifest = AdminCatalog.object(body, "manifest");
        audit.record(actor, "migration.verify", migrationId, Map.of("manifestVersion", Json.number(manifest,
                "version")));
        // 검증도 같은 순서로 게이트부터 잡는다 — 진행 중인 적재와 섞인 스냅샷을 「검증 통과」로 남기지 않는다.
        lockGate(migrationId, false);
        Map<String, Object> report = inspect(migrationId, manifest);
        boolean verified = Boolean.TRUE.equals(report.get("verified"));
        int written = store.update("INSERT INTO migration_state(id,version,manifest,verified_at)"
                + " VALUES(?,?,?::jsonb,?) ON CONFLICT(id) DO UPDATE SET version=EXCLUDED.version,"
                + "manifest=EXCLUDED.manifest,verified_at=EXCLUDED.verified_at"
                + " WHERE migration_state.version<=EXCLUDED.version", migrationId,
                Json.number(manifest, "version"), Json.write(manifest),
                verified ? Timestamp.from(clock.instant()) : null);
        if (written == 0) {
            throw new NotificationFailure(409, "MANIFEST_VERSION_REGRESSED");
        }
        return report;
    }

    /** 실제 DB 를 훑는다. imports 의 소스 레코드와 «필드 단위»로 대조하고 미발송 행은 렌더까지 돌린다. */
    private Map<String, Object> inspect(String migrationId, Map<String, Object> manifest) {
        List<Map<String, Object>> rows = store.rows("SELECT record_key,checksum,status,record::text AS record"
                + " FROM imports WHERE migration_id=? ORDER BY record_key", migrationId);
        Map<String, Long> counts = new TreeMap<>();
        Map<String, StringBuilder> folds = new TreeMap<>();
        // 0건 자원도 «접은 값»이 있어야 한다. Data 내보내기는 세 자원을 언제나 manifest 에 싣고 빈
        // 집합을 SHA256("") 로 채운다(NotificationMigrationManifest.ResourceDigest). 여기서 비워 두면
        // 그 자원의 checksums 가 null 이라, 알림 이력이 아직 없는 환경의 «정상» export 가 건수 0 은
        // 맞는데도 매번 CHECKSUM_MISMATCH 로 막혀 verify·최초 개방을 끝낼 수 없다.
        // counts 에는 넣지 않는다 — 선언하지 않은 자원을 UNDECLARED_RESOURCE 로 잘못 걸게 된다.
        MigrationRecords.RESOURCES.forEach(resource -> folds.put(resource, new StringBuilder()));
        Map<String, Long> superseded = new TreeMap<>();
        Map<String, Long> skipped = new TreeMap<>();
        List<Map<String, Object>> failures = new ArrayList<>();
        long failed = 0;
        for (Map<String, Object> row : rows) {
            String recordKey = row.get("record_key").toString();
            int separator = recordKey.indexOf(':');
            String resource = separator < 0 ? "" : recordKey.substring(0, separator);
            counts.merge(resource, 1L, Long::sum);
            folds.computeIfAbsent(resource, ignored -> new StringBuilder())
                    .append(recordKey).append('=').append(row.get("checksum")).append('\n');
            // SKIPPED 는 탈퇴 tombstone·세대 펜스로 «일부러» 넣지 않은 레코드다. 대상 행이 없는 게 정상이다.
            boolean fenced = "SKIPPED".equals(row.get("status"));
            Map<String, Object> failure = fenced ? null : compare(resource, Json.map(row.get("record")));
            if (failure != null) {
                failed++;
                if (failures.size() < MAX_FAILURES) {
                    failure.put("recordKey", recordKey);
                    failures.add(failure);
                }
            } else if (fenced) {
                skipped.merge(resource, 1L, Long::sum);
            } else if ("SUPERSEDED".equals(row.get("status"))) {
                superseded.merge(resource, 1L, Long::sum);
            }
        }
        Map<String, Object> checksums = new TreeMap<>();
        folds.forEach((resource, fold) -> checksums.put(resource, Json.digest(fold.toString())));
        failed += manifestGaps(manifest, counts, checksums, failures);
        failed += stopWindow(manifest, failures);
        Map<String, Object> report = new LinkedHashMap<>();
        report.put("migrationId", migrationId);
        report.put("verified", failed == 0);
        report.put("records", (long) rows.size());
        report.put("counts", counts);
        report.put("checksums", checksums);
        report.put("supersededByLiveWrite", superseded);
        report.put("skippedByFence", skipped);
        report.put("failureCount", failed);
        report.put("failures", failures);
        return report;
    }

    private long manifestGaps(Map<String, Object> manifest, Map<String, Long> counts,
            Map<String, Object> checksums, List<Map<String, Object>> failures) {
        Map<String, Object> declared = AdminCatalog.object(manifest, "resources");
        long failed = 0;
        for (String resource : counts.keySet()) {
            if (!declared.containsKey(resource)) {
                failed++;
                failures.add(fail("UNDECLARED_RESOURCE", resource, null, null));
            }
        }
        for (Map.Entry<String, Object> entry : declared.entrySet()) {
            Map<String, Object> expected = Json.map(entry.getValue());
            long count = counts.getOrDefault(entry.getKey(), 0L);
            long wanted = Json.number(expected, "count");
            if (count != wanted) {
                failed++;
                failures.add(fail("COUNT_MISMATCH", entry.getKey(), wanted, count));
            }
            String checksum = (String) checksums.get(entry.getKey());
            if (!Json.text(expected, "checksum").equals(checksum)) {
                failed++;
                failures.add(fail("CHECKSUM_MISMATCH", entry.getKey(), Json.text(expected, "checksum"), checksum));
            }
        }
        return failed;
    }

    /** 정지 창 증거가 없거나 큐가 비지 않았으면 실패다. 「끝났다」는 태그만으로는 열지 않는다. */
    private long stopWindow(Map<String, Object> manifest, List<Map<String, Object>> failures) {
        Map<String, Object> evidence = AdminCatalog.object(manifest, "stopWindow");
        long depth = Json.number(evidence, "queueDepth");
        Json.number(evidence, "closedAt");
        Json.text(evidence, "cursor");
        Json.text(evidence, "source");
        if (depth != 0) {
            failures.add(fail("STOP_WINDOW_NOT_DRAINED", "stopWindow", 0L, depth));
            return 1;
        }
        return 0;
    }

    private static Map<String, Object> fail(String reason, String scope, Object expected, Object actual) {
        Map<String, Object> failure = new LinkedHashMap<>();
        failure.put("reason", reason);
        failure.put("scope", scope);
        failure.put("expected", expected);
        failure.put("actual", actual);
        return failure;
    }

    private Map<String, Object> compare(String resource, Map<String, Object> source) {
        return switch (resource) {
            case "settings" -> compareSettings(source);
            case "device" -> compareDevice(source);
            case "delivery" -> compareDelivery(source);
            default -> fail("UNKNOWN_MIGRATION_RESOURCE", resource, null, null);
        };
    }

    private Map<String, Object> compareSettings(Map<String, Object> source) {
        Map<String, Object> row = store.one("SELECT * FROM settings WHERE user_id=?",
                MigrationRecords.uuid(source.get("userId")));
        if (row == null) {
            return fail("TARGET_ROW_MISSING", "settings", null, null);
        }
        Map<String, Object> target = MigrationRecords.fromSettings(row);
        long sourceVersion = ((Number) source.get("version")).longValue();
        long targetVersion = ((Number) target.get("version")).longValue();
        if (targetVersion < sourceVersion) {
            return fail("VERSION_REGRESSED", "settings", sourceVersion, targetVersion);
        }
        if (targetVersion > sourceVersion) {
            return null;
        }
        return diff(source, target, "settings", "notificationEnabled", "soundEnabled", "nightModeEnabled",
                "nightStartTime", "nightEndTime");
    }

    private Map<String, Object> compareDevice(Map<String, Object> source) {
        Map<String, Object> row = store.one("SELECT * FROM device_tokens WHERE device_token=?",
                source.get("deviceToken"));
        if (row == null) {
            return fail("TARGET_ROW_MISSING", "device", null, null);
        }
        Map<String, Object> target = MigrationRecords.fromDevice(row);
        // 라이브 등록·삭제가 남긴 흔적. 이게 있으면 어긋남을 «살아 있는 쓰기»가 설명한다.
        boolean live = row.get("bootstrap_hash") != null || row.get("session_epoch") != null
                || ((Number) row.get("ownership_version")).longValue() > 1;
        if (!same(source.get("userId"), target.get("userId"))) {
            // 라이브 흔적 없이 주인이 다르면 내보내기 쪽 토큰 중복이다(§7.1 ②″). 조용히 넘기지 않는다.
            return live ? null
                    : fail("FIELD_MISMATCH", "device.userId", source.get("userId"), target.get("userId"));
        }
        long sourceGeneration = source.get("authGeneration") == null ? 0
                : ((Number) source.get("authGeneration")).longValue();
        long targetGeneration = target.get("authGeneration") == null ? 0
                : ((Number) target.get("authGeneration")).longValue();
        if (targetGeneration < sourceGeneration) {
            return live ? null : fail("GENERATION_REGRESSED", "device", sourceGeneration, targetGeneration);
        }
        // 살아 있는 tombstone 이 다시 켜지는 방향만 실패다. 그 반대(true→false)는 라이브 로그아웃이다.
        if (!Boolean.TRUE.equals(source.get("active")) && Boolean.TRUE.equals(target.get("active"))) {
            return fail("TOMBSTONE_RESURRECTED", "device", false, true);
        }
        return null;
    }

    private Map<String, Object> compareDelivery(Map<String, Object> source) {
        Map<String, Object> row = store.one("SELECT * FROM deliveries WHERE event_id=?", source.get("eventId"));
        if (row == null) {
            return fail("TARGET_ROW_MISSING", "delivery", null, null);
        }
        Map<String, Object> target = MigrationRecords.fromDelivery(row);
        Map<String, Object> mismatch = diff(source, target, "delivery", "userId", "kind", "subjectId", "groupId",
                "slotAt", "locale", "params");
        if (mismatch != null) {
            return mismatch;
        }
        String sourceStatus = source.get("status").toString();
        String targetStatus = target.get("status").toString();
        if (sourceStatus.equals(targetStatus)) {
            mismatch = diff(source, target, "delivery", "attempts", "nextAttemptAt", "sentAt");
            if (mismatch != null) {
                return mismatch;
            }
        } else if (!"PENDING".equals(sourceStatus) && !"DEFERRED".equals(sourceStatus)) {
            return fail("STATUS_REGRESSED", "delivery", sourceStatus, targetStatus);
        }
        // 미발송 행은 코어 추가 조회 없이 렌더돼야 한다(§7.1.1). 여기서 막지 않으면 개방 직후 터진다.
        if ("PENDING".equals(targetStatus) || "DEFERRED".equals(targetStatus)) {
            try {
                renderer.render(target.get("kind").toString(), (String) target.get("locale"),
                        AdminCatalog.object(target, "params"));
            } catch (RuntimeException failure) {
                return fail("RENDER_FAILED", "delivery", null, failure.getMessage());
            }
        }
        return null;
    }

    private static Map<String, Object> diff(Map<String, Object> source, Map<String, Object> target, String scope,
            String... keys) {
        for (String key : keys) {
            if (!same(source.get(key), target.get(key))) {
                return fail("FIELD_MISMATCH", scope + "." + key, source.get(key), target.get(key));
            }
        }
        return null;
    }

    private static boolean same(Object left, Object right) {
        if (left == null || right == null) {
            return left == right;
        }
        if (left instanceof Map<?, ?> || left instanceof List<?>) {
            return Json.hash(left).equals(Json.hash(right));
        }
        return left.toString().equals(right.toString());
    }

    // ── 발송 게이트 ─────────────────────────────────────────────────────

    /**
     * 게이트 개방. verified_at 태그만 보고 열지 않는다 — 여기서 실제 DB 를 다시 훑는다.
     * ever_opened 는 한 번 true 가 되면 «어떤 경로로도» false 로 돌아가지 않는다.
     */
    @Transactional(timeout = 120)
    public Map<String, Object> open(String actor, String migrationId, Map<String, Object> body, String key) {
        Map<String, Object> manifest = AdminCatalog.object(body, "manifest");
        audit.record(actor, "dispatch.open", migrationId, Map.of("manifestVersion",
                Json.number(manifest, "version")));
        return store.command("dispatch-open:" + migrationId, key, Map.of("manifest", manifest), () -> {
            // 게이트 «먼저». 이 배타 잠금이 풀릴 때까지 다른 적재는 커밋을 끝내고, 여기 아래의 최종
            // 검사는 그 이후의 DB 만 본다. 순서를 뒤집으면 검사에 안 잡힌 쓰기를 안은 채 열린다.
            lockGate(migrationId, true);
            Map<String, Object> state = store.one("SELECT version,manifest::text AS manifest,verified_at,opened_at"
                    + " FROM migration_state WHERE id=? FOR UPDATE", migrationId);
            if (state == null || state.get("verified_at") == null) {
                throw new NotificationFailure(409, "MIGRATION_NOT_VERIFIED");
            }
            if (!Json.hash(Json.map(state.get("manifest"))).equals(Json.hash(manifest))) {
                throw new NotificationFailure(409, "MANIFEST_MISMATCH");
            }
            // 구 AT 롤아웃 창(generation-required=false)에서는 최초 개방을 허용하지 않는다.
            if (!generationRequired) {
                throw new NotificationFailure(409, "GENERATION_REQUIRED_FOR_OPEN");
            }
            Instant verifiedAt = ((Timestamp) state.get("verified_at")).toInstant();
            Instant closedAt = Instant.ofEpochMilli(Json.number(AdminCatalog.object(manifest, "stopWindow"),
                    "closedAt"));
            if (!verifiedAt.isAfter(closedAt)) {
                throw new NotificationFailure(409, "VERIFICATION_BEFORE_STOP_WINDOW");
            }
            if (store.one("SELECT record_key FROM imports WHERE migration_id=? AND imported_at>? LIMIT 1",
                    migrationId, Timestamp.from(verifiedAt)) != null) {
                throw new NotificationFailure(409, "IMPORT_AFTER_VERIFICATION");
            }
            Map<String, Object> report = inspect(migrationId, manifest);
            if (!Boolean.TRUE.equals(report.get("verified"))) {
                // 표시 지우기는 여기서 못 한다 — 이 예외가 트랜잭션을 되감아 UPDATE 까지 사라진다.
                // migration_state 행에 FOR UPDATE 를 잡고 있어 중첩 트랜잭션은 자기 자신과 교착한다.
                // 컨트롤러가 이 트랜잭션이 «끝난 뒤» invalidate 를 호출한다.
                throw new NotificationFailure(409, "VERIFICATION_FAILED");
            }
            store.update("UPDATE dispatch_control SET enabled=true,ever_opened=true,active_migration_id=?,"
                    + "updated_at=now() WHERE id=1", migrationId);
            store.update("UPDATE migration_state SET opened_at=COALESCE(opened_at,?) WHERE id=?",
                    Timestamp.from(clock.instant()), migrationId);
            audit.record(actor, "dispatch.opened", migrationId, Map.of("records", report.get("records")));
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("dispatch", gate());
            result.put("report", report);
            return result;
        });
    }

    /** 재검증에 실패한 뒤 남은 낡은 «검증 통과» 표시를 지운다. open 트랜잭션이 끝난 뒤에 불린다. */
    @Transactional
    public void invalidate(String actor, String migrationId) {
        store.update("UPDATE migration_state SET verified_at=NULL WHERE id=?", migrationId);
        audit.record(actor, "migration.verification.cleared", migrationId, Map.of());
    }

    /**
     * 게이트 닫기. dispatch_control 행 UPDATE 는 DispatchService 가 잡은 FOR SHARE 가 풀릴 때까지
     * «대기»하므로, 이 호출이 돌아오는 시점에는 진행 중이던 발송이 전부 커밋·drain 돼 있다.
     */
    @Transactional(timeout = 120)
    public Map<String, Object> close(String actor, String key) {
        audit.record(actor, "dispatch.close", null, Map.of());
        return store.command("dispatch-close", key, Map.of("action", "close"), () -> {
            store.update("UPDATE dispatch_control SET enabled=false,updated_at=now() WHERE id=1");
            audit.record(actor, "dispatch.closed", null, Map.of());
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("dispatch", gate());
            result.put("drained", true);
            return result;
        });
    }

    // ── 놓친 잡 재생 ────────────────────────────────────────────────────

    /**
     * ④′~④‴ 사이에 «아무도 돌리지 않은» 예약 실행을 등록부에 내구화한다.
     * 실행 자체는 알림 등록부(잡 소유자)가 한다 — 여기서 completed_at 을 찍지 않는다.
     */
    @Transactional
    public Map<String, Object> replay(String actor, String jobId, Map<String, Object> body, String key) {
        audit.record(actor, "jobs.replay", jobId, Map.of());
        return store.command("job-replay:" + jobId, key, Map.of("body", body), () -> {
            Map<String, Object> job = store.one("SELECT id,owner,cron FROM jobs WHERE id=? FOR UPDATE", jobId);
            if (job == null) {
                // 없는 잡을 성공으로 접으면 「재생했다」는 거짓 증거가 남는다.
                throw new NotificationFailure(404, "UNKNOWN_JOB");
            }
            if (!"NOTIFICATION".equals(job.get("owner"))) {
                throw new NotificationFailure(409, "JOB_OWNED_BY_DATA");
            }
            Instant to = body.get("to") == null ? clock.instant()
                    : Instant.ofEpochMilli(Json.number(body, "to"));
            Instant from = from(jobId, body);
            if (!from.isBefore(to)) {
                throw new NotificationFailure(400, "INVALID_REPLAY_WINDOW");
            }
            CronExpression cron;
            try {
                cron = CronExpression.parse(job.get("cron").toString());
            } catch (IllegalArgumentException invalid) {
                throw new NotificationFailure(400, "INVALID_CRON");
            }
            List<String> scheduled = new ArrayList<>();
            long queued = 0;
            ZonedDateTime cursor = from.atZone(KST);
            ZonedDateTime end = to.atZone(KST);
            while (true) {
                ZonedDateTime next = cron.next(cursor);
                if (next == null || next.isAfter(end)) {
                    break;
                }
                if (scheduled.size() >= MAX_REPLAY) {
                    throw new NotificationFailure(400, "REPLAY_WINDOW_TOO_LARGE");
                }
                scheduled.add(next.toInstant().toString());
                queued += store.update("INSERT INTO job_runs(job_id,scheduled_at) VALUES(?,?)"
                        + " ON CONFLICT DO NOTHING", jobId, Timestamp.from(next.toInstant()));
                cursor = next;
            }
            audit.record(actor, "jobs.replay.queued", jobId, Map.of("missed", scheduled.size(), "queued", queued));
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("jobId", jobId);
            result.put("from", from.toString());
            result.put("to", to.toString());
            result.put("missed", (long) scheduled.size());
            result.put("queued", queued);
            result.put("scheduledAt", scheduled);
            // 실행은 등록부가 한다. 여기서 「성공」으로 표시하지 않는다.
            result.put("executed", false);
            return result;
        });
    }

    private Instant from(String jobId, Map<String, Object> body) {
        if (body.get("from") != null) {
            return Instant.ofEpochMilli(Json.number(body, "from"));
        }
        Map<String, Object> last = store.one("SELECT max(scheduled_at) AS last FROM job_runs"
                + " WHERE job_id=? AND completed_at IS NOT NULL", jobId);
        if (last == null || last.get("last") == null) {
            throw new NotificationFailure(400, "REPLAY_WINDOW_REQUIRED");
        }
        return ((Timestamp) last.get("last")).toInstant();
    }
}
