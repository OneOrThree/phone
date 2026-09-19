package com.oneorthree.business.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 섬 게시판 공개 조회 응답 (GROMO-1771, island-board LLD §1·§2). 원본 계약의 필드만 싣는다 — 정렬 키
 * {@code createdAt} 은 목록에 노출하지 않고 서명 커서 안에만 둔다.
 */
public final class IslandNoticeResponses {

    private IslandNoticeResponses() {
    }

    /** 목록 — {@code nextCursor} 는 더 없으면 null 이고 키는 항상 실린다. */
    public record Page(List<Item> items, @JsonInclude(JsonInclude.Include.ALWAYS) String nextCursor) {
    }

    public record Item(UUID id, String title, long commentCount) {
    }

    /** 상세 — 댓글 다음 쪽은 {@code nextCommentsCursor} 로 같은 GET 에 {@code commentsCursor} 로 읽는다. */
    public record Detail(UUID id, String title, String body, long version, List<Comment> comments,
            @JsonInclude(JsonInclude.Include.ALWAYS) String nextCommentsCursor) {
    }

    /**
     * 댓글 — {@code userId}·{@code name} 은 작성자가 없거나 탈퇴했으면 null(키는 항상 실린다). {@code catColor} 는
     * 아직 없다: 그 값의 소유 도메인이 없고 null 은 이미 「비노출」의 뜻이다({@code MailboxMessageResponse} 와 같은 판단).
     */
    public record Comment(UUID id, @JsonInclude(JsonInclude.Include.ALWAYS) UUID userId,
            @JsonInclude(JsonInclude.Include.ALWAYS) String name, String text, Instant createdAt) {
    }
}
