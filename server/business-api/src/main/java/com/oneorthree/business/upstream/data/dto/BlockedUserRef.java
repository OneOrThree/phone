package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.UUID;

/**
 * 차단 목록 항목의 ID 만 읽는 내부 전송 계약 (GROMO-2183). 표시 치환은 누구를 가릴지만 알면 되므로 {@code name}
 * 을 읽지 않는다 — 닉네임이 없는(온보딩 전) 차단 대상 하나 때문에 주민 목록 전체가 계약 위반으로 깨지지 않게 한다.
 */
public record BlockedUserRef(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id) {
}
