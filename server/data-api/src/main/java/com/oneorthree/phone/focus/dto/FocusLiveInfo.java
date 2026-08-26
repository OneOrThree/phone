package com.oneorthree.phone.focus.dto;

import java.time.Instant;

/**
 * 여러 유저의 집중 라이브 정보 배치 조회 결과 (GROMO-822).
 *
 * <p>친구 목록({@code FriendService.getFriends})이 사용하며, 리그 랭킹(GROMO-824 예정)도 재사용하는
 * 도메인 무관 값 객체다. {@code FocusLiveInfoLookup} 이 userId 기준으로 채운다.
 *
 * @param focusTimeMinutes 당일 총 집중 분(초/60 내림 — GROMO-642 계약과 동일)
 * @param isFocusing       현재 진행 중(미종료) 세션 보유 여부
 * @param focusStartedAt   진행 중 세션의 시작 시각(미집중이면 null)
 * @param focusTagName     진행 중 세션의 태그명(태그 미지정이거나 미집중이면 null)
 */
public record FocusLiveInfo(
        int focusTimeMinutes,
        boolean isFocusing,
        Instant focusStartedAt,
        String focusTagName) {
}
