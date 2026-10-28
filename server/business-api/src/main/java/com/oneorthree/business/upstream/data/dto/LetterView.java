package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.UUID;

/**
 * 편지 한 통 (GROMO-1933) — 발송(POST /letters)과 상세 조회(GET /letters/{id})가 공유하는
 * Data {@code LetterView} 를 그대로 내보낸다.
 *
 * @param id             편지 id
 * @param senderId       발신자. 시스템 편지(GROMO-2260)는 null
 * @param senderNickname 발신자 닉네임. 탈퇴자는 null
 * @param receiverId     수신자
 * @param content        본문
 * @param createdAt      발송 시각 — DB {@code NOT NULL} 이라 누락·null 은 계약 불일치다
 * @param readAt         수신자의 최초 열람 시각. 안 읽었으면 null — 발송 직후는 항상 null
 * @param kind           {@code FRIEND|KICK|JOIN_APPROVED} (GROMO-2260). 구 Data 서버는 내려보내지 않는다
 * @param islandId       시스템 편지가 가리키는 섬. 친구 편지는 null
 * @param catColor       발신자 고양이 색(GROMO-2389) — 필수가 아니다(옛 Data 응답 호환). 차단한 상대면 Data 가 null 로 내린다
 * @param appearance     발신자 착용 외양(GROMO-2389) — 필수가 아니다. 차단한 상대면 Data 가 기본 외양으로 내린다
 */
public record LetterView(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
        UUID senderId,
        String senderNickname,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID receiverId,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String content,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String createdAt,
        String readAt,
        String kind,
        UUID islandId,
        String catColor,
        PersonalAppearanceState appearance) {
}
