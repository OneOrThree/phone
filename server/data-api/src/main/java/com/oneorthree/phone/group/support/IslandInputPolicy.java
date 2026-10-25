package com.oneorthree.phone.group.support;

/** 섬 생성·관리·방문 입력에 공통으로 적용하는 규칙. */
public final class IslandInputPolicy {

    public static final int MAX_JOINED_ISLANDS = 3;

    /** 보이는 글자를 요구하고 개행·제어문자·양방향 제어문자를 거절한다. */
    public static final String NAME_PATTERN =
            "^(?=.*[^\\p{javaWhitespace}\\p{Z}\\p{C}\\p{M}\\u115F\\u1160\\u2800\\u3164\\uFFA0])"
                    + "[^\\p{Cc}\\p{Zl}\\p{Zp}\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]*$";

    private IslandInputPolicy() {
    }
}
