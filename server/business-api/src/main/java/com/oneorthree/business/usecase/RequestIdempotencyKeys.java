package com.oneorthree.business.usecase;

import com.oneorthree.business.common.exception.CommonErrorCode;
import com.oneorthree.business.common.exception.DomainException;

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

    /**
     * 앱이 보낼 수 있는 {@code Idempotency-Key} 의 상한.
     *
     * <h2>왜 여기서 자르는가</h2>
     * 상류의 저장 컬럼이 {@code varchar(200)} 이고(Data {@code command_idempotency} ·
     * {@code invite_claim_intents}, 링크 쪽도 200 에서 400 을 낸다) Business 는 여기에 <b>단계 접미를
     * 덧붙여</b> 보낸다. 검증이 없으면 190자 헤더 하나가 Data 에서 컬럼 초과로 터져
     * <b>{@code INTERNAL_ERROR} 500</b> 이 되고, 사용자는 「서버 장애」로 본다 — 실제로는 요청이 잘못된
     * 400 이다. 상한을 200 이 아니라 150 으로 두는 것은 가장 긴 접미({@code :device-delete-outbox},
     * 21자)까지 얹어도 남는 여유를 확보하기 위해서다.
     *
     * <p><b>자르지 않고 거절한다.</b> 잘라 보내면 서로 다른 명령이 같은 키로 접혀 두 번째 명령이
     * 첫 번째의 응답을 재생받는다 — 조용한 오답이 500 보다 나쁘다.
     */
    private static final int MAX_KEY_LENGTH = 150;

    private final String base;

    private RequestIdempotencyKeys(String base) {
        this.base = base;
    }

    /**
     * @param headerValue 앱이 보낸 {@code Idempotency-Key}. null·공백이면 이번 호출용 새 키를 만든다
     * @throws DomainException {@code INVALID_PARAMETER}(400) — 150자를 넘었다.
     *     상류 컬럼을 넘겨 500 으로 터지게 두지 않는다
     */
    public static RequestIdempotencyKeys from(String headerValue) {
        if (headerValue == null || headerValue.isBlank()) {
            return new RequestIdempotencyKeys(UUID.randomUUID().toString());
        }
        String trimmed = headerValue.trim();
        if (trimmed.length() > MAX_KEY_LENGTH) {
            throw new DomainException(CommonErrorCode.INVALID_PARAMETER);
        }
        return new RequestIdempotencyKeys(trimmed);
    }

    /**
     * <b>저장된 단계 키에서 base 를 복원한다</b> — 재개가 원 시도와 «같은 키»로 상류를 부르기 위해서다.
     *
     * <p>Data 의 {@code invite_claim_intents.idempotency_key} 에는 원 요청이 <b>그 단계에</b> 쓴 값,
     * 즉 {@code base:claim-intent} 가 저장돼 있다({@code InviteLinkUseCase} 가 적재 호출에 그 파생 키를
     * 실어 보낸다). 그 값을 다시 base 로 삼아 {@link #forStep} 하면 재개의 링크 claim 키가
     * {@code base:claim-intent:link-claim} 이 되어 <b>원 시도의 {@code base:link-claim} 과 달라진다</b> —
     * A22 ㉼ 와 {@link ClaimIntentReplayService} 의 계약(「원래 키를 그대로 쓴다」)이 금지한 바로 그
     * 경로이고, 상류의 자연키 방어가 하나라도 걷히는 날 클릭을 한 번 더 소진한다.
     *
     * <p>접미가 붙어 있지 않으면(다른 caller 가 적재한 값 등) <b>그 값을 그대로 base 로 쓴다</b> —
     * 없는 접미를 억지로 떼면 원래 키를 훼손한다. 마지막 한 번만 떼므로 base 가 우연히 같은 접미로
     * 끝나는 경우도 안전하다.
     *
     * @param storedStepKey 상류에 저장된 단계 키
     * @param step          그 값이 달고 있는 단계 이름
     */
    public static RequestIdempotencyKeys fromStepKey(String storedStepKey, String step) {
        String trimmed = storedStepKey.trim();
        String suffix = ":" + step;
        return new RequestIdempotencyKeys(trimmed.endsWith(suffix)
                ? trimmed.substring(0, trimmed.length() - suffix.length())
                : trimmed);
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
