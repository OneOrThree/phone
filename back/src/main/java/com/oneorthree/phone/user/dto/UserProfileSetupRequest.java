package com.oneorthree.phone.user.dto;

import com.oneorthree.phone.user.domain.Occupation;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class UserProfileSetupRequest {
    // 온보딩 시 닉네임 필수 — 로그인 후 반드시 입력 (GROMO-584)
    @NotBlank
    String nickname;
    Occupation occupation;

    @PositiveOrZero
    int dailyScreenTimeGoalMinutes;

    @PositiveOrZero
    int dailyFocusTimeGoalMinutes;

    @Pattern(regexp = "^[A-Z]{2}$", message = "ISO 3166-1 alpha-2 형식이어야 합니다")
    String countryCode;
}
