package com.oneorthree.phone.internal.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Business가 검증한 세션 증명과 앱의 위임 대상을 구분한다. 외부 임의 userId 필드는 받지 않는다. */
public record HostTransferRequest(@NotNull UUID targetUserId, @NotNull UUID sessionId,
                                  @NotNull @PositiveOrZero Long authGeneration) {
    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static HostTransferRequest fromJson(Map<String, Object> fields) {
        SettingsRequestFields.requireKeys(fields, Set.of("targetUserId", "sessionId", "authGeneration"));
        return new HostTransferRequest(SettingsRequestFields.sessionId(fields.get("targetUserId")),
                SettingsRequestFields.sessionId(fields.get("sessionId")),
                SettingsRequestFields.generation(fields.get("authGeneration")));
    }

    /** 내부 경로·헤더도 UUID 축약형/숫자 변환을 허용하지 않는다. */
    public static UUID identifier(String value) {
        return SettingsRequestFields.sessionId(value);
    }
}
