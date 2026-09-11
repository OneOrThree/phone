package com.oneorthree.notification;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 관리 목록의 커서 페이지네이션 한 곳. limit 상한과 커서 해석을 모든 목록이 공유한다. */
final class AdminPage {

    static final int MAX_LIMIT = 100;
    static final int DEFAULT_LIMIT = 20;
    /** 커서 없는 첫 장의 경계값. 실재하는 행보다 항상 크다. */
    private static final Timestamp TIME_END = Timestamp.valueOf(LocalDateTime.of(9999, 12, 31, 23, 59, 59));
    private static final UUID UUID_END = UUID.fromString("ffffffff-ffff-ffff-ffff-ffffffffffff");

    private AdminPage() { }

    static int limit(Integer requested) {
        int value = requested == null ? DEFAULT_LIMIT : requested;
        if (value < 1 || value > MAX_LIMIT) {
            throw new NotificationFailure(400, "INVALID_LIMIT");
        }
        return value;
    }

    /** text PK 목록(jobs·templates·deeplinks)의 커서. 빈 문자열은 모든 id 보다 작다. */
    static String textCursor(String cursor) {
        if (cursor == null || cursor.isBlank()) {
            return "";
        }
        if (cursor.length() > 200) {
            throw new NotificationFailure(400, "INVALID_CURSOR");
        }
        return cursor;
    }

    /** deliveries 커서 "<ISO-8601>|<uuid>". 시각만으로는 같은 밀리초가 장 경계에서 유실된다. */
    static Object[] timeCursor(String cursor) {
        if (cursor == null || cursor.isBlank()) {
            return new Object[]{TIME_END, UUID_END};
        }
        int separator = cursor.lastIndexOf('|');
        if (separator < 0 || cursor.length() > 200) {
            throw new NotificationFailure(400, "INVALID_CURSOR");
        }
        try {
            return new Object[]{Timestamp.from(Instant.parse(cursor.substring(0, separator))),
                    UUID.fromString(cursor.substring(separator + 1))};
        } catch (RuntimeException invalid) {
            throw new NotificationFailure(400, "INVALID_CURSOR");
        }
    }

    static String encodeTimeCursor(Object createdAt, Object id) {
        return ((Timestamp) createdAt).toInstant().toString() + "|" + id;
    }

    /** 콘솔 계약은 {items,nextCursor} 고정이다. 마지막 장의 nextCursor 는 null 이다. */
    static Map<String, Object> page(List<Map<String, Object>> items, String nextCursor) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("items", items);
        result.put("nextCursor", nextCursor);
        return result;
    }
}
