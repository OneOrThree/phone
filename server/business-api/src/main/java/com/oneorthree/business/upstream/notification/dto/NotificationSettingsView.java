package com.oneorthree.business.upstream.notification.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

/**
 * 알림 설정 <b>정본</b>. 설정의 소유자는 {@code gromo_notification} 이라 GET 도 알림 서버에서 읽는다
 * (§3) — Data 패스스루로는 정본을 못 읽는다.
 *
 * <p>필드는 기존 앱 계약({@code NotificationSettingsResponse})과 <b>글자 그대로 같다</b>: 5필드,
 * 시각은 {@code "HH:mm"} 문자열이고 미설정이면 null. 자정을 넘기는 구간(22:00~07:00)도 정상값이다.
 */
public record NotificationSettingsView(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean notificationEnabled,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean soundEnabled,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean nightModeEnabled,
        String nightStartTime,
        String nightEndTime) {
    public NotificationSettingsView {
        requireTime(nightStartTime);
        requireTime(nightEndTime);
    }

    /** 공개 PUT과 같은 형식만 반환한다. 값 보정은 하지 않고 null은 미설정으로 보존한다. */
    private static void requireTime(String value) {
        if (value != null && !value.matches("^([01]\\d|2[0-3]):[0-5]\\d$")) {
            throw new IllegalArgumentException("알림 설정 응답의 시각은 HH:mm 형식이어야 합니다");
        }
    }
}
