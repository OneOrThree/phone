package com.oneorthree.phone.user.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 알림 수신 설정 변경 요청 — <b>전체 교체</b>다. 필드 하나만 바꾸려 해도 나머지를 현재값 그대로 실어
 * 보내야 하며, 세 플래그는 필수라 생략하면 400 이다.
 *
 * <p>야간 방해금지 시각은 {@code "HH:mm"} 문자열이고 <b>시간대를 담지 않는다</b> — 서버 날짜 축이
 * KST 고정이라 해석도 그 축에서 이뤄진다. 자정을 넘기는 구간(예: 22:00~07:00)도 정상 입력이다.
 */
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
