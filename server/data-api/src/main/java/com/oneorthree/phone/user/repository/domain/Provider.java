package com.oneorthree.phone.user.repository.domain;

import lombok.Getter;

/**
 * 소셜 로그인 제공자. (제공자, 제공자측 계정 id) 쌍이 소셜 연동의 유니크 키라, 여기 값이 바뀌면
 * 기존 연동 행이 통째로 매칭되지 않는다 — 이름은 사실상 불변으로 다룬다.
 */
@Getter
public enum Provider {
    /** 애플 — identityToken(JWT)을 서버가 애플 공개키로 검증한다. 다른 제공자와 흐름이 다르다. */
    APPLE,
    /** 구글. */
    GOOGLE,
    /** 카카오. */
    KAKAO,
    /** 라인. */
    LINE,
    /** 인스타그램. */
    INSTAGRAM,
    /** 페이스북. */
    FACEBOOK;
}
