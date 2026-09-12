package com.oneorthree.phone.notification.migration;

import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.notification.producer.NotificationEventKey;
import com.oneorthree.phone.notification.producer.NotificationKind;
import com.oneorthree.phone.notification.producer.NotificationExpiry;
import com.oneorthree.phone.notification.producer.NotificationSlotGranularity;
import com.oneorthree.phone.notification.repository.domain.NotificationSendStatus;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.user.repository.UserQueryService;
import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.sql.Time;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.util.AbstractMap;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.UUID;

/**
 * 컷오버 이관 export — 구 상태를 <b>알림 서버의 import wire 그대로</b> 뽑는다
 * (`docs`: N2↔N3 확정 이관 wire 계약 · 계약 §5).
 *
 * <h2>한 트랜잭션 · {@code REPEATABLE_READ}</h2>
 * 설정 · 기기 · 발송 이력 · 수위를 <b>같은 스냅샷</b>에서 읽는다. 따로 읽으면 그 사이의 변경으로
 * 「어느 시점에도 존재하지 않았던 상태」가 파일에 남고, 그게 알림 DB 의 초기 상태가 된다.
 *
 * <h2>48시간 창을 쓰지 않는다</h2>
 * 구 재훑기는 최근 48시간 종료 회차만 훑고 그 밖은 포기한다. <b>이관은 그 반대</b>다 — 창 밖이라
 * 포기했던 미발송 행도, 이미 정산이 끝난 회차의 행도 참조를 붙여 내보내야 한다.
 *
 * <h2>{@code SENT} 도 새 키로 옮긴다</h2>
 * 미발송만 키를 정규화하고 종결분을 구 id 로 두면, 컷오버 뒤 재훑기가 같은 사건을 <b>새 키</b>로
 * 다시 만들어 이미 나간 알림이 한 번 더 간다. 그래서 상태와 무관하게 같은 규칙으로 키를 만들고,
 * 만들 수 없으면 <b>실패로 보고하고 게이트를 닫는다</b>.
 *
 * <h2>코어 데이터를 필요 이상 담지 않는다</h2>
 * 담는 것은 wire 계약이 요구하는 값뿐이다. 기기 토큰은 계약상 원문이 필요해 {@code device} 레코드에
 * 그대로 들어가지만, 사람이 읽는 {@code report} 쪽에는 앞 8자만 남긴다.
 *
 * <h2>{@code user}·{@code participation} 은 <b>bootstrap</b> 이다 — 정본이 아니다</h2>
 * 이 두 자원은 알림 서버의 {@code projections} 를 <b>한 번 세우는</b> 값이다(승인 계획 ②′).
 * 그 투영을 갱신할 <b>이벤트 producer 가 아직 하나도 없어서</b>(변경 피드가 없다) 적재된 값은
 * 그 시점에 박제된다. 그래서 발송 판정(적격성·탈퇴·설정)은 <b>계속 코어 정본</b>(내부 조회 3종과
 * Data 명령/outbox)이 담당한다 — 「투영이 있으니 읽어도 되겠지」로 판정을 옮기는 순간
 * <b>조용히 옛 상태로 판정</b>하게 된다. 계약 문서에도 같은 문장을 못 박아 뒀다
 * ({@code docs/contracts/notification-producer.md}).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class NotificationExportService {

    /**
     * 내역 중 <b>잔여가 아니라 화물</b>인 항목의 키 — {@code queueDepth} 합계에서 빠진다.
     *
     * <p>이름을 상수로 두는 이유: 합계 계산과 내역 조립 두 곳이 같은 문자열을 봐야 하는데, 한쪽
     * 오타면 화물이 잔여로 세어져 <b>게이트가 영영 열리지 않는다</b>(그리고 원인이 드러나지 않는다).
     */
    static final String PAYLOAD_KEY = "migrationPayload";

    /** 이관 대상이 아닌 구 종류 — A5 에서 폐기됐고 신 producer 가 만들지 않으므로 중복 위험이 없다. */
    static final String LEGACY_RANK_OVERTAKE = "RANK_OVERTAKE";

    /**
     * 구 {@code PENDING} 의 재시도 기준 — {@code claimed_at} + 10분 리스
     * ({@code BetEventNotificationService.CLAIM_LEASE} 와 같은 값). wire 의 {@code nextAttemptAt} 은
     * nullable 이 아니므로 이월분이 아닌 행에도 값을 줘야 한다.
     */
    static final Duration LEGACY_CLAIM_LEASE = Duration.ofMinutes(10);

    /** 실패 사유 — 신 카탈로그에 없는 종류. */
    static final String FAIL_UNKNOWN_KIND = "UNKNOWN_KIND";
    /** 실패 사유 — 대상 id 가 비어 있다. */
    static final String FAIL_NO_SUBJECT = "NO_SUBJECT";
    /** 실패 사유 — 참조하던 회차가 사라졌다. */
    static final String FAIL_SESSION_GONE = "SESSION_GONE";
    /** 실패 사유 — 참조하던 챌린지가 사라졌다. */
    static final String FAIL_CHALLENGE_GONE = "CHALLENGE_GONE";
    /** 실패 사유 — 그 회차의 참가 행이 없다. */
    static final String FAIL_PARTICIPANT_GONE = "PARTICIPANT_GONE";
    /** 실패 사유 — 수신자 행이 사라졌다. */
    static final String FAIL_USER_GONE = "USER_GONE";
    /** 실패 사유 — 결정적 키를 만들 원본 사건 시각이 없다. */
    static final String FAIL_NO_EVENT_TIME = "NO_EVENT_TIME";

    private static final String LOGS_SQL = """
            SELECT id, user_id, type, kind, subject_id, target_user_id, status,
                   sent_at, claimed_at, group_id, slot_at, next_attempt_at
              FROM notification_sent_logs
             ORDER BY id
            """;

    private static final String DEVICE_SQL = """
            SELECT CAST(id AS varchar), device_token, auth_generation, is_deleted
              FROM users
             WHERE device_token IS NOT NULL AND is_bot = false
             ORDER BY id
            """;

    private static final String SETTINGS_SQL = """
            SELECT CAST(u.id AS varchar),
                   s.notification_enabled,
                   s.sound_enabled,
                   s.night_mode_enabled,
                   s.night_start_time,
                   s.night_end_time,
                   COALESCE(av.last_version, 0) AS version
              FROM users u
              JOIN user_notification_settings s
                ON s.user_id = u.id AND s.deleted_at IS NULL
              LEFT JOIN aggregate_versions av
                     ON av.aggregate_type = :aggregateType
                    AND av.aggregate_id = CAST(u.id AS varchar)
             WHERE u.is_bot = false
             ORDER BY u.id
            """;

    /**
     * 유저 투영 bootstrap — 봇과 <b>탈퇴자를 뺀</b> 전 유저.
     *
     * <p>탈퇴자를 빼는 이유는 둘이다. ① 알림 서버의 적재 경로는 {@code user_fences.withdrawn} 을
     * 보고 <b>어차피 건너뛴다</b>(그리고 {@code DeviceService} 는 탈퇴 시 그 유저의 투영을 통째로
     * 지운다) — 넣어도 행이 생기지 않는다. ② 그런데 파일에는 표시명이 남는다. 아무 효과 없이 PII 만
     * 한 벌 더 만드는 셈이라 뺀다. {@code settings}·{@code device} 자원이 탈퇴자를 싣는 것과 방향이
     * 다른 이유도 여기 있다 — 그쪽은 「그 기기의 토큰을 꺼야 한다」는 <b>할 일</b>이 있다.
     *
     * <p>{@code version} 은 {@code settings} 자원과 <b>같은 축·같은 값</b>이다(유저 축
     * {@code aggregate_versions.last_version}). 그래야 스냅샷 이전에 발행돼 백로그에 남아 있던
     * 사건이 늦게 도착해도 <b>거부</b>되고, 이후 사건만 적용된다 — 「시각이 아니라 커서」가 별도
     * 커서 없이 닫힌다(A22 ㋖).
     */
    private static final String USERS_SQL = """
            SELECT CAST(u.id AS varchar),
                   u.nickname,
                   u.language,
                   (s.user_id IS NOT NULL) AS settings_present,
                   s.notification_enabled,
                   s.sound_enabled,
                   s.night_mode_enabled,
                   s.night_start_time,
                   s.night_end_time,
                   COALESCE(av.last_version, 0) AS version
              FROM users u
              LEFT JOIN user_notification_settings s
                     ON s.user_id = u.id AND s.deleted_at IS NULL
              LEFT JOIN aggregate_versions av
                     ON av.aggregate_type = :aggregateType
                    AND av.aggregate_id = CAST(u.id AS varchar)
             WHERE u.is_bot = false AND u.is_deleted = false
             ORDER BY u.id
            """;

    /**
     * 참가 투영 bootstrap — <b>진행 중·미정산</b> 회차의 참가 행만.
     *
     * <p>{@code status = 'OPEN'} 이 「아직 결과가 없다」의 단일 정의다({@code GroupBetStatus} 주석).
     * {@code settled_at IS NULL} 을 함께 적는 것은 중복이지만, 「미정산」이 무엇인지 질의만 보고
     * 알 수 있게 남긴다.
     *
     * <p>이미 정산돼 <b>발송만 기다리는</b> 건은 이 범위 밖이다 — 그쪽은 {@code delivery} 자원이
     * 미발송 로그로 이미 옮긴다(승인 계획 ②′ 단서). 여기서 또 실으면 같은 사건이 두 축으로 들어간다.
     */
    private static final String PARTICIPATIONS_SQL = """
            SELECT CAST(p.user_id AS varchar),
                   CAST(s.id AS varchar),
                   CAST(s.challenge_id AS varchar),
                   CAST(s.group_id AS varchar),
                   CAST(s.status AS varchar),
                   s.stake,
                   s.join_closes_at,
                   p.achieved,
                   COALESCE(av.last_version, 0) AS version
              FROM group_challenge_bet_participants p
              JOIN group_challenge_bet_sessions s ON s.id = p.session_id
              JOIN users u ON u.id = p.user_id
              LEFT JOIN aggregate_versions av
                     ON av.aggregate_type = :aggregateType
                    AND av.aggregate_id = CAST(p.user_id AS varchar)
             WHERE s.status = 'OPEN' AND s.settled_at IS NULL
               AND u.is_bot = false AND u.is_deleted = false
             ORDER BY p.user_id, s.id
            """;

    private static final String DUPLICATE_TOKEN_SQL = """
            SELECT device_token, ARRAY_AGG(CAST(id AS varchar) ORDER BY id) AS user_ids
              FROM users
             WHERE device_token IS NOT NULL
             GROUP BY device_token
            HAVING COUNT(*) > 1
             ORDER BY device_token
            """;

    /**
     * 정지 창이 <b>아직 끝나지 않았다</b>는 증거 — Data 가 여전히 밖으로 내보낼 것이 남았는가.
     *
     * <h2>구 클레임 큐({@code PENDING}·{@code DEFERRED})는 여기 들어가지 않는다</h2>
     * 그 행들은 <b>이관할 화물</b>이지 잔여 작업이 아니다. 이관의 목적이 바로 그것을 옮기는 것인데
     * 그 수를 {@code queueDepth} 에 넣으면 0 이 되는 날이 영영 오지 않아 게이트를 열 수 없다
     * (특히 {@code next_attempt_at} 이 미래인 이월분은 정의상 지금 비워질 수 없다). 그 수는
     * {@code migrationPayload} 로 따로 보고한다.
     *
     * <h2>outbox 미전달은 진짜 잔여다</h2>
     * relay 가 아직 안 내보낸 봉투가 있는 채로 게이트를 열면, 나중에 나가는 그 사건이 <b>이관분과
     * 겹친다</b>. 이건 drain 하면 0 이 되는 값이라 게이트 조건으로 삼을 수 있다.
     */
    private static final String QUEUE_DEPTH_SQL = """
            SELECT (SELECT COUNT(*) FROM event_outbox_deliveries
                     WHERE target = 'KAFKA' AND delivered_at IS NULL)   AS outbox_kafka_undelivered,
                   (SELECT COUNT(*) FROM event_outbox_deliveries
                     WHERE target = 'NOTI' AND delivered_at IS NULL)    AS outbox_noti_undelivered,
                   (SELECT COUNT(*) FROM notification_sent_logs
                     WHERE status IN ('PENDING', 'DEFERRED'))           AS migration_payload
            """;

    /**
     * 커밋된 상태의 지문 — {@code aggregate_versions} 전 축을 코드포인트 순으로 이어 붙인다.
     *
     * <p>「지금」을 커서로 쓰지 않는 이유가 여기 있다: 시각은 발급 순서일 뿐 커밋 순서가 아니라
     * (㊸) 그 시각 이전이 모두 커밋됐다는 뜻이 되지 않는다. 이 벡터는 <b>실제로 커밋된</b> 값만 담는다.
     */
    private static final String CURSOR_SQL = """
            SELECT COUNT(*)                                                          AS axis_count,
                   COALESCE(STRING_AGG(aggregate_type || ':' || aggregate_id || '='
                                       || last_version, E'\\n' ORDER BY aggregate_type, aggregate_id), '')
                                                                                     AS axis_vector
              FROM aggregate_versions
            """;

    private final EntityManager entityManager;
    private final GroupQueryService groupQueryService;
    private final GroupChallengeBetParticipantRepository betParticipantRepository;
    private final UserQueryService userQueryService;

    /**
     * 한 스냅샷에서 전부 읽어 이관 문서를 만든다.
     *
     * @param migrationId 이관 id — manifest 와 짝지어 운영자가 추적한다
     * @param closedAt    정지 창을 닫은 시각(운영자 입력, epoch millis). <b>최초 탐색 export 는
     *                    {@code null}</b> 로 둘 수 있고, 그때는 최종 verify 에 쓸 수 없는 문서가 된다
     * @param inflightDrained 운영자의 <b>인플라이트 drain 확인</b>. 「쓰기·구 발송·리스너·크론을
     *                    멈추고 이미 시작된 워커가 끝나기를 기다렸다」는 선언이다. DB 로는 알 수
     *                    없는 사실이라 <b>사람이 말해야만</b> 하고, {@code closedAt} 이 있는 최종
     *                    export 는 이것이 {@code true} 여야 한다
     * @param strict      {@code true} 면 재조립 실패가 하나라도 있을 때 예외로 죽인다. <b>기본이자
     *                    정상 운용값</b>이다 — {@code false} 는 「무엇이 안 되는지 보기만 하는」 사전
     *                    점검용이고, 그 상태로 컷오버하면 그 행들이 영영 나가지 않는다
     * @return 이관 문서
     * @throws IllegalStateException {@code strict} 인데 재조립 실패가 있거나, 정지 창을 닫았다면서
     *     {@code queueDepth} 가 0 이 아닐 때
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public NotificationExportDocument export(String migrationId, Long closedAt,
                                             boolean inflightDrained, boolean strict) {
        Instant exportedAt = Instant.now();
        List<NotificationExportDocument.Failure> failures = new ArrayList<>();

        List<NotificationMigrationRecord> settings = readSettings();
        List<NotificationMigrationRecord> devices = readDevices();
        List<NotificationMigrationRecord> deliveries = readDeliveries(failures);
        List<NotificationMigrationRecord> users = readUsers();
        List<NotificationMigrationRecord> participations = readParticipations();

        Map<String, Long> queueBreakdown = readQueueBreakdown();
        // 이관할 화물(migrationPayload)은 잔여가 아니다 — 빼고 센다. 자세한 이유는 QUEUE_DEPTH_SQL 주석.
        long queueDepth = queueBreakdown.entrySet().stream()
                .filter(entry -> !PAYLOAD_KEY.equals(entry.getKey()))
                .mapToLong(Map.Entry::getValue)
                .sum();

        NotificationMigrationManifest manifest = new NotificationMigrationManifest(
                NotificationMigrationManifest.VERSION,
                UUID.randomUUID().toString(),
                Map.of(
                        NotificationMigrationRecord.RESOURCE_SETTINGS, digest(
                                NotificationMigrationRecord.RESOURCE_SETTINGS, settings),
                        NotificationMigrationRecord.RESOURCE_DEVICE, digest(
                                NotificationMigrationRecord.RESOURCE_DEVICE, devices),
                        NotificationMigrationRecord.RESOURCE_DELIVERY, digest(
                                NotificationMigrationRecord.RESOURCE_DELIVERY, deliveries),
                        NotificationMigrationRecord.RESOURCE_USER, digest(
                                NotificationMigrationRecord.RESOURCE_USER, users),
                        NotificationMigrationRecord.RESOURCE_PARTICIPATION, digest(
                                NotificationMigrationRecord.RESOURCE_PARTICIPATION, participations)),
                new NotificationMigrationManifest.StopWindow(
                        closedAt, readCursor(), queueDepth,
                        NotificationMigrationManifest.StopWindow.SOURCE));

        List<NotificationMigrationRecord> records = new ArrayList<>(
                settings.size() + devices.size() + deliveries.size()
                        + users.size() + participations.size());
        records.addAll(settings);
        records.addAll(devices);
        records.addAll(deliveries);
        records.addAll(users);
        records.addAll(participations);

        Map<String, Long> counts = new TreeMap<>();
        counts.put("settings", (long) settings.size());
        counts.put("device", (long) devices.size());
        counts.put("delivery", (long) deliveries.size());
        counts.put("user", (long) users.size());
        counts.put("participation", (long) participations.size());
        counts.put("failures", (long) failures.size());
        counts.put("queueDepth", queueDepth);

        List<NotificationExportDocument.DuplicateDeviceToken> duplicates = readDuplicateDeviceTokens();
        NotificationExportDocument document = new NotificationExportDocument(
                exportedAt, migrationId, manifest, List.copyOf(records), List.copyOf(failures),
                new NotificationExportDocument.Report(duplicates, counts, queueBreakdown,
                        inflightDrained, closedAt != null && inflightDrained && failures.isEmpty()
                                && queueDepth == 0));

        if (strict && !failures.isEmpty()) {
            // 여기서 죽는 편이 낫다. 통과시키면 그 행들이 이관되지 않은 채 구 DB 에만 남고,
            // 컷오버 후에는 아무도 그 큐를 보지 않는다.
            throw new IllegalStateException(
                    "재조립할 수 없는 발송 이력이 " + failures.size() + "건 남아 전환할 수 없습니다. "
                            + "사유는 export 문서의 failures[] 를 보세요.");
        }
        if (strict && closedAt != null && !inflightDrained) {
            // DB 에는 「이미 시작된 워커가 아직 도는 중」이 남지 않는다 — 구 flush 는 선점 행을 지우고
            // 나가므로, 그 스레드가 살아 있는지는 조회로 알 수 없다. 그래서 이 한 가지는 사람이
            // 말해야 한다. 없이 통과시키면 「멈췄다고 생각한」 창 안에서 구 경로가 계속 발송한다.
            throw new IllegalStateException(
                    "정지 창을 닫았다면 인플라이트 drain 확인이 필요합니다 — "
                            + "--notification.migration.inflight-drained=true 로 명시하세요. "
                            + "DB 조회로는 «이미 시작된 구 워커가 끝났는가»를 알 수 없습니다.");
        }
        if (strict && closedAt != null && queueDepth != 0) {
            // 정지 창을 닫았다고 선언했는데 큐가 남아 있다 = drain 이 끝나지 않았거나 무언가 아직 쓰고 있다.
            throw new IllegalStateException(
                    "정지 창을 닫았는데 아직 내보내지 못한 outbox 전달이 " + queueDepth
                            + "건 남아 있습니다 — drain 이 끝나지 않았습니다. 내역: " + queueBreakdown);
        }
        log.info("알림 이관 export — settings {}건, device {}건, delivery {}건, user {}건, "
                        + "participation {}건, 실패 {}건, 잔여 queueDepth {} (화물 {}건) {}",
                settings.size(), devices.size(), deliveries.size(), users.size(), participations.size(),
                failures.size(), queueDepth, queueBreakdown.getOrDefault(PAYLOAD_KEY, 0L), queueBreakdown);
        return document;
    }

    /** 자원 하나의 개수·체크섬. 빈 자원도 {@code SHA256("")} 로 채운다 — 빠뜨린 것과 구분하기 위해서다. */
    private static NotificationMigrationManifest.ResourceDigest digest(
            String resource, List<NotificationMigrationRecord> records) {
        List<Map.Entry<String, String>> entries = new ArrayList<>(records.size());
        for (NotificationMigrationRecord record : records) {
            entries.add(new AbstractMap.SimpleEntry<>(record.recordKey(), record.recordChecksum()));
        }
        return new NotificationMigrationManifest.ResourceDigest(
                records.size(), MigrationCanonicalJson.resourceChecksum(resource, entries));
    }

    /**
     * 설정 자원 — <b>행이 실재하는 유저만</b> 내보낸다.
     *
     * <p>설정 행은 지연 생성이다. 한 번도 설정을 만진 적 없는 유저의 「기본값」을 여기서 만들어
     * 보내면 알림 서버가 「사용자가 직접 켠 것」과 구분하지 못하고, 나중에 기본값이 바뀌어도 옛 값이
     * 박제된다. 행이 없는 유저는 알림 서버에서도 기본값으로 다뤄진다.
     */
    private List<NotificationMigrationRecord> readSettings() {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager.createNativeQuery(SETTINGS_SQL)
                .setParameter("aggregateType", AggregateRef.TYPE_USER)
                .getResultList();
        List<NotificationMigrationRecord> records = new ArrayList<>(rows.size());
        for (Object[] row : rows) {
            String userId = String.valueOf(row[0]);
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("userId", userId);
            data.put("version", ((Number) row[6]).longValue());
            data.put("notificationEnabled", Boolean.TRUE.equals(row[1]));
            data.put("soundEnabled", Boolean.TRUE.equals(row[2]));
            data.put("nightModeEnabled", Boolean.TRUE.equals(row[3]));
            data.put("nightStartTime", toTimeText(row[4]));
            data.put("nightEndTime", toTimeText(row[5]));
            records.add(NotificationMigrationRecord.of(
                    NotificationMigrationRecord.RESOURCE_SETTINGS, userId, data));
        }
        return records;
    }

    /**
     * 기기 자원 — {@code recordKey} 는 토큰의 SHA-256 hex 다(계약).
     *
     * <p>탈퇴자도 내보낸다. {@code active=false} 로 들어가야 알림 서버가 그 기기의 토큰을 정리할 수
     * 있고, 그러지 않으면 <b>이전 계정 푸시가 그 기기로 계속 간다</b>.
     */
    private List<NotificationMigrationRecord> readDevices() {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager.createNativeQuery(DEVICE_SQL).getResultList();
        List<NotificationMigrationRecord> records = new ArrayList<>(rows.size());
        for (Object[] row : rows) {
            String token = String.valueOf(row[1]);
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("deviceToken", token);
            data.put("userId", String.valueOf(row[0]));
            data.put("authGeneration", row[2] == null ? null : ((Number) row[2]).longValue());
            data.put("active", !Boolean.TRUE.equals(row[3]));
            records.add(NotificationMigrationRecord.of(NotificationMigrationRecord.RESOURCE_DEVICE,
                    MigrationCanonicalJson.sha256Hex(token.getBytes(StandardCharsets.UTF_8)), data));
        }
        return records;
    }

    /**
     * 유저 투영 bootstrap 자원 — 설정 5필드는 <b>행이 없으면 전부 {@code null}</b> 이다.
     *
     * <p>{@code settingsPresent} 를 따로 싣는 이유는 {@code NotificationSnapshotItem} 과 같다 —
     * 기본값을 여기서 채워 보내면 「사용자가 직접 켠 것」과 구분되지 않는다. 그리고 그 구분이
     * 사라지면 나중에 기본값이 바뀌어도 옛 값이 박제된다.
     */
    private List<NotificationMigrationRecord> readUsers() {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager.createNativeQuery(USERS_SQL)
                .setParameter("aggregateType", AggregateRef.TYPE_USER)
                .getResultList();
        List<NotificationMigrationRecord> records = new ArrayList<>(rows.size());
        for (Object[] row : rows) {
            String userId = String.valueOf(row[0]);
            boolean settingsPresent = Boolean.TRUE.equals(row[3]);
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("userId", userId);
            data.put("version", ((Number) row[9]).longValue());
            data.put("displayName", blankToNull(row[1]));
            data.put("locale", blankToNull(row[2]));
            data.put("settingsPresent", settingsPresent);
            data.put("notificationEnabled", settingsPresent ? Boolean.TRUE.equals(row[4]) : null);
            data.put("soundEnabled", settingsPresent ? Boolean.TRUE.equals(row[5]) : null);
            data.put("nightModeEnabled", settingsPresent ? Boolean.TRUE.equals(row[6]) : null);
            data.put("nightStartTime", toTimeText(row[7]));
            data.put("nightEndTime", toTimeText(row[8]));
            records.add(NotificationMigrationRecord.of(
                    NotificationMigrationRecord.RESOURCE_USER, userId, data));
        }
        return records;
    }

    /**
     * 참가 투영 bootstrap 자원 — {@code recordKey} 는 {@code "<userId>:<sessionId>"} 다(계약).
     *
     * <p>키에 회차를 넣는 것이 이 자원의 전부다. 유저 하나로 접으면 <b>한 회차가 다른 회차를
     * 덮어</b> 그 회차가 정산됐을 때 참가자를 몰라 결과 알림이 통째로 누락된다(A22 ㊂).
     */
    private List<NotificationMigrationRecord> readParticipations() {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager.createNativeQuery(PARTICIPATIONS_SQL)
                .setParameter("aggregateType", AggregateRef.TYPE_USER)
                .getResultList();
        List<NotificationMigrationRecord> records = new ArrayList<>(rows.size());
        for (Object[] row : rows) {
            String userId = String.valueOf(row[0]);
            String sessionId = String.valueOf(row[1]);
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("userId", userId);
            data.put("sessionId", sessionId);
            data.put("version", ((Number) row[8]).longValue());
            data.put("challengeId", String.valueOf(row[2]));
            data.put("groupId", String.valueOf(row[3]));
            data.put("sessionStatus", String.valueOf(row[4]));
            data.put("stake", ((Number) row[5]).longValue());
            data.put("joinClosesAt", toInstant(row[6]).toEpochMilli());
            // 정산 전에도 조기 확정(confirmWin)으로 true 가 될 수 있다 — null 은 「아직 판정 없음」이다.
            data.put("achieved", row[7] == null ? null : Boolean.TRUE.equals(row[7]));
            records.add(NotificationMigrationRecord.of(
                    NotificationMigrationRecord.RESOURCE_PARTICIPATION, userId + ":" + sessionId, data));
        }
        return records;
    }

    /** 발송 이력 자원 — 상태 불문 전량. 재조립 실패는 {@code failures} 에 쌓인다. */
    private List<NotificationMigrationRecord> readDeliveries(
            List<NotificationExportDocument.Failure> failures) {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager.createNativeQuery(LOGS_SQL).getResultList();
        List<NotificationMigrationRecord> records = new ArrayList<>(rows.size());
        for (Object[] row : rows) {
            toDelivery(row, failures).ifPresent(records::add);
        }
        return records;
    }

    private Optional<NotificationMigrationRecord> toDelivery(
            Object[] row, List<NotificationExportDocument.Failure> failures) {

        UUID rowId = toUuid(row[0]);
        UUID userId = toUuid(row[1]);
        String legacyKind = (String) row[3];
        UUID subjectId = toUuid(row[4]);
        String status = String.valueOf(row[6]);
        Instant sentAt = toInstant(row[7]);
        Instant claimedAt = toInstant(row[8]);
        UUID groupId = toUuid(row[9]);
        Instant slotAt = toInstant(row[10]);
        Instant nextAttemptAt = toInstant(row[11]);

        NotificationKind kind = NotificationKind.find(legacyKind);
        if (kind == null) {
            if (LEGACY_RANK_OVERTAKE.equals(legacyKind)) {
                // 신 producer 가 만들지 않는 종류라 «새 키로 다시 생길» 위험이 없다. 옮기지 않는다.
                return Optional.empty();
            }
            failures.add(fail(rowId, userId, legacyKind, status, FAIL_UNKNOWN_KIND,
                    "신 카탈로그에 없는 종류입니다 — 모르는 것을 조용히 버리면 그게 곧 유실입니다."));
            return Optional.empty();
        }
        if (kind.subjectKind() != NotificationKind.SubjectKind.NONE && subjectId == null) {
            failures.add(fail(rowId, userId, legacyKind, status, FAIL_NO_SUBJECT,
                    kind + " 는 대상 id 가 필요한데 비어 있습니다 — 키가 유저 × kind 로 뭉칩니다."));
            return Optional.empty();
        }

        // 시간축은 «원래 슬롯»을 먼저 본다 — 이월돼도 바뀌지 않게 설계된 컬럼이라, 구 행에서
        // 「사건이 언제 일어났는가」에 가장 가까운 값이다. 발송·선점 시각을 쓰면 이월분·재훑기
        // 회수분이 producer 가 만들 키와 어긋난다.
        Instant occurredAt = slotAt != null ? slotAt : (sentAt != null ? sentAt : claimedAt);
        if (kind.slotGranularity() != NotificationSlotGranularity.NONE && occurredAt == null) {
            failures.add(fail(rowId, userId, legacyKind, status, FAIL_NO_EVENT_TIME,
                    kind + " 는 시간축이 " + kind.slotGranularity() + " 인데 원본 사건 시각이 없습니다."));
            return Optional.empty();
        }
        String eventId = NotificationEventKey.of(kind, userId, subjectId, occurredAt);

        boolean unsent = NotificationSendStatus.PENDING.name().equals(status)
                || NotificationSendStatus.DEFERRED.name().equals(status);
        Map<String, Object> params;
        if (unsent) {
            Enrichment enrichment = enrich(kind, userId, subjectId, slotAt);
            if (enrichment.reason() != null) {
                failures.add(fail(rowId, userId, legacyKind, status, enrichment.reason(),
                        enrichment.detail()));
                return Optional.empty();
            }
            params = withCommonParams(kind, enrichment.params(), groupId, slotAt);
        } else {
            // 종결분은 «다시 렌더하지 않는다» — 중복 억제의 근거로만 옮긴다. 다만 키는 미발송분과
            // 같은 규칙으로 만든다(그러지 않으면 재훑기가 새 키로 같은 사건을 다시 만든다).
            params = withCommonParams(kind, Map.of(), groupId, slotAt);
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("eventId", eventId);
        data.put("userId", userId.toString());
        data.put("kind", kind.name());
        data.put("subjectId", subjectId == null ? null : subjectId.toString());
        data.put("groupId", groupId == null ? null : groupId.toString());
        data.put("slotAt", toMillis(slotAt));
        data.put("locale", localeOf(userId));
        data.put("status", status);
        // 구 테이블에 시도 횟수 컬럼이 없다 — 0 을 지어내는 대신 «세지 않았다»는 사실을 그대로 0 으로
        // 옮기고 문서에 남긴다. 이 값으로 백오프를 계산하면 안 된다.
        data.put("attempts", 0L);
        data.put("nextAttemptAt", nextAttemptMillis(status, nextAttemptAt, claimedAt, slotAt, sentAt));
        data.put("sentAt", toMillis(sentAt));
        NotificationExpiry.addTo(params, kind, occurredAt);
        data.put("params", params);

        return Optional.of(NotificationMigrationRecord.of(
                NotificationMigrationRecord.RESOURCE_DELIVERY, eventId, data));
    }

    /**
     * wire 의 {@code nextAttemptAt} — <b>nullable 이 아니다</b>.
     *
     * <p>이월분은 그 값을 그대로 쓴다. {@code PENDING} 은 구 재시도 기준이 리스({@code claimed_at} +
     * 10분)라 그것을 옮긴다. 종결분은 재시도 대상이 아니므로 「이미 지난 시각」이면 무엇이든 되는데,
     * 그중 가장 뜻이 분명한 값(발송 시각 → 슬롯 → 선점 시각)을 쓴다.
     */
    private static long nextAttemptMillis(String status, Instant nextAttemptAt, Instant claimedAt,
                                          Instant slotAt, Instant sentAt) {
        if (nextAttemptAt != null) {
            return nextAttemptAt.toEpochMilli();
        }
        if (NotificationSendStatus.PENDING.name().equals(status) && claimedAt != null) {
            return claimedAt.plus(LEGACY_CLAIM_LEASE).toEpochMilli();
        }
        Instant fallback = sentAt != null ? sentAt : (slotAt != null ? slotAt : claimedAt);
        return fallback == null ? 0L : fallback.toEpochMilli();
    }

    /** 공통 params — producer 가 얹는 것과 같은 키를 같은 자리에 얹는다. */
    private static Map<String, Object> withCommonParams(NotificationKind kind, Map<String, Object> base,
                                                        UUID groupId, Instant slotAt) {
        Map<String, Object> params = new LinkedHashMap<>(base);
        params.put("kind", kind.name());
        params.put("quietPolicy", kind.quietPolicy().name());
        if (groupId != null) {
            params.put("groupId", groupId.toString());
        }
        if (slotAt != null) {
            params.put("slotAt", slotAt.toString());
        }
        return params;
    }

    private NotificationExportDocument.Failure fail(UUID rowId, UUID userId, String legacyKind,
                                                    String status, String reason, String detail) {
        return new NotificationExportDocument.Failure(
                NotificationMigrationRecord.RESOURCE_DELIVERY,
                rowId == null ? null : rowId.toString(),
                userId == null ? null : userId.toString(),
                legacyKind, status, reason, detail);
    }

    /** 코어 참조를 붙여 발송 params 를 만든다 — 48시간 창도, 정산 완료 여부도 따지지 않는다. */
    private Enrichment enrich(NotificationKind kind, UUID userId, UUID subjectId, Instant slotAt) {
        if (userQueryService.findActive(userId).isEmpty()) {
            return Enrichment.fail(FAIL_USER_GONE, "수신자가 없거나 탈퇴했습니다.");
        }
        return switch (kind) {
            case BET_RESULT, BET_VOID_REFUND -> enrichBetOutcome(kind, userId, subjectId);
            case BET_WON, BET_SILENT_FLUSH -> enrichBetSimple(kind, userId, subjectId);
            case CHALLENGE_SESSION_OPEN -> enrichSessionOpen(subjectId);
            case CHALLENGE_CREATED, CHALLENGE_WINDOW_END, CHALLENGE_ENDED -> enrichChallenge(subjectId);
            // 리그·리텐션·친구는 그때의 값(순위·부족분·닉네임)이 렌더 입력인데 구 행에 남아 있지 않다.
            // 알림 서버는 이관분을 «억제 근거» 로만 쓰고 새로 보내지 않는다 — 그래서 params 를 비운다.
            default -> new Enrichment(Map.of(), null, null);
        };
    }

    private Enrichment enrichBetOutcome(NotificationKind kind, UUID userId, UUID sessionId) {
        GroupChallengeBetSession session = groupQueryService.findBetSession(sessionId).orElse(null);
        if (session == null) {
            return Enrichment.fail(FAIL_SESSION_GONE, "참조하던 회차가 사라졌습니다: " + sessionId);
        }
        GroupChallengeBetParticipant participant =
                betParticipantRepository.findBySessionIdAndUserId(sessionId, userId).orElse(null);
        if (participant == null) {
            return Enrichment.fail(FAIL_PARTICIPANT_GONE, "그 회차의 참가 행이 없습니다: " + sessionId);
        }
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("challengeId", session.getChallenge().getId().toString());
        params.put("stake", (long) session.getStake());
        if (kind == NotificationKind.BET_VOID_REFUND) {
            params.put("voidReason",
                    session.getVoidReason() == null ? null : session.getVoidReason().name());
        } else {
            params.put("betStatus", session.getStatus().name());
            params.put("achieved", Boolean.TRUE.equals(participant.getAchieved()));
            params.put("payout", participant.getPayout() == null ? 0L : participant.getPayout().longValue());
        }
        return new Enrichment(params, null, null);
    }

    private Enrichment enrichBetSimple(NotificationKind kind, UUID userId, UUID sessionId) {
        GroupChallengeBetSession session = groupQueryService.findBetSession(sessionId).orElse(null);
        if (session == null) {
            return Enrichment.fail(FAIL_SESSION_GONE, "참조하던 회차가 사라졌습니다: " + sessionId);
        }
        if (betParticipantRepository.findBySessionIdAndUserId(sessionId, userId).isEmpty()) {
            return Enrichment.fail(FAIL_PARTICIPANT_GONE, "그 회차의 참가 행이 없습니다: " + sessionId);
        }
        Map<String, Object> params = new LinkedHashMap<>();
        if (kind == NotificationKind.BET_SILENT_FLUSH) {
            params.put("silent", "flush");
        } else {
            params.put("challengeId", session.getChallenge().getId().toString());
        }
        return new Enrichment(params, null, null);
    }

    private Enrichment enrichSessionOpen(UUID sessionId) {
        GroupChallengeBetSession session = groupQueryService.findBetSession(sessionId).orElse(null);
        if (session == null) {
            return Enrichment.fail(FAIL_SESSION_GONE, "참조하던 회차가 사라졌습니다: " + sessionId);
        }
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("challengeId", session.getChallenge().getId().toString());
        params.put("stake", (long) session.getStake());
        params.put("deferExpiresAt", session.getJoinClosesAt().toString());
        // 이미 마감된 모집도 옮긴다 — 버리는 판정은 알림 서버의 적격성 조회가 한다. 여기서 버리면
        // 그 사건 키가 어디에도 없어, 컷오버 뒤 15분 크론이 다시 만들어 «마감된 모집»을 보낸다.
        params.put("legacySessionStatus", session.getStatus().name());
        params.put("legacyStillOpen", session.getStatus() == GroupBetStatus.OPEN);
        return new Enrichment(params, null, null);
    }

    private Enrichment enrichChallenge(UUID challengeId) {
        GroupChallenge challenge = groupQueryService.findChallenge(challengeId).orElse(null);
        if (challenge == null) {
            return Enrichment.fail(FAIL_CHALLENGE_GONE, "참조하던 챌린지가 사라졌습니다: " + challengeId);
        }
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("challengeId", challenge.getId().toString());
        params.put("groupName", challenge.getGroup().getName());
        return new Enrichment(params, null, null);
    }

    private String localeOf(UUID userId) {
        return userQueryService.findActive(userId)
                .map(com.oneorthree.phone.user.repository.domain.User::getLanguage)
                .orElse(null);
    }

    /**
     * 잔여·화물 내역 — 합계만 싣고 내역을 버리면 0 이 아닐 때 어디를 볼지 알 수 없다.
     *
     * <p>{@link #PAYLOAD_KEY} 항목은 <b>합계에서 빠진다</b>(이관할 화물이지 잔여가 아니다).
     *
     * @return 항목별 실측값
     */
    private Map<String, Long> readQueueBreakdown() {
        Object[] row = (Object[]) entityManager.createNativeQuery(QUEUE_DEPTH_SQL).getSingleResult();
        Map<String, Long> breakdown = new TreeMap<>();
        breakdown.put("outboxKafkaUndelivered", ((Number) row[0]).longValue());
        breakdown.put("outboxNotiUndelivered", ((Number) row[1]).longValue());
        breakdown.put(PAYLOAD_KEY, ((Number) row[2]).longValue());
        return breakdown;
    }

    /** 커밋된 상태의 지문 — {@code "av:<축 수>:<sha256>"}. 시각이 아니다. */
    private String readCursor() {
        Object[] row = (Object[]) entityManager.createNativeQuery(CURSOR_SQL).getSingleResult();
        long axisCount = ((Number) row[0]).longValue();
        String vector = row[1] == null ? "" : String.valueOf(row[1]);
        return "av:" + axisCount + ":"
                + MigrationCanonicalJson.sha256Hex(vector.getBytes(StandardCharsets.UTF_8));
    }

    private List<NotificationExportDocument.DuplicateDeviceToken> readDuplicateDeviceTokens() {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager.createNativeQuery(DUPLICATE_TOKEN_SQL).getResultList();
        List<NotificationExportDocument.DuplicateDeviceToken> duplicates = new ArrayList<>(rows.size());
        for (Object[] row : rows) {
            String token = String.valueOf(row[0]);
            String masked = token.length() <= 8 ? token : token.substring(0, 8) + "…";
            duplicates.add(new NotificationExportDocument.DuplicateDeviceToken(
                    masked, List.of((String[]) row[1])));
        }
        return List.copyOf(duplicates);
    }

    /** 렌더 입력, 또는 재조립 불가 사유. */
    private record Enrichment(Map<String, Object> params, String reason, String detail) {

        static Enrichment fail(String reason, String detail) {
            return new Enrichment(Map.of(), reason, detail);
        }
    }

    private static UUID toUuid(Object value) {
        if (value == null) {
            return null;
        }
        return value instanceof UUID uuid ? uuid : UUID.fromString(String.valueOf(value));
    }

    private static Instant toInstant(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Instant instant) {
            return instant;
        }
        return ((Timestamp) value).toInstant();
    }

    private static Long toMillis(Instant value) {
        return value == null ? null : value.toEpochMilli();
    }

    /**
     * 빈 문자열을 «값 없음»으로 접는다 — 빈 표시명은 이름이 아니다.
     *
     * <p>그냥 두면 수신 측의 문자열 검증({@code Json.text} 는 공백을 거절한다)이 <b>배치 전체를
     * 400 으로 되돌린다</b>. 한 유저의 빈 닉네임이 컷오버를 막는 셈이라, 뜻이 같은 {@code null} 로
     * 보낸다.
     */
    private static String blankToNull(Object value) {
        if (value == null) {
            return null;
        }
        String text = String.valueOf(value);
        return text.isBlank() ? null : text;
    }

    /** {@code HH:mm:ss} — wire 계약의 표기다. {@code LocalTime.toString()} 은 초가 0 이면 «HH:mm» 이다. */
    private static String toTimeText(Object value) {
        if (value == null) {
            return null;
        }
        LocalTime time = value instanceof LocalTime localTime ? localTime : ((Time) value).toLocalTime();
        return String.format("%02d:%02d:%02d", time.getHour(), time.getMinute(), time.getSecond());
    }
}
