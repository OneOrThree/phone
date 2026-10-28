package com.oneorthree.phone.internal.dto;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** 새 내부 설정 계약은 JSON 문자열/소수의 자동 타입 변환과 알 수 없는 필드를 허용하지 않는다. */
final class SettingsRequestFields {
    private SettingsRequestFields() {
    }

    static void requireKeys(Map<String, Object> fields, Set<String> expected) {
        if (fields == null || !fields.keySet().equals(expected)) {
            throw new IllegalArgumentException("설정 요청의 필드가 올바르지 않습니다.");
        }
    }

    static UUID sessionId(Object value) {
        if (!(value instanceof String text) || text.length() != 36) {
            throw new IllegalArgumentException("서명된 세션 식별자가 필요합니다.");
        }
        UUID id = UUID.fromString(text);
        if (!id.toString().equalsIgnoreCase(text)) {
            throw new IllegalArgumentException("세션 식별자 형식이 올바르지 않습니다.");
        }
        return id;
    }

    static Long generation(Object value) {
        if (!(value instanceof Integer) && !(value instanceof Long)) {
            throw new IllegalArgumentException("서명된 정수 세대가 필요합니다.");
        }
        long generation = ((Number) value).longValue();
        if (generation < 0) {
            throw new IllegalArgumentException("세대는 음수일 수 없습니다.");
        }
        return generation;
    }
}
