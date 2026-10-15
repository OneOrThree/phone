package com.oneorthree.business.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.business.upstream.data.dto.LetterItem;
import com.oneorthree.business.upstream.data.dto.LetterSlice;
import com.oneorthree.business.upstream.data.dto.LetterView;

import java.util.List;
import java.util.UUID;

/** 공개 필드만 명시적으로 조립한다. 내부 전송 DTO의 확장이 응답에 섞이지 않도록 분리한다. */
public final class LetterResponses {

    private LetterResponses() {
    }

    public record LetterDetailView(
            @JsonProperty(required = true) UUID id,
            @JsonProperty(required = true) UUID senderId,
            String senderNickname,
            @JsonProperty(required = true) UUID receiverId,
            @JsonProperty(required = true) String content,
            @JsonProperty(required = true) String createdAt,
            String readAt) {
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
                    value.readAt());
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
            @JsonProperty(required = true) UUID counterpartUserId,
            String counterpartNickname,
            @JsonProperty(required = true) String content,
            @JsonProperty(value = "isRead", required = true) boolean isRead,
            @JsonProperty(required = true) String createdAt) {
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
                    value.createdAt());
        }
    }
}
