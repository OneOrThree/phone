package com.oneorthree.phone.user.dto;

import java.util.UUID;

/**
 * 본인 프로필 응답 (GET /users/me).
 *
 * @param timeZone 서버가 날짜 버킷을 자르는 IANA 존 문자열(GROMO-1252 코드리뷰 4차 ②, additive).
 *                 GROMO-1259 부터 항상 {@code Asia/Seoul} 고정({@code ZonePolicy.KST} — 저장축 KST 통일,
 *                 해외 유저는 L5 수용). 앱이 자정 걸친 세션의 업로드 키(focusSecondsByDate)를 이 존으로
 *                 만들어야 서버 버킷과 어긋나지 않는다. 축 정본을 서버 한 곳에 두려고 존 문자열을 내려준다.
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
