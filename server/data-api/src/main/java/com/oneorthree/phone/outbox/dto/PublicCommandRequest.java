package com.oneorthree.phone.outbox.dto;

import com.fasterxml.jackson.databind.JsonNode;
import com.oneorthree.phone.outbox.support.PublicCommandFingerprint;

import java.util.Objects;
import java.util.UUID;

/** 공개 명령의 scope. operation에는 method 의미와 실제 경로 자원 ID를 도메인이 포함해야 한다. */
public record PublicCommandRequest(UUID userId, String operation, UUID key, JsonNode semanticRequest) {

    public PublicCommandRequest {
        Objects.requireNonNull(userId, "명령 주체는 필수입니다.");
        Objects.requireNonNull(key, "앱 명령 키는 필수입니다.");
        if (operation == null || operation.isBlank() || operation.indexOf('\0') >= 0) {
            throw new IllegalArgumentException("공개 명령 작업 범위가 올바르지 않습니다.");
        }
        Objects.requireNonNull(semanticRequest, "검증한 의미 요청은 필수입니다.");
        if (!semanticRequest.isObject()) {
            throw new IllegalArgumentException("의미 요청은 JSON 객체여야 합니다.");
        }
        semanticRequest = semanticRequest.deepCopy();
    }

    @Override
    public JsonNode semanticRequest() {
        return semanticRequest.deepCopy();
    }

    public String fingerprint() {
        return PublicCommandFingerprint.of(operation, semanticRequest);
    }

    /** 본문 지문을 키로 사용하지 않는다. 같은 키의 다른 본문은 같은 저장 위치에서 충돌해야 한다. */
    public IdempotencyRequest storageRequest() {
        String internalKey = "public:v1:" + PublicCommandFingerprint.hash(operation + "\0" + key);
        String commandType = "public:v1:" + PublicCommandFingerprint.hash(operation);
        return new IdempotencyRequest(internalKey, userId, commandType, fingerprint());
    }
}
