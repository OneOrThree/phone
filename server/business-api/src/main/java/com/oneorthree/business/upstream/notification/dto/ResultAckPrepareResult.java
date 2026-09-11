package com.oneorthree.business.upstream.notification.dto;

/**
 * 결과 ack prepare 응답 (A22 ⓓ · ㊅).
 *
 * <p><b>「대기 클레임을 HELD 로 바꾼다」만으로는 부족하다</b> — 사용자의 ack 가 Kafka 소비·재훑기보다
 * 먼저 오면 잠글 행이 아직 없어 no-op 이 되고, 나중에 도착한 사건이 발송을 낸다. 그래서 prepare 는
 * <b>행이 없어도 tombstone 을 만든다</b>({@code (userId, BET_RESULT, sessionId)} insert-or-transition).
 *
 * <p>{@code held=false} 는 「이미 확정된 상태여서 잠글 필요가 없다」는 뜻일 수 있다 — 그 경우에도
 * Data ack 커밋은 진행한다. 이 값을 「실패」로 읽으면 정상 ack 가 막힌다.
 *
 * @param held  이번 호출이 HELD 잠금을 쥐었는가
 * @param state 알림 서버가 본 현재 상태 — {@code HELD} · {@code COMMITTED} · {@code NEEDS_CONFIRM} 등
 */
public record ResultAckPrepareResult(boolean held, String state) {
}
