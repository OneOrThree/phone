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
 * <p>{@code arrival} 은 초대 도착 결과다 (GROMO-2264). 필수로 걸지 않는다 — 도착을 요청({@code arrive=true})하지 않은
 * 미리보기와 구 Data 서버(서비스 독립 배포)는 null 이다.
 */
public record InvitationResolved(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) IslandSummary island,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String invitationToken,
        Arrival arrival) {

    /**
     * Data {@code InvitationResolvedView.Arrival} 와 같은 필드다.
     *
     * @param reason 바로 가입하지 않은 사유({@code ISLAND_LIMIT}·{@code KICKED} — 강퇴자는 신청은 할 수 있다, GROMO-2315),
     *     없으면 null
     */
    public record Arrival(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID islandId,
            @JsonProperty(required = true) boolean arrived,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String membershipStatus,
            String reason) {
    }
}
