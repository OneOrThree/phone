package com.oneorthree.phone.invitelink.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.UUID;

/**
 * deferred 매치 응답 (스펙 §4-2 ③).
 *
 * <p>실패도 200 {@code {"matched": false}} 다 — 앱은 이 응답을 받았다는 사실만으로 "확인 완료"
 * 플래그를 세우고 다음 실행에서 재시도하지 않는다. 4xx/5xx 로 내려가면 재시도 루프가 돈다.
 *
 * <p>매치는 확률적이므로 결과로 자동 가입시키지 않는다 — 앱은 반드시 초대 시트 확인을 거친다.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record InviteMatchResponse(boolean matched, String slug, UUID groupId) {

    public static InviteMatchResponse notMatched() {
        return new InviteMatchResponse(false, null, null);
    }

    public static InviteMatchResponse matched(String slug, UUID groupId) {
        return new InviteMatchResponse(true, slug, groupId);
    }
}
