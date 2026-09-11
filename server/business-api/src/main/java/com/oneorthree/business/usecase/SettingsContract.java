package com.oneorthree.business.usecase;

import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.request.ResourceVersions;
import tools.jackson.databind.JsonNode;

import java.util.UUID;

/** 신규 설정 상류 응답을 변환 전에 검사한다. 누락 boolean을 false로, 소수를 정수로 바꾸지 않는다. */
final class SettingsContract {

    private SettingsContract() {
    }

    static JsonNode snapshot(JsonNode value, long generation) {
        object(value, 3);
        number(value, "version");
        if (number(value, "authGeneration") != generation) {
            throw invalid();
        }
        settings(value.get("settings"));
        return value;
    }

    static Command command(JsonNode value, boolean requested) {
        object(value, 8);
        String commandId = text(value, "commandId");
        UUID id;
        try {
            id = UUID.fromString(commandId);
            if (commandId.length() != 36 || !id.toString().equalsIgnoreCase(commandId)) {
                throw invalid();
            }
        } catch (IllegalArgumentException e) {
            throw invalid();
        }
        text(value, "eventId");
        long version = number(value, "version");
        number(value, "authGeneration");
        JsonNode mask = value.get("mask");
        if (mask == null || !mask.isArray() || mask.size() != 1
                || !mask.get(0).isString() || !"notificationEnabled".equals(mask.get(0).stringValue())) {
            throw invalid();
        }
        JsonNode patch = value.get("patch");
        object(patch, 1);
        JsonNode result = value.get("result");
        object(result, 1);
        settings(value.get("baseline"));
        if (bool(patch, "notificationEnabled") != requested || bool(result, "notifications") != requested
                || bool(value.get("baseline"), "notificationEnabled") != requested) {
            throw invalid();
        }
        return new Command(id, version, value, requested);
    }

    static JsonNode settings(JsonNode value) {
        object(value, 5);
        bool(value, "notificationEnabled");
        bool(value, "soundEnabled");
        bool(value, "nightModeEnabled");
        time(value, "nightStartTime");
        time(value, "nightEndTime");
        return value;
    }

    static void applied(JsonNode value) {
        object(value, 1);
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

    private static void object(JsonNode value, int size) {
        if (value == null || !value.isObject() || value.size() != size) {
            throw invalid();
        }
    }

    private static UpstreamContractMismatchException invalid() {
        return new UpstreamContractMismatchException("설정 상류 응답 계약 불일치");
    }

    record Command(UUID id, long version, JsonNode data, boolean notifications) {
    }
}
