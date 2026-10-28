package com.oneorthree.phone.auth.client;

import org.springframework.http.client.SimpleClientHttpRequestFactory;

import java.time.Duration;

/**
 * 소셜 제공자(IdP) 클라이언트 공용 HTTP 타임아웃.
 *
 * <p>로그인 실행 임차(LoginAttemptService 의 EXECUTION_LEASE)는 30초다. 타임아웃이 없으면 느린
 * 제공자 하나가 임차보다 오래 붙잡혀, 다른 실행자가 시도를 회수한 뒤에야 응답이 돌아온다.
 * 연결 5초 + 읽기 5초면 제공자 왕복 한 번이 임차보다 한참 짧게 끝난다(2026-10-07 결정:
 * connect 5s / read 5s).
 */
final class IdpHttp {

    /** 연결 타임아웃. */
    static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(5);

    /** 읽기 타임아웃. */
    static final Duration READ_TIMEOUT = Duration.ofSeconds(5);

    private IdpHttp() {
    }

    static SimpleClientHttpRequestFactory requestFactory() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(CONNECT_TIMEOUT);
        factory.setReadTimeout(READ_TIMEOUT);
        return factory;
    }
}
