package com.oneorthree.phone.user.dto;

/**
 * 알림 설정 현재값 조회 응답 (GROMO-612).
 * 요청 DTO {@link NotificationSettingsRequest} 를 미러 — 시각은 "HH:mm" 문자열(미설정 시 null).
 */
public record NotificationSettingsResponse(
        boolean notificationEnabled,
        boolean soundEnabled,
        boolean nightModeEnabled,
        String nightStartTime,
        String nightEndTime
) {}
