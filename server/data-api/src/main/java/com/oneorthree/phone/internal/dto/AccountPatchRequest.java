package com.oneorthree.phone.internal.dto;

import com.fasterxml.jackson.annotation.JsonCreator;

import java.util.Map;
import java.util.Set;

/**
 * 공개 {@code PATCH /me} 의 내부 본문 (GROMO-1801). Business 가 공개 본문을 검증한 뒤 {@code name} 하나만 싣는다 —
 * {@code catColor} 는 Q03 카탈로그가 없어 Business 가 422 로 끝낸다. 문자열 외 타입·null·미지 필드는 400 이다.
 *
 * @param name 새 닉네임 원문(trim 전). 형식·중복 판정은 기존 닉네임 writer 가 한다
 */
public record AccountPatchRequest(String name) {
    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static AccountPatchRequest fromJson(Map<String, Object> fields) {
        SettingsRequestFields.requireKeys(fields, Set.of("name"));
        if (!(fields.get("name") instanceof String name)) {
            throw new IllegalArgumentException("name 은 문자열이어야 합니다.");
        }
        return new AccountPatchRequest(name);
    }
}
