package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.List;
import java.util.UUID;

/**
 * 이름 검색 한 페이지 (GROMO-1759).
 *
 * <p>{@code nextIslandId} 는 <b>서명 전</b> keyset 경계다. Business 가 이 값을 사용자·필터·limit 에
 * 묶어 서명한 뒤에야 공개 {@code nextCursor} 가 된다. null 이면 다음 페이지가 없다.
 */
public record IslandSearchPage(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.AS_EMPTY) List<IslandSummary> items,
        UUID nextIslandId) {
}
