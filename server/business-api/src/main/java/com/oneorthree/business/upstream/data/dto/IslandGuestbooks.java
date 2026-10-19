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
 * 섬 방명록 Data 응답 — Data {@code IslandGuestbookViews} 와 같은 필드다. Business가 hasMore를
 * 서명 커서로 바꿔 공개한다. 필수 필드가 빠지거나 null 이면 계약 불일치(502)다. 삭제는 공지와 같은
 * {@link IslandNotices.Deleted} 를 쓴다.
 */
public final class IslandGuestbooks {

    private IslandGuestbooks() {
    }

    /**
     * 최신순 한 페이지. {@code boardBuilt} 는 게시판의 <b>실제 완공 여부</b>다(시설 게이트 플래그와 무관) — 게이트가 켜진
     * 환경에서 false 면 {@code items} 는 비어 있다.
     */
    public record Page(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean boardBuilt,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<Item> items,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean hasMore) {
    }

    /** {@code authorName} 은 닉네임이 아직 없는 계정이면 null 이다 — 키는 항상 실린다. */
    @Schema(name = "IslandGuestbookItem")
    public record Item(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID authorId,
            @JsonInclude(JsonInclude.Include.ALWAYS) String authorName,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String content,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Instant createdAt,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean mine) {
    }
}
