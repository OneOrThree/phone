package com.oneorthree.business.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;
import java.util.UUID;

/**
 * 우체통 편지 한 통 — 공개 계약 {@code Message} (island-mailbox LLD §2). GET items 와 POST 응답이 같은 모양이다.
 *
 * <p><b>{@code catColor} 는 아직 없다.</b> 원본 계약에는 있으나 그 값의 소유 도메인(외양, 1783 계열)이 없고
 * {@code null} 은 이미 「탈퇴·비노출」의 뜻이라 대체할 수 없다 — 그 계약이 생기면 필드를 «추가»한다
 * (재영님 결정 2026-09-18). 앱은 없는 키를 «미착수»로, {@code name:null} 을 «알 수 없음»으로 그린다.
 *
 * @param id              서버 부여 id(UUID v7). 정렬·커서의 근거
 * @param clientMessageId 앱 멱등 키 — GET items 에도 싣는다(LLD §2 명시 확장: 낙관적 말풍선 병합용)
 * @param userId          작성자
 * @param name            표시 이름. 탈퇴·비노출은 null — 키는 항상 실린다
 * @param text            저장된 본문
 * @param createdAt       서버 수신 시각(UTC ISO-8601)
 */
public record MailboxMessageResponse(
        UUID id,
        UUID clientMessageId,
        UUID userId,
        @JsonInclude(JsonInclude.Include.ALWAYS) String name,
        String text,
        Instant createdAt) {
}
