package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * {@code GET /internal/users/{userId}/focus-sessions/current} 응답 (GROMO-1764).
 *
 * <p>세션이 없으면 {@code {"session": null}} 이다 — <b>빈 본문이 아니다</b>. 화면 계약(bff-screens
 * LLD §1)이 "빈 HTTP 200/204 는 정상 null 의 증거가 아니다"라고 정한 자리라, Data 가 명시 null 키를
 * 보내고 {@link com.oneorthree.business.common.http.InternalHttpClient} 는 빈 본문을 계약 불일치로
 * 올린다. 공개 응답의 {@code data:null} 은 이 값을 벗겨 만든다.
 *
 * <p><b>{@code required = true} 인데 {@code Nulls.FAIL} 은 아니다</b> — 이 필드는 둘을 구분해야 한다.
 * 값이 {@code null} 인 것은 「진행 중 세션 없음」이라는 정상 계약이고, <b>키 자체가 없는 것</b>은
 * 상류 계약 불일치다. {@code required = true} 는 생성자 프로퍼티의 «등장 여부»만 보므로
 * {@code {"session":null}} 은 통과하고 {@code {}} 는 실패한다. 이 구분이 없으면 배포가 어긋나
 * {@code {}} 를 받은 순간 진행 중이던 세션이 공개 {@code data:null} 로 조용히 사라진다.
 *
 * @param session 진행(active/paused) 중인 세션. 없으면 {@code null}(키는 반드시 있어야 한다)
 */
public record CurrentFocusSession(@JsonProperty(required = true) FocusSessionState session) {
}
