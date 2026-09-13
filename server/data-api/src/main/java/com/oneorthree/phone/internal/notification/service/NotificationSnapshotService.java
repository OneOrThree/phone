package com.oneorthree.phone.internal.notification.service;

import com.oneorthree.phone.internal.notification.dto.NotificationSnapshotItem;
import com.oneorthree.phone.internal.notification.dto.NotificationSnapshotPageResponse;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.sql.Time;
import java.time.Instant;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * 알림 서버의 유저 투영 부트스트랩 정본 (조회 3종의 첫 번째, {@code GET /internal/users/notification-snapshot}).
 *
 * <h2>한 질의로 읽는다</h2>
 * 유저 · 알림설정 · 유저 축 version 셋을 <b>한 번</b>에 조인한다. 유저마다 설정을 따로 읽으면
 * 전수 스냅샷이 N+1 이 되어 이관 창(발송 정지 시간)이 그대로 길어진다.
 *
 * <h2>{@code REPEATABLE_READ}</h2>
 * 한 «스냅샷»이라는 이름이 성립하려면 페이지들이 같은 시점을 봐야 한다 — 고 싶지만 그럴 수 없다:
 * 페이지마다 별도 HTTP 요청이라 트랜잭션이 다르다. 그래서 페이지 <b>안에서만</b> 일관성을 보장하고,
 * 페이지 사이의 변경은 <b>{@code version} 으로 수렴</b>시킨다(항목 주석 참조). 격리 수준을 올려도
 * 그 성질이 생기지 않는다는 것을 분명히 해 두려고 이 주석을 남긴다.
 *
 * <h2>봇은 뺀다</h2>
 * A5 에서 봇 발송이 폐기됐다. 스냅샷에 남기면 알림 서버가 «기기도 설정도 없는 유저»를 잔뜩 투영하고,
 * 나중에 그 행이 무엇이었는지 아무도 모른다.
 */
@Service
@RequiredArgsConstructor
public class NotificationSnapshotService {

    /** 한 페이지 기본 크기. */
    public static final int DEFAULT_LIMIT = 500;

    /** 한 페이지 최대 크기 — 호출자가 무제한을 요구해 한 트랜잭션에 전건을 적재하지 못하게 막는다. */
    public static final int MAX_LIMIT = 2000;

    private static final String SNAPSHOT_SQL = """
            SELECT u.id,
                   u.is_deleted,
                   u.auth_generation,
                   u.nickname,
                   u.language,
                   (u.device_token IS NOT NULL) AS has_device_token,
                   (s.user_id IS NOT NULL) AS settings_present,
                   s.notification_enabled,
                   s.sound_enabled,
                   s.night_mode_enabled,
                   s.night_start_time,
                   s.night_end_time,
                   s.updated_at AS settings_updated_at,
                   COALESCE(av.last_version, 0) AS version
              FROM users u
              LEFT JOIN user_notification_settings s
                     ON s.user_id = u.id AND s.deleted_at IS NULL
              LEFT JOIN aggregate_versions av
                     ON av.aggregate_type = :aggregateType
                    AND av.aggregate_id = CAST(u.id AS varchar)
             WHERE u.is_bot = false
               AND (CAST(:cursor AS uuid) IS NULL OR u.id > CAST(:cursor AS uuid))
             ORDER BY u.id
             LIMIT :limit
            """;

    private final EntityManager entityManager;

    /**
     * 스냅샷 한 페이지.
     *
     * @param cursor 직전 페이지의 {@code nextCursor}. 처음이면 {@code null}
     * @param limit  요청 크기. {@code null} 이면 {@link #DEFAULT_LIMIT}, 상한은 {@link #MAX_LIMIT}
     * @return 유저 id 오름차순 한 페이지와 다음 커서
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public NotificationSnapshotPageResponse read(UUID cursor, Integer limit) {
        int size = normalizeLimit(limit);
        Query query = entityManager.createNativeQuery(SNAPSHOT_SQL)
                .setParameter("aggregateType", AggregateRef.TYPE_USER)
                .setParameter("cursor", cursor == null ? null : cursor.toString())
                // 한 건 더 읽어 「다음이 있는가」를 센다 — 별도 COUNT 는 같은 시점을 보지 못한다.
                .setParameter("limit", size + 1);
        @SuppressWarnings("unchecked")
        List<Object[]> rows = query.getResultList();

        boolean hasMore = rows.size() > size;
        List<Object[]> page = hasMore ? rows.subList(0, size) : rows;
        List<NotificationSnapshotItem> items = new ArrayList<>(page.size());
        for (Object[] row : page) {
            items.add(toItem(row));
        }
        String nextCursor = hasMore && !items.isEmpty()
                ? items.get(items.size() - 1).userId().toString()
                : null;
        return new NotificationSnapshotPageResponse(List.copyOf(items), nextCursor);
    }

    /**
     * 요청 크기를 정상 범위로 접는다.
     *
     * @param limit 요청 값
     * @return 1 이상 {@link #MAX_LIMIT} 이하
     */
    private static int normalizeLimit(Integer limit) {
        if (limit == null || limit <= 0) {
            return DEFAULT_LIMIT;
        }
        return Math.min(limit, MAX_LIMIT);
    }

    /**
     * 네이티브 행 → 항목.
     *
     * <p>설정 행이 없으면 5필드를 <b>전부 {@code null}</b> 로 둔다 — 여기서 기본값을 채워 보내면
     * 「사용자가 직접 켠 것」과 구분되지 않는다.
     *
     * @param row 네이티브 조회 한 행
     * @return 항목
     */
    private static NotificationSnapshotItem toItem(Object[] row) {
        boolean settingsPresent = toBoolean(row[6]);
        return new NotificationSnapshotItem(
                toUuid(row[0]),
                toBoolean(row[1]),
                ((Number) row[2]).longValue(),
                (String) row[3],
                (String) row[4],
                toBoolean(row[5]),
                settingsPresent,
                settingsPresent ? toBoolean(row[7]) : null,
                settingsPresent ? toBoolean(row[8]) : null,
                settingsPresent ? toBoolean(row[9]) : null,
                toLocalTime(row[10]),
                toLocalTime(row[11]),
                toInstant(row[12]),
                row[13] == null ? 0L : ((Number) row[13]).longValue());
    }

    private static UUID toUuid(Object value) {
        return value instanceof UUID uuid ? uuid : UUID.fromString(String.valueOf(value));
    }

    private static boolean toBoolean(Object value) {
        return value instanceof Boolean bool && bool;
    }

    private static LocalTime toLocalTime(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof LocalTime localTime) {
            return localTime;
        }
        return ((Time) value).toLocalTime();
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
}
