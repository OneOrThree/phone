package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.domain.GroupBetStatus;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 카드 응답의 <b>오늘(조회 date) 회차</b> — {@code bet.session}, 신앱(A3) 전용 additive 필드
 * (GROMO-1418 · LLD §2.1). 조회 date 의 회차가 없으면(비활성 요일) null 이다 — 레거시 필드의
 * 내일 폴백(계약 §3)과 달리 <b>이 필드는 폴백하지 않는다</b>: 앱이 "오늘 회차"로 읽고 카운트다운을
 * 그리므로 내일 회차를 실으면 축이 하루 밀린다(내일 축은 {@code nextSessionAt} 이 담당).
 *
 * <p>{@code @JsonInclude(NON_NULL)} 금지 — 앱은 undefined(구서버) ↔ null(오늘 회차 없음)을
 * 3상으로 구분한다(LLD §2.1 직렬화 계약).
 */
@Getter
@Builder
public class GroupBetSessionResponse {

    private UUID sessionId;

    /** 회차 날짜(KST) — 조회 date 와 항상 같다(폴백 없음). */
    private LocalDate sessionDate;

    /** 이 회차에 박제된 참가비(GROMO-1263). */
    private int stake;

    /** 이 회차에 박제된 목표 분. null = V39 백필 이전 이력뿐(새 회차는 항상 채워진다). */
    private Integer goalMinutes;

    /** pot = stake × 참가자 수. */
    private int pot;

    private GroupBetStatus status;

    /** 회차 시작 — 참가 취소(시작 전) 기준. 하루형은 회차일 00:00 KST, 창형은 창 시작. */
    private Instant startsAt;

    /** 참가 마감(LLD §1.1) — 창형은 창 시작, 하루형은 회차 종료. 카운트다운 축. */
    private Instant joinClosesAt;

    /**
     * 내 취소 마감(서버 계산 정본, N22) — 시작 전 참가는 회차 시작까지(유예 없음), 시작 후
     * 참가(하루형)는 min(참가+5분, 회차 종료). 미참여·종료 회차는 null(취소 진입점 없음).
     */
    private Instant myLeaveDeadlineAt;

    /** 회차 종료. */
    private Instant closesAt;

    private Boolean myJoined;

    /** 레거시 {@code bet.myAchievedNow} 와 같은 값·같은 카테고리별 의미(FOCUS 확정 / SCREEN_TIME 잠정). */
    private Boolean myAchievedNow;

    private List<GroupBetSessionParticipantResponse> participants;
}
