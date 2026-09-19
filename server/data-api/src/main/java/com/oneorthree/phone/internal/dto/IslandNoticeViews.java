package com.oneorthree.phone.internal.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 섬 게시판 내부 응답 (GROMO-1771, island-board LLD §2). 공개 봉투·서명 커서는 Business 가 만든다 — 여기서는
 * 다음 페이지의 존재({@code hasMore})와 경계로 쓸 불변 정렬 키({@code createdAt}·{@code id})만 준다.
 */
public final class IslandNoticeViews {

    private IslandNoticeViews() {
    }

    /** 목록 한 페이지 — {@code (createdAt DESC, id DESC)}. */
    public record Page(List<Item> items, boolean hasMore) {
    }

    /** {@code commentCount} 는 보이는 댓글 수 — 댓글 삭제가 없으니(BQ02) 지금은 전부다. */
    public record Item(UUID id, String title, long commentCount, Instant createdAt) {
    }

    /**
     * 상세 — 본문·댓글 한 페이지·version 이 한 스냅샷이다. {@code version} 은 공지 aggregate 의 마지막 발급값.
     */
    public record Detail(UUID id, String title, String body, long version, List<Comment> comments,
            boolean hasMoreComments) {
    }

    /**
     * 댓글 — {@code userId}·{@code name} 은 작성자 행이 없거나 탈퇴했으면 null 이다. {@code catColor} 는 싣지
     * 않는다: 그 값을 가진 컬럼이 없다({@code InternalIslandMailboxService} 와 같은 판단).
     */
    public record Comment(UUID id, UUID userId, String name, String text, Instant createdAt) {
    }

    /** 작성·수정 결과 — 저장된 두 값 전체. */
    public record Notice(UUID id, String title, String body) {
    }

    /** 삭제 결과 — legacy 의 204 와 섞지 않는다. */
    public record Deleted(boolean deleted) {
    }

    /** 댓글 작성 결과 — 원본 계약 그대로 id·name·text. */
    public record CommentCreated(UUID id, String name, String text) {
    }
}
