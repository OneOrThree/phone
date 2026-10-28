package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * {@code GET /internal/users/{userId}/focus-sessions/pending-result} 응답 (GROMO-1998).
 *
 * <p>휴식이 1시간을 넘겨 서버가 자동 종료한 집중의 <b>아직 안 보여 준</b> 결과다. 없으면
 * {@code {"result": null}} 이고 <b>빈 본문이 아니다</b>.
 *
 * <p><b>{@code required = true} 인데 {@code Nulls.FAIL} 은 아니다</b> — 이유는
 * {@link CurrentFocusSession} 과 같다. 값이 {@code null} 인 것은 「보여 줄 결과 없음」이라는 정상 계약이고,
 * <b>키 자체가 없는 것</b>은 상류 계약 불일치다. 이 구분이 없으면 배포가 어긋나 {@code {}} 를 받은 순간
 * 사용자가 영영 못 볼 결과가 조용히 {@code data:null} 이 된다.
 *
 * @param result 미확인 자동 종료 결과. 없으면 {@code null}(키는 반드시 있어야 한다)
 */
public record PendingFocusResult(@JsonProperty(required = true) FocusFinish result) {
}
