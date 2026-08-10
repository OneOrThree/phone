package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupBetVoidReason;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import lombok.Builder;
import lombok.Getter;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

/**
 * 내 정산 완료 회차 한 건 — {@code GET /me/challenge-results} (GROMO-1415, N53 결과 모달의 유일한
 * 소스). 참가자 스코프라 그룹 탈퇴·챌린지 종료(ENDED)와 무관하게 실리고, 삭제된 챌린지의 회차만
 * 빠진다(FR-44-4·N48 — 삭제 환불은 {@code BET_VOID_REFUND} 푸시가 알린다).
 *
 * <p>미션 스냅샷(카테고리·방식·창 시각)은 결과 모달의 관용치 고지 복원용 additive 필드다
 * (배치 결정 로그 [R0·A2→B6] — 티켓 1217 계열).
 */
@Getter
@Builder
public class MyChallengeResultResponse {
    private UUID sessionId;
    private UUID groupId;

    /** 그룹 이름 — 탈퇴자는 그룹방을 못 읽어도 결과 모달에 이름은 보여준다(LLD §2.1). */
    private String groupName;

    private UUID challengeId;

    /** 삭제 회차는 애초에 응답에서 빠지므로 항상 false — 계약 필드로 유지한다(FR-44-4). */
    private boolean challengeDeleted;

    /** 챌린지가 종료(ENDED/INACTIVE)됐어도 결과는 실린다(N38 — N53 으로 이관). */
    private boolean challengeEnded;

    /** 회차 날짜(KST). */
    private LocalDate sessionDate;

    private int stake;

    /** 적립금 총액 = stake × 참가 인원(정산 당시 사실 — 계약 §1). */
    private int pot;

    /** SETTLED | FORFEITED | VOIDED | REFUNDED — UNUSED(0명 종료)는 안 실린다(N52). */
    private GroupBetStatus status;

    /** VOIDED·REFUNDED 만 — 인원 미달/삭제/24h 를 구분해야 카피가 거짓말하지 않는다(N33). */
    private GroupBetVoidReason voidReason;

    /** 미션 스냅샷 — 목표 분(회차 박제값). */
    private Integer goalMinutes;

    /** 미션 스냅샷 — 카테고리(additive). */
    private MissionCategory missionCategory;

    /** 미션 스냅샷 — 방식(additive). */
    private MissionType missionType;

    /** 미션 스냅샷 — 창 시작(KST 벽시계, 창형만·additive). */
    private LocalTime windowStart;

    /** 미션 스냅샷 — 창 종료(KST 벽시계, 창형만·additive). */
    private LocalTime windowEnd;

    /** 내 달성 여부 — 판정 없는 종료(무산·환불)는 null. */
    private Boolean myAchieved;

    /** 내 지급/환불액 — 패자 0, 정산 전 판정 불가 케이스는 null. */
    private Integer myPayout;

    /** 인별 달성·payout·실측(IA §4.3) — 탈퇴자는 닉네임만 치환된다(계약 §1). */
    private List<GroupBetResultParticipantResponse> results;
}
