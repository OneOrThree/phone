package com.oneorthree.phone.internal.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.oneorthree.phone.common.port.MemberLookPort;
import com.oneorthree.phone.letter.repository.domain.LetterKind;

import java.time.Instant;
import java.util.UUID;

/**
 * 편지 한 통의 내부 응답 — 발송(LLD §1.12)과 상세 조회(§1.14)가 공유한다.
 *
 * <p>LLD 는 두 계약의 필드를 따로 적었고 발송 쪽에만 {@code senderNickname} 이 없다. 여기서는 하나로
 * 합치고 발송 응답에도 발신자(=호출자) 닉네임을 채운다 — 상세의 상위집합이라 앱이 받는 값이 줄지 않고,
 * 같은 「편지 한 통」을 두 모양으로 두면 화면이 둘을 다르게 파싱해야 한다.
 *
 * <p>{@code kind}·{@code islandId} 는 시스템 편지 상세에서만 나간다(GROMO-2260) — 친구 편지는 null 이라
 * 직렬화에서 빠지고 응답이 GROMO-2260 이전과 같다.
 *
 * @param senderId       발신자. <b>시스템 편지는 null</b> — 시스템 편지는 수신자 본인에게만 나간다
 * @param senderNickname 발신자 닉네임. <b>탈퇴자는 null</b> — {@code erasePersonalData} 가 닉네임만 지우고
 *     유저 행은 남기므로(LLD §3) 조회 시점에 자연히 null 이 된다
 * @param readAt         수신자가 처음 상세를 연 시각. 안 읽었으면 null. 발송 직후는 항상 null 이다

 * @param catColor       발신자 고양이 색(GROMO-2389). 미선택·탈퇴·시스템 편지면 null. 차단한 상대면 null
 * @param appearance     발신자 착용 외양(GROMO-2389). 탈퇴·시스템 편지면 null. 차단한 상대면 기본 외양
 * @param kind           시스템 편지의 종류. 친구 편지는 null(키 없음)
 * @param islandId       시스템 편지가 가리키는 섬. 친구 편지는 null(키 없음)
 */
public record LetterView(
        UUID id,
        UUID senderId,
        String senderNickname,
        UUID receiverId,
        String content,
        Instant createdAt,
        Instant readAt,
        @JsonInclude(JsonInclude.Include.NON_NULL) LetterKind kind,
        @JsonInclude(JsonInclude.Include.NON_NULL) UUID islandId,
        String catColor,
        MemberLookPort.Appearance appearance) {
}
