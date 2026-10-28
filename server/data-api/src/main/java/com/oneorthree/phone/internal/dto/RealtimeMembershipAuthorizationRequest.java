package com.oneorthree.phone.internal.dto;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.core.StreamReadFeature;

import java.io.IOException;
import java.util.UUID;

/** Realtime이 검증한 AT의 sid/gen과 조회 섬. 앱이 지정한 대상 사용자나 수신자 목록은 받지 않는다. */
public record RealtimeMembershipAuthorizationRequest(UUID sessionId, long authGeneration, UUID islandId) {
    private static final long MAX_SAFE_GENERATION = 9007199254740991L;
    private static final JsonFactory JSON = JsonFactory.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build();
    private static final String INVALID_REQUEST = "실시간 멤버십 인가 요청 형식이 올바르지 않습니다.";

    public RealtimeMembershipAuthorizationRequest {
        if (sessionId == null || islandId == null || authGeneration < 0 || authGeneration > MAX_SAFE_GENERATION) {
            throw new IllegalArgumentException(INVALID_REQUEST);
        }
    }

    /** 전역 mapper 설정에 의존하지 않고 중복 필드·자동 형변환·추가 JSON을 거절한다. */
    public static RealtimeMembershipAuthorizationRequest fromJson(byte[] body) {
        try (JsonParser parser = JSON.createParser(body)) {
            if (parser.nextToken() != JsonToken.START_OBJECT) {
                throw new IllegalArgumentException(INVALID_REQUEST);
            }
            UUID sessionId = null;
            UUID islandId = null;
            Long generation = null;
            while (parser.nextToken() != JsonToken.END_OBJECT) {
                if (parser.currentToken() != JsonToken.FIELD_NAME) {
                    throw new IllegalArgumentException(INVALID_REQUEST);
                }
                String name = parser.currentName();
                JsonToken value = parser.nextToken();
                switch (name) {
                    case "sessionId" -> sessionId = readIdentifier(parser, value);
                    case "islandId" -> islandId = readIdentifier(parser, value);
                    case "authGeneration" -> {
                        if (value != JsonToken.VALUE_NUMBER_INT) {
                            throw new IllegalArgumentException(INVALID_REQUEST);
                        }
                        generation = parser.getLongValue();
                    }
                    default -> throw new IllegalArgumentException(INVALID_REQUEST);
                }
            }
            if (generation == null || parser.nextToken() != null) {
                throw new IllegalArgumentException(INVALID_REQUEST);
            }
            return new RealtimeMembershipAuthorizationRequest(sessionId, generation, islandId);
        } catch (IOException | IllegalArgumentException e) {
            // JSON parser의 메시지/원인은 요청 UUID·body를 포함할 수 있어 외부 예외에 붙이지 않는다.
            throw new IllegalArgumentException(INVALID_REQUEST);
        }
    }

    private static UUID readIdentifier(JsonParser parser, JsonToken token) throws IOException {
        if (token != JsonToken.VALUE_STRING) {
            throw new IllegalArgumentException(INVALID_REQUEST);
        }
        return identifier(parser.getText());
    }

    /** UUID version은 제한하지 않되 축약형과 공백·숫자 coercion은 받지 않는다. */
    public static UUID identifier(String value) {
        try {
            if (value == null || value.length() != 36) {
                throw new IllegalArgumentException(INVALID_REQUEST);
            }
            UUID id = UUID.fromString(value);
            if (!id.toString().equalsIgnoreCase(value)) {
                throw new IllegalArgumentException(INVALID_REQUEST);
            }
            return id;
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException(INVALID_REQUEST);
        }
    }

    @Override
    public String toString() {
        return "RealtimeMembershipAuthorizationRequest[sessionId=REDACTED, authGeneration=REDACTED, islandId=REDACTED]";
    }
}
