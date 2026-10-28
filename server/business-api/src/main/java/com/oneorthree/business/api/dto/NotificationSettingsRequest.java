package com.oneorthree.business.api.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/**
 * 알림 수신 설정 변경 요청 — <b>전체 교체</b>다. 기존 Data API DTO 의 제약을 글자 그대로 옮겼다.
 *
 * <p>필드 하나만 바꾸려 해도 나머지를 현재값 그대로 실어야 하고, 세 플래그는 필수라 생략하면 400 이다.
 * 야간 방해금지 시각은 {@code "HH:mm"} 문자열이고 <b>시간대를 담지 않는다</b> — 서버 날짜 축이 KST
 * 고정이라 해석도 그 축에서 이뤄진다. 자정을 넘기는 구간(22:00~07:00)도 정상 입력이다.
 *
 * <p><b>여기서 기본값을 채우지 않는다.</b> 채우면 「전체 교체」가 아니게 되고, 앱이 빠뜨린 필드가
 * 조용히 다른 값으로 저장된다.
 */
public record NotificationSettingsRequest(
        @NotNull Boolean notificationEnabled,
        @NotNull Boolean soundEnabled,
        @NotNull Boolean nightModeEnabled,
        @Pattern(regexp = "^([01]\\d|2[0-3]):[0-5]\\d$", message = "HH:mm 형식이어야 합니다")
        String nightStartTime,
        @Pattern(regexp = "^([01]\\d|2[0-3]):[0-5]\\d$", message = "HH:mm 형식이어야 합니다")
        String nightEndTime) {
}
