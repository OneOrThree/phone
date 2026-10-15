package com.oneorthree.phone.notification.dto;

/**
 * 푸시 발송 배치 요약(B4) — 스케줄러 로그와 수동 트리거 응답이 같은 값을 쓴다.
 *
 * <p>{@code targetCount == sentCount + dedupedCount + skippedCount} 가 항상 성립한다.
 * "재실행하면 0건 발송" 을 QA 가 눈으로 확인하는 지점이라 dedup 을 스킵과 분리해서 센다.
 *
 * @param targetCount   발송 판정을 시도한 (유저 × 대상) 건수
 * @param sentCount     실제 발송이 성사된 건수(= sent_log 에 기록된 수)
 * @param dedupedCount  이미 발송 이력이 있어 건너뛴 건수
 * @param skippedCount  알림 off·토큰 없음·quiet hours·발송 실패로 나가지 않은 건수
 * @param elapsedMillis 배치 소요 시간(ms)
 */
public record PushDispatchSummaryResponse(
        int targetCount,
        int sentCount,
        int dedupedCount,
        int skippedCount,
        long elapsedMillis) {
}
