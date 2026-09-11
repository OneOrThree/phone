package com.oneorthree.phone.internal.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** 설정 초기화 snapshot도 현재 로그인 세션과 사용자 세대를 동기 검증한다. */
public record NotificationSettingsSnapshotRequest(@NotNull UUID sessionId,
                                                   @NotNull @PositiveOrZero Long authGeneration) {
    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static NotificationSettingsSnapshotRequest fromJson(Map<String, Object> fields) {
        SettingsRequestFields.requireKeys(fields, Set.of("sessionId", "authGeneration"));
        return new NotificationSettingsSnapshotRequest(SettingsRequestFields.sessionId(fields.get("sessionId")),
                SettingsRequestFields.generation(fields.get("authGeneration")));
    }
}
