package com.oneorthree.phone.auth.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * Refresh Token 해시 유틸(정적) — RT 를 평문이 아닌 SHA-256 해시로 저장하기 위한 변환 (GROMO-713).
 *
 * <p>DB 읽기 유출(백업·덤프·인젝션) 시 평문 RT 는 그대로 30일짜리 자격증명이 되므로, 저장·조회 모두
 * 이 해시를 거친다. 원본 RT 를 아는 것은 클라이언트뿐이고 서버는 대조만 한다.
 *
 * <p>salt·키 스트레칭을 쓰지 않는다 — RT 는 서버가 발급한 고엔트로피 랜덤이라 사전공격·레인보우테이블이
 * 비현실적이다(저엔트로피인 비밀번호와 다르다). 비밀번호 해시로 오해해 bcrypt 로 바꾸지 말 것.
 * 상태가 없으므로 {@code static} 메서드만 노출하고 인스턴스화를 막는다.
 */
public final class TokenHasher {

    private static final String ALGORITHM = "SHA-256";

    private TokenHasher() {
    }

    /**
     * 토큰 원본을 SHA-256 해시의 소문자 hex 문자열(64자)로 변환한다.
     *
     * <p>입력 길이와 무관하게 항상 64자다(SHA-256 = 32바이트).
     *
     * @param rawToken 해싱할 토큰 원본 (null·blank 불가)
     * @return 소문자 hex 64자 해시
     */
    public static String sha256Hex(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) {
            throw new IllegalArgumentException("해싱할 토큰이 비어 있습니다");
        }

        // MessageDigest 는 내부 상태를 가져 thread-safe 하지 않다 — 필드로 캐싱하면 동시 요청이 서로의
        // 해싱 상태를 덮어써 잘못된 해시가 나온다. 비용이 낮으므로 호출마다 새 인스턴스를 얻는다.
        MessageDigest messageDigest;
        try {
            messageDigest = MessageDigest.getInstance(ALGORITHM);
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 미지원 JVM 은 현실적으로 없다. 복구 불가라 언체크로 바꿔 던지되 원인은 보존한다.
            throw new IllegalStateException(ALGORITHM + " 알고리즘 미지원", e);
        }

        byte[] hashed = messageDigest.digest(rawToken.getBytes(StandardCharsets.UTF_8));
        return HexFormat.of().formatHex(hashed);
    }
}
