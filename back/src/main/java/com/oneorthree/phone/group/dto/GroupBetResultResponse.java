package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.domain.GroupBetStatus;
import lombok.Builder;
import lombok.Getter;

import java.time.LocalDate;
import java.util.List;

/**
 * 이 챌린지의 가장 최근 정산 내기 — 카드의 "지난 내기" 한 줄용. 정산 이력이 없으면 필드가 null 이다.
 *
 * <p>{@code status} 는 정산 결과 3종이다 — {@code SETTLED}(달성자에게 분배) ·
 * {@code FORFEITED}(승자 0명, 팟 몰수·소멸) · {@code REFUNDED}(정산 불가로 회차 무효화, 전원 환불).
 * CANCELED 는 "없던 일"이라 이 줄에 오지 않는다({@code findLatestSettledByChallengeIds} 의 허용
 * 목록과 같은 규칙). 종전 주석은 몰수 룰 도입 전 문구라 {@code FORFEITED} 가 빠져 있었다.
 */
@Getter
@Builder
public class GroupBetResultResponse {

    private LocalDate betDate;
    private int stake;
    private int pot;
    private GroupBetStatus status;

    /**
     * 정산 시점의 목표 분 스냅샷(GROMO-1207) — 참가자별 {@code progressMinutes} 의 분모.
     * null = 미기록(V29 이전 정산) — 앱은 분모를 생략해 그리므로 항상 직렬화한다
     * ({@code @JsonInclude(NON_NULL)} 금지, 계약 §1).
     */
    private Integer goalMinutes;

    private List<GroupBetResultParticipantResponse> results;
}
