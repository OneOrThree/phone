package com.oneorthree.phone.user.dto;

import com.oneorthree.phone.user.repository.domain.Occupation;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 온보딩 프로필 최초 등록 요청. 닉네임만 필수이고 나머지는 생략하면 기본값으로 들어간다.
 *
 * <p>수정({@link UserProfileUpdateRequest})과 달리 목표가 원시 {@code int} 라 <b>"보내지 않음"과 "0"을
 * 구분하지 못한다</b> — 온보딩은 전체를 한 번에 세우는 경로라서다.
 */
@Getter
@NoArgsConstructor
@AllArgsConstructor
public class UserProfileSetupRequest {
    /**
     * 온보딩 시 닉네임 필수 — 로그인 후 반드시 입력 (GROMO-584)
     */
    @NotBlank
    String nickname;
    Occupation occupation;

    /**
     * 목표 상한 24h(GROMO-1049) — 전용 갱신 API와 같은 제약을 온보딩 경로에도 건다.
     */
    @PositiveOrZero
    @Max(value = 24 * 60, message = "하루 24시간을 넘을 수 없습니다")
    int dailyScreenTimeGoalMinutes;

    @PositiveOrZero
    @Max(value = 24 * 60, message = "하루 24시간을 넘을 수 없습니다")
    int dailyFocusTimeGoalMinutes;

    @Pattern(regexp = "^[A-Z]{2}$", message = "ISO 3166-1 alpha-2 형식이어야 합니다")
    String countryCode;
}
