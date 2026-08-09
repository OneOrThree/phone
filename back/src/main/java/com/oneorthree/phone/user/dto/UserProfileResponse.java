package com.oneorthree.phone.user.dto;

import java.util.UUID;

/**
 * 본인 프로필 응답 (GET /users/me).
 *
 * @param timeZone 서버가 이 유저의 날짜 버킷을 자르는 IANA 존 문자열(GROMO-1252 코드리뷰 4차 ②, additive).
 *                 {@code countryCode} 파생({@code CountryZoneResolver}) — 미지정·미지원은 Asia/Seoul.
 *                 앱이 자정 걸친 세션의 업로드 키(focusSecondsByDate)를 이 존으로 만들어야 서버 버킷과
 *                 어긋나지 않는다. 매핑 정본을 서버 한 곳에 두려고 코드가 아니라 존 문자열을 내려준다.
 */
public record UserProfileResponse(
        UUID id,
        String nickname,
        int currency,
        int dailyScreenTimeGoalMinutes,
        int dailyFocusTimeGoalMinutes,
        String countryCode,
        String statVisibility,
        String occupation,
        String timeZone
) {}
