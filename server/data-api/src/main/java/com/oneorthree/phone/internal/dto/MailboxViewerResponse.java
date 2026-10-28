package com.oneorthree.phone.internal.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.oneorthree.phone.appearance.dto.PersonalAppearanceView;

import java.util.UUID;

/**
 * 우체통이 쓰는 최소 표시 projection (GROMO-1775) — 이름·고양이 색·착용 외양(GROMO-2389).
 *
 * <p>{@code catColor}·{@code appearance} 는 «추가» 필드다. 탈퇴 계정은 {@code name} 과 함께 둘 다 null 이다 —
 * 지운 사람의 외양을 내리지 않는다. 요청자가 차단한 작성자는 목록에서 통째로 빠지므로 치환 대상이 아니다.
 *
 * @param userId     사용자
 * @param name       표시 이름. 탈퇴 계정은 {@code null} — 키 자체는 항상 실린다(수신 측이 «없음»과 «null»을 구분한다)
 * @param catColor   고양이 색. 미선택·탈퇴면 null
 * @param appearance 착용 외양. 탈퇴면 null
 */
public record MailboxViewerResponse(UUID userId, @JsonInclude(JsonInclude.Include.ALWAYS) String name,
                                    String catColor, PersonalAppearanceView appearance) {
}
