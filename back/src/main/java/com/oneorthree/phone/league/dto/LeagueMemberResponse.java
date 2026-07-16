package com.oneorthree.phone.league.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * 리그 랭킹 멤버 1건 응답.
 *
 * <p>tierLevel 은 멤버별 실제 티어(users.tier_level 를 SoT 로 도출) — 전역(교차 티어) 랭킹에서
 * 앱이 내 티어를 전원에게 임시 부여하던 문제 해소 (GROMO-748).
 *
 * <p>isFocusing/focusTimeMinutes/focusStartedAt/focusTagName 은 멤버의 집중 라이브 정보 (GROMO-824,
 * FocusLiveInfoLookup 공용 도출). /league/me/ranking 에서만 채워지고, 전역 랭킹(/league/ranking)은
 * 스코프 밖이라 기본값(false/0/null/null)이다. focusTimeMinutes 는 당일 집중분, isFocusing 은 진행 중
 * 세션 유무, focusStartedAt·focusTagName 은 진행 중일 때만 값이 있다.
 */
public record LeagueMemberResponse(
        int rank,
        UUID userId,
        String nickname,
        int tierLevel,
        int totalFocusSeconds,
        boolean isPinned,
        boolean isFocusing,
        int focusTimeMinutes,
        Instant focusStartedAt,
        String focusTagName
) {
}
