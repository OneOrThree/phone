package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

/**
 * 초대 코드 해석 결과 (GROMO-1760, 섬 소속 LLD §3.10).
 *
 * <p>{@code invitationToken} 은 가입 명령에 그대로 실어 보내는 불투명 전달값이다 — Business 가
 * 해석하거나 로그·URL 에 복사하지 않는다. 실제 유효성은 가입 커밋의 Data TX 가 다시 검사한다.
 */
public record InvitationResolved(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) IslandSummary island,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String invitationToken) {
}
