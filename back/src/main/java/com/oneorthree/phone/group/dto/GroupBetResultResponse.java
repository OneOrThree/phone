package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.domain.GroupBetStatus;
import lombok.Builder;
import lombok.Getter;

import java.time.LocalDate;
import java.util.List;

/**
 * 이 챌린지의 가장 최근 정산 내기 — 카드의 "지난 내기" 한 줄용. 정산 이력이 없으면 필드가 null 이다.
 *
 * <p>{@code status} 는 {@code SETTLED}(분배) 또는 {@code REFUNDED}(달성자 0명 전원 환불)다.
 */
@Getter
@Builder
public class GroupBetResultResponse {

    private LocalDate betDate;
    private int stake;
    private int pot;
    private GroupBetStatus status;

    private List<GroupBetResultParticipantResponse> results;
}
