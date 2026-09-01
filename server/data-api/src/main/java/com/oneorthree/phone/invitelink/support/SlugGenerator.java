package com.oneorthree.phone.invitelink.support;

import org.springframework.stereotype.Component;

import java.security.SecureRandom;

/**
 * 초대 링크 slug 생성기.
 *
 * <p>알파벳에서 {@code 0·1·o·l·i} 를 뺐다 — slug 는 카톡으로 받아 눈으로 읽고 때로는 받아 적는
 * 문자열이라, 서로 헷갈리는 글자가 섞이면 "링크가 안 열려요" 가 된다.
 *
 * <p>{@link SecureRandom} 을 쓰는 이유는 암호 강도가 필요해서가 아니라, 예측 가능한 난수면
 * 남의 그룹 초대 링크를 훑을 수 있기 때문이다(slug 만 알면 그룹명이 노출된다).
 */
@Component
public class SlugGenerator {

    private static final String ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
    private static final int LENGTH = 8;

    private final SecureRandom random = new SecureRandom();

    /**
     * @return 헷갈리는 글자를 뺀 31자 알파벳에서 뽑은 8자 문자열({@code 31^8} ≈ 8.5×10^11).
     *         <b>유일성을 보장하지 않는다</b> — 충돌 확인은 호출부가 하고 최종 방어는 DB 유니크 제약이다.
     *         공간이 넓어 실제 충돌은 사실상 일어나지 않는다
     */
    public String generate() {
        StringBuilder sb = new StringBuilder(LENGTH);
        for (int i = 0; i < LENGTH; i++) {
            sb.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        }
        return sb.toString();
    }
}
