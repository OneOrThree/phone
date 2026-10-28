package com.oneorthree.phone.outbox.dto;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.UUID;

/** 기존 command_idempotency.response_body에만 저장하는 버전 달린 공개 명령 결과. */
public record PublicCommandReceipt(int contractVersion, UUID userId, String operation, UUID key,
                                   String fingerprint, int httpStatus, JsonNode data, JsonNode events) {

    public PublicCommandReceipt {
        // 미지원 버전도 읽은 뒤 서비스가 명시 거절한다. 구버전을 신규 실행으로 오인하면 안 된다.
        data = data == null ? null : data.deepCopy();
        events = events == null ? null : events.deepCopy();
    }

    public static PublicCommandReceipt completed(PublicCommandRequest request, PublicCommandResult result) {
        return new PublicCommandReceipt(1, request.userId(), request.operation(), request.key(),
                request.fingerprint(), result.httpStatus(), result.data(), result.events());
    }

    @Override
    public JsonNode data() {
        return data == null ? null : data.deepCopy();
    }

    @Override
    public JsonNode events() {
        return events == null ? null : events.deepCopy();
    }
}
