package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.List;
import java.util.UUID;

/**
 * 편지함 커서 페이지 (GROMO-1933) — Data 의 {@code LetterSliceView} 와 같은 필드라 그대로 내보낸다.
 * 빈 페이지도 이 봉투 한 겹으로 온다 — {@code content} 가 빠지면 계약 불일치다.
 *
 * @param content    현재 페이지(최신순). 빈 목록은 {@code []}
 * @param size       요청 페이지 크기
 * @param hasNext    다음 페이지 존재 여부
 * @param nextCursor 다음 조회에 넘길 커서. {@code hasNext=false} 면 null
 */
public record LetterSlice(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<LetterItem> content,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int size,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean hasNext,
        UUID nextCursor) {
}
