package com.oneorthree.business.usecase;

import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.request.ResourceVersions;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;

import java.util.UUID;

/** 신규 설정 상류 응답을 변환 전에 검사한다. 누락 boolean을 false로, 소수를 정수로 바꾸지 않는다. */
final class SettingsContract {

    private SettingsContract() {
    }

    static JsonNode snapshot(JsonNode value, long generation) {
        object(value);
        number(value, "version");
        if (number(value, "authGeneration") != generation) {
            throw invalid();
        }
        ObjectNode normalized = project(value, "version", "authGeneration");
        normalized.set("settings", settings(value.get("settings")));
        return normalized;
    }

    static Command command(JsonNode value, boolean requested) {
        object(value);
        UUID id = uuid(value, "commandId");
        if (!id.equals(uuid(value, "eventId"))) {
            throw invalid();
        }
        long version = number(value, "version");
        number(value, "authGeneration");
        JsonNode mask = value.get("mask");
        if (mask == null || !mask.isArray() || mask.size() != 1
                || !mask.get(0).isString() || !"notificationEnabled".equals(mask.get(0).stringValue())) {
            throw invalid();
        }
        JsonNode patch = value.get("patch");
        object(patch);
        JsonNode result = value.get("result");
        object(result);
        settings(value.get("baseline"));
        if (bool(patch, "notificationEnabled") != requested || bool(result, "notifications") != requested
                || bool(value.get("baseline"), "notificationEnabled") != requested) {
            throw invalid();
        }
        ObjectNode normalized = project(value, "commandId", "eventId", "version", "authGeneration", "mask", "result");
        normalized.set("patch", project(patch, "notificationEnabled"));
        normalized.set("baseline", settings(value.get("baseline")));
        return new Command(id, version, normalized, requested);
    }

    static JsonNode settings(JsonNode value) {
        object(value);
        bool(value, "notificationEnabled");
        bool(value, "soundEnabled");
        bool(value, "nightModeEnabled");
        time(value, "nightStartTime");
        time(value, "nightEndTime");
        return project(value, "notificationEnabled", "soundEnabled", "nightModeEnabled",
                "nightStartTime", "nightEndTime");
    }

    static void applied(JsonNode value) {
        object(value);
        if (!bool(value, "applied")) {
            throw invalid();
        }
    }

    static boolean bool(JsonNode value, String field) {
        JsonNode child = value == null ? null : value.get(field);
        if (child == null || !child.isBoolean()) {
            throw invalid();
        }
        return child.booleanValue();
    }

    private static UUID uuid(JsonNode value, String field) {
        String raw = text(value, field);
        try {
            UUID id = UUID.fromString(raw);
            if (raw.length() != 36 || !id.toString().equalsIgnoreCase(raw)) {
                throw invalid();
            }
            return id;
        } catch (IllegalArgumentException e) {
            throw invalid();
        }
    }

    private static long number(JsonNode value, String field) {
        JsonNode child = value.get(field);
        if (child == null || !child.isIntegralNumber() || !child.canConvertToLong()
                || child.longValue() < 0 || child.longValue() > ResourceVersions.MAX_SAFE_INTEGER) {
            throw invalid();
        }
        return child.longValue();
    }

    private static String text(JsonNode value, String field) {
        JsonNode child = value.get(field);
        if (child == null || !child.isString() || child.stringValue().isBlank()) {
            throw invalid();
        }
        return child.stringValue();
    }

    private static void time(JsonNode value, String field) {
        JsonNode child = value.get(field);
        if (child == null || (!child.isNull() && (!child.isString()
                || !child.stringValue().matches("(?:[01][0-9]|2[0-3]):[0-5][0-9]")))) {
            throw invalid();
        }
    }

    private static void object(JsonNode value) {
        if (value == null || !value.isObject()) {
            throw invalid();
        }
    }

    /** 응답 확장은 허용하되 알 수 없는 필드를 다른 서비스의 명령으로 전달하지 않는다. */
    private static ObjectNode project(JsonNode value, String... fields) {
        ObjectNode result = JsonNodeFactory.instance.objectNode();
        for (String field : fields) {
            result.set(field, value.get(field));
        }
        return result;
    }

    private static UpstreamContractMismatchException invalid() {
        return new UpstreamContractMismatchException("설정 상류 응답 계약 불일치");
    }

    record Command(UUID id, long version, JsonNode data, boolean notifications) {
    }
}
