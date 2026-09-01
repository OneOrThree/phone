package com.oneorthree.phone.focus.dto;

/**
 * 태그 채택 요청 — id 가 아니라 <b>이름</b>으로 보낸다. 같은 이름의 전역 마스터를 재사용하고 없으면 만든 뒤,
 * 이 유저의 채택 행을 세우기 때문이다. 이미 채택 중인 이름이면 아무것도 만들지 않는다(멱등).
 *
 * @param name 태그 이름. 정규화 없이 그대로 마스터를 찾으므로 공백·대소문자가 다르면 다른 태그가 된다
 */
public record FocusTagSetupRequest(String name) {
}
