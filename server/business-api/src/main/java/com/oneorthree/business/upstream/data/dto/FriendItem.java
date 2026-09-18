package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.UUID;

/**
 * 친구 목록의 한 건 (GROMO-1894) — Data 의 {@code FriendResponse} 와 같은 필드라 <b>그대로 내보낸다</b>
 * (friend-letter LLD §1.5). 시각은 계산하지 않고 전달만 하므로 문자열로 받는다({@link FocusSessionState} 와 같은 취급).
 *
 * <p>{@code isPinned}·{@code isFocusing} 은 Data 가 {@code @JsonProperty} 로 키를 고정한 값이라 여기서도
 * 이름을 고정한다 — record 접근자 이름 규칙에 맡기면 {@code pinned} 로 새 나갈 수 있다.
 *
 * @param userId           친구 유저 id
 * @param nickname         닉네임 — 탈퇴자는 null 일 수 있다
 * @param tierLevel        티어. 리그 미참여면 null
 * @param occupation       준비 시험 코드. 미설정이면 null
 * @param isPinned         내가 핀한 친구인가
 * @param isFocusing       지금 집중 중인가
 * @param focusTimeMinutes {@code date} 당일 집중 분
 * @param focusStartedAt   진행 중 세션 시작 시각. 미집중이면 null
 * @param focusTagName     진행 중 세션 태그명. 없으면 null
 */
public record FriendItem(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID userId,
        String nickname,
        Integer tierLevel,
        String occupation,
        @JsonProperty(value = "isPinned", required = true) @JsonSetter(nulls = Nulls.FAIL) boolean isPinned,
        @JsonProperty(value = "isFocusing", required = true) @JsonSetter(nulls = Nulls.FAIL) boolean isFocusing,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int focusTimeMinutes,
        String focusStartedAt,
        String focusTagName) {
}
