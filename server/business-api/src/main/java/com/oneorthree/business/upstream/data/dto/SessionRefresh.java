package com.oneorthree.business.upstream.data.dto;

/**
 * Data 가 확정한 AT 재발급 결과 — 공개 200 의 두 필드와 <b>같다</b> (GROMO-2035).
 *
 * <p>{@link LoginSession} 과 같은 이유로 상류 DTO 와 공개 DTO 를 같은 모양으로 둔다: 상류가
 * {@code sessionId}·{@code deviceBootstrap} 을 실어 보내고 Business 가 그걸 «거르는» 구조였다면,
 * 거르는 줄 하나가 빠지는 순간 노출이다.
 *
 * <p>{@code refreshToken} 은 현재 <b>언제나 null</b> 이다 — 계정 LLD §3 「정상 RT 회전의 클라이언트
 * 전환 gate」를 통과하기 전의 미회전 호환 응답이다.
 */
public record SessionRefresh(String accessToken, String refreshToken) {
}
