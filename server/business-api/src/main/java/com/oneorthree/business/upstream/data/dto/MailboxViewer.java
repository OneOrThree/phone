package com.oneorthree.business.upstream.data.dto;

import java.util.UUID;

/**
 * Data 의 우체통 인가 결과이자 작성자 표시 projection — 이름·고양이 색·착용 외양 (GROMO-1775 · GROMO-2389).
 *
 * <p>{@code catColor}·{@code appearance} 는 필수가 아니다 — 이 필드를 싣기 전의 Data 가 먼저 떠 있어도 역직렬화가
 * 깨지지 않는다. 탈퇴 계정은 셋 다 null 이다.
 *
 * @param userId     사용자
 * @param name       표시 이름. 탈퇴 계정은 null
 * @param catColor   고양이 색. 미선택·탈퇴면 null
 * @param appearance 착용 외양. 탈퇴면 null
 */
public record MailboxViewer(UUID userId, String name, String catColor, PersonalAppearanceState appearance) {
}
