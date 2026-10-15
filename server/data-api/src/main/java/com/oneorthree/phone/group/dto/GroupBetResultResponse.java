package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupBetVoidReason;
import lombok.Builder;
import lombok.Getter;

import java.time.LocalDate;
import java.util.List;

/**
 * 이 챌린지의 가장 최근 정산 내기 — 카드의 "지난 내기" 한 줄용. 정산 이력이 없으면 필드가 null 이다.
 *
 * <p>{@code status} 는 {@code SETTLED}(분배)·{@code FORFEITED}(몰수)·{@code REFUNDED}(전원 환불)이고,
 * 종료 사유는 {@code voidReason} 이 보조한다(N55).
 */
@Getter
@Builder
public class GroupBetResultResponse {

    private LocalDate betDate;
    private int stake;
    private int pot;
    private GroupBetStatus status;

    /**
     * 종료 사유(N55) — {@code VOIDED}(인원 미달·챌린지 삭제)와 24h 데드라인 자동 환불
     * ({@code REFUNDED} + {@code REFUND_DEADLINE})에만 채워지고 그 외 종료는 null 이다.
     *
     * <p><b>사유 없이 status 만 내려보내면 앱이 거짓말을 한다</b>: 앱 배너는 모든 {@code REFUNDED}
     * 를 "달성한 사람이 없어 전원 환불됐어요"로 그리므로, <b>시스템이 정산하지 못해</b> 환불된
     * 회차가 참가자 전원 실패로 안내된다. 추가 전용 필드라 구앱은 모르는 키를 무시한다(N36).
     */
    private GroupBetVoidReason voidReason;

    /**
     * 정산 시점의 목표 분 스냅샷(GROMO-1207) — 참가자별 {@code progressMinutes} 의 분모.
     * null = 미기록(V29 이전 정산) — 앱은 분모를 생략해 그리므로 항상 직렬화한다
     * ({@code @JsonInclude(NON_NULL)} 금지, 계약 §1).
     */
    private Integer goalMinutes;

    private List<GroupBetResultParticipantResponse> results;
}
