package com.oneorthree.business.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.business.upstream.data.dto.LetterItem;
import com.oneorthree.business.upstream.data.dto.LetterSlice;
import com.oneorthree.business.upstream.data.dto.LetterView;

import java.util.List;
import java.util.UUID;

/**
 * 공개 필드만 명시적으로 조립한다. 내부 전송 DTO의 확장이 응답에 섞이지 않도록 분리한다.
 *
 * <p>{@code kind}·{@code islandId}·(목록의) {@code readAt} 은 시스템 편지(GROMO-2260)에만 값이 있고, 친구 편지는
 * null 이라 키째 빠진다 — 친구 편지함 응답은 GROMO-2260 이전과 같은 모양이다.
 */
public final class LetterResponses {

    private LetterResponses() {
    }

    public record LetterDetailView(
            @JsonProperty(required = true) UUID id,
            @JsonInclude(JsonInclude.Include.ALWAYS) UUID senderId,
            String senderNickname,
            @JsonProperty(required = true) UUID receiverId,
            @JsonProperty(required = true) String content,
            @JsonProperty(required = true) String createdAt,
            String readAt,
            @JsonInclude(JsonInclude.Include.NON_NULL) String kind,
            @JsonInclude(JsonInclude.Include.NON_NULL) UUID islandId) {
        public static LetterDetailView from(LetterView value) {
            if (value == null) {
                return null;
            }
            return new LetterDetailView(
                    value.id(),
                    value.senderId(),
                    value.senderNickname(),
                    value.receiverId(),
                    value.content(),
                    value.createdAt(),
                    value.readAt(),
                    value.kind(),
                    value.islandId());
        }
    }

    public record LetterPageView(
            @JsonProperty(required = true) List<LetterItemView> content,
            @JsonProperty(required = true) int size,
            @JsonProperty(required = true) boolean hasNext,
            UUID nextCursor) {
        public static LetterPageView from(LetterSlice value) {
            if (value == null) {
                return null;
            }
            return new LetterPageView(
                    value.content() == null ? null : value.content().stream().map(LetterItemView::from).toList(),
                    value.size(),
                    value.hasNext(),
                    value.nextCursor());
        }
    }

    public record LetterItemView(
            @JsonProperty(required = true) UUID id,
            @JsonInclude(JsonInclude.Include.ALWAYS) UUID counterpartUserId,
            String counterpartNickname,
            @JsonProperty(required = true) String content,
            @JsonProperty(value = "isRead", required = true) boolean isRead,
            @JsonProperty(required = true) String createdAt,
            @JsonInclude(JsonInclude.Include.NON_NULL) String kind,
            @JsonInclude(JsonInclude.Include.NON_NULL) UUID islandId,
            @JsonInclude(JsonInclude.Include.NON_NULL) String readAt) {
        public static LetterItemView from(LetterItem value) {
            if (value == null) {
                return null;
            }
            return new LetterItemView(
                    value.id(),
                    value.counterpartUserId(),
                    value.counterpartNickname(),
                    value.content(),
                    value.isRead(),
                    value.createdAt(),
                    value.kind(),
                    value.islandId(),
                    value.readAt());
        }
    }
}
