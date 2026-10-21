package com.oneorthree.business.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;
import java.util.UUID;

/**
 * 우체통 편지 한 통 — 공개 계약 {@code Message} (island-mailbox LLD §2). GET items 와 POST 응답이 같은 모양이다.
 *
 * <p>{@code catColor}·{@code appearance} 는 GROMO-2389 로 «추가»됐다(재영님 결정 2026-09-18 의 후속) —
 * 작성자의 고양이 색과 착용 외양이다. 탈퇴·계정 없음이면 {@code name} 과 함께 둘 다 null 이다. 요청자가 차단한
 * 작성자의 메시지는 목록에서 빠지므로 치환 대상이 아니다.
 *
 * @param id              서버 부여 id(UUID v7). 정렬·커서의 근거
 * @param clientMessageId 앱 멱등 키 — GET items 에도 싣는다(LLD §2 명시 확장: 낙관적 말풍선 병합용)
 * @param userId          작성자
 * @param name            표시 이름. 탈퇴·비노출은 null — 키는 항상 실린다
 * @param catColor        작성자 고양이 색. 미선택·탈퇴면 null
 * @param appearance      작성자 착용 외양. 탈퇴·계정 없음이면 null
 * @param text            저장된 본문
 * @param createdAt       서버 수신 시각(UTC ISO-8601)
 */
public record MailboxMessageResponse(
        UUID id,
        UUID clientMessageId,
        UUID userId,
        @JsonInclude(JsonInclude.Include.ALWAYS) String name,
        @JsonInclude(JsonInclude.Include.ALWAYS) String catColor,
        @JsonInclude(JsonInclude.Include.ALWAYS) MemberAppearanceView appearance,
        String text,
        Instant createdAt) {
}
