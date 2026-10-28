package com.oneorthree.business.common.request;

import tools.jackson.databind.JsonNode;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.TreeSet;

/** 검증된 DTO의 의미 지문. 요청 원문·인증 헤더나 재시도 때의 현재 상태를 넣지 않는다. */
public final class SemanticFingerprint {

    private SemanticFingerprint() {
    }

    public static String of(JsonNode value) {
        if (value == null || value.isMissingNode()) {
            throw new IllegalArgumentException("검증된 요청 값이 필요합니다.");
        }
        return digest(canonical(value));
    }

    public static String digest(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256을 사용할 수 없습니다.", e);
        }
    }

    private static String canonical(JsonNode value) {
        if (value.isObject()) {
            TreeSet<String> keys = new TreeSet<>(value.propertyNames());
            StringBuilder result = new StringBuilder("{");
            for (String key : keys) {
                // 키의 길이와 값의 길이를 함께 넣어 구분자 문자가 있는 이름도 충돌하지 않는다.
                String child = canonical(value.get(key));
                result.append(key.length()).append(':').append(key)
                        .append(child.length()).append(':').append(child);
            }
            return result.append('}').toString();
        }
        if (value.isArray()) {
            StringBuilder result = new StringBuilder("[");
            for (JsonNode child : value) {
                String encoded = canonical(child);
                result.append(encoded.length()).append(':').append(encoded);
            }
            return result.append(']').toString();
        }
        if (value.isNumber()) {
            return "n:" + value.decimalValue().stripTrailingZeros().toPlainString();
        }
        if (value.isTextual() || value.isBoolean() || value.isNull()) {
            return value.toString();
        }
        throw new IllegalArgumentException("JSON 값만 지문으로 만들 수 있습니다.");
    }
}
