package com.oneorthree.phone.user.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class NotificationSettingsRequest {
    @NotNull
    private Boolean notificationEnabled;

    @NotNull
    private Boolean soundEnabled;

    @NotNull
    private Boolean nightModeEnabled;

    private String nightStartTime;

    private String nightEndTime;
}
