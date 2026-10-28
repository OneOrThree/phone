package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.UUID;

/**
 * 편지함 목록의 한 건 (GROMO-1933) — Data 의 {@code LetterItemView} 와 같은 필드라 <b>그대로
 * 내보낸다</b>(friend-letter LLD §1.13). 시각은 계산하지 않고 전달만 하므로 문자열로 받는다
 * ({@link FriendItem} 과 같은 취급).
 *
 * @param id                  편지 id — 다음 페이지 커서가 이 값이다
 * @param counterpartUserId   상대 — 받은함이면 발신자, 보낸함이면 수신자. 시스템 편지(GROMO-2260)는 null
 * @param counterpartNickname 상대 닉네임. 탈퇴자는 null
 * @param content             본문
 * @param isRead              받은함만 실제 값. 보낸함은 Data 가 항상 false 로 내린다 — 키 이름을
 *                            애노테이션으로 고정한다({@link FriendItem#isPinned} 와 같은 이유)
 * @param createdAt           발송 시각 — DB {@code NOT NULL} 이라 누락·null 은 계약 불일치다
 * @param kind                {@code FRIEND|KICK|JOIN_APPROVED} (GROMO-2260). 구 Data 서버는 내려보내지 않는다
 * @param islandId            시스템 편지가 가리키는 섬. 친구 편지는 null
 * @param readAt              시스템 편지를 처음 연 시각. 친구 편지·안 읽은 편지는 null
 */
public record LetterItem(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
        UUID counterpartUserId,
        String counterpartNickname,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String content,
        @JsonProperty(value = "isRead", required = true) @JsonSetter(nulls = Nulls.FAIL) boolean isRead,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String createdAt,
        String kind,
        UUID islandId,
        String readAt) {
}
