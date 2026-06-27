package com.oneorthree.phone.user.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class NotificationSettingsRequest {

    private static final String HH_MM = "^([01]\\d|2[0-3]):[0-5]\\d$";

    @NotNull
    private Boolean notificationEnabled;

    @NotNull
    private Boolean soundEnabled;

    @NotNull
    private Boolean nightModeEnabled;

    @Pattern(regexp = HH_MM, message = "HH:mm 형식이어야 합니다")
    private String nightStartTime;

    @Pattern(regexp = HH_MM, message = "HH:mm 형식이어야 합니다")
    private String nightEndTime;
}
