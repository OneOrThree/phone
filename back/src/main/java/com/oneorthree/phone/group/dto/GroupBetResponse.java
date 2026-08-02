package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.domain.GroupBetStatus;
import lombok.Builder;
import lombok.Getter;

import java.util.List;
import java.util.UUID;

/**
 * 챌린지 카드에 붙는 "오늘의 내기". 조회 {@code date} 의 내기가 없으면 필드 자체가 null 이다.
 *
 * <p>{@code myJoined}/{@code myAchievedNow} 를 {@link Boolean} 으로 둔 것은 is 접두 getter 의
 * 이중 직렬화 함정을 피하기 위함이다(선례: {@link ChallengeMemberProgressResponse}).
 */
@Getter
@Builder
public class GroupBetResponse {

    private UUID betId;

    /**
     * 개설자 — 앱이 취소 버튼(개설자 본인 && 단독 참가 && OPEN)을 판정하는 데 쓴다.
     * additive 필드이며 {@code @JsonInclude(NON_NULL)} 은 금지 — 앱은 bet 필드의
     * undefined/null 을 구분하는 3상 로직이라 직렬화 형태가 흔들리면 안 된다.
     */
    private UUID creatorUserId;

    /** 1인 판돈. */
    private int stake;

    /** 팟 = stake × 참가자 수. */
    private int pot;

    private GroupBetStatus status;

    /** 내가 이미 참가했는가. */
    private Boolean myJoined;

    /**
     * 지금 이미 목표를 달성했는가 — true 면 참가가 거절된다({@code BET_ALREADY_ACHIEVED}).
     * 앱이 참가 버튼을 미리 잠그고 안내하는 데 쓴다.
     */
    private Boolean myAchievedNow;

    private List<GroupBetParticipantResponse> participants;
}
