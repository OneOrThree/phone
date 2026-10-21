package com.oneorthree.business.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.business.upstream.data.dto.IslandGuestbooks;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

/** 방명록 공개 목록 — Data의 hasMore 대신 Business가 서명한 nextCursor를 싣는다. */
public final class IslandGuestbookResponses {

    private IslandGuestbookResponses() {
    }

    @Schema(name = "IslandGuestbook")
    public record Page(@JsonProperty(required = true) boolean boardBuilt,
            @JsonProperty(required = true) List<IslandGuestbooks.Item> items,
            @JsonInclude(JsonInclude.Include.ALWAYS) String nextCursor) {
    }
}
