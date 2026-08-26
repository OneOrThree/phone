package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.UUID;

/**
 * 내 OPEN 회차 한 건 — {@code GET /me/bet-sessions?status=OPEN} (GROMO-1415, N43).
 *
 * <p>미션 스냅샷(카테고리·방식·목표·창 시각)을 회차 행에서 그대로 싣는다 — 챌린지 조인이 불가능한
 * 상황(종료·삭제·그룹 탈퇴)이 이 API 의 존재 이유라, 앱({@code screentimeSync.ts})이 이 응답만으로
 * 창 경계를 계산해 {@code window-usage} 로 보고한다.
 */
@Getter
@Builder
public class MyBetSessionResponse {
    private UUID sessionId;
    private UUID groupId;
    private UUID challengeId;

    /** 회차 날짜(KST). */
    private LocalDate sessionDate;

    /** 미션 스냅샷 — 카테고리. */
    private MissionCategory missionCategory;

    /** 미션 스냅샷 — 방식. */
    private MissionType missionType;

    /** 미션 스냅샷 — 목표 분. null 은 V39 백필 이전 이력뿐(OPEN 회차에서는 없다). */
    private Integer goalMinutes;

    /** 미션 스냅샷 — 창 시작(KST 벽시계). DURATION 은 null. */
    private LocalTime windowStart;

    /** 미션 스냅샷 — 창 종료(KST 벽시계). DURATION 은 null. */
    private LocalTime windowEnd;

    /** 회차 종료 — 보고 마감 판단용(실제 보고는 정산 전까지 받는다 — N43). */
    private Instant closesAt;

    /** 정산 가능 시각 — 사일런트 flush 타이밍 판단용(FR-22). */
    private Instant settleAfter;
}
