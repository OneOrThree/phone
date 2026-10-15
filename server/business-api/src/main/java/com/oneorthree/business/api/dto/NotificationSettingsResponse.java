package com.oneorthree.business.api.dto;

/**
 * 알림 설정 현재값 — 기존 Data API 응답({@code NotificationSettingsResponse}, GROMO-612)과 필드가 같다.
 * 값의 출처만 바뀐다: 정본은 {@code gromo_notification} 이라 <b>알림 서버에서</b> 읽는다(§3).
 */
public record NotificationSettingsResponse(
        boolean notificationEnabled,
        boolean soundEnabled,
        boolean nightModeEnabled,
        String nightStartTime,
        String nightEndTime) {
}
