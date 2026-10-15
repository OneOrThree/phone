package com.oneorthree.phone.user.support;

import java.util.Set;

/**
 * 고양이 색 카탈로그 — 계정 Q03(2026-09-19 권장안 승인). 앱 2.0 의 {@code colors}
 * ({@code app/app-dev/src/services/model.ts}) 6종 그대로이고 {@code users.cat_color} CHECK(V80)와 같은 값이다.
 * 색이 늘면 이 목록·V80 CHECK·Business {@code AccountController} 를 함께 늘린다.
 */
public final class CatColors {

    /** 허용 자산 ID. 문자열을 이미지 URL·파일 경로로 해석하지 않는다(계정 LLD §2.3). */
    public static final Set<String> IDS = Set.of("black", "ginger", "cream", "gray", "white", "calico");

    private CatColors() {
    }
}
