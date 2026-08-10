package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupBetVoidReason;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 내기 히스토리 한 건(GROMO-1207) — {@link GroupBetResultResponse} 와 같은 구조에 목록 식별용
 * {@code betId}(커서로도 쓰인다)와 {@code settledAt} 을 더한 것이다.
 *
 * <p>{@code status} 는 정산 결과 3종(SETTLED·REFUNDED·FORFEITED)뿐이다 — CANCELED 는 "없던 일"이라
 * 이력에 실리지 않는다. {@code goalMinutes} 와 참가자별 {@code progressMinutes} 는 V29 이전 정산
 * 건이면 null 이다(앱은 "—"·분모 생략으로 그린다).
 */
@Getter
@Builder
public class GroupBetHistoryItemResponse {

    private UUID betId;
    private LocalDate betDate;
    private int stake;
    private int pot;
    private GroupBetStatus status;

    /**
     * 종료 사유(N55) — {@code VOIDED}(인원 미달·챌린지 삭제)와 24h 데드라인 자동 환불
     * ({@code REFUNDED} + {@code REFUND_DEADLINE})에만 채워진다. 사유가 없으면 내역이 "달성자 0명
     * 환불"과 "시스템 미정산 환불"을 구분하지 못한다. 추가 전용 — 구앱은 무시한다(N36).
     */
    private GroupBetVoidReason voidReason;
    private Instant settledAt;

    /** 정산 시점의 목표 분 스냅샷 — null = 미기록(V29 이전 정산). 항상 직렬화한다(계약 §1). */
    private Integer goalMinutes;

    private List<GroupBetResultParticipantResponse> results;
}
