package com.oneorthree.business.usecase;

import java.util.UUID;

/**
 * 한 요청 안에서 쓸 {@code Idempotency-Key} 를 만든다.
 *
 * <h2>키 소유자는 앱이다</h2>
 * A22 ㉼: 호출자는 첫 응답 전엔 {@code eventId} 를 모르고 Business 는 무상태라 앱 재시도마다 새 키가
 * 생긴다 → 앱이 {@code Idempotency-Key} 헤더로 보내고 Data 가 UNIQUE 저장 후 <b>응답을 재생</b>한다.
 * 그래서 앱이 키를 보내면 <b>그 값을 그대로 쓴다</b>.
 *
 * <h2>구 앱은 키를 안 보낸다 — 매 호출 새 키다</h2>
 * A22 ㊞: <b>요청 본문에서 키를 도출하면 안 된다</b>. 종료된 챌린지를 같은 설정으로 다시 만드는 정상
 * 명령이 접히고, 같은 설정으로 되돌리는 정상 알림 설정 변경도 접힌다. 그래서 구 앱 요청에는
 * <b>매 호출 새 UUID</b> 를 만든다 — 그 키가 보호하는 것은 «Business 내부의 재시도»뿐이라고 인정한다
 * (앱 보급 후 필수화).
 *
 * <p>한 요청이 여러 상류를 부를 때는 <b>단계별로 접미를 붙인</b> 파생 키를 쓴다. 같은 키를 Data 와
 * 알림에 같이 보내면 두 저장소의 멱등 테이블이 서로 다른 명령을 같은 키로 보게 된다.
 */
public final class RequestIdempotencyKeys {

    private final String base;

    private RequestIdempotencyKeys(String base) {
        this.base = base;
    }

    /**
     * @param headerValue 앱이 보낸 {@code Idempotency-Key}. null·공백이면 이번 호출용 새 키를 만든다
     */
    public static RequestIdempotencyKeys from(String headerValue) {
        if (headerValue == null || headerValue.isBlank()) {
            return new RequestIdempotencyKeys(UUID.randomUUID().toString());
        }
        return new RequestIdempotencyKeys(headerValue.trim());
    }

    /**
     * 단계별 파생 키. <b>재시도에서 같은 값이 나와야 한다</b> — 그래서 무작위가 아니라 base 에 단계
     * 이름을 붙인 결정적 문자열이다({@code InternalHttpClient} 가 같은 {@code InternalCall} 을 다시
     * 보내므로 재시도 안에서는 애초에 변하지 않고, 이 규칙은 «앱 재시도»까지 같은 키가 되게 한다).
     */
    public String forStep(String step) {
        return base + ":" + step;
    }

    public String base() {
        return base;
    }
}
