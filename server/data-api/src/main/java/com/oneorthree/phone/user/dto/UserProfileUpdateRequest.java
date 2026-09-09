package com.oneorthree.phone.user.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 프로필 부분 수정 요청 — <b>null 인 필드는 건드리지 않는다</b>. 그래서 목표가 원시 {@code int} 가 아니라
 * {@code Integer} 이고, 0 은 "목표 없음"이라는 실제 값이지 미지정이 아니다.
 *
 * <p>닉네임은 자기 것을 그대로 다시 보내는 건 허용되지만 남이 쓰는 값이면 409 다.
 */
@Getter
@NoArgsConstructor
@AllArgsConstructor
public class UserProfileUpdateRequest {
    String nickname;

    /**
     * 목표 상한 24h(GROMO-1049) — 전용 갱신 API와 같은 제약을 이 경로에도 건다.
     */
    @PositiveOrZero
    @Max(value = 24 * 60, message = "하루 24시간을 넘을 수 없습니다")
    Integer dailyScreenTimeGoalMinutes;

    @PositiveOrZero
    @Max(value = 24 * 60, message = "하루 24시간을 넘을 수 없습니다")
    Integer dailyFocusTimeGoalMinutes;

    @Pattern(regexp = "^[A-Z]{2}$", message = "ISO 3166-1 alpha-2 형식이어야 합니다")
    String countryCode;

    /**
     * 앱이 적용 중인 표시 언어 (GROMO-1692). 앱의 {@code SUPPORTED_LOCALES} 와 같은 집합만 받는다 —
     * {@code 'system'} 은 앱이 기기 언어로 해석해 보내므로 여기 오지 않는다. null 은 «변경 안 함».
     */
    @Pattern(regexp = "^(ko|en|ja|zh-Hant)$", message = "지원하지 않는 언어입니다 (ko·en·ja·zh-Hant)")
    String language;
}
