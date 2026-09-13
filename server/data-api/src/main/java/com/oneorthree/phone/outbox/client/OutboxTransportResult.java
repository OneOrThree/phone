package com.oneorthree.phone.outbox.client;

/**
 * 전달 한 건의 결과.
 *
 * <p>「성공/실패」만이 아니라 <b>재시도 가능한가</b>를 함께 돌려준다. 설정에 없는 엔드포인트 키처럼
 * 재시도해도 절대 성공하지 않는 실패는, 브로커 순단과 같은 백오프로 무한히 돌면 로그만 채우고
 * 진짜 장애를 가린다.
 *
 * <p>다만 <b>어느 쪽이든 행을 지우지 않는다</b> — 고갈 처리는 A18 보류다. 재시도 불가도 기록만 하고
 * 남긴다(사람이 설정을 고치면 그때부터 나간다).
 *
 * @param delivered 전달에 성공했으면 {@code true}
 * @param retryable 재시도로 성공할 여지가 있으면 {@code true}
 * @param error     실패 요약 — 성공이면 {@code null}
 */
public record OutboxTransportResult(boolean delivered, boolean retryable, String error) {

    /**
     * 이름이 {@code delivered()} 가 아닌 이유: record 컴포넌트 접근자와 이름이 겹치면 컴파일되지 않는다.
     *
     * @return 성공 결과
     */
    public static OutboxTransportResult success() {
        return new OutboxTransportResult(true, false, null);
    }

    /**
     * @param error 실패 요약
     * @return 재시도로 풀릴 수 있는 실패(브로커 순단·타임아웃·5xx)
     */
    public static OutboxTransportResult retry(String error) {
        return new OutboxTransportResult(false, true, error);
    }

    /**
     * @param error 실패 요약
     * @return 재시도해도 그대로인 실패(설정 누락·계약 위반). 사람이 고쳐야 한다
     */
    public static OutboxTransportResult permanent(String error) {
        return new OutboxTransportResult(false, false, error);
    }
}
