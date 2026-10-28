package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.List;

/**
 * 무작위 발견 한 페이지 (GROMO-1759).
 *
 * <p>{@code nextHandle} 은 셔플 순서 위의 경계값이다. Business 가 이 값을 탐색 seed 와 함께 서명해
 * 다음 {@code nextCursor} 로 만든다. null 이면 후보가 소진됐다.
 */
public record IslandDiscoverPage(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.AS_EMPTY) List<IslandSummary> items,
        String nextHandle) {
}
