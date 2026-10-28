package com.oneorthree.phone.outbox.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;

/** 검증된 의미 DTO의 지문. 누락/null과 배열 순서를 보존하고 객체 순서·숫자 표기만 정규화한다. */
public final class PublicCommandFingerprint {

    private PublicCommandFingerprint() {
    }

    public static String of(String operation, JsonNode semanticRequest) {
        return hash(operation + "\0" + canonical(semanticRequest));
    }

    public static String hash(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 미지원", e);
        }
    }

    private static String canonical(JsonNode value) {
        if (value == null || value.isMissingNode()) {
            throw new IllegalArgumentException("의미 요청 값은 필수입니다.");
        }
        if (value.isObject()) {
            List<String> names = new ArrayList<>();
            value.fieldNames().forEachRemaining(names::add);
            names.sort(String::compareTo);
            List<String> fields = new ArrayList<>();
            for (String name : names) {
                fields.add(JsonNodeFactory.instance.textNode(name) + ":" + canonical(value.get(name)));
            }
            return "{" + String.join(",", fields) + "}";
        }
        if (value.isArray()) {
            List<String> elements = new ArrayList<>();
            value.forEach(element -> elements.add(canonical(element)));
            return "[" + String.join(",", elements) + "]";
        }
        if (value.isNumber()) {
            if (value.isFloatingPointNumber() && !Double.isFinite(value.doubleValue())) {
                throw new IllegalArgumentException("유한한 JSON 숫자만 허용합니다.");
            }
            return value.decimalValue().stripTrailingZeros().toPlainString();
        }
        if (value.isTextual() || value.isBoolean() || value.isNull()) {
            return value.toString();
        }
        throw new IllegalArgumentException("표준 JSON 값만 허용합니다.");
    }
}
