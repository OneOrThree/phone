package com.oneorthree.notification;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;

final class Json {

    private static final JsonMapper MAPPER = JsonMapper.builder().build();
    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() { };

    private Json() { }

    static Map<String, Object> map(Object value) {
        if (value instanceof String text) {
            return MAPPER.readValue(text, MAP);
        }
        return MAPPER.convertValue(value, MAP);
    }

    static String write(Object value) {
        return MAPPER.writeValueAsString(value);
    }

    static String hash(Object value) {
        return digest(write(sorted(value)));
    }

    static String digest(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private static Object sorted(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> sorted = new TreeMap<>();
            map.forEach((key, item) -> sorted.put(key.toString(), sorted(item)));
            return sorted;
        }
        if (value instanceof List<?> list) {
            return list.stream().map(Json::sorted).toList();
        }
        return value;
    }

    static String text(Map<String, Object> body, String key) {
        Object value = body.get(key);
        if (!(value instanceof String text) || text.isBlank() || text.length() > 4096) {
            throw new NotificationFailure(400, "INVALID_" + key);
        }
        return text;
    }

    static String nullableText(Map<String, Object> body, String key) {
        return body.get(key) == null ? null : text(body, key);
    }

    static long number(Map<String, Object> body, String key) {
        try {
            long value = Long.parseLong(String.valueOf(body.get(key)));
            if (value < 0) {
                throw new NumberFormatException();
            }
            return value;
        } catch (NumberFormatException invalid) {
            throw new NotificationFailure(400, "INVALID_" + key);
        }
    }

    static Long nullableNumber(Map<String, Object> body, String key) {
        return body.get(key) == null ? null : number(body, key);
    }

    static UUID uuid(Map<String, Object> body, String key) {
        try {
            return UUID.fromString(text(body, key));
        } catch (IllegalArgumentException invalid) {
            throw new NotificationFailure(400, "INVALID_" + key);
        }
    }

    static boolean bool(Map<String, Object> body, String key) {
        if (!(body.get(key) instanceof Boolean value)) {
            throw new NotificationFailure(400, "INVALID_" + key);
        }
        return value;
    }
}
