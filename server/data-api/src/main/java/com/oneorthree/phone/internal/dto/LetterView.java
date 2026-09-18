package com.oneorthree.phone.internal.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * 편지 한 통의 내부 응답 — 발송(LLD §1.12)과 상세 조회(§1.14)가 공유한다.
 *
 * <p>LLD 는 두 계약의 필드를 따로 적었고 발송 쪽에만 {@code senderNickname} 이 없다. 여기서는 하나로
 * 합치고 발송 응답에도 발신자(=호출자) 닉네임을 채운다 — 상세의 상위집합이라 앱이 받는 값이 줄지 않고,
 * 같은 「편지 한 통」을 두 모양으로 두면 화면이 둘을 다르게 파싱해야 한다.
 *
 * @param senderNickname 발신자 닉네임. <b>탈퇴자는 null</b> — {@code erasePersonalData} 가 닉네임만 지우고
 *     유저 행은 남기므로(LLD §3) 조회 시점에 자연히 null 이 된다
 * @param readAt         수신자가 처음 상세를 연 시각. 안 읽었으면 null. 발송 직후는 항상 null 이다
 */
public record LetterView(
        UUID id,
        UUID senderId,
        String senderNickname,
        UUID receiverId,
        String content,
        Instant createdAt,
        Instant readAt) {
}
