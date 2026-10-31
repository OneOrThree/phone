package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.content.exception.ContentErrorCode;
import com.oneorthree.phone.content.exception.ContentException;
import com.oneorthree.phone.internal.dto.ContentHistoryPage;
import com.oneorthree.phone.magazine.support.MagazineCalendar;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 공지 원장과 잡지 규칙을 조합해 운영 게시 이력을 읽는다. 백오피스 초안 저장소로 복제하지 않는다. */
@Service
@RequiredArgsConstructor
public class ContentHistoryService {
    private final JdbcTemplate jdbc;
    private final Clock clock;

    @Transactional(readOnly = true)
    public ContentHistoryPage notices(String cursor, Integer limit) {
        int size = limit(limit);
        Instant now = clock.instant();
        NoticeCursor before = noticeCursor(cursor);
        Long total = jdbc.queryForObject("SELECT count(*) FROM developer_notices", Long.class);
        List<Map<String, Object>> items = jdbc.query("SELECT n.publication_id,n.title,n.body,n.starts_at,"
                + "n.ends_at,n.published_at,n.min_ios_version,n.min_android_version,"
                + "n.withdrawn_at,n.withdrawn_by,p.actor FROM developer_notices n"
                + " LEFT JOIN content_publications p ON p.publication_id=n.publication_id"
                + " WHERE (n.published_at,n.publication_id)<(?::timestamptz,?::uuid)"
                + " ORDER BY n.published_at DESC,n.publication_id DESC LIMIT ?", (rs, row) -> {
                Map<String, Object> item = new LinkedHashMap<>();
                Instant startsAt = rs.getTimestamp("starts_at").toInstant();
                Timestamp end = rs.getTimestamp("ends_at");
                Instant endsAt = end == null ? null : end.toInstant();
                item.put("id", rs.getObject("publication_id").toString());
                item.put("kind", "notice");
                item.put("title", rs.getString("title"));
                item.put("body", rs.getString("body"));
                item.put("startsAt", startsAt);
                item.put("endsAt", endsAt);
                item.put("publishedAt", rs.getTimestamp("published_at").toInstant());
                item.put("minIosVersion", rs.getString("min_ios_version"));
                item.put("minAndroidVersion", rs.getString("min_android_version"));
                item.put("actor", rs.getString("actor"));
                Timestamp withdrawn = rs.getTimestamp("withdrawn_at");
                item.put("withdrawnAt", withdrawn == null ? null : withdrawn.toInstant());
                item.put("withdrawnBy", rs.getString("withdrawn_by"));
                item.put("status", withdrawn != null ? "WITHDRAWN" : now.isBefore(startsAt) ? "SCHEDULED"
                        : endsAt != null && !now.isBefore(endsAt) ? "EXPIRED" : "LIVE");
                return item;
            }, Timestamp.from(before.publishedAt()), before.id(), size + 1);
        boolean more = items.size() > size;
        List<Map<String, Object>> visible = more ? items.subList(0, size) : items;
        Map<String, Object> last = visible.isEmpty() ? null : visible.get(visible.size() - 1);
        return new ContentHistoryPage(new ArrayList<>(visible), total == null ? 0 : total,
                more ? last.get("publishedAt") + "|" + last.get("id") : null);
    }

    @Transactional(readOnly = true)
    public ContentHistoryPage magazines(String cursor, Integer limit) {
        int size = limit(limit);
        int before = magazineCursor(cursor);
        Instant now = clock.instant();
        Long total = jdbc.queryForObject("SELECT count(*) FROM magazine_issues", Long.class);
        List<Map<String, Object>> items = jdbc.query("SELECT i.id,i.issue_date,i.issue_no,i.published_at,"
                + "i.notified_at,i.promotion_count,i.editorial::text AS editorial,"
                + "(SELECT p.actor FROM content_publications p WHERE p.kind='MAGAZINE'"
                + " AND p.result->>'issueId'=i.id::text ORDER BY p.created_at LIMIT 1) AS actor,"
                + "(SELECT count(*) FROM magazine_receipts r WHERE r.issue_id=i.id) AS receipt_count,"
                + "(SELECT count(*) FROM magazine_receipts r WHERE r.issue_id=i.id AND r.opened_at IS NOT NULL)"
                + " AS opened_count FROM magazine_issues i"
                + " WHERE i.issue_no<? ORDER BY i.issue_no DESC LIMIT ?", (rs, row) -> {
                Map<String, Object> item = new LinkedHashMap<>();
                Timestamp notifiedAt = rs.getTimestamp("notified_at");
                item.put("id", rs.getObject("id").toString());
                item.put("kind", "magazine");
                item.put("title", "제 " + rs.getInt("issue_no") + "호");
                item.put("issueDate", rs.getDate("issue_date").toLocalDate());
                item.put("issueNo", rs.getInt("issue_no"));
                item.put("publishedAt", rs.getTimestamp("published_at").toInstant());
                item.put("notifiedAt", notifiedAt == null ? null : notifiedAt.toInstant());
                item.put("promotionCount", rs.getInt("promotion_count"));
                item.put("receiptCount", rs.getLong("receipt_count"));
                item.put("openedCount", rs.getLong("opened_count"));
                item.put("editorial", rs.getString("editorial"));
                item.put("actor", rs.getString("actor"));
                var issueDate = rs.getDate("issue_date").toLocalDate();
                item.put("status", notifiedAt != null ? "PUBLISHED"
                        : !now.isBefore(MagazineCalendar.currentUntil(issueDate)) ? "NOTIFICATION_EXPIRED"
                        : "NOTIFICATION_PENDING");
                return item;
            }, before, size + 1);
        boolean more = items.size() > size;
        List<Map<String, Object>> visible = more ? items.subList(0, size) : items;
        Map<String, Object> last = visible.isEmpty() ? null : visible.get(visible.size() - 1);
        return new ContentHistoryPage(new ArrayList<>(visible), total == null ? 0 : total,
                more ? String.valueOf(last.get("issueNo")) : null);
    }

    private static NoticeCursor noticeCursor(String value) {
        if (value == null || value.isBlank()) {
            return new NoticeCursor(Timestamp.valueOf(LocalDateTime.of(9999, 12, 31, 23, 59, 59)).toInstant(),
                    UUID.fromString("ffffffff-ffff-ffff-ffff-ffffffffffff"));
        }
        try {
            String[] parts = value.split("\\|", -1);
            if (parts.length != 2 || value.length() > 100) {
                throw new IllegalArgumentException();
            }
            return new NoticeCursor(Instant.parse(parts[0]), UUID.fromString(parts[1]));
        } catch (RuntimeException invalid) {
            throw new ContentException(ContentErrorCode.INVALID_REQUEST);
        }
    }

    private static int magazineCursor(String value) {
        if (value == null || value.isBlank()) {
            return Integer.MAX_VALUE;
        }
        try {
            int issueNo = Integer.parseInt(value);
            if (issueNo <= 0) {
                throw new IllegalArgumentException();
            }
            return issueNo;
        } catch (RuntimeException invalid) {
            throw new ContentException(ContentErrorCode.INVALID_REQUEST);
        }
    }

    private static int limit(Integer value) {
        if (value == null) {
            return 50;
        }
        if (value < 1 || value > 100) {
            throw new ContentException(ContentErrorCode.INVALID_REQUEST);
        }
        return value;
    }

    private record NoticeCursor(Instant publishedAt, UUID id) { }

}
