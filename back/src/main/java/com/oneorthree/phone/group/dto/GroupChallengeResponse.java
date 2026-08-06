package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Getter
@Builder
public class GroupChallengeResponse {
    private UUID id;
    private MissionType missionType;
    private MissionCategory missionCategory;

    /** DURATION: 하루 목표 분 · TIME_WINDOW: 창 내 목표 분(V20 additive — 목표 없는 구 창 챌린지는 null). */
    private Integer durationMinutes;

    private String windowStart;
    private String windowEnd;
    private GroupChallengeStatus status;
    private Instant createdAt;
    private boolean canParticipate;

    /**
     * 멤버별 당일 진행률. 조회 시 {@code date} 를 주지 않았거나 목표 없는 창 챌린지
     * ({@code durationMinutes = null}), 또는 이미 끝난 챌린지({@code status = INACTIVE})면 null 이다
     * (하위 호환: 기존 클라이언트는 date 를 보내지 않으므로 필드가 항상 null 로 나간다).
     *
     * <p>TIME_WINDOW 는 date(KST) 의 창 기준 — FOCUS 는 세션 클리핑 실측(달성 판정만 5분 관용치),
     * SCREEN_TIME 은 클라 보고값(미보고 = null, 3상 유지).
     */
    private List<ChallengeMemberProgressResponse> memberProgress;

    /**
     * 조회 {@code date} 의 진행 중 내기. 내기가 없거나 date 를 주지 않았으면 null 이다.
     * 내기는 FOCUS + DURATION 챌린지에만 걸리므로 다른 챌린지에서는 항상 null 이다.
     */
    private GroupBetResponse bet;

    /**
     * 이 챌린지의 가장 최근 정산 내기(카드의 '지난 내기' 한 줄). 정산 이력이 없으면 null.
     * 조회 {@code date} 와 무관하므로 date 없이도 채워진다.
     */
    private GroupBetResultResponse lastSettledBet;

    /**
     * 휴면 챌린지 배지(GROMO-1201) — 내기 이력은 있는데(status 무관, 취소 포함) 지금 걸린 OPEN 내기가
     * 없으면 true. 이력 없는 새 챌린지는 항상 false 이고, date 없는 하위 호환 조회는 현재 내기를 싣지
     * 않아 판정하지 않는다(false). primitive 라 항상 직렬화된다 — 앱은 3상 관례상
     * {@code dormant?: boolean} optional 로 받아 구서버 undefined 를 흡수한다(additive).
     */
    private boolean dormant;
}
