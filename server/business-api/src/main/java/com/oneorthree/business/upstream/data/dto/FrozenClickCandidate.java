package com.oneorthree.business.upstream.data.dto;

import java.util.Map;

/**
 * 구 {@code invite_link_clicks} 정지 스냅샷 행의 <b>래퍼</b> — Data 의 read-only export 로만 온다(§7.2).
 *
 * <h2>왜 필드를 풀지 않고 {@code Map} 으로 나르는가</h2>
 * 링크 서버가 이 값을 받는 형태가 {@code {source, sourceChecksum}} 이고
 * ({@code link/src/lib/migration.ts:98} — {@code importClick(tx, id, frozen(entry.source), entry.sourceChecksum)}),
 * <b>{@code sourceChecksum} 은 {@code source} 객체 전체에 대한 체크섬</b>이다
 * ({@code migration.ts:61} 의 {@code checksum(source) !== suppliedChecksum} → {@code SOURCE_CHECKSUM_MISMATCH}).
 *
 * <p>그래서 Business 가 필드를 풀어 다시 조립하면 <b>키 순서·타입·null 표현이 조금만 달라져도 체크섬이
 * 깨진다</b> — 그리고 그 체크섬은 §7.2 4단계 검증의 기준이라, 깨지면 이관 검증을 닫을 수 없다.
 * Business 는 이 이관 경로에서 <b>운반체일 뿐</b>이므로 원본 JSON 을 손대지 않고 통째로 전달한다.
 * 필드를 아는 주체는 Data(만드는 쪽)와 링크(검증하는 쪽) 둘이면 충분하다.
 *
 * <p>{@code source} 의 실제 모양은 {@code migration.ts} 의 {@code FrozenClick} 25필드다 —
 * {@code clickId · linkId · slug · groupId · inviterId · linkVersion · membershipEpoch · transitionSeq ·
 * groupName · inviterName · groupClosed · linkStatus · linkCreatedAt · revokedAt · ipHash · os ·
 * userAgent · clickedAt · matched · matchedAt · matchedDeviceId · appInstanceId · claimedUserId ·
 * claimedAt}. Data 가 이 전량을 채워야 한다(축약하면 {@code frozen()} 의 {@code INVALID_FROZEN_CLICK}
 * 또는 불변 필드 검증에서 떨어진다).
 *
 * @param source         정지 행 원본 JSON. <b>Business 는 이 객체를 수정하지 않는다</b>
 * @param sourceChecksum {@code source} 전체의 체크섬(64자 hex). 4단계 검증이 이 값을 대조한다
 */
public record FrozenClickCandidate(Map<String, Object> source, String sourceChecksum) {
}
