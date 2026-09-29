package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 섬 게시판 Data 응답 (GROMO-1771) — Data {@code IslandNoticeViews} 와 같은 필드. 필수 필드가 빠지거나 null 이면
 * 계약 불일치(502)다. 커서는 없다 — {@code hasMore} 와 마지막 행의 {@code (createdAt, id)} 로 Business 가
 * 서명 커서를 만든다.
 */
public final class IslandNotices {

    private IslandNotices() {
    }

    /** 목록 한 페이지 — {@code (createdAt DESC, id DESC)}. */
    public record Page(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<Item> items,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean hasMore) {
    }

    public record Item(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String title,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long commentCount,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Instant createdAt) {
    }

    /** 상세 — 본문·댓글 한 페이지·version 이 Data 의 한 스냅샷이다. */
    public record Detail(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String title,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String body,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long version,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<Comment> comments,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean hasMoreComments) {
    }

    /** 댓글 — {@code userId}·{@code name} 은 작성자 행이 없거나 탈퇴했으면 null 이다. */
    public record Comment(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
            UUID userId,
            String name,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String text,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Instant createdAt) {
    }

    /** 작성·수정 결과 — 공개 {@code data} 와 같은 모양이라 그대로 내보낸다. */
    public record Notice(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String title,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String body) {
    }

    /** 삭제 결과. */
    @Schema(name = "IslandNoticeDeleted")
    public record Deleted(@JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean deleted) {
    }

    /**
     * 댓글 작성 결과 — 원본 계약 그대로 id·name·text. {@code name} 은 닉네임이 아직 없는 계정(게스트·온보딩 전)이면
     * null 이다 — 키는 항상 실린다.
     */
    public record CommentCreated(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
            @JsonInclude(JsonInclude.Include.ALWAYS) String name,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String text) {
    }
}
