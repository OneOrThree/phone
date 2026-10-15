package com.oneorthree.phone.group.dto;

import java.time.LocalDate;

/**
 * 내기 수동(MANUAL) 배치 실행 요약 (수동 트리거 응답 · 감사 로그용).
 *
 * @param settledBefore  실행 기준일(KST) — 대상 선택 축이 날짜에서 <b>회차별 {@code settle_after}
 *                       경과</b>로 바뀌었지만(GROMO-1411 후속 — 당일 창형 회차도 잡는다) 응답 shape
 *                       호환을 위해 필드명·타입은 유지한다
 * @param targetCount    대상으로 집은 미정산 내기 수
 * @param settledCount   달성자에게 분배해 확정한 내기 수
 * @param forfeitedCount 달성자 0명이라 팟 전액을 몰수한 내기 수
 * @param refundedCount  24h 데드라인 초과로 전원 자동 환불된 내기 수(N21)
 * @param skippedCount   대상으로 집었지만 이 실행이 지급하지 않은 내기 수 — 동시 실행(스케줄러 ↔ 수동
 *                       트리거)에서 다른 쪽이 먼저 정산했거나, 가드(그레이스·FOCUS 대기)에 걸렸거나,
 *                       지급 없는 정리(UNUSED·VOIDED)였던 경우다. 성공 건수와 섞이면 지표가
 *                       부풀려지므로 따로 센다
 * @param failedCount    해당 내기만 롤백된 실패 건수(불변식 위반 등) — 0 이 아니면 에러 로그를 봐야 한다
 * @param elapsedMillis  총 소요 시간(ms)
 */
public record GroupBetSettlementSummaryResponse(
        LocalDate settledBefore,
        int targetCount,
        int settledCount,
        int forfeitedCount,
        int refundedCount,
        int skippedCount,
        int failedCount,
        long elapsedMillis) {
}
