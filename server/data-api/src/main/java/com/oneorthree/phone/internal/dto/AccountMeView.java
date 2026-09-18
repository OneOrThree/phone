package com.oneorthree.phone.internal.dto;

import java.util.List;
import java.util.UUID;

/**
 * 공개 {@code GET /me} 의 상류 응답 (GROMO-1801 · 계정 LLD §2.2).
 *
 * @param id                 사용자 UUID
 * @param name               닉네임. 미설정이면 null
 * @param catColor           Q03 미결이라 컬럼이 없다 — 항상 null 이고 임의 기본색을 채우지 않는다
 * @param linkedProviders    활성 소셜 연동 provider 소문자·중복 제거·오름차순. 게스트면 빈 배열
 * @param onboardingComplete {@code OnboardingCompletion} 판정 — 로그인 응답과 같은 함수
 */
public record AccountMeView(UUID id, String name, String catColor, List<String> linkedProviders,
                            boolean onboardingComplete) {
    public AccountMeView {
        linkedProviders = List.copyOf(linkedProviders);
    }
}
