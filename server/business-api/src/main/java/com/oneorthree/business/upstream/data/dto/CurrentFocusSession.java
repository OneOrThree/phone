package com.oneorthree.business.upstream.data.dto;

/**
 * {@code GET /internal/users/{userId}/focus-sessions/current} 응답 (GROMO-1764).
 *
 * <p>세션이 없으면 {@code {"session": null}} 이다 — <b>빈 본문이 아니다</b>. 화면 계약(bff-screens
 * LLD §1)이 "빈 HTTP 200/204 는 정상 null 의 증거가 아니다"라고 정한 자리라, Data 가 명시 null 키를
 * 보내고 {@link com.oneorthree.business.common.http.InternalHttpClient} 는 빈 본문을 계약 불일치로
 * 올린다. 공개 응답의 {@code data:null} 은 이 값을 벗겨 만든다.
 *
 * @param session 진행(active/paused) 중인 세션. 없으면 {@code null}
 */
public record CurrentFocusSession(FocusSessionState session) {
}
