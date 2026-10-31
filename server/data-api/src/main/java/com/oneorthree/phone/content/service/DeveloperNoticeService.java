package com.oneorthree.phone.content.service;

import com.oneorthree.phone.content.exception.ContentErrorCode;
import com.oneorthree.phone.content.exception.ContentException;
import com.oneorthree.phone.content.repository.ContentStore;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** 전역 개발자 소식. 게시 UUID와 내용은 불변이며 재시도는 최초 결과를 돌려준다. */
@Service
@RequiredArgsConstructor
public class DeveloperNoticeService {
    private final JdbcTemplate jdbc;
    private final ContentStore store;
    private final Clock clock;

    @Transactional
    public Notice publish(UUID id, Draft draft, String actor) {
        if (draft == null || !text(draft.title(), 120) || !text(draft.body(), 10000)
                || draft.startsAt() == null
                || (draft.endsAt() != null && !draft.endsAt().isAfter(draft.startsAt()))) {
            throw new ContentException(ContentErrorCode.INVALID_REQUEST);
        }
        String digest = ContentJson.digest(draft);
        store.lock(id);
        String previous = store.replay(id, "NOTICE", digest);
        if (previous != null) {
            return ContentJson.read(previous, Notice.class);
        }
        Notice notice = new Notice(id, draft.title(), draft.body(), draft.startsAt(), draft.endsAt(), clock.instant());
        jdbc.update("INSERT INTO developer_notices(publication_id,title,body,starts_at,ends_at,published_at)"
                        + " VALUES(?,?,?,?,?,?)", id, notice.title(), notice.body(), Timestamp.from(notice.startsAt()),
                notice.endsAt() == null ? null : Timestamp.from(notice.endsAt()), Timestamp.from(notice.publishedAt()));
        store.record(id, "NOTICE", digest, ContentJson.write(notice), actor, notice.publishedAt());
        return notice;
    }

    @Transactional
    public Withdrawal withdraw(UUID id, String actor) {
        List<Withdrawal> previous = jdbc.query("SELECT withdrawn_at,withdrawn_by FROM developer_notices"
                        + " WHERE publication_id=? FOR UPDATE", (rs, row) -> {
                    Timestamp at = rs.getTimestamp("withdrawn_at");
                    return at == null ? null : new Withdrawal(id, at.toInstant(), rs.getString("withdrawn_by"));
                }, id);
        if (previous.isEmpty()) {
            throw new ContentException(ContentErrorCode.NOT_FOUND);
        }
        if (previous.get(0) != null) {
            return previous.get(0);
        }
        Instant at = clock.instant();
        jdbc.update("UPDATE developer_notices SET withdrawn_at=?,withdrawn_by=? WHERE publication_id=?",
                Timestamp.from(at), actor, id);
        return new Withdrawal(id, at, actor);
    }

    @Transactional(readOnly = true)
    public Page list(boolean management) {
        String where = management ? "" : " WHERE withdrawn_at IS NULL AND starts_at<=?"
                + " AND (ends_at IS NULL OR ends_at>?)";
        Object[] args = management ? new Object[0]
                : new Object[]{Timestamp.from(clock.instant()), Timestamp.from(clock.instant())};
        List<Notice> rows = jdbc.query("SELECT publication_id,title,body,starts_at,ends_at,published_at"
                        + " FROM developer_notices" + where
                        + " ORDER BY published_at DESC,publication_id DESC LIMIT 100",
                (rs, number) -> new Notice(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3),
                        rs.getTimestamp(4).toInstant(),
                        rs.getTimestamp(5) == null ? null : rs.getTimestamp(5).toInstant(),
                        rs.getTimestamp(6).toInstant()), args);
        return new Page(rows);
    }

    @Transactional(readOnly = true)
    public Notice get(UUID id) {
        Instant now = clock.instant();
        List<Notice> rows = jdbc.query("SELECT publication_id,title,body,starts_at,ends_at,published_at"
                        + " FROM developer_notices WHERE publication_id=? AND withdrawn_at IS NULL AND starts_at<=?"
                        + " AND (ends_at IS NULL OR ends_at>?)",
                (rs, number) -> new Notice(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3),
                        rs.getTimestamp(4).toInstant(),
                        rs.getTimestamp(5) == null ? null : rs.getTimestamp(5).toInstant(),
                        rs.getTimestamp(6).toInstant()), id, Timestamp.from(now), Timestamp.from(now));
        if (rows.isEmpty()) {
            throw new ContentException(ContentErrorCode.NOT_FOUND);
        }
        return rows.get(0);
    }

    private static boolean text(String value, int max) {
        return value != null && !value.isBlank() && value.codePointCount(0, value.length()) <= max
                && value.indexOf('\0') < 0;
    }


    public record Draft(String title, String body, Instant startsAt, Instant endsAt) { }

    public record Notice(UUID publicationId, String title, String body, Instant startsAt, Instant endsAt,
                         Instant publishedAt) { }

    public record Withdrawal(UUID publicationId, Instant withdrawnAt, String withdrawnBy) { }

    public record Page(List<Notice> items) { }
}
