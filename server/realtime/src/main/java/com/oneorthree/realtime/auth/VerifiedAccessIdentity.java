package com.oneorthree.realtime.auth;

import java.time.Instant;
import java.util.UUID;

/** 서명 검증한 AT의 주체/로그인 세션. WebSocket 연결 id와 JWT sessionId는 서로 다르다. */
public record VerifiedAccessIdentity(UUID userId, UUID sessionId, long authGeneration, Instant expiresAt) {
    public VerifiedAccessIdentity {
        if (userId == null || sessionId == null || expiresAt == null
                || authGeneration < 0 || authGeneration > 9007199254740991L) {
            throw new IllegalArgumentException("검증된 세션 증명이 필요합니다.");
        }
    }

    @Override
    public String toString() {
        return "VerifiedAccessIdentity[REDACTED]";
    }
}
