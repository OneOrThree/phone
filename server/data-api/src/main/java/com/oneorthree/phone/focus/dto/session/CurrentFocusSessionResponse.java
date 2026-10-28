package com.oneorthree.phone.focus.dto.session;

/**
 * {@code GET /internal/users/{userId}/focus-sessions/current} 응답 (GROMO-1764).
 *
 * <p>진행 세션이 없으면 {@code {"session": null}} 이다 — <b>빈 본문으로 답하지 않는다</b>.
 * bff-screens LLD §1 이 "빈 HTTP 200/204 는 정상 null 의 증거가 아니다"라고 못 박은 자리이고,
 * Business 의 {@code InternalHttpClient} 도 응답 DTO 를 요구한 호출의 빈 본문을 계약 불일치(502)로
 * 올린다 — 롤링 배포·프록시가 돌려준 빈 200 이 "세션 없음"으로 통과하면 안 되기 때문이다.
 *
 * <p>이 키는 공개 계약이 아니다. Business 가 벗겨 공개 {@code {"data": null}} 로 내려보낸다.
 *
 * @param session 진행(active/paused) 중인 세션. 없으면 {@code null}
 */
public record CurrentFocusSessionResponse(FocusSessionView session) {
}
