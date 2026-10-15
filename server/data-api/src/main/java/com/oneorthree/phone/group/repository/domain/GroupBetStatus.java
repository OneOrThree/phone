package com.oneorthree.phone.group.repository.domain;

import java.util.List;

/**
 * 그룹 챌린지 내기 <b>회차</b> 상태 (GROMO-1262 2계층 재편 이후).
 *
 * <p>상태의 주인은 {@link GroupChallengeBetSession}(회차)다 — 설정({@link GroupChallengeBet})은
 * 상태를 갖지 않는다. {@code OPEN} 만 참가 가능하며, 정산 배치가 훑는 유일한 상태다.
 *
 * <p>종료 상태 전이는 전부 {@code GroupChallengeBetSessionRepository.compareAndSetSettled} 의
 * 원자적 CAS 를 거친다 — 정산 배치·삭제 연동이 동시에 겹쳐도 한 경로만 돈을 움직인다.
 * 종료 상태는 전부 불가역이다(되돌리는 경로가 없다).
 *
 * <p>구 {@code CANCELED}(개설 취소)는 재편으로 소멸했다 — 취소 개념 자체가 사라졌고(개설이 없다),
 * 참가를 무르면 참가 행이 삭제될 뿐 회차 상태는 변하지 않는다. 마지막 참가자가 떠난 유저 개설
 * 회차는 "없던 일"로 회차 행을 삭제한다(V39 가 기존 CANCELED 행도 같은 규칙으로 정리했다).
 */
public enum GroupBetStatus {
    /** 참가 가능. 정산 전. */
    OPEN,
    /** 정산 완료 — 달성자에게 팟 분배. */
    SETTLED,
    /**
     * 전원 환불로 종료. 구 정산(승자 0명 환불) 이력이 남긴 상태이자, 24h 정산 데드라인 초과
     * 자동 환불(N21 — B4 배선)의 종착 상태다. 환불 사유는 {@code void_reason} 이 보조한다
     * ({@link GroupBetVoidReason#REFUND_DEADLINE}).
     */
    REFUNDED,
    /** 승자 0명 → 팟 전액 몰수·소멸. 아무에게도 지급하지 않는다. */
    FORFEITED,
    /**
     * 무산 — 환불 대상이 실제로 있는 경우(정확히 1명)로 한정한다(N33·N52).
     * 사유는 {@code void_reason} 에 남는다(인원 미달·챌린지 삭제).
     */
    VOIDED,
    /**
     * 참가자 0명 전용 종료(N52) — 아무도 돈을 걸지 않은 회차. 결과 큐·내역·알림 어디에도
     * 싣지 않는다("결과"가 아니다). {@code VOIDED} 로 접으면 0명 무산이 진짜 결과를 밀어낸다.
     */
    UNUSED;

    /**
     * <b>"결과"로 치는 종료 상태 4종</b> — 결과 조회({@code /me/challenge-results})·결과 모달 큐·
     * 표시 선점·확인 표시(ack)가 공유하는 단일 정의다(N52·N53 · GROMO-1577).
     *
     * <p>여기 없는 둘이 핵심이다: {@code OPEN} 은 <b>아직 결과가 아니고</b>, {@code UNUSED} 는
     * <b>결과가 아니다</b>(0명 종료). 특히 {@code OPEN} 을 빠뜨리면 정산 전 회차에 확인 표시가 찍혀
     * 그 회차가 나중에 정산됐을 때 <b>어느 기기에서도 안 뜬다</b> — 아무도 못 본 결과의 유실이다
     * (V49 백필이 같은 이유로 결과 4종만 칠한다).
     *
     * <p>목록을 각 계층이 따로 들면 한쪽만 고쳐졌을 때 조회에는 실리는데 ack 은 거부되는 식으로
     * 갈린다 — 그래서 상태의 주인인 이 enum 이 정의를 소유한다.
     */
    public static final List<GroupBetStatus> RESULT_STATUSES =
            List.of(SETTLED, REFUNDED, FORFEITED, VOIDED);

    /**
     * 같은 목록의 <b>이름</b> 판 — 선점·확인의 조건부 UPDATE 는 리스를 DB 시계로 재려고 네이티브
     * 쿼리라, enum 이 아니라 컬럼에 저장된 문자열로 비교해야 한다. 목록을 손으로 다시 적지 않고
     * {@link #RESULT_STATUSES} 에서 파생시켜 둘이 갈릴 여지를 없앤다.
     */
    public static final List<String> RESULT_STATUS_NAMES =
            RESULT_STATUSES.stream().map(Enum::name).toList();
}
