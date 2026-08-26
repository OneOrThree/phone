package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupBetVoidReason;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import lombok.Builder;
import lombok.Getter;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.UUID;

/**
 * 그룹 챌린지 내역 한 줄 — {@code GET /groups/{gid}/challenge-history} (GROMO-1271, N6-1).
 *
 * <p>표시 값은 전부 <b>회차 미션 스냅샷</b>에서 온다 — 챌린지가 삭제돼도 조인 없이 한 줄이
 * 온전하다(이력의 소유자를 그룹으로 승격한 이유). 스냅샷 null 은 V39 백필 이전 정산 이력뿐이다
 * (앱은 "—" 로 그린다).
 */
@Getter
@Builder
public class GroupChallengeHistoryItemResponse {
    private UUID sessionId;

    /** 회차 날짜(KST). */
    private LocalDate sessionDate;

    /** 삭제된 챌린지여도 값은 있다(소프트 삭제 — 행이 남는다). */
    private UUID challengeId;

    /** 앱이 "삭제된 챌린지" 배지를 단다(LLD §2.1). */
    private boolean challengeDeleted;

    /** 미션 스냅샷 — 카테고리. */
    private MissionCategory missionCategory;

    /** 미션 스냅샷 — 방식. */
    private MissionType missionType;

    /** 미션 스냅샷 — 목표 분. */
    private Integer goalMinutes;

    /** 미션 스냅샷 — 창 시작(KST 벽시계, 창형만). */
    private LocalTime windowStart;

    /** 미션 스냅샷 — 창 종료(KST 벽시계, 창형만). */
    private LocalTime windowEnd;

    private int stake;

    /** 적립금 = stake × 참가 인원(정산 당시 사실). */
    private int pot;

    /** SETTLED | REFUNDED | FORFEITED | VOIDED — UNUSED(0명 종료)는 내역에 안 실린다(N52). */
    private GroupBetStatus status;

    /** VOIDED·REFUNDED 만 — 사유 없이 상태 하나면 "인원 부족" 카피가 삭제 건까지 거짓말한다. */
    private GroupBetVoidReason voidReason;

    /** 내 지급/환불액 — 미참가 회차는 null. */
    private Integer myPayout;

    /** 내 달성 여부 — 미참가·판정 없는 종료는 null. */
    private Boolean myAchieved;

    /** 내 실측 분 — 미참가·미계측은 null(0분과 구분 — 계약 §1). */
    private Integer myProgressMinutes;

    /** 달성 인원 수. */
    private int achievedCount;

    /** 참가 인원 수. */
    private int participantCount;
}
