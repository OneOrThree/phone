package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.List;

/**
 * 개인 인벤토리 (GROMO-1783, LLD §3 GET /me/inventory). 공개 GET 은 UseCase의 별도 DTO로
 * 명시적으로 매핑한다. {@code hulls} 는 상수 ["raft"] 다 — 유료 선체 폐지로 소유 목록이 아니다.
 * head·neck·shoes(GROMO-2331)는 선택이다 — 옛 Data 응답에 키가 없어도(롤링 배포) 빈 목록으로 받는다.
 */
public record PersonalInventory(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<String> clothes,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<String> decor,
        @JsonSetter(nulls = Nulls.AS_EMPTY) List<String> head,
        @JsonSetter(nulls = Nulls.AS_EMPTY) List<String> neck,
        @JsonSetter(nulls = Nulls.AS_EMPTY) List<String> shoes,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<String> hulls,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long inventoryVersion,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) PersonalAppearanceState equipped) {
}
