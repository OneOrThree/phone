package com.oneorthree.phone.outbox.dto;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.Objects;

/** 같은 TX에서 확정한 최소 결과와 이벤트. 토큰·cookie·현재 requestId는 포함하지 않는다. */
public record PublicCommandResult(int httpStatus, JsonNode data, JsonNode events) {

    public PublicCommandResult {
        if (httpStatus != 200 && httpStatus != 201) {
            throw new IllegalArgumentException("공개 JSON 명령 성공 상태는 200 또는 201입니다.");
        }
        Objects.requireNonNull(data, "빈 성공 결과도 명시적인 JSON null이어야 합니다.");
        Objects.requireNonNull(events, "이벤트 목록은 필수입니다.");
        if (!events.isArray()) {
            throw new IllegalArgumentException("이벤트는 JSON 배열이어야 합니다.");
        }
        data = data.deepCopy();
        events = events.deepCopy();
    }

    @Override
    public JsonNode data() {
        return data.deepCopy();
    }

    @Override
    public JsonNode events() {
        return events.deepCopy();
    }
}
