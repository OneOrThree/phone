package com.oneorthree.phone.internal.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** 앱 본문은 notifications 하나이며 나머지는 Business가 검증한 AT의 sid/gen만 전달한다. */
public record NotificationSettingsPatchRequest(@NotNull Boolean notifications, @NotNull UUID sessionId,
                                                @NotNull @PositiveOrZero Long authGeneration) {
    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static NotificationSettingsPatchRequest fromJson(Map<String, Object> fields) {
        SettingsRequestFields.requireKeys(fields, Set.of("notifications", "sessionId", "authGeneration"));
        if (!(fields.get("notifications") instanceof Boolean enabled)) {
            throw new IllegalArgumentException("notifications는 필수 boolean입니다.");
        }
        return new NotificationSettingsPatchRequest(enabled, SettingsRequestFields.sessionId(fields.get("sessionId")),
                SettingsRequestFields.generation(fields.get("authGeneration")));
    }
}
