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
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

/**
 * 이관 적재·검증과 «공통 발송 게이트»(§7.1.2 · A22 ㋭).
 * 게이트 개방은 태그 하나를 믿지 않는다 — 개방 시점에 실제 DB 를 다시 훑어 건수·체크섬·렌더까지
 * 재확인하고, 정지 창 증거가 없으면 fail-closed 로 닫힌 채 둔다.
 */
@Service
class MigrationService {

    private static final int MAX_REPLAY = 200;
    private static final int MAX_FAILURES = 50;
    private static final int MAX_SNAPSHOT_ID = 200;
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    /** 임대 재확인 주기 — 발송 하나가 끝나는 즉시 풀려나올 만큼 짧게. */
    private static final long DRAIN_POLL_MILLIS = 100;

    private final Store store;
    private final AdminAudit audit;
    private final Renderer renderer;
    private final Clock clock;
    private final boolean generationRequired;

    /**
     * 게이트를 닫은 뒤 진행 중인 발송을 기다리는 상한(초).
     *
     * <p>정상 발송은 (활성 기기 수 × 토큰당 6초)면 끝난다. 기본값은 그것을 덮되, 발송 도중 죽은
     * 워커의 임대 만료(120초)까지 기다리지는 않을 만큼이다 — 죽은 워커를 기다리는 것은 드레인이
     * 아니라 관리자 API 를 붙잡는 것이다.
     */
    private final int drainBudgetSeconds;

    MigrationService(Store store, AdminAudit audit, Renderer renderer, Clock clock,
            @Value("${notification.generation-required:false}") boolean generationRequired,
            @Value("${notification.drain-budget-seconds:30}") int drainBudgetSeconds) {
        this.drainBudgetSeconds = drainBudgetSeconds;
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
        // 세대별 분해. 「어느 스냅샷을 지목해야 하는가」를 운영자가 원장에서 바로 읽게 한다.
        result.put("snapshots", store.rows("SELECT s.snapshot_id,s.registered_at,"
                + "(SELECT count(*) FROM imports i WHERE i.migration_id=s.migration_id"
                + " AND i.snapshot_id=s.snapshot_id) AS members"
                + " FROM migration_snapshots s WHERE s.migration_id=? ORDER BY s.registered_at,s.snapshot_id",
                migrationId));
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
        Map<String, Object> control = store.one("SELECT enabled,ever_opened,active_migration_id FROM dispatch_control"
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
        String snapshot = snapshot(body);
        List<?> records = list(body, snapshot);
        audit.record(actor, "migration.import", migrationId,
                Map.of("records", records.size(), "snapshot", snapshot));
        return store.command("migration-import:" + migrationId, key,
                Map.of("migrationId", migrationId, "snapshot", snapshot, "records", records), () -> {
                    // 배타 잠금이다 — 동시에 들어온 open 은 이 적재가 커밋된 «뒤에» 최종 검사를 시작한다.
                    // FOR SHARE 로는 open 이 검사를 먼저 끝내고 그 결과로 열어 버릴 수 있다.
                    Map<String, Object> control = lockGate(migrationId, true);
                    if (Boolean.TRUE.equals(control.get("ever_opened"))) {
                        throw new NotificationFailure(409, "IMPORT_CLOSED");
                    }
                    bind(migrationId);
                    return apply(migrationId, snapshot, records);
                });
    }

    /**
     * 빈 {@code records} 는 <b>스냅샷을 선언했을 때만</b> 받는다 — 「구성원이 하나도 없는 최종
     * 스냅샷」은 실재하는 정당한 상태다(마지막 회차가 전부 정산됐거나 대상 유저가 전부 탈퇴).
     * 그것을 400 으로 막으면 전량 제거를 선언할 길이 없어 최종 매니페스트와 영영 어긋난다.
     * 스냅샷 없는 빈 요청은 아무 뜻도 없으므로 그대로 400 이다.
     */
    private List<?> list(Map<String, Object> body, String snapshot) {
        if (!(body.get("records") instanceof List<?> records)
                || (records.isEmpty() && snapshot.isEmpty())) {
            throw new NotificationFailure(400, "INVALID_records");
        }
        if (records.size() > MigrationRecords.MAX_RECORDS) {
            throw new NotificationFailure(400, "TOO_MANY_RECORDS");
        }
        return records;
    }

    /**
     * 이 청크가 실어 온 «스냅샷 세대». 한 export 를 {@code MAX_RECORDS} 씩 쪼개 올릴 때 모든 청크가
     * 같은 값을 반복한다 — 그래야 「이 키가 최신 스냅샷의 구성원인가」를 배치 경계와 무관하게 말할 수 있다.
     *
     * <p>선언하지 않으면 빈 문자열이다(단일 스냅샷 운용). 빈 문자열도 하나의 세대이고,
     * 검증이 아무 세대도 지목하지 않으면 원장 전체를 보므로 기존 운용은 그대로 통과한다.
     */
    private static String snapshot(Map<String, Object> body) {
        String declared = Json.nullableText(body, "snapshot");
        if (declared == null) {
            return "";
        }
        if (declared.isBlank() || declared.length() > MAX_SNAPSHOT_ID) {
            throw new NotificationFailure(400, "INVALID_snapshot");
        }
        return declared;
    }

    private Map<String, Object> apply(String migrationId, String snapshot, List<?> records) {
        // record 순서는 자유다. gate 다음 공통 잠금을 잡아 settings/delivery 행을 먼저 잠그지 않는다.
        store.lock("device-ownership");
        Map<String, Long> outcome = new TreeMap<>();
        List<String> seen = new ArrayList<>();
        if (!snapshot.isEmpty()) {
            // 레코드가 0건이어도 등재한다. 「선언된 공집합」이 「모르는 스냅샷」과 구분되는 근거다.
            store.update("INSERT INTO migration_snapshots(migration_id,snapshot_id) VALUES(?,?)"
                    + " ON CONFLICT DO NOTHING", migrationId, snapshot);
        }
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
            Map<String, Object> previous = store.one("SELECT checksum,snapshot_id FROM imports"
                    + " WHERE migration_id=? AND record_key=? FOR UPDATE", migrationId, recordKey);
            boolean projection = "user".equals(resource) || "participation".equals(resource);
            // 투영은 같은 원본 재적재에도 실제 행·탈퇴 fence를 다시 보장한다.
            // «같은 스냅샷»의 같은 체크섬만 건너뛴다 — 세대가 바뀌면 내용이 그대로여도 다시 적재해
            // snapshot_id 를 전진시킨다. 안 그러면 최종에도 그대로 있는 키가 옛 세대에 묶여
            // 구성원에서 빠지고, 그 행이 «사라진 것»으로 정리된다.
            boolean withdrawnSettings = "settings".equals(resource)
                    && withdrawn(MigrationRecords.uuid(canonical.get("userId")));
            if (!projection && !withdrawnSettings && previous != null && checksum.equals(previous.get("checksum"))
                    && snapshot.equals(previous.get("snapshot_id"))) {
                outcome.merge("SKIPPED", 1L, Long::sum);
                continue;
            }
            // 체크섬이 다르면 «전체 레코드»를 다시 쓴다. 부분 갱신은 뒤늦은 opt-out 을 영구히 건너뛴다.
            String status = write(migrationId, resource, canonical);
            store.update("INSERT INTO imports(migration_id,record_key,checksum,record,snapshot_id,status,"
                    + "imported_at) VALUES(?,?,?,?::jsonb,?,?,?) ON CONFLICT(migration_id,record_key)"
                    + " DO UPDATE SET checksum=EXCLUDED.checksum,record=EXCLUDED.record,"
                    + "snapshot_id=EXCLUDED.snapshot_id,status=EXCLUDED.status,"
                    + "imported_at=EXCLUDED.imported_at", migrationId, recordKey, checksum,
                    Json.write(canonical), snapshot, status, Timestamp.from(clock.instant()));
            outcome.merge(status, 1L, Long::sum);
        }
        // 데이터가 바뀌었으므로 이전 검증은 무효다. 재검증 없이 열 수 없게 만든다.
        store.update("UPDATE migration_state SET verified_at=NULL WHERE id=?", migrationId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("migrationId", migrationId);
        result.put("snapshot", snapshot);
        result.put("total", (long) records.size());
        result.put("outcome", outcome);
        result.put("verificationCleared", true);
        return result;
    }

    private String write(String migrationId, String resource, Map<String, Object> record) {
        return switch (resource) {
            case "settings" -> writeSettings(migrationId, record);
            case "device" -> writeDevice(migrationId, record);
            case "delivery" -> writeDelivery(record);
            case "user" -> writeProjection(MigrationRecords.USER_PROJECTION,
                    MigrationRecords.uuid(record.get("userId")), "", record);
            case "participation" -> writeProjection(MigrationRecords.PARTICIPATION_PROJECTION,
                    MigrationRecords.uuid(record.get("userId")), record.get("sessionId").toString(), record);
            default -> throw new NotificationFailure(400, "UNKNOWN_MIGRATION_RESOURCE");
        };
    }

    /**
     * 투영 bootstrap 적재(승인 계획 ②′). {@code InboundService.project()} 와 <b>같은 잠금·같은 펜스</b>를
     * 지난다 — 탈퇴 tombstone 을 여기서만 빠뜨리면 export~import 사이에 탈퇴한 유저의 PII 투영이
     * 되살아난다({@code DeviceService} 가 탈퇴 때 지운 바로 그 행이다).
     *
     * <h2>가드가 {@code &lt;=} 인 이유 — 라이브 경로의 {@code &lt;} 와 다르다</h2>
     * 라이브 이벤트는 같은 {@code version} 이면 <b>이미 적용된 것</b>이라 건너뛰는 게 맞다.
     * 반면 bootstrap 의 재적재는 <b>운영자가 다시 미는 같은 값</b>이다 — {@code &lt;} 로 두면 부분
     * 적재를 이어 붙이는 재시도가 조용한 no-op 이 되어 「왜 안 먹지」가 현장에서 보이지 않는다.
     * 같은 version 이면 payload 를 실제로 다시 쓰고, <b>더 높은 라이브 version 은 그대로 보존</b>한다.
     *
     * @param subject 컬렉션 투영의 축. 유저당 한 행인 투영은 빈 문자열이다(스키마 기본값과 같다)
     */
    private String writeProjection(String type, UUID user, String subject, Map<String, Object> record) {
        store.lock("device-ownership");
        if (withdrawn(user)) {
            return "SKIPPED";
        }
        int written = store.update("INSERT INTO projections(projection_type,user_id,subject_id,version,payload)"
                + " VALUES(?,?,?,?,?::jsonb) ON CONFLICT(projection_type,user_id,subject_id)"
                + " DO UPDATE SET version=EXCLUDED.version,payload=EXCLUDED.payload"
                + " WHERE projections.version<=EXCLUDED.version", type, user, subject,
                ((Number) record.get("version")).longValue(), Json.write(record));
        return written == 0 ? "SUPERSEDED" : "IMPORTED";
    }

    /**
     * 설정 적재. 더 높은 라이브 version 은 그대로 보존하되, <b>같은 version 의 «이관이 만든 행»</b> 은
     * 최종 스냅샷으로 다시 쓴다.
     *
     * <h2>같은 version 에서 멈추면 안 되는 이유 — 구 경로가 version 을 올리지 않는다</h2>
     * 구 Data 의 {@code UserService.updateNotificationSettings()} 는 유저 aggregate version 을 올리지
     * 않는다. 그런데 {@code NotificationExportService} 는 그 version 을 설정 자원의 version 으로 싣는다.
     * 그래서 초기 백필 뒤 사용자가 구 앱에서 알림을 끄면, 최종 export 는 <b>값만 바뀌고 version 은 같은</b>
     * 레코드로 온다. {@code <} 만 보면 그 opt-out 은 영영 적재되지 않고, {@code compareSettings()} 의
     * 필드 불일치도 해소되지 않아 게이트가 닫힌 채 남는다 — 반복 적재로도 풀리지 않는다.
     *
     * <h2>경계는 «이관 소유»다 — 라이브 쓰기가 닿은 행은 같은 version 에서 덮지 않는다</h2>
     * {@code imported_by} 는 이 행을 마지막으로 쓴 것이 이관인지 말한다. 라이브 명령
     * ({@code SettingsService.applyLocked}) 은 쓸 때 이 값을 NULL 로 지운다. 조건을
     * {@code settings.imported_by=EXCLUDED.imported_by} 로 두면 NULL 은 결코 같지 않으므로
     * 라이브 소유 행은 제외되고, 같은 이관이 만든 행만 갱신된다. 라이브 소유 행이 같은 version 에서
     * 내용이 어긋나면 조용히 덮지 않고 {@code compareSettings()} 가 FIELD_MISMATCH 로 닫는다.
     *
     * <p>이 갱신 창은 개방 전으로 이미 닫혀 있다 — 개방 뒤 적재는 {@code IMPORT_CLOSED} 다.
     */
    private String writeSettings(String migrationId, Map<String, Object> record) {
        UUID user = MigrationRecords.uuid(record.get("userId"));
        // apply가 공통 잠금을 보유한다. 늦은 export도 탈퇴 때 삭제한 설정을 되살리지 않는다.
        if (withdrawn(user)) {
            return "SKIPPED";
        }
        int written = store.update("INSERT INTO settings(user_id,version,notification_enabled,sound_enabled,"
                + "night_mode_enabled,night_start_time,night_end_time,imported_by)"
                + " VALUES(?,?,?,?,?,?::time,?::time,?)"
                + " ON CONFLICT(user_id) DO UPDATE SET version=EXCLUDED.version,"
                + "notification_enabled=EXCLUDED.notification_enabled,sound_enabled=EXCLUDED.sound_enabled,"
                + "night_mode_enabled=EXCLUDED.night_mode_enabled,night_start_time=EXCLUDED.night_start_time,"
                + "night_end_time=EXCLUDED.night_end_time,imported_by=EXCLUDED.imported_by"
                + " WHERE settings.version<EXCLUDED.version"
                + " OR (settings.version=EXCLUDED.version AND settings.imported_by=EXCLUDED.imported_by)",
                user, record.get("version"), record.get("notificationEnabled"), record.get("soundEnabled"),
                record.get("nightModeEnabled"), record.get("nightStartTime"), record.get("nightEndTime"),
                migrationId);
        return written == 0 ? "SUPERSEDED" : "IMPORTED";
    }

    /**
     * 기기 토큰 적재. 이관은 «자기가 만든 최초 행»만 갱신한다.
     * 라이브 등록이 남긴 흔적(부트스트랩 해시 · 세션 epoch · 올라간 ownership_version)이 하나라도 있으면
     * 건드리지 않는다 — 계정 전환으로 B 에게 넘어간 토큰을 A 의 구 export 가 되돌리면 A 의 알림이
     * B 의 기기로 가고, ownership_token 은 B 값 그대로라 등록 CAS 로도 잡히지 않는다.
     * 전역 락은 «동시 실행»만 막지 순서 역행을 막지 못하므로 provenance 로 닫는다.
     *
     * <p>{@code imported_by} 를 함께 본다 — 컬럼 «모양»만으로는 이관이 만든 행과 sid 없는 구 앱의
     * 최초 등록이 만든 행을 구분할 수 없다(둘 다 bootstrap·세션·legacy 가 NULL 이고
     * {@code ownership_version=1} 인 활성 행이다). 그래서 이관은 자기가 찍어 둔 표식이 그대로 남아
     * 있는 행만 갱신한다. 라이브 등록은 그 표식을 NULL 로 지운다({@code DeviceService}).
     */
    private String writeDevice(String migrationId, Map<String, Object> record) {
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
                + "active,imported_by) VALUES(?,?,?,?,?,?) ON CONFLICT(device_token) DO UPDATE SET "
                + "auth_generation=GREATEST(COALESCE(device_tokens.auth_generation,0),"
                + "COALESCE(EXCLUDED.auth_generation,0)),active=device_tokens.active AND EXCLUDED.active,"
                + "imported_by=EXCLUDED.imported_by,"
                + "updated_at=now() WHERE device_tokens.user_id=EXCLUDED.user_id"
                + " AND device_tokens.bootstrap_hash IS NULL AND device_tokens.session_epoch IS NULL"
                + " AND device_tokens.legacy_session_id IS NULL AND device_tokens.ownership_version=1"
                + " AND device_tokens.active AND device_tokens.imported_by=EXCLUDED.imported_by",
                record.get("deviceToken"), user, UUID.randomUUID(), generation, record.get("active"),
                migrationId);
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

    /**
     * 실제 DB 를 훑는다. imports 의 소스 레코드와 «필드 단위»로 대조하고 미발송 행은 렌더까지 돌린다.
     *
     * <p>매니페스트가 스냅샷을 지목하면 <b>그 스냅샷의 구성원만</b> 센다. 초기 적재와 최종 재동기화
     * 사이에 회차가 정산되거나 유저가 탈퇴하면, 그 키는 최종 export 에서 빠진다
     * ({@code NotificationExportService} 는 OPEN 회차·미탈퇴 유저만 싣는다). 원장은 추가·갱신만 하므로
     * 지목 없이 전부 세면 그 키들이 남아 건수·체크섬이 영구히 어긋난다.
     */
    private Map<String, Object> inspect(String migrationId, Map<String, Object> manifest) {
        String snapshot = snapshot(manifest);
        List<Map<String, Object>> rows = snapshot.isEmpty()
                ? store.rows("SELECT record_key,checksum,status,record::text AS record"
                        + " FROM imports WHERE migration_id=? ORDER BY record_key", migrationId)
                : store.rows("SELECT record_key,checksum,status,record::text AS record"
                        + " FROM imports WHERE migration_id=? AND snapshot_id=? ORDER BY record_key",
                        migrationId, snapshot);
        Map<String, Long> counts = new TreeMap<>();
        Map<String, StringBuilder> folds = new TreeMap<>();
        // 0건 자원도 «접은 값»이 있어야 한다. Data 내보내기는 다섯 자원을 언제나 manifest 에 싣고 빈
        // 집합을 SHA256("") 로 채운다(NotificationMigrationManifest.ResourceDigest). 여기서 비워 두면
        // 그 자원의 checksums 가 null 이라, 알림 이력이 아직 없는 환경의 «정상» export 가 건수 0 은
        // 맞는데도 매번 CHECKSUM_MISMATCH 로 막혀 verify·최초 개방을 끝낼 수 없다.
        // counts 에는 넣지 않는다 — 선언하지 않은 자원을 UNDECLARED_RESOURCE 로 잘못 걸게 된다.
        MigrationRecords.RESOURCES.forEach(resource -> folds.put(resource, new StringBuilder()));
        Map<String, Long> superseded = new TreeMap<>();
        Map<String, Long> skipped = new TreeMap<>();
        List<Map<String, Object>> failures = new ArrayList<>();
        long failed = 0;
        boolean resumed = Boolean.TRUE.equals(gate().get("everOpened"));
        for (Map<String, Object> row : rows) {
            String recordKey = row.get("record_key").toString();
            int separator = recordKey.indexOf(':');
            String resource = separator < 0 ? "" : recordKey.substring(0, separator);
            counts.merge(resource, 1L, Long::sum);
            folds.computeIfAbsent(resource, ignored -> new StringBuilder())
                    .append(recordKey).append('=').append(row.get("checksum")).append('\n');
            // SKIPPED 는 탈퇴 tombstone·세대 펜스로 «일부러» 넣지 않은 레코드다. 대상 행이 없는 게 정상이다.
            boolean fenced = "SKIPPED".equals(row.get("status"));
            Map<String, Object> failure = fenced ? null : compare(resource, Json.map(row.get("record")), resumed);
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
        failed += snapshotGaps(migrationId, snapshot, rows.size(), failures);
        failed += manifestGaps(manifest, counts, checksums, failures);
        failed += stopWindow(manifest, failures);
        Map<String, Object> report = new LinkedHashMap<>();
        report.put("migrationId", migrationId);
        report.put("snapshot", snapshot);
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

    /**
     * 스냅샷 지목 자체가 성립하는가. 「최종 스냅샷에서 빠진 키」와 「태그를 빠뜨린 적재」는 둘 다
     * 구성원 0 으로 보이므로, 건수만으로는 <b>정당한 전량 제거</b>와 <b>오조작</b>을 구분할 수 없다.
     *
     * <ul>
     *   <li>{@code SNAPSHOT_EMPTY} — 지목한 스냅샷이 <b>등재된 적이 없다</b>. 적재 때 {@code snapshot}
     *       을 빠뜨렸거나 오타다. 등재된 공집합(전량 제거)은 여기 걸리지 않는다.</li>
     *   <li>{@code SNAPSHOT_REQUIRED} — 원장에 스냅샷이 둘 이상인데 매니페스트가 지목하지 않았다.
     *       전체 집계는 옛 세대의 구성원을 섞으므로 어느 쪽이 정본인지 말하게 한다.</li>
     * </ul>
     *
     * <h2>세대는 {@code imports} 가 아니라 «등재부»로 센다</h2>
     * <b>전량 제거를 뜻하는 빈 스냅샷은 {@code imports} 에 행이 하나도 없다.</b> 그래서 거기서만
     * 세면 그 세대가 통째로 보이지 않는다 — {@code snap-1} 적재 뒤 빈 {@code snap-2} 를 등재했는데
     * 운영자가 스냅샷을 빠뜨린 매니페스트를 검증하면 세대가 하나뿐이라고 판정되고, 매니페스트가 옛
     * {@code snap-1} 의 건수·체크섬과 맞으면 <b>검증과 개방이 그대로 통과한다</b>. 그다음
     * {@link #retire} 도 지목이 없어 아무 행도 정리하지 않으므로, <b>최종 스냅샷에서 제거된 기기로
     * 계속 발송된다</b>.
     *
     * <p>{@code apply} 가 「레코드가 0건이어도 등재한다」고 {@code migration_snapshots} 에 적어 두는
     * 이유가 정확히 이것이다. 그 등재부를 세지 않으면 적어 둔 보람이 없다. 태그 없이 적재된 행
     * ({@code snapshot_id=''})도 한 세대로 세던 기존 동작은 그대로 두려고 {@code imports} 쪽을
     * 합집합으로 함께 센다 — 어느 한쪽만 보면 다른 쪽이 세대를 숨긴다.
     */
    private long snapshotGaps(String migrationId, String snapshot, int members,
            List<Map<String, Object>> failures) {
        if (snapshot.isEmpty()) {
            long generations = ((Number) store.one("SELECT count(*) AS total FROM ("
                    + "SELECT snapshot_id FROM migration_snapshots WHERE migration_id=?"
                    + " UNION SELECT snapshot_id FROM imports WHERE migration_id=?) generations",
                    migrationId, migrationId).get("total")).longValue();
            if (generations > 1) {
                failures.add(fail("SNAPSHOT_REQUIRED", "snapshot", 1L, generations));
                return 1;
            }
            return 0;
        }
        boolean registered = store.one("SELECT snapshot_id FROM migration_snapshots"
                + " WHERE migration_id=? AND snapshot_id=?", migrationId, snapshot) != null;
        if (!registered) {
            failures.add(fail("SNAPSHOT_EMPTY", "snapshot", snapshot, (long) members));
            return 1;
        }
        return 0;
    }

    private long manifestGaps(Map<String, Object> manifest, Map<String, Long> counts,
            Map<String, Object> checksums, List<Map<String, Object>> failures) {
        Map<String, Object> declared = AdminCatalog.object(manifest, "resources");
        long failed = 0;
        for (String resource : MigrationRecords.RESOURCES) {
            if (!declared.containsKey(resource)) {
                failed++;
                failures.add(fail("REQUIRED_RESOURCE_MISSING", resource, null, null));
            }
        }
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

    private Map<String, Object> compare(String resource, Map<String, Object> source, boolean resumed) {
        return switch (resource) {
            case "settings" -> compareSettings(source);
            case "device" -> compareDevice(source);
            case "delivery" -> compareDelivery(source, resumed);
            case "user" -> compareProjection(MigrationRecords.USER_PROJECTION, "user", source,
                    MigrationRecords.uuid(source.get("userId")), "");
            case "participation" -> compareProjection(MigrationRecords.PARTICIPATION_PROJECTION,
                    "participation", source, MigrationRecords.uuid(source.get("userId")),
                    source.get("sessionId").toString());
            default -> fail("UNKNOWN_MIGRATION_RESOURCE", resource, null, null);
        };
    }

    /**
     * 투영 대조 — 실제 {@code projections} 행을 <b>필드 단위</b>로 본다(존재 검사로 퇴화하지 않는다).
     *
     * <p>라이브 투영이 더 최신인 방향({@code target.version > source.version})만 허용한다.
     * 되돌아간 방향은 {@code VERSION_REGRESSED} 이고, 같은 version 인데 내용이 다르면
     * {@code FIELD_MISMATCH} 다 — 적재가 도중에 끊겨 옛 payload 가 남은 경우가 여기서 잡힌다.
     */
    private Map<String, Object> compareProjection(String type, String scope, Map<String, Object> source,
            UUID user, String subject) {
        Map<String, Object> row = store.one("SELECT version,payload::text AS payload FROM projections"
                + " WHERE projection_type=? AND user_id=? AND subject_id=?", type, user, subject);
        if (row == null) {
            return fail("TARGET_ROW_MISSING", scope, null, null);
        }
        long sourceVersion = ((Number) source.get("version")).longValue();
        long targetVersion = ((Number) row.get("version")).longValue();
        if (targetVersion < sourceVersion) {
            return fail("VERSION_REGRESSED", scope, sourceVersion, targetVersion);
        }
        if (targetVersion > sourceVersion) {
            return null;
        }
        Map<String, Object> target = MigrationRecords.fromProjection(row);
        return diff(source, target, scope, source.keySet().toArray(new String[0]));
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

    private Map<String, Object> compareDelivery(Map<String, Object> source, boolean resumed) {
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
        boolean pendingSource = "PENDING".equals(sourceStatus) || "DEFERRED".equals(sourceStatus);
        if (resumed && pendingSource && Json.number(target, "attempts") < Json.number(source, "attempts")) {
            return fail("ATTEMPTS_REGRESSED", "delivery", source.get("attempts"), target.get("attempts"));
        }
        if (sourceStatus.equals(targetStatus)) {
            // 최초 개방 전에는 원본 전체를 검증한다. 개방 뒤에는 정상 재시도가 attempts와 due를
            // 전진시키므로 그 런타임 상태를 원본 이관값으로 되돌리도록 요구하지 않는다.
            mismatch = resumed && pendingSource ? diff(source, target, "delivery", "sentAt")
                    : diff(source, target, "delivery", "attempts", "nextAttemptAt", "sentAt");
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
        Supplier<Map<String, Object>> activate = () -> {
            // 게이트 «먼저». 이 배타 잠금이 풀릴 때까지 다른 적재는 커밋을 끝내고, 여기 아래의 최종
            // 검사는 그 이후의 DB 만 본다. 순서를 뒤집으면 검사에 안 잡힌 쓰기를 안은 채 열린다.
            Map<String, Object> control = lockGate(migrationId, true);
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
            // 검사가 끝난 «뒤», 게이트를 켜기 «전». 최종 스냅샷에서 빠진 이관 행을 여기서 접는다 —
            // 열고 나서 하면 그 사이 한 틱이 옛 기기로 나간다.
            Map<String, Object> retired = Boolean.TRUE.equals(control.get("ever_opened")) ? Map.of()
                    : retire(migrationId, Json.nullableText(manifest, "snapshot"));
            store.update("UPDATE dispatch_control SET enabled=true,ever_opened=true,active_migration_id=?,"
                    + "updated_at=now() WHERE id=1", migrationId);
            store.update("UPDATE migration_state SET opened_at=COALESCE(opened_at,?) WHERE id=?",
                    Timestamp.from(clock.instant()), migrationId);
            audit.record(actor, "dispatch.opened", migrationId,
                    Map.of("records", report.get("records"), "retired", retired));
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("dispatch", gate());
            result.put("report", report);
            result.put("retired", retired);
            return result;
        };
        return store.command("dispatch-open:" + migrationId, key, Map.of("manifest", manifest), activate,
                false, () -> {
                    // 과거 개방 재시도가 이후의 운영 중지를 뒤집어서는 안 된다. 같은 gate 잠금 아래
                    // 현재 개방을 확인한 뒤 실제 검증도 다시 수행한다. 재개 의도에는 새 키가 필요하다.
                    if (!Boolean.TRUE.equals(lockGate(migrationId, true).get("enabled"))) {
                        throw new NotificationFailure(409, "DISPATCH_OPEN_REPLAY_STALE");
                    }
                    activate.get();
                });
    }

    /**
     * 최종 스냅샷에서 빠진 «이관 소유» 실제 행을 접는다 — 집계에서 빼는 것만으로는 부족하다.
     *
     * <h2>왜 필요한가</h2>
     * 구 {@code DEVICE_SQL} 은 유저의 토큰이 지워지거나 회전하면 그 토큰을 export 에서 통째로 뺀다.
     * 초기 적재로 만들어 둔 {@code active=true} 행은 그대로 남아, 개방 직후부터 <b>주인이 더는 쓰지
     * 않는 기기로 계속 발송된다</b>. 참가·유저 투영도 오늘은 bootstrap 전용이라 「정산·탈퇴 이벤트가
     * 나중에 치워 줄 것」이라고 전제할 수 없다. 미발송 delivery 도 구 시스템이 이미 처리한 사건이면
     * 개방과 함께 중복으로 나간다.
     *
     * <h2>손대는 범위 — «변경되지 않은 이관 소유» 행뿐</h2>
     * 라이브 흔적이 하나라도 있으면(기기의 bootstrap·세션·올라간 ownership_version, 설정의
     * {@code imported_by IS NULL}, 투영의 더 높은 version, 이미 전진한 delivery) 손대지 않는다.
     * 전부 조건부 한 문장이라 멱등이고, <b>원장 행은 지우지 않는다</b>(이력 보존).
     *
     * <p>스냅샷을 지목하지 않았거나 이미 열린 이관에서는 아무것도 하지 않는다 — 지목이 없으면
     * 「빠졌다」는 판정 자체가 성립하지 않고, 개방 뒤는 라이브가 모든 행의 주인이다.
     */
    private Map<String, Object> retire(String migrationId, String snapshot) {
        Map<String, Object> retired = new TreeMap<>();
        if (snapshot == null || snapshot.isBlank()) {
            return retired;
        }
        // open이 gate를 보유한다. 탈퇴와 같은 순서로 공통 잠금 뒤에 실제 행을 정리한다.
        store.lock("device-ownership");
        List<Map<String, Object>> obsolete = store.rows("SELECT record_key,record::text AS record FROM imports"
                + " WHERE migration_id=? AND snapshot_id<>? ORDER BY record_key", migrationId, snapshot);
        for (Map<String, Object> row : obsolete) {
            String recordKey = row.get("record_key").toString();
            int separator = recordKey.indexOf(':');
            String resource = separator < 0 ? "" : recordKey.substring(0, separator);
            Map<String, Object> record = Json.map(row.get("record"));
            int folded = switch (resource) {
                case "settings" -> retireSettings(migrationId, record);
                case "device" -> retireDevice(migrationId, record);
                case "delivery" -> retireDelivery(record);
                case "user" -> retireProjection(MigrationRecords.USER_PROJECTION, record, "");
                case "participation" -> retireProjection(MigrationRecords.PARTICIPATION_PROJECTION, record,
                        record.get("sessionId").toString());
                default -> 0;
            };
            if (folded > 0) {
                retired.merge(resource, (long) folded, (left, right) -> ((Number) left).longValue()
                        + ((Number) right).longValue());
            }
        }
        return retired;
    }

    /** 설정 행을 지운다 — 알림 서버 기본값으로 되돌아간다. 라이브가 한 번이라도 쓴 행은 제외다. */
    private int retireSettings(String migrationId, Map<String, Object> record) {
        return store.update("DELETE FROM settings WHERE user_id=? AND imported_by=? AND version=?",
                MigrationRecords.uuid(record.get("userId")), migrationId, record.get("version"));
    }

    /**
     * 기기는 지우지 않고 {@code active=false} 로 접는다 — 그 값이 「소유권 폐기」의 정본 표식이고,
     * 되살아나면 안 되는 tombstone 이라 뒤늦은 구 export 가 다시 켜지 못한다.
     *
     * <p>{@code imported_by} 가 판정의 중심이다. 나머지 가드({@code writeDevice}·
     * {@code DeviceService.legacyRow} 와 같은 라이브 흔적)만으로는 <b>sid 없는 구 앱의 최초 등록</b>이
     * 만든 살아 있는 행과 구분되지 않는다 — 그 행도 bootstrap·세션·legacy 가 NULL 이고
     * {@code ownership_version=1} 인 활성 행이다. 모양으로 가르면 방금 등록한 기기를 끄게 된다.
     */
    private int retireDevice(String migrationId, Map<String, Object> record) {
        return store.update("UPDATE device_tokens SET active=false,updated_at=now()"
                + " WHERE device_token=? AND user_id=? AND active AND imported_by=? AND bootstrap_hash IS NULL"
                + " AND session_epoch IS NULL AND legacy_session_id IS NULL AND ownership_version=1",
                record.get("deviceToken"), MigrationRecords.uuid(record.get("userId")), migrationId);
    }

    /**
     * 미발송 delivery 는 {@code SUPPRESSED} 로 종결한다 — 삭제하면 {@code delivery_devices} 의 전송
     * 이력이 참조를 잃는다.
     *
     * <p>「손대지 않은 행」의 정의는 {@code DispatchService} 가 실제로 무엇을 전진시키는지에서 온다 —
     * 선점({@code lease_token}) · 재시도({@code attempts}·{@code next_attempt_at}) · 상태다.
     * 넷 중 하나라도 적재값과 다르면 라이브가 이미 그 행의 주인이므로 접지 않는다.
     */
    private int retireDelivery(Map<String, Object> record) {
        return store.update("UPDATE deliveries SET status='SUPPRESSED' WHERE event_id=? AND user_id=?"
                + " AND status=? AND status IN ('PENDING','DEFERRED') AND attempts=? AND next_attempt_at=?"
                + " AND lease_token IS NULL AND sent_at IS NULL",
                record.get("eventId"), MigrationRecords.uuid(record.get("userId")),
                record.get("status"), record.get("attempts"),
                MigrationRecords.timestamp(record.get("nextAttemptAt")));
    }

    /**
     * 투영은 <b>적재한 payload 가 그대로 남아 있을 때만</b> 지운다. version 만 보면 나중에 같은
     * version 으로 쓰는 경로가 생겼을 때 조용히 라이브 값을 지우게 된다 — 오늘 라이브 두 경로
     * ({@code InboundService.project}·{@code SnapshotReconciler})가 {@code <} 인 사실에 기대지 않는다.
     */
    private int retireProjection(String type, Map<String, Object> record, String subject) {
        return store.update("DELETE FROM projections WHERE projection_type=? AND user_id=? AND subject_id=?"
                + " AND version=? AND payload=?::jsonb", type, MigrationRecords.uuid(record.get("userId")),
                subject, record.get("version"), Json.write(record));
    }

    /** 재검증 실패 후 발송을 닫고 낡은 검증 표시를 지운다. open 트랜잭션이 끝난 뒤에 불린다. */
    @Transactional(timeout = 120)
    public void invalidate(String actor, String migrationId) {
        lockGate(migrationId, true);
        store.update("UPDATE dispatch_control SET enabled=false,updated_at=now() WHERE id=1");
        store.update("UPDATE migration_state SET verified_at=NULL WHERE id=?", migrationId);
        audit.record(actor, "migration.verification.cleared", migrationId, Map.of());
    }

    /**
     * 게이트 닫기 — <b>두 가지를 기다려야 «드레인»이다.</b>
     *
     * <p>① {@code dispatch_control} 행 UPDATE 는 {@code DispatchService} 의 판정이 잡은
     * {@code FOR SHARE} 가 풀릴 때까지 대기한다. 그래서 이 UPDATE 가 돌아온 시점에 <b>판정 중인</b>
     * 발송은 없다.
     *
     * <p>② 그런데 판정이 끝난 워커는 <b>트랜잭션도 잠금도 없이</b> FCM 을 부른다(외부 호출을
     * 트랜잭션 밖으로 뺀 결과다). 그 워커는 게이트 행을 쥐고 있지 않으므로 ①이 붙잡지 못한다.
     * ①만 보고 {@code drained=true} 를 돌려주면 <b>긴급 정지 뒤에도 푸시가 계속 나가고</b>, 컷오버가
     * 이어지면 전환된 발송 경로와 겹쳐 중복이 된다. 그래서 발송 임대
     * ({@code deliveries.lease_expires_at})가 모두 풀릴 때까지 함께 기다린다.
     *
     * <p><b>게이트는 기다리기 «전에» 닫는다.</b> 닫는 것이 안전이고 기다리는 것은 확인이라, 순서를
     * 바꾸면 기다리는 동안 새 발송이 계속 시작된다. 그래서 예산을 넘겨도 게이트는 닫힌 채다 —
     * {@code drained} 만 {@code false} 로 정직하게 돌려준다. 운영자는 그 값으로 「지금 컷오버해도
     * 되는가」를 판단한다. {@code true} 를 무조건 주는 것이 정확히 이 판단을 망가뜨리던 것이다.
     */
    @Transactional(timeout = 120)
    public Map<String, Object> close(String actor, String key) {
        audit.record(actor, "dispatch.close", null, Map.of());
        return store.command("dispatch-close", key, Map.of("action", "close"), () -> {
            store.update("UPDATE dispatch_control SET enabled=false,updated_at=now() WHERE id=1");
            audit.record(actor, "dispatch.closed", null, Map.of());
            boolean drained = awaitInFlightSends();
            if (!drained) {
                audit.record(actor, "dispatch.drain.timeout", null, Map.of());
            }
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("dispatch", gate());
            result.put("drained", drained);
            return result;
        }, true);
    }

    /**
     * 진행 중인 외부 발송이 모두 끝나기를 기다린다.
     *
     * <p>임대는 {@code DispatchService} 가 판정 커밋과 함께 걸고 결과를 맺을 때 푼다. 그래서 살아
     * 있는 임대가 하나라도 있으면 <b>지금 FCM 을 부르는 중인 워커가 있다</b>는 뜻이다.
     *
     * <p>무한히 기다리지 않는다. 발송 도중 프로세스가 죽으면 그 임대는 만료까지 남으므로, 기다림에
     * 상한이 없으면 게이트 닫기가 관리자 API 를 통째로 붙잡는다. 예산을 넘기면 {@code false} 를
     * 돌려주고 판단은 운영자에게 넘긴다.
     *
     * @return 예산 안에 모두 끝났는가
     */
    private boolean awaitInFlightSends() {
        // 예산은 «실제로 흐른 시간»이라 도메인 시계(clock)가 아니라 nanoTime 으로 잰다. clock 은
        // 테스트에서 고정되므로 그것으로 재면 예산이 영영 끝나지 않아 여기서 멈춘다. 임대 생존
        // 판정도 같은 이유로 DB 의 now() 를 쓴다 — 둘 다 실시간 축이라야 서로 맞는다.
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(drainBudgetSeconds);
        while (true) {
            if (store.one("SELECT id FROM deliveries WHERE lease_expires_at>now() LIMIT 1") == null) {
                return true;
            }
            if (System.nanoTime() - deadline >= 0) {
                return false;
            }
            try {
                Thread.sleep(DRAIN_POLL_MILLIS);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
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
