package com.oneorthree.business.upstream.notification.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

/**
 * 결과 ack prepare 응답 (A22 ⓓ · ㊅).
 *
 * <p><b>「대기 클레임을 HELD 로 바꾼다」만으로는 부족하다</b> — 사용자의 ack 가 Kafka 소비·재훑기보다
 * 먼저 오면 잠글 행이 아직 없어 no-op 이 되고, 나중에 도착한 사건이 발송을 낸다. 그래서 prepare 는
 * <b>행이 없어도 tombstone 을 만든다</b>({@code (userId, BET_RESULT, sessionId)} insert-or-transition).
 *
 * <p>{@code held=false} 는 「이미 확정된 상태여서 잠글 필요가 없다」는 뜻일 수 있다 — 그 경우에도
 * Data ack는 이미 확정됐으므로 추가 쓰기 없이 성공한다. 이 값을 「실패」로 읽으면 정상 재시도가 막힌다.
 *
 * @param held  이번 호출이 HELD 잠금을 쥐었는가
 * @param ackDeadlineAt HELD의 필수 실행 기한. 이미 확정된 CONFIRMED에서는 없어도 된다.
 * @param state 선점된 {@code HELD} 또는 이미 억제된 {@code CONFIRMED}. HELD는 held=true여야 한다.
 */
public record ResultAckPrepareResult(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean held,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String state,
        String ackDeadlineAt) {
}
