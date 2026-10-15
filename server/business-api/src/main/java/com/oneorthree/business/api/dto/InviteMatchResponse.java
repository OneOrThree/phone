package com.oneorthree.business.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.UUID;

/**
 * deferred 매치 응답 — 기존 계약을 그대로 재현한다.
 *
 * <p>실패도 <b>200 {@code {"matched": false}}</b> 다 — 앱은 이 응답을 받았다는 사실만으로 「확인 완료」
 * 플래그를 세우고 다음 실행에서 재시도하지 않는다. 4xx/5xx 로 내려가면 재시도 루프가 돈다.
 *
 * <p><b>그래서 「매치 안 됨」과 「판정 불가」를 섞으면 안 된다</b> — 상류 장애를 {@code matched:false}
 * 로 접으면 그 설치의 초대가 영구히 사라진다. 판정 불가는 5xx 로 올라간다(계약 §4).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record InviteMatchResponse(boolean matched, String slug, UUID groupId) {

    /** {@code matched=false} — slug·groupId 는 null 이라 JSON 에서 아예 빠진다. */
    public static InviteMatchResponse notMatched() {
        return new InviteMatchResponse(false, null, null);
    }

    /** {@code matched=true}. <b>가입이 끝났다는 뜻이 아니다</b> — 앱이 사용자 확인을 받은 뒤 claim 한다. */
    public static InviteMatchResponse matched(String slug, UUID groupId) {
        return new InviteMatchResponse(true, slug, groupId);
    }
}
