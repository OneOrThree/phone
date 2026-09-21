package com.oneorthree.phone.focus.dto.session;

/**
 * {@code GET /internal/users/{userId}/focus-sessions/pending-result} 응답 (GROMO-1998).
 *
 * <p>휴식이 1시간을 넘겨 서버가 자동 종료한 집중의 <b>아직 안 보여 준</b> 결과다. 없으면
 * {@code {"result": null}} 이다 — <b>빈 본문으로 답하지 않는다</b>. 이유는
 * {@link CurrentFocusSessionResponse} 와 같다: bff-screens LLD §1 의 "빈 HTTP 200/204 는 정상 null 의
 * 증거가 아니다" 이고, Business 의 {@code InternalHttpClient} 도 빈 본문을 계약 불일치(502)로 올린다.
 *
 * <p>값은 {@code finish} 응답과 <b>같은 모양</b>이다 — 정책이 「정상 종료와 같게」라고 정했으므로
 * 앱이 결과창을 두 벌 그리지 않게 한다. 보여 준 뒤에는
 * {@code POST /focus-sessions/{sessionId}/acknowledge} 로 확인 처리해야 다시 오지 않는다.
 *
 * @param result 미확인 자동 종료 결과 중 가장 오래된 것. 없으면 {@code null}(키는 반드시 있어야 한다)
 */
public record PendingFocusResultResponse(FocusFinishView result) {
}
