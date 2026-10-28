package com.oneorthree.phone.internal.dto;

import com.fasterxml.jackson.annotation.JsonCreator;

import java.util.Map;
import java.util.Set;

/**
 * 2.0 표면의 AT 재발급 요청 (GROMO-2035). 자격은 RT 하나이고 Data 가 서명으로 직접 검증한다.
 *
 * <p>{@link SessionLogoutRequest} 와 같은 모양이다 — 알 수 없는 필드를 <b>거부</b>하고 자동
 * {@code toString} 으로 비밀을 흘리지 않는다. 모르는 필드를 무시하면 오타 난 요청이 성공한다.
 */
public record SessionRefreshRequest(String refreshToken) {

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static SessionRefreshRequest fromJson(Map<String, Object> fields) {
        if (fields == null || !Set.of("refreshToken").containsAll(fields.keySet())
                || !(fields.get("refreshToken") instanceof String refresh)) {
            throw new IllegalArgumentException("갱신 요청 형식이 올바르지 않습니다.");
        }
        return new SessionRefreshRequest(refresh);
    }

    @Override
    public String toString() {
        return "SessionRefreshRequest[refreshToken=REDACTED]";
    }
}
