package com.oneorthree.business.usecase;

import com.oneorthree.business.api.dto.IslandNoticeResponses;
import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.request.CursorBoundary;
import com.oneorthree.business.common.request.CursorScope;
import com.oneorthree.business.common.request.SignedCursorCodec;
import com.oneorthree.business.upstream.data.DataApiClient;
import com.oneorthree.business.upstream.data.dto.IslandNotices;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * 섬 게시판 6종의 공개 유스케이스 (GROMO-1771, island-board LLD §1~§4).
 *
 * <p>주민·게시판 완공·작성 권한·멱등·version 은 전부 Data TX 가 판정한다. Business 는 strict 세션의 주체만
 * 넘기고, 서명 커서를 풀고 만들며, 도메인 실패를 공개 오류 표로 옮긴다.
 *
 * <h2>커서 (LLD §4, api-platform LLD §4)</h2>
 * 목록은 {@code (createdAt DESC, id DESC)}, 댓글은 {@code (createdAt ASC, id ASC)} 다. 서명 커서의 scope 에
 * 사용자·섬(·공지)·정렬·페이지 크기가 묶이므로 다른 섬·다른 공지의 커서는 400 이다. 오류 field 는 실제로 제출된
 * 이름이다 — 목록은 {@code cursor}, 상세의 댓글 쪽은 {@code commentsCursor}. 페이지 크기는 서버 내부 값(30)이고
 * 원본 query 에 limit 을 추가하지 않는다.
 *
 * <p>커서 서명기는 {@code business.cursor.enabled=true} 일 때만 있다 — 없으면 커서를 «없는 셈» 치지 않고 503 으로
 * 실패한다({@code IslandMailboxUseCase#codec} 과 같은 모양).
 */
@Service
@RequiredArgsConstructor
public class IslandNoticeUseCase {

    /** 목록·댓글 한 쪽의 크기 — 서버 내부 페이지 설정(LLD §4 기본 30/최대 100). */
    public static final int PAGE_SIZE = 30;

    private static final String FIELD_CURSOR = "cursor";
    private static final String FIELD_COMMENTS_CURSOR = "commentsCursor";

    /**
     * 상류 (status, code) → 공개 코드·필드. 여기 없는 코드는 그대로 올려 전역 핸들러가 동명 공개 코드로 옮기거나
     * (IDEMPOTENCY_KEY_CONFLICT·REQUEST_IN_PROGRESS 등) 502 로 접는다. 상태까지 대조한다 — Data 가 같은 코드의
     * 상태를 바꾸면 공개 표가 조용히 어긋나는 대신 502 가 된다.
     */
    private static final Map<String, PublicFailure> DOMAIN_FAILURES = Map.ofEntries(
            Map.entry("USER_NOT_FOUND", new PublicFailure(404, ApiErrorCode.USER_NOT_FOUND, null)),
            Map.entry("GROUP_NOT_FOUND", new PublicFailure(404, ApiErrorCode.GROUP_NOT_FOUND, "islandId")),
            // 비주민·공지 권한 없음 — api-platform policy 의 명시 매핑(403 FORBIDDEN, field=null).
            Map.entry("MEMBER_ONLY", new PublicFailure(403, ApiErrorCode.FORBIDDEN, null)),
            Map.entry("NOTICE_FORBIDDEN", new PublicFailure(403, ApiErrorCode.FORBIDDEN, null)),
            Map.entry("BOARD_LOCKED", new PublicFailure(403, ApiErrorCode.FACILITY_LOCKED, null)),
            // 그 섬 경로에 없는 공지(다른 섬의 공지 id 포함).
            Map.entry("NOT_FOUND", new PublicFailure(404, ApiErrorCode.NOT_FOUND, "noticeId")),
            // BQ02·BQ03 결정 전 쓰기 게이트.
            Map.entry("NOTICE_WRITE_UNAVAILABLE", new PublicFailure(503, ApiErrorCode.SERVICE_UNAVAILABLE, null)),
            // BQ03 임시 상한.
            Map.entry("NOTICE_BODY_TOO_LONG", new PublicFailure(422, ApiErrorCode.OUT_OF_RANGE, "body")),
            Map.entry("NOTICE_COMMENT_TOO_LONG", new PublicFailure(422, ApiErrorCode.OUT_OF_RANGE, "text")),
            // Data 의 bean 검증 거절 — 공개 경계가 먼저 거르므로 보통 닿지 않는다.
            Map.entry("INVALID_REQUEST", new PublicFailure(400, ApiErrorCode.INVALID_REQUEST, null)));

    private final DataApiClient data;
    private final ObjectProvider<SignedCursorCodec> cursorCodecs;

    /** 목록 — 커서를 먼저 푸는 것은 위조·만료 커서로 상류를 두드리지 않기 위해서다. 인가는 매 쪽 Data 가 한다. */
    public IslandNoticeResponses.Page list(AccessTokenClaims claims, UUID islandId, String cursor,
            Deadline deadline) {
        CursorScope scope = new CursorScope(claims.userId(), "islands/notices",
                Map.of("islandId", islandId.toString()), "created-desc", PAGE_SIZE);
        Anchor anchor = Anchor.of(codec().decode(cursor, scope, FIELD_CURSOR), FIELD_CURSOR);
        IslandNotices.Page page = relay(() -> data.fetchNotices(claims.userId(), islandId,
                anchor == null ? null : anchor.createdAt(), anchor == null ? null : anchor.id(), PAGE_SIZE,
                deadline));
        if (page == null) {
            throw new UpstreamContractMismatchException("게시판 목록 응답이 없습니다");
        }
        List<IslandNoticeResponses.Item> items = page.items().stream()
                .map(item -> new IslandNoticeResponses.Item(item.id(), item.title(), item.commentCount()))
                .toList();
        String next = null;
        if (page.hasMore()) {
            IslandNotices.Item last = lastOf(page.items());
            next = codec().encode(scope, new CursorBoundary(last.createdAt().toString(), last.id().toString()));
        }
        return new IslandNoticeResponses.Page(items, next);
    }

    /** 상세 + 댓글 한 쪽. 댓글 커서는 공지까지 scope 에 묶여 다른 공지로 옮겨 쓸 수 없다. */
    public IslandNoticeResponses.Detail detail(AccessTokenClaims claims, UUID islandId, UUID noticeId,
            String commentsCursor, Deadline deadline) {
        CursorScope scope = new CursorScope(claims.userId(), "islands/notices/comments",
                Map.of("islandId", islandId.toString(), "noticeId", noticeId.toString()), "created-asc",
                PAGE_SIZE);
        Anchor anchor = Anchor.of(codec().decode(commentsCursor, scope, FIELD_COMMENTS_CURSOR),
                FIELD_COMMENTS_CURSOR);
        IslandNotices.Detail notice = relay(() -> data.fetchNotice(claims.userId(), islandId, noticeId,
                anchor == null ? null : anchor.createdAt(), anchor == null ? null : anchor.id(), PAGE_SIZE,
                deadline));
        if (notice == null) {
            throw new UpstreamContractMismatchException("공지 상세 응답이 없습니다");
        }
        List<IslandNoticeResponses.Comment> comments = notice.comments().stream()
                .map(c -> new IslandNoticeResponses.Comment(c.id(), c.userId(), c.name(), c.text(), c.createdAt()))
                .toList();
        String next = null;
        if (notice.hasMoreComments()) {
            IslandNotices.Comment last = lastOf(notice.comments());
            next = codec().encode(scope, new CursorBoundary(last.createdAt().toString(), last.id().toString()));
        }
        return new IslandNoticeResponses.Detail(notice.id(), notice.title(), notice.body(), notice.version(),
                comments, next);
    }

    public IslandNotices.Notice create(AccessTokenClaims claims, UUID islandId, String title, String body, UUID key,
            Deadline deadline) {
        return required(relay(() -> data.createNotice(claims.userId(), islandId, title, body, key, deadline)));
    }

    public IslandNotices.Notice update(AccessTokenClaims claims, UUID islandId, UUID noticeId, String title,
            String body, UUID key, Deadline deadline) {
        return required(relay(() -> data.updateNotice(claims.userId(), islandId, noticeId, title, body, key,
                deadline)));
    }

    public IslandNotices.Deleted delete(AccessTokenClaims claims, UUID islandId, UUID noticeId, UUID key,
            Deadline deadline) {
        IslandNotices.Deleted deleted = relay(() -> data.deleteNotice(claims.userId(), islandId, noticeId, key,
                deadline));
        if (deleted == null || !deleted.deleted()) {
            throw new UpstreamContractMismatchException("공지 삭제 응답이 계약과 다릅니다");
        }
        return deleted;
    }

    public IslandNotices.CommentCreated comment(AccessTokenClaims claims, UUID islandId, UUID noticeId, String text,
            UUID key, Deadline deadline) {
        return required(relay(() -> data.createNoticeComment(claims.userId(), islandId, noticeId, text, key,
                deadline)));
    }

    // ---------------------------------------------------------------- 도구

    /** {@code hasMore=true} 인데 행이 없으면 경계를 만들 수 없다 — 상류 계약 위반이다. */
    private static <T> T lastOf(List<T> rows) {
        if (rows.isEmpty()) {
            throw new UpstreamContractMismatchException("다음 쪽이 있다면서 행이 없습니다");
        }
        return rows.get(rows.size() - 1);
    }

    private static <T> T required(T value) {
        if (value == null) {
            throw new UpstreamContractMismatchException("게시판 명령 응답이 없습니다");
        }
        return value;
    }

    /** {@link IslandMailboxUseCase} 와 같은 이유로 서명기가 없으면 503 이다. */
    private SignedCursorCodec codec() {
        SignedCursorCodec codec = cursorCodecs.getIfAvailable();
        if (codec == null) {
            throw new PublicApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null);
        }
        return codec;
    }

    private static <T> T relay(Supplier<T> upstream) {
        try {
            return upstream.get();
        } catch (UpstreamDomainException e) {
            PublicFailure failure = DOMAIN_FAILURES.get(e.getCode());
            if (failure == null || failure.upstreamStatus() != e.getStatus()) {
                throw e;
            }
            throw new PublicApiException(failure.code(), failure.field());
        }
    }

    /** 서명 커서가 담은 keyset 경계 — 서명은 통과했는데 값이 형식에 맞지 않으면 위조·손상이다(같은 400). */
    private record Anchor(Instant createdAt, UUID id) {

        static Anchor of(CursorBoundary boundary, String field) {
            if (boundary == null) {
                return null;
            }
            try {
                return new Anchor(Instant.parse(boundary.sortKey()), UUID.fromString(boundary.tieBreaker()));
            } catch (DateTimeParseException | IllegalArgumentException e) {
                throw new PublicApiException(ApiErrorCode.INVALID_CURSOR, field);
            }
        }
    }

    /** 상류 (status, code) 한 쌍 → 공개 코드와 입력 필드. */
    private record PublicFailure(int upstreamStatus, ApiErrorCode code, String field) {
    }
}
