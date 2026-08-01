package com.oneorthree.phone.group.dto;

import java.time.LocalDate;

/**
 * 내기 일 배치 실행 요약 (수동 트리거 응답 · 로그용).
 *
 * @param settledBefore 이 날짜 <b>미만</b>의 bet_date 를 정산 대상으로 삼았다(= KST 오늘)
 * @param targetCount   대상으로 집은 미정산 내기 수
 * @param settledCount  달성자에게 분배해 확정한 내기 수
 * @param refundedCount 달성자 0명이라 전원 환불한 내기 수
 * @param skippedCount  대상으로 집었지만 이 실행이 지급하지 않은 내기 수 — 동시 실행(스케줄러 ↔ 수동
 *                      트리거)에서 다른 쪽이 먼저 정산한 경우다. 정상이며, 성공 건수와 섞이면 지표가
 *                      부풀려지므로 따로 센다
 * @param failedCount   해당 내기만 롤백된 실패 건수(불변식 위반 등) — 0 이 아니면 에러 로그를 봐야 한다
 * @param elapsedMillis 총 소요 시간(ms)
 */
public record GroupBetSettlementSummaryResponse(
        LocalDate settledBefore,
        int targetCount,
        int settledCount,
        int refundedCount,
        int skippedCount,
        int failedCount,
        long elapsedMillis) {
}
