package com.oneorthree.phone.content.service;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.oneorthree.phone.content.exception.ContentErrorCode;
import com.oneorthree.phone.content.exception.ContentException;
import com.oneorthree.phone.content.repository.ContentStore;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

/** 전역 개발자 소식. 게시 UUID와 내용은 불변이며 재시도는 최초 결과를 돌려준다. */
@Service
@RequiredArgsConstructor
public class DeveloperNoticeService {
    private static final Pattern MIN_VERSION = Pattern.compile("^[0-9]{1,9}\\.[0-9]{1,9}\\.[0-9]{1,9}$");
    private static final String COLUMNS = "publication_id,title,body,starts_at,ends_at,published_at,"
            + "min_ios_version,min_android_version";
    /** 한 쪽의 최대이자 기본 크기. 앱이 첫 쪽만 훑어 예약 공지를 고르므로 기본값을 줄이지 않는다. */
    private static final int PAGE_MAX = 100;
    private final JdbcTemplate jdbc;
    private final ContentStore store;
    private final Clock clock;

    @Transactional
    public Notice publish(UUID id, Draft draft, String actor) {
        if (draft == null || !text(draft.title(), 120) || !text(draft.body(), 10000)
                || draft.startsAt() == null
                || (draft.endsAt() != null && !draft.endsAt().isAfter(draft.startsAt()))
                || !version(draft.minIosVersion()) || !version(draft.minAndroidVersion())) {
            throw new ContentException(ContentErrorCode.INVALID_REQUEST);
        }
        String digest = ContentJson.digest(draft);
        store.lock(id);
        String previous = store.replay(id, "NOTICE", digest);
        if (previous != null) {
            return ContentJson.read(previous, Notice.class);
        }
        Notice notice = new Notice(id, draft.title(), draft.body(), draft.startsAt(), draft.endsAt(), clock.instant(),
                draft.minIosVersion(), draft.minAndroidVersion());
        jdbc.update("INSERT INTO developer_notices(publication_id,title,body,starts_at,ends_at,published_at,"
                        + "min_ios_version,min_android_version) VALUES(?,?,?,?,?,?,?,?)",
                id, notice.title(), notice.body(),
                Timestamp.from(notice.startsAt()),
                notice.endsAt() == null ? null : Timestamp.from(notice.endsAt()), Timestamp.from(notice.publishedAt()),
                notice.minIosVersion(), notice.minAndroidVersion());
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

    /** 관리 목록(전체)이나 공개 목록(활성만)의 첫 쪽 — 최대 100건이다. 이어 읽기는 공개 목록의 keyset 쪽만 한다. */
    @Transactional(readOnly = true)
    public Page list(boolean management) {
        return page(management, null, null, PAGE_MAX);
    }

    /**
     * 공개 목록 한 쪽 — {@code (publishedAt DESC, id DESC)}. anchor 는 이전 쪽 마지막 행의 두 값이고 둘 다 있거나
     * 둘 다 없어야 한다. 같은 {@code publishedAt} 의 행은 id 가 가르므로 쪽 경계에서 겹치거나 빠지지 않는다.
     * 활성 조건의 now 는 쪽마다 다시 읽는다 — 쪽 사이에 미시작·만료가 바뀌는 것은 허용한다.
     */
    @Transactional(readOnly = true)
    public Page list(Instant afterPublishedAt, UUID afterId, int limit) {
        if (limit < 1 || limit > PAGE_MAX || (afterPublishedAt == null) != (afterId == null)) {
            throw new ContentException(ContentErrorCode.INVALID_REQUEST);
        }
        return page(false, afterPublishedAt, afterId, limit);
    }

    /** limit+1 건을 읽어 {@code hasMore} 를 정한다 — 정확히 limit 건이면 false 다. */
    private Page page(boolean management, Instant afterPublishedAt, UUID afterId, int limit) {
        List<Object> args = new ArrayList<>();
        String where = "";
        if (!management) {
            Timestamp now = Timestamp.from(clock.instant());
            where = " WHERE withdrawn_at IS NULL AND starts_at<=? AND (ends_at IS NULL OR ends_at>?)";
            args.add(now);
            args.add(now);
        }
        if (afterPublishedAt != null) {
            where += (where.isEmpty() ? " WHERE" : " AND") + " (published_at,publication_id)<(?::timestamptz,?::uuid)";
            args.add(Timestamp.from(afterPublishedAt));
            args.add(afterId);
        }
        args.add(limit + 1);
        List<Notice> rows = jdbc.query("SELECT " + COLUMNS + " FROM developer_notices" + where
                        + " ORDER BY published_at DESC,publication_id DESC LIMIT ?",
                DeveloperNoticeService::notice, args.toArray());
        boolean hasMore = rows.size() > limit;
        return new Page(hasMore ? rows.subList(0, limit) : rows, hasMore);
    }

    @Transactional(readOnly = true)
    public Notice get(UUID id) {
        Instant now = clock.instant();
        List<Notice> rows = jdbc.query("SELECT " + COLUMNS
                        + " FROM developer_notices WHERE publication_id=? AND withdrawn_at IS NULL AND starts_at<=?"
                        + " AND (ends_at IS NULL OR ends_at>?)",
                DeveloperNoticeService::notice, id, Timestamp.from(now), Timestamp.from(now));
        if (rows.isEmpty()) {
            throw new ContentException(ContentErrorCode.NOT_FOUND);
        }
        return rows.get(0);
    }

    /** 지금 유효한 해당 플랫폼 최소 버전 공지 중 가장 최근 것. 없으면 전부 null. */
    @Transactional(readOnly = true)
    public AppRequirement appRequirement(String platform) {
        // 칼럼명은 platform 값으로 고른 고정 문자열이다. 입력을 SQL에 잇지 않는다.
        String column = switch (platform == null ? "" : platform) {
            case "ios" -> "min_ios_version";
            case "android" -> "min_android_version";
            default -> throw new ContentException(ContentErrorCode.INVALID_REQUEST);
        };
        Timestamp now = Timestamp.from(clock.instant());
        List<AppRequirement> rows = jdbc.query("SELECT " + column + ",title,body,publication_id,published_at"
                        + " FROM developer_notices WHERE withdrawn_at IS NULL AND starts_at<=?"
                        + " AND (ends_at IS NULL OR ends_at>?) AND " + column + " IS NOT NULL"
                        + " ORDER BY GREATEST(starts_at,published_at) DESC,published_at DESC,"
                        + "publication_id DESC LIMIT 1",
                (rs, number) -> new AppRequirement(rs.getString(1), rs.getString(2), rs.getString(3),
                        rs.getObject(4, UUID.class), rs.getTimestamp(5).toInstant()), now, now);
        return rows.isEmpty() ? new AppRequirement(null, null, null, null, null) : rows.get(0);
    }

    private static Notice notice(ResultSet rs, int number) throws SQLException {
        Timestamp end = rs.getTimestamp(5);
        return new Notice(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3),
                rs.getTimestamp(4).toInstant(), end == null ? null : end.toInstant(),
                rs.getTimestamp(6).toInstant(), rs.getString(7), rs.getString(8));
    }

    private static boolean version(String value) {
        return value == null || MIN_VERSION.matcher(value).matches();
    }

    private static boolean text(String value, int max) {
        return value != null && !value.isBlank() && value.codePointCount(0, value.length()) <= max
                && value.indexOf('\0') < 0;
    }


    // min 은 컴포넌트 단위 NON_NULL: 없는 초안의 직렬화(=digest)가 기존과 같아야 한다.
    public record Draft(String title, String body, Instant startsAt, Instant endsAt,
                        @JsonInclude(JsonInclude.Include.NON_NULL) String minIosVersion,
                        @JsonInclude(JsonInclude.Include.NON_NULL) String minAndroidVersion) { }

    public record Notice(UUID publicationId, String title, String body, Instant startsAt, Instant endsAt,
                         Instant publishedAt,
                         @JsonInclude(JsonInclude.Include.NON_NULL) String minIosVersion,
                         @JsonInclude(JsonInclude.Include.NON_NULL) String minAndroidVersion) { }

    public record AppRequirement(String minVersion, String title, String body, UUID publicationId,
                                 Instant publishedAt) { }

    public record Withdrawal(UUID publicationId, Instant withdrawnAt, String withdrawnBy) { }

    /** {@code hasMore} 는 이 쪽 뒤에 같은 조건의 행이 더 있다는 뜻이다 — 이어 읽을 경계는 호출자가 마지막 행에서 만든다. */
    public record Page(List<Notice> items, boolean hasMore) { }
}
