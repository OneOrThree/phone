package com.oneorthree.phone.internal.dto;

/**
 * 조회 결과. {@code session} 이 있으면 원 201 을 그대로 재생하면 된다.
 *
 * <p><b>빈 본문을 내지 않으려고 한 겹 감쌌다</b> — Business 의 {@code InternalHttpClient} 는 응답
 * 타입을 요구한 호출의 빈 본문을 502 로 올린다(계약 위반을 null 로 접으면 조용히 잘못된 성공이 되기
 * 때문). GROMO-1764 의 {@code {"session": null}} 과 같은 처리다.
 *
 * @param replayable 저장된 결과가 있는가. false 면 호출자가 제공자 교환을 실행한다
 * @param session    재생할 결과. {@code replayable=false} 면 null
 */
public record LoginAttemptLookupResponse(boolean replayable, LoginSessionResponse session) {

    public static LoginAttemptLookupResponse miss() {
        return new LoginAttemptLookupResponse(false, null);
    }

    public static LoginAttemptLookupResponse replay(LoginSessionResponse session) {
        return new LoginAttemptLookupResponse(true, session);
    }
}
