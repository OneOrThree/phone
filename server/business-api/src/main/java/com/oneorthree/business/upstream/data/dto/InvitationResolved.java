package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.UUID;

/**
 * 초대 코드 해석 결과 (GROMO-1760, 섬 소속 LLD §3.10).
 *
 * <p>{@code invitationToken} 은 가입 명령에 그대로 실어 보내는 불투명 전달값이다 — Business 가
 * 해석하거나 로그·URL 에 복사하지 않는다. 실제 유효성은 가입 커밋의 Data TX 가 다시 검사한다.
 *
 * <p>{@code arrival} 은 초대 도착 결과다 (GROMO-2264). 필수로 걸지 않는다 — 구 Data 서버는 내려보내지 않으므로
 * null 이다(서비스 독립 배포).
 */
public record InvitationResolved(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) IslandSummary island,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String invitationToken,
        Arrival arrival) {

    /**
     * Data {@code InvitationResolvedView.Arrival} 와 같은 필드다.
     *
     * @param reason 가입·신청을 하지 않은 사유({@code ISLAND_LIMIT}·{@code KICKED}), 없으면 null
     */
    public record Arrival(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID islandId,
            @JsonProperty(required = true) boolean arrived,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String membershipStatus,
            String reason) {
    }
}
