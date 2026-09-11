package com.oneorthree.phone.internal.dto;

/**
 * 위성 쓰기 전 활성 검사 결과 (A22 ⓖ).
 *
 * <p><b>{@code authGeneration} 을 일부러 담지 않는다.</b> 담아 두면 「AT 에 {@code gen} 이 없으니 여기서
 * 받은 현재 세대로 채우자」는 유혹이 생기는데, 그건 로그아웃 전에 발급된 옛 AT 를 최신 세대로 태깅해
 * 기기 토큰 tombstone 을 우회한다(㊍). 세대는 AT claim 에서만 온다.
 *
 * @param active 쓰기를 허용해도 되는 상태인가. 탈퇴·비활성은 false
 */
public record UserActivationResponse(boolean active) {
}
