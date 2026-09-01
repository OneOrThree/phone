package com.oneorthree.phone.user.repository.domain;

import lombok.Getter;

/**
 * 소셜 로그인 제공자. (제공자, 제공자측 계정 id) 쌍이 소셜 연동의 유니크 키라, 여기 값이 바뀌면
 * 기존 연동 행이 통째로 매칭되지 않는다 — 이름은 사실상 불변으로 다룬다.
 */
@Getter
public enum Provider {
    APPLE, GOOGLE, KAKAO, LINE, INSTAGRAM, FACEBOOK;
}
