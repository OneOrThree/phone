package com.oneorthree.phone.group.dto;

import lombok.Builder;
import lombok.Getter;

import java.util.UUID;

/**
 * 정산이 끝난 내기의 참가자별 결과 한 줄.
 *
 * <p>{@code achieved} 를 {@link Boolean} 으로 둔 이유는 {@link ChallengeMemberProgressResponse}
 * 와 같다 — primitive boolean 이면 is-getter 암묵 이름 때문에 {@code isAchieved}/{@code achieved}
 * 이중 직렬화 함정에 걸린다.
 */
@Getter
@Builder
public class GroupBetResultParticipantResponse {

    /**
     * 참가자 사용자 id. 탈퇴자 행은 null 이다(계정 LLD §4 — 과거 회차 명단이 탈퇴자 UUID 를 다른 그룹원에게
     * 계속 잇지 않게). 목록 key·행 구분에는 {@link #participantId} 를 쓴다.
     */
    private UUID userId;

    /** 회차별 참가 행 id — 탈퇴자 행도 항상 채워지는 목록 key. 회차를 넘어 같은 사람을 잇지 않는다. */
    private UUID participantId;

    private String nickname;

    /** 정산 시점 판정 — 당일 집중 분 ≥ 챌린지 목표 분. */
    private Boolean achieved;

    /** 분배금(패자 0) 또는 환불금(달성자 0명 내기). */
    private Integer payout;

    /**
     * 정산 판정에 쓴 실측 분(GROMO-1207). null = 미계측(SCREEN_TIME 미보고·V29 이전 정산) —
     * 앱은 "—" 로 그리므로 0(진짜 0분)과 구분해 항상 직렬화한다({@code @JsonInclude(NON_NULL)}
     * 금지, 계약 §1).
     */
    private Integer progressMinutes;
}
