package com.oneorthree.phone.outbox.dto;

/**
 * 멱등 명령의 결과 — 값과 「이번에 실행했는가」.
 *
 * <p>{@code replayed=true} 는 <b>이번 호출이 아무것도 만들지 않았다</b>는 뜻이다. 호출부가 이걸 보고
 * 응답 상태를 바꿀 필요는 없다(A21 은 같은 봉투를 돌려주는 것을 계약으로 삼는다) — 관측과 테스트를
 * 위해 구분해 둔다.
 *
 * @param value    응답 값 — 첫 실행이면 명령이 만든 것, 재생이면 저장된 것
 * @param replayed 저장된 응답을 재생했으면 {@code true}
 * @param <T>      응답 타입
 */
public record IdempotentOutcome<T>(T value, boolean replayed) {
}
