package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

/**
 * 위성 쓰기 전 활성 검사 결과 (A22 ⓖ · §5).
 *
 * <p>위성(알림·링크) 직행 쓰기는 Data 의 {@code X-User-Id} 활성 검사를 <b>안 거친다</b> — 그래서
 * 탈퇴 직전 발급된 AT 로 최대 AT 수명(3600초) 동안 기기 토큰을 재등록하거나 초대를 귀속시킬 수 있다.
 * 이 검사가 그 창을 닫는다.
 *
 * <p><b>{@code authGeneration} 을 일부러 담지 않는다.</b> 담아 두면 「AT 에 {@code gen} 이 없으니
 * 여기서 받은 현재 세대로 채우자」는 유혹이 생기는데, 그건 로그아웃 전에 발급된 옛 AT 를 최신 세대로
 * 태깅해 <b>기기 토큰 tombstone 을 우회</b>한다(A22 ㊍). 세대는 AT claim 에서만 온다.
 *
 * @param active 이 유저가 쓰기를 해도 되는 상태인가. 탈퇴·비활성은 false
 */
public record UserActivation(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean active) {
}
