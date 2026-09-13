package com.oneorthree.phone.internal.dto;

import com.fasterxml.jackson.annotation.JsonCreator;

import java.util.Map;
import java.util.Set;

/** 내부 서비스 인증과 별도로 검증할 사용자 자격. 자동 toString으로 비밀을 출력하지 않는다. */
public record SessionLogoutRequest(String refreshToken, String accessToken) {
    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static SessionLogoutRequest fromJson(Map<String, Object> fields) {
        if (fields == null || !fields.containsKey("refreshToken")
                || !Set.of("refreshToken", "accessToken").containsAll(fields.keySet())
                || !(fields.get("refreshToken") instanceof String refresh)
                || (fields.get("accessToken") != null && !(fields.get("accessToken") instanceof String))) {
            throw new IllegalArgumentException("종료 요청 형식이 올바르지 않습니다.");
        }
        return new SessionLogoutRequest(refresh, (String) fields.get("accessToken"));
    }

    @Override
    public String toString() {
        return "SessionLogoutRequest[refreshToken=REDACTED, accessToken=REDACTED]";
    }
}
