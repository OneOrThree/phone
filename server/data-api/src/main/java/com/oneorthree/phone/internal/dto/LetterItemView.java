package com.oneorthree.phone.internal.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.phone.common.port.MemberLookPort;
import com.oneorthree.phone.letter.repository.domain.LetterKind;

import java.time.Instant;
import java.util.UUID;

/**
 * 편지함 목록의 한 건 (GROMO-1933, friend-letter LLD §1.13).
 *
 * <p><b>뒤의 세 칸은 시스템 편지함({@code kind=system}, GROMO-2260)에서만 나간다.</b> 친구 편지는 셋 다
 * null 이라 직렬화에서 빠져, 친구 편지함 응답은 GROMO-2260 이전과 키까지 같다 — 구 앱이 받는 모양을
 * 바꾸지 않는다.
 *
 * @param counterpartUserId     상대 — {@code type=received} 면 발신자, {@code type=sent} 면 수신자. 시스템
 *     편지는 발신자가 없어 null
 * @param counterpartNickname   상대 닉네임. 탈퇴자는 null(LLD §3)
 * @param isRead                {@code type=sent} 일 때는 <b>항상 false</b> — 내가 보낸 편지를 상대가 읽었는지는
 *     이 계약에서 노출하지 않는다. 키 이름을 애노테이션으로 고정한다({@code FriendResponse.isPinned} 와 같은 이유)

 * @param catColor              상대 고양이 색(GROMO-2389). 미선택·탈퇴·시스템 편지면 null
 * @param appearance            상대 착용 외양(GROMO-2389). 탈퇴·시스템 편지면 null
 * @param kind                  시스템 편지의 종류({@code KICK|JOIN_APPROVED}). 친구 편지는 null(키 없음)
 * @param islandId              시스템 편지가 가리키는 섬. 친구 편지는 null(키 없음)
 * @param readAt                시스템 편지를 처음 연 시각. 안 읽었거나 친구 편지면 null(키 없음)
 */
public record LetterItemView(
        UUID id,
        UUID counterpartUserId,
        String counterpartNickname,
        String content,
        @JsonProperty("isRead") boolean isRead,
        Instant createdAt,
        @JsonInclude(JsonInclude.Include.NON_NULL) LetterKind kind,
        @JsonInclude(JsonInclude.Include.NON_NULL) UUID islandId,
        @JsonInclude(JsonInclude.Include.NON_NULL) Instant readAt,
        String catColor,
        MemberLookPort.Appearance appearance) {
}
