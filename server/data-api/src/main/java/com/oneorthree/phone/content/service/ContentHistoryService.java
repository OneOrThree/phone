package com.oneorthree.phone.content.service;

import com.oneorthree.phone.content.exception.ContentErrorCode;
import com.oneorthree.phone.content.exception.ContentException;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 운영 DB의 게시 이력을 읽는다. 백오피스 초안 저장소로 복제하지 않는다. */
@Service
@RequiredArgsConstructor
public class ContentHistoryService {
    private final JdbcTemplate jdbc;
    private final Clock clock;

    @Transactional(readOnly = true)
    public Page notices(Integer offset, Integer limit) {
        int start = offset(offset);
        int size = limit(limit);
        Instant now = clock.instant();
        Long total = jdbc.queryForObject("SELECT count(*) FROM developer_notices", Long.class);
        List<Map<String, Object>> items = jdbc.query("SELECT n.publication_id,n.title,n.body,n.starts_at,"
                + "n.ends_at,n.published_at,p.actor FROM developer_notices n"
                + " LEFT JOIN content_publications p ON p.publication_id=n.publication_id"
                + " ORDER BY n.published_at DESC,n.publication_id DESC LIMIT ? OFFSET ?", (rs, row) -> {
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
                item.put("actor", rs.getString("actor"));
                item.put("status", now.isBefore(startsAt) ? "SCHEDULED"
                        : endsAt != null && !now.isBefore(endsAt) ? "EXPIRED" : "LIVE");
                return item;
            }, size, start);
        return page(items, start, size, total);
    }

    @Transactional(readOnly = true)
    public Page magazines(Integer offset, Integer limit) {
        int start = offset(offset);
        int size = limit(limit);
        Long total = jdbc.queryForObject("SELECT count(*) FROM magazine_issues", Long.class);
        List<Map<String, Object>> items = jdbc.query("SELECT i.id,i.issue_date,i.issue_no,i.published_at,"
                + "i.notified_at,i.promotion_count,i.editorial::text AS editorial,"
                + "(SELECT p.actor FROM content_publications p WHERE p.kind='MAGAZINE'"
                + " AND p.result->>'issueId'=i.id::text ORDER BY p.created_at LIMIT 1) AS actor,"
                + "(SELECT count(*) FROM magazine_receipts r WHERE r.issue_id=i.id) AS receipt_count,"
                + "(SELECT count(*) FROM magazine_receipts r WHERE r.issue_id=i.id AND r.opened_at IS NOT NULL)"
                + " AS opened_count FROM magazine_issues i"
                + " ORDER BY i.issue_no DESC LIMIT ? OFFSET ?", (rs, row) -> {
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
                item.put("status", notifiedAt == null ? "NOTIFICATION_PENDING" : "PUBLISHED");
                return item;
            }, size, start);
        return page(items, start, size, total);
    }

    private static Page page(List<Map<String, Object>> items, int start, int size, Long total) {
        long count = total == null ? 0 : total;
        return new Page(new ArrayList<>(items), count, start + items.size() < count ? start + size : null);
    }

    private static int offset(Integer value) {
        if (value == null) {
            return 0;
        }
        if (value < 0 || value > 1_000_000) {
            throw new ContentException(ContentErrorCode.INVALID_REQUEST);
        }
        return value;
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

    public record Page(List<Map<String, Object>> items, long total, Integer nextOffset) { }
}
